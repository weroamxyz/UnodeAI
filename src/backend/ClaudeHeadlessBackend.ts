/*---------------------------------------------------------------------------------------------
 *  UnodeAi - ClaudeHeadlessBackend
 *  Runs an agent as a persistent `claude` process in stream-json mode.
 *
 *  Invocation:
 *    claude -p --output-format stream-json --input-format stream-json --verbose
 *           --model <model> --permission-mode <mode>
 *
 *  We talk to it over stdio: each user turn is one NDJSON line on stdin; the agent streams
 *  back NDJSON events (system/assistant/result) on stdout, which we normalize to BackendEvents.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn as nodeSpawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig, AgentModelParams } from '../types';
import {
  AgentBackend,
  BackendEvent,
  BackendEventHandler,
  TurnAttachments,
  TurnResult,
} from './AgentBackend';
import { StreamJsonParser } from './StreamJsonParser';
import {
  buildTeamBridgeConfig,
  ClaudeMcpConfig,
  ClaudeMcpServerSpec,
  PERMISSION_SERVER_ID,
  TEAM_BRIDGE_SERVER_ID,
} from '../mcp/ClaudeMcpConfig';
import { createLocalMcpServer, LocalMcpServer, LocalMcpTool } from '../mcp/LocalMcpServer';
import { TeamMcpBridge } from '../mcp/TeamMcpBridge';
import { CommandPolicy } from './CommandPolicy';
import { CommandApprover } from './WorkspaceTools';
import { decideCommandPermission, PERMISSION_TOOL_NAME } from './commandPermission';
import { projectContextBlock, replaceProjectContextBlock } from '../session/RulesFile';

/** Relative, space-free path for the MCP config we hand claude (safe for shell-spawn on Windows).
 *  Lives under .roam/ — which is gitignored — so a leftover (e.g. after an abnormal exit) carrying the
 *  local team-bridge token can never be accidentally committed. Forward slash works for the CLI arg on
 *  every platform. */
const MCP_CONFIG_FILE = '.roam/mcp.json';

export interface ClaudeHeadlessBackendDeps {
  localMcpServerFactory?: () => LocalMcpServer;
  teamMcpBridge?: TeamMcpBridge;
  spawn?: typeof nodeSpawn;
  /** Command-approval gate so a Claude agent's shell commands honor roam.commandApproval (the approval
   *  card) — wired into claude via --permission-prompt-tool. Absent → no gating (legacy behavior). */
  commandPermission?: {
    policy?: CommandPolicy;
    /** Approver bound to THIS agent's name (so the card says e.g. "Senior Developer wants to run …"). */
    requestApproval?: CommandApprover;
    /** Server factory for the per-agent permission server; defaults to createLocalMcpServer (injectable for tests). */
    createServer?: () => LocalMcpServer;
  };
}

export class ClaudeHeadlessBackend implements AgentBackend {
  public readonly agentId: string;

  private proc: ChildProcess | undefined;
  private parser = new StreamJsonParser();
  private handlers = new Set<BackendEventHandler>();
  private firstTurnSent = false;
  private readyEmitted = false;
  private mcpConfigPath: string | undefined;
  private localMcpServer: LocalMcpServer | undefined;
  private permissionServer: LocalMcpServer | undefined;

  /**
   * @param mcpConfig optional claude-native MCP config; when present we write it to a relative
   *        `.roam-mcp.json` in the agent cwd and pass `--mcp-config`. claude hosts the servers
   *        itself (we do NOT use the in-process MCPHub for claude agents).
   * @param resolvedParams optional resolved model params (F2). claude's params are set at spawn, so
   *        only fields with a CLI flag apply: `reasoning_effort` → `--effort`. The rest are ignored
   *        (no flags exist — see PRD F1 backend matrix). `--json-schema` needs a concrete schema, so
   *        response_format:json_object is intentionally NOT mapped here (deferred).
   */
  constructor(
    private config: AgentConfig,
    private mcpConfig?: ClaudeMcpConfig,
    private resolvedParams?: AgentModelParams,
    private deps: ClaudeHeadlessBackendDeps = {}
  ) {
    this.agentId = config.id;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  onEvent(handler: BackendEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(env: NodeJS.ProcessEnv): Promise<void> {
    if (this.proc) {
      return;
    }

    const cwd = this.config.workingDirectory || process.cwd();
    const mcpConfig = await this.prepareMcpConfig();
    this.writeMcpConfig(cwd, mcpConfig);
    // If an MCP config was built but couldn't be written (e.g. unwritable cwd), claude won't know about our
    // local servers — so stop them (don't leak a loopback server) and don't reference them. buildArgs()
    // keys --mcp-config off mcpConfigPath and --permission-prompt-tool off permissionServer (now cleared),
    // so neither dangling flag is emitted.
    if (mcpConfig && !this.mcpConfigPath) {
      await this.stopLocalMcpServer();
    }
    const args = this.buildArgs();

    // On Windows the global `claude` is a `.cmd` shim, which Node (post CVE-2024-27980) won't launch
    // directly. We keep the historically-working `shell:true` form (the two shell-free alternatives
    // both prevented claude from starting on Windows). The DEP0190 "args + shell" deprecation is
    // cosmetic here: tokens are space-free by construction (fixed flags + space-free model/permission
    // ids + the relative .roam-mcp.json path); the long role/system prompt is folded into the first
    // user turn (see sendUserTurn), never the argv.
    const useShell = process.platform === 'win32';
    const spawn = this.deps.spawn ?? nodeSpawn;
    try {
      const proc: ChildProcess = spawn(useShell ? 'claude.cmd' : 'claude', args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: useShell,
      });
      this.proc = proc;

      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');

      proc.stdout?.on('data', (chunk: string) => this.consumeStdout(chunk));

      proc.stderr?.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          if (line.trim()) {
            this.emit({ kind: 'log', stream: 'stderr', line: line.trim() });
          }
        }
      });

      proc.on('error', (err: Error) => {
        this.emit({ kind: 'error', message: err.message });
      });

      proc.on('exit', (code: number | null) => {
        const tail = this.parser.flush();
        tail.objects.forEach((o) => this.handleEvent(o));
        this.proc = undefined;
        this.firstTurnSent = false;
        this.readyEmitted = false;
        this.cleanupMcpConfig();
        void this.stopLocalMcpServer();
        this.emit({ kind: 'exit', code });
      });

      await new Promise<void>((resolve, reject) => {
        proc.once('spawn', () => {
          // `claude -p` block-buffers stdout, so its system/init line doesn't flush until it has
          // received a turn to work on. SessionManager gates the first turn on `ready`, so waiting
          // for init here would deadlock (it waits for input; we wait for init). The process is able
          // to accept a turn the moment it spawns — that's what `ready` means — so emit it now and
          // treat the later system/init purely as metadata enrichment.
          this.emitReady(this.config.model);
          resolve();
        });
        proc.once('error', (err) => reject(err));
      });
    } catch (err) {
      // Spawn failed (e.g. missing/broken claude binary): the 'exit' handler won't fire, so the local
      // permission/team-bridge servers we started above + the .roam/mcp.json we wrote would leak. Clean up
      // explicitly, then rethrow so SessionManager sees the failed start. (Pre-0.8.79 this leaked only the
      // PM bridge; now it would leak a permission server for every non-autoApprove Claude agent.)
      this.proc = undefined;
      this.cleanupMcpConfig();
      await this.stopLocalMcpServer();
      throw err;
    }
  }

  /** Emit `ready` exactly once per process lifetime (deduping spawn vs system/init). */
  private emitReady(model?: string, backendSessionId?: string): void {
    if (this.readyEmitted) {
      return;
    }
    this.readyEmitted = true;
    this.emit({ kind: 'ready', model, backendSessionId });
  }

  sendUserTurn(instruction: string, attachments?: TurnAttachments): void {
    if (!this.proc?.stdin) {
      this.emit({ kind: 'error', message: 'Agent process is not running; cannot send turn.' });
      return;
    }

    const text = this.composeTurnText(instruction, attachments);
    const turn = {
      type: 'user',
      message: { role: 'user', content: text },
    };

    this.proc.stdin.write(JSON.stringify(turn) + '\n');
  }

  async stop(forceTimeoutMs = 10000): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.pid === undefined) {
      return;
    }

    await new Promise<void>((resolve) => {
      const force = setTimeout(() => this.killTree(proc.pid!), forceTimeoutMs);
      proc.once('exit', () => {
        clearTimeout(force);
        resolve();
      });

      // End stdin first so the agent can finish the current turn, then signal.
      try {
        proc.stdin?.end();
      } catch {
        /* stdin may already be closed */
      }
      proc.kill('SIGTERM');
    });
    await this.stopLocalMcpServer();
  }

  abort(): void {
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: 'Interrupt requested, but Claude per-turn cancellation is not available in v0.2.0; leaving the process running.',
    });
  }

  /** Update the model for the next spawn. Claude's model is fixed at process start (--model), so this
   *  takes effect when the agent is next restarted, not mid-session. */
  setModel(model: string): void {
    if (model) {
      this.config.model = model;
    }
  }

  isAlive(): boolean {
    return this.proc !== undefined && this.proc.exitCode === null;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private buildArgs(): string[] {
    const mode = this.config.autoApprove ? 'bypassPermissions' : 'acceptEdits';
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-mode', mode,
    ];
    // Route claude's permission requests (e.g. Bash) to our in-process gate so they hit Roam's approval
    // card. Mounted by prepareMcpConfig only in acceptEdits mode (bypassPermissions ignores it).
    if (this.permissionServer) {
      args.push('--permission-prompt-tool', `mcp__${PERMISSION_SERVER_ID}__${PERMISSION_TOOL_NAME}`);
    }
    if (this.config.model) {
      args.push('--model', this.config.model);
    }
    // F1: reasoning effort is the only sampling-ish param the claude CLI exposes (--effort). Resolved
    // params win; fall back to the agent's explicit modelParams. All other params have no CLI flag.
    const effort = this.resolvedParams?.reasoning_effort ?? this.config.modelParams?.reasoning_effort;
    if (effort) {
      args.push('--effort', effort);
    }
    // Claude-native MCP: a relative, space-free config path so the Windows shell-spawn can't mangle
    // it. claude hosts the declared servers itself.
    if (this.mcpConfigPath) {
      args.push('--mcp-config', MCP_CONFIG_FILE);
    }
    return args;
  }

  private async prepareMcpConfig(): Promise<ClaudeMcpConfig | undefined> {
    const mcpServers: Record<string, ClaudeMcpServerSpec> = { ...(this.mcpConfig?.mcpServers ?? {}) };

    // 1) Command-approval gate for EVERY claude agent: a per-agent local server hosting the
    //    permission-prompt tool, so shell commands honor roam.commandApproval (the approval card) — the
    //    same gate OpenAI-compat agents already get. Only when we'll actually be asked (acceptEdits mode;
    //    bypassPermissions never calls the tool).
    if (this.shouldGateCommands()) {
      const create = this.deps.commandPermission?.createServer ?? createLocalMcpServer;
      const server = create();
      server.addLocalTool(this.buildPermissionTool());
      await server.start();
      this.permissionServer = server;
      mcpServers[PERMISSION_SERVER_ID] = buildTeamBridgeConfig(server);
    }

    // 2) Team bridge (PM only) — unchanged: lets a Claude PM delegate via list_agents/assign_task/etc.
    if (this.config.role === 'pm') {
      if (this.deps.localMcpServerFactory && this.deps.teamMcpBridge) {
        this.localMcpServer = this.deps.localMcpServerFactory();
        await this.localMcpServer.start(this.deps.teamMcpBridge);
        mcpServers[TEAM_BRIDGE_SERVER_ID] = buildTeamBridgeConfig(this.localMcpServer);
      } else {
        this.emit({ kind: 'log', stream: 'stderr', line: 'Claude PM team bridge skipped: TeamMcpBridge is not available.' });
      }
    }

    return Object.keys(mcpServers).length > 0 ? { mcpServers } : undefined;
  }

  /** Gate commands only when an approver is wired AND claude will actually consult it: in
   *  bypassPermissions (autoApprove) claude never calls --permission-prompt-tool, so don't mount it. */
  private shouldGateCommands(): boolean {
    return !!this.deps.commandPermission && !this.config.autoApprove;
  }

  /** The permission-prompt tool claude calls before a gated tool use; routes shell commands through the
   *  CommandPolicy + approval card and returns claude's allow/deny JSON. */
  private buildPermissionTool(): LocalMcpTool {
    const gate = this.deps.commandPermission;
    return {
      name: PERMISSION_TOOL_NAME,
      description: 'UnodeAi command-approval gate (invoked by claude --permission-prompt-tool).',
      inputSchema: {
        type: 'object',
        properties: { tool_name: { type: 'string' }, input: { type: 'object' } },
        required: ['tool_name', 'input'],
      },
      handler: async (args) => {
        const toolName = typeof args.tool_name === 'string' ? args.tool_name : '';
        const input = args.input && typeof args.input === 'object' && !Array.isArray(args.input)
          ? (args.input as Record<string, unknown>)
          : {};
        const decision = await decideCommandPermission(toolName, input, {
          policy: gate?.policy,
          requestApproval: gate?.requestApproval,
        });
        return JSON.stringify(decision);
      },
    };
  }

  /** Write the agent's MCP config into a relative file in cwd (if any). Best-effort. */
  private writeMcpConfig(cwd: string, mcpConfig: ClaudeMcpConfig | undefined): void {
    if (!mcpConfig) {
      return;
    }
    try {
      const abs = path.join(cwd, MCP_CONFIG_FILE);
      fs.mkdirSync(path.dirname(abs), { recursive: true }); // ensure .roam/ exists
      fs.writeFileSync(abs, JSON.stringify(mcpConfig, null, 2), 'utf8');
      this.mcpConfigPath = abs;
    } catch (err) {
      this.emit({ kind: 'log', stream: 'stderr', line: `failed to write MCP config: ${String(err)}` });
      this.mcpConfigPath = undefined;
    }
  }

  /** Remove the MCP config file we wrote, if any. */
  private cleanupMcpConfig(): void {
    if (!this.mcpConfigPath) {
      return;
    }
    try {
      fs.unlinkSync(this.mcpConfigPath);
    } catch {
      /* already gone */
    }
    this.mcpConfigPath = undefined;
  }

  private async stopLocalMcpServer(): Promise<void> {
    const servers = [this.localMcpServer, this.permissionServer];
    this.localMcpServer = undefined;
    this.permissionServer = undefined;
    for (const server of servers) {
      if (!server) {
        continue;
      }
      try {
        await server.stop();
      } catch {
        /* stopping a local server must not break process cleanup */
      }
    }
  }

  /**
   * Build the text for one user turn. On the first turn we prepend the role/system prompt and a
   * crew-context header so the agent adopts its persona (we deliberately don't pass the prompt as
   * a CLI arg — see start()). Attachments are folded in as a structured footer.
   * Plan mode is best-effort for Claude in v0.2.0 because native tool permissions are fixed at
   * spawn via --permission-mode; hard per-turn gating would require restarting the process.
   */
  private composeTurnText(instruction: string, attachments?: TurnAttachments): string {
    const parts: string[] = [];
    const projectContext = attachments?.projectContext ?? '';

    if (!this.firstTurnSent && this.config.systemPrompt) {
      parts.push(`# Your Role: ${this.config.name}\n\n${replaceProjectContextBlock(this.config.systemPrompt, projectContext)}`);
      parts.push(
        `You are agent "${this.config.id}" in a UnodeAi multi-agent team. ` +
          `Other agents may hand you tasks; address only the task below.`
      );
      parts.push('---');
    } else {
      const block = projectContextBlock(projectContext);
      if (block) {
        parts.push(block.trim());
        parts.push('---');
      }
    }
    this.firstTurnSent = true;

    if (attachments?.mode === 'plan') {
      parts.push('[PLAN MODE] Discuss, analyze, and plan only. Do not edit files or run commands.');
    }

    parts.push(instruction);

    if (attachments?.files?.length) {
      parts.push(`\nRelevant files:\n${attachments.files.map((f) => `- ${f}`).join('\n')}`);
    }
    if (attachments?.expectedOutput) {
      parts.push(`\nExpected output: ${attachments.expectedOutput}`);
    }
    if (attachments?.context && Object.keys(attachments.context).length > 0) {
      parts.push(`\nContext:\n\`\`\`json\n${JSON.stringify(attachments.context, null, 2)}\n\`\`\``);
    }

    return parts.join('\n\n');
  }

  private consumeStdout(chunk: string): void {
    const { objects, garbage } = this.parser.push(chunk);
    objects.forEach((o) => this.handleEvent(o));
    garbage.forEach((line) => this.emit({ kind: 'log', stream: 'stdout', line }));
  }

  /**
   * Translate one Claude Code stream-json event into a normalized BackendEvent.
   * Parsing is defensive: unknown shapes are surfaced as logs rather than throwing.
   */
  private handleEvent(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const evt = raw as Record<string, any>;

    switch (evt.type) {
      case 'system':
        if (evt.subtype === 'init') {
          // Usually a no-op (we already emitted `ready` on spawn); acts as a fallback if some
          // platform flushes init before our spawn handler runs.
          this.emitReady(evt.model, evt.session_id);
        }
        return;

      case 'assistant': {
        const content = evt.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'text' && block.text) {
              this.emit({ kind: 'assistant', text: block.text });
            } else if (block?.type === 'tool_use') {
              this.emit({ kind: 'tool_use', name: block.name, input: block.input });
            }
          }
        }
        return;
      }

      case 'result': {
        const result: TurnResult = {
          text: typeof evt.result === 'string' ? evt.result : '',
          isError: evt.is_error === true || (typeof evt.subtype === 'string' && evt.subtype !== 'success'),
          usage: evt.usage
            ? {
                inputTokens: evt.usage.input_tokens ?? 0,
                outputTokens: evt.usage.output_tokens ?? 0,
                costUsd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : undefined,
              }
            : undefined,
        };
        this.emit({ kind: 'turn_complete', result });
        return;
      }

      default:
        // user (tool results) and stream deltas are not needed for orchestration in v1.
        return;
    }
  }

  private killTree(pid: number): void {
    if (process.platform === 'win32') {
      // Shell-spawned `claude.cmd` creates a child tree; SIGKILL on the shell can orphan it.
      nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        this.proc?.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  private emit(event: BackendEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        /* a faulty sink must not break the backend */
      }
    }
  }
}
