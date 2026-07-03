/*---------------------------------------------------------------------------------------------
 *  UnodeAi - OpenAICompatBackend
 *  Runs an agent in-process against any OpenAI-compatible /chat/completions endpoint
 *  (算力仓 / OpenRouter / vLLM / LM Studio / OpenAI itself).
 *
 *  Implements the same AgentBackend contract as ClaudeHeadlessBackend, so SessionManager,
 *  the MessageBus wiring, and workflows treat it identically. The difference is purely "how
 *  the agent runs": here we own a minimal tool-calling loop instead of delegating to a CLI.
 *--------------------------------------------------------------------------------------------*/

import { AgentConfig, AgentModelParams, ChatMode } from '../types';
import {
  AgentBackend,
  BackendEvent,
  BackendEventHandler,
  ConversationSnapshot,
  TurnAttachments,
  TurnResult,
} from './AgentBackend';
import { WorkspaceTools, CommandApprover, CommandExecutor, CheckpointRecorder, WriteApprover, MemoryWriter, ToolSpec, BLOCKED_OUTSIDE_WORKDIR } from './WorkspaceTools';
import { ToolProtocol } from './toolProtocol/ToolProtocol';
import { NativeToolProtocol } from './toolProtocol/NativeToolProtocol';
import { XmlToolProtocol } from './toolProtocol/XmlToolProtocol';
import { stripToolCallMarkup } from './toolProtocol/leakedToolCalls';
import { prefersXmlByDefault } from './toolProtocol/xmlPreferredModels';
import { looksLikeAnnouncedAction, looksLikeUnverifiedCompletion, looksLikeToolDistrustRefusal } from './announcedAction';
import { DiagnosticsCollector, EngineOptions, FileDiagnostic, formatPostWriteDiagnostics, hasErrors } from './Diagnostics';
import { MessageBus } from '../bus/MessageBus';
import { TeamTools } from './TeamTools';
import { FileCoordinator } from './FileCoordinator';
import { CommandPolicy } from './CommandPolicy';
import { MCPHub, McpServerGrant } from '../mcp/MCPHub';
import { estimateTokens, TokenCounter } from './TokenCounter';
import { replaceProjectContextBlock } from '../session/RulesFile';
import { Summarizer, SummarizerIO } from '../session/Summarizer';
import { OpenAIStreamReconstructor, OpenAIStreamResult, parseSseEvents } from './sseParser';
import { createUnifiedDiff } from './diff';
import { summarizeToolResult } from './toolSummary';
import { isToolAllowedInPlan, planModeRefusal } from './planMode';
import { resolveOpenAICompatBaseUrl } from './openAICompatBaseUrl';
import { buildGateHandoffMessage, buildGateRetryMessage, decideCompletionGate } from './completionGate';

/** MCP wiring for this agent: the shared Hub plus the servers/tools it's authorized for. */
export interface McpAccess {
  hub: MCPHub;
  grants: McpServerGrant[];
}

/** Narrow fetch shape so we don't depend on DOM lib types and can inject a fake in tests. */
export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type StreamFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  text?(): Promise<string>;
  body?: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;
}>;

/** Tunables for network resilience; defaults are sensible for a flaky LLM gateway. */
export interface BackendNetworkOptions {
  /** Abort a single HTTP attempt after this many ms. */
  timeoutMs?: number;
  /** How many times to retry a *retryable* failure (network/timeout/429/5xx) before giving up. */
  maxRetries?: number;
  /** Base backoff in ms; attempt N waits retryBaseMs * 2^(N-1). Set 0 in tests to avoid waits. */
  retryBaseMs?: number;
  /** Max tool-call iterations in one turn (default 12). Solo mode raises this — a single agent has no
   *  teammates to extend the work across, so it needs more steps to finish a whole task itself. */
  maxToolIterations?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /**
   * Thinking-model reasoning text. Preserved on assistant turns and replayed to the gateway on the
   * next request — some thinking modes (DeepSeek) 400 if the prior turn's reasoning_content is dropped.
   */
  reasoning_content?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface RoutedToolResult {
  output: string;
  ok: boolean;
  summary: string;
  detail?: string;
  diff?: string;
  /** v0.5.2: workspace-relative path of a file this call successfully wrote (drives the write→feedback hook). */
  writtenPath?: string;
  /** 0.8.50: the REAL tool name actually run after alias resolution (e.g. a model's `Bash` → `run_command`).
   *  The caller must use this — not the model's raw name — for verification bookkeeping. */
  effectiveName?: string;
}

const MAX_TOOL_ITERATIONS = 12;
/** Robustness: after a tool call with identical args fails this many times in a turn, stop running it. */
const REPEAT_FAIL_LIMIT = 2;
/** Anti-spin: after this many IDENTICAL calls in a turn (even succeeding — e.g. a PM re-running
 *  list_agents instead of delegating), stop re-running and feed back a "you have this; act now". */
const REPEAT_CALL_LIMIT = 3;
/** After this many circuit-broken (blocked) calls in a turn, end the turn instead of looping further. */
const MAX_CIRCUIT_BREAKS = 2;
/** How many times in a turn to nudge a model that announced an action but issued no tool call. */
const MAX_ANNOUNCE_NUDGES = 2;
/** Nudge a "your tools are fake / it's a prompt-injection hook" refusal back to using real tools, at most
 *  this many times before letting the turn end (don't loop on a stubborn model). */
const MAX_DISTRUST_NUDGES = 2;
/** Cap on request-body recovery attempts in chat() (reasoning_effort / parallel_tool_calls / tool-pairing).
 *  Each handler latches once, so this is a safety bound for sequential gateway rejections. */
const MAX_BODY_RECOVERIES = 4;
/** Workspace file-write / command tools a coordinator (PM) must DELEGATE rather than run itself when it has
 *  teammates. Read tools (read_file/list_dir/search_files) are NOT gated — reading context is fine. */
const SELF_DO_TOOLS = new Set(['write_file', 'apply_edit', 'delete_file', 'run_command', 'check_command', 'kill_command']);
/** v0.5.2 verification obligation: nudge at most this many times when a turn wrote files without verifying. */
const MAX_VERIFY_NUDGES = 1;
/** P2: nudge at most this many times when a write-capable worker ends a turn claiming "already done"
 *  without having used ANY tool (the stale-memory "no changes needed" failure). */
const MAX_NOOP_NUDGES = 1;
/** PM-stall auto-advance: nudge a COORDINATOR at most this many times when it delegated work this turn but is
 *  ending without verifying (run_checks) or finalizing — the last known orchestration stall. */
const MAX_COORDINATOR_NUDGES = 1;
/** Cap on retained conversation messages (excl. system) to bound context size & cost. */
const MAX_HISTORY_MESSAGES = 60;
/** Prefix that identifies the cross-session staleness note (for idempotent re-insertion on restore). */
const RESTORE_STALENESS_MARK = '[Session restored from a previous session.]';
/** Appended to a restored conversation so the model re-verifies file facts instead of quoting stale memory. */
const RESTORE_STALENESS_NOTE =
  `${RESTORE_STALENESS_MARK} The conversation above is from an earlier session — the workspace and files ` +
  'may have changed since. Treat any file contents, version numbers, config values, or command output ' +
  'shown above as possibly STALE: before you cite or rely on any of it, re-read the file with read_file ' +
  '(or re-run the check) in THIS turn. Do not answer from the restored history as if you verified it now.';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;
const ROLLING_SUMMARY_PREFIX =
  '[Rolling summary of older conversation turns. Use it as memory; recent messages below remain authoritative.]';

export class OpenAICompatBackend implements AgentBackend {
  public readonly agentId: string;
  public readonly pid = undefined; // in-process: no OS process

  private handlers = new Set<BackendEventHandler>();
  private tools: WorkspaceTools;
  private history: ChatMessage[] = [];
  private alive = false;
  private busy = false;
  private queue: Array<{ instruction: string; attachments?: TurnAttachments }> = [];
  private cancelRequested = false;
  private currentAbortController?: AbortController;
  /** G-001: user messages to fold into the running turn at the next safe point (top of the tool loop). */
  private interjections: string[] = [];
  /** Cline #2: this turn's workspace orientation (active file + diagnostics), injected ephemerally. */
  private currentWorkspaceContext = '';

  private apiKey = '';
  private baseUrl = '';
  private tokenCounter: TokenCounter;
  /** Per-turn model override for Smart Mode; request-scoped, not persisted to AgentConfig. */
  private currentModel?: string;
  /** Resolved model params for the turn in flight (F2); applied to each chat() request body. */
  private currentParams?: AgentModelParams;
  private currentMode: ChatMode = 'act';
  /** Set once a model rejects reasoning_effort (e.g. 'max' on Kimi) so we stop sending it this session. */
  private dropReasoningEffort = false;
  /** Set once a gateway rejects parallel_tool_calls as an unknown field, so we stop sending it this
   *  session (some OpenAI-compatible/custom endpoints 400 on it). splitParallelToolCalls still protects us. */
  private dropParallelToolCalls = false;
  /** Per-turn guard so we self-heal a tool-pairing 400 at most once (avoid an infinite retry). */
  private toolPairingRecovered = false;
  /** Per-turn guard for the "assistant message prefill / must end with a user message" 400 self-heal. */
  private assistantPrefillRecovered = false;
  /** Tool-calling protocol for the turn in flight (design C): native function calling or XML. */
  private currentProtocol: ToolProtocol = new NativeToolProtocol();
  /** Option-4 fallback: set once an agent on the native protocol emits a tool call as TEXT (we had to
   *  recover it) — it isn't doing native function-calling reliably, so switch it to XML for the rest of
   *  the session (where it gets an explicit format guide). Self-tuning; resets each session. */
  private preferXmlProtocol = false;

  /** Pick the agent's tool-calling protocol. XML (Cline-style) for weaker models — chosen by config, or
   *  auto-selected after a native leak (Option 4), or defaulted on for known tool-call leakers (so they
   *  skip the first-leak stall); native otherwise. An explicit AgentConfig.toolProtocol always wins. */
  private makeProtocol(specs: ToolSpec[]): ToolProtocol {
    const explicit = this.config.toolProtocol; // 'native' | 'xml' | undefined
    const useXml =
      explicit === 'xml' ||
      this.preferXmlProtocol ||
      (explicit !== 'native' && prefersXmlByDefault(this.config.model));
    return useXml ? new XmlToolProtocol(specs) : new NativeToolProtocol(specs);
  }

  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxToolIterations: number;
  private readonly fetchFn: FetchFn;
  private readonly streamFetchFn?: StreamFetchFn;
  /** v0.5.2 Execution Engine: post-write diagnostics collector (undefined = disabled). */
  private readonly diagnostics?: DiagnosticsCollector;
  /** v0.5.2 Execution Engine: enforce a (non-silent) verification step when a turn wrote files. */
  private readonly verifyObligation: boolean;
  /** Shared-tree coordinator completion gate. Undefined for workers, solo, worktree mode, or no verify command. */
  private readonly completionGate?: NonNullable<EngineOptions['completionGate']>;
  /** Number of gate-driven fix cycles already completed for the current user-initiated turn. */
  private gateAttempts = 0;

  constructor(
    private config: AgentConfig,
    fetchFn?: FetchFn,
    private team?: TeamTools,
    coordinator?: FileCoordinator,
    commandPolicy?: CommandPolicy,
    net: BackendNetworkOptions = {},
    private mcp?: McpAccess,
    streamFetchFn?: StreamFetchFn,
    requestApproval?: CommandApprover,
    private bus?: MessageBus,
    commandNormalizer?: (command: string) => { command: string; note?: string },
    commandExecutor?: CommandExecutor,
    checkpointRecorder?: CheckpointRecorder,
    writeApprovalAsk: () => boolean = () => false,
    requestWriteApproval?: WriteApprover,
    memoryWriter?: MemoryWriter,
    engine: EngineOptions = {},
  ) {
    this.agentId = config.id;
    this.diagnostics = engine.diagnostics;
    this.verifyObligation = engine.verifyObligation ?? false;
    this.completionGate = engine.completionGate;
    this.fetchFn = fetchFn ?? defaultFetch();
    this.streamFetchFn = streamFetchFn ?? (fetchFn ? undefined : defaultStreamFetch());
    this.tools = new WorkspaceTools(
      config.workingDirectory || process.cwd(),
      new Set(config.allowedTools ?? []),
      config.id,
      coordinator,
      commandPolicy,
      undefined,
      requestApproval,
      this.bus,
      commandNormalizer,
      commandExecutor,
      checkpointRecorder,
      writeApprovalAsk,
      requestWriteApproval,
      memoryWriter,
      engine.onOutsideRoot,
      engine.sharedReadRoot,
    );
    this.timeoutMs = net.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = net.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = net.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.maxToolIterations = net.maxToolIterations ?? MAX_TOOL_ITERATIONS;
    this.tokenCounter = new TokenCounter(config.contextWindowTokens ?? 128_000);
  }

  onEvent(handler: BackendEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(env: NodeJS.ProcessEnv): Promise<void> {
    this.apiKey = env[this.config.provider.apiKeySecretName] ?? '';
    this.baseUrl = resolveOpenAICompatBaseUrl(
      this.config.provider.providerId,
      this.config.baseUrl,
      env.OPENAI_BASE_URL
    );

    if (!this.apiKey) {
      throw new Error(
        `No API key for ${this.config.provider.apiKeySecretName}. Run "UnodeAi: Set Provider API Key".`
      );
    }

    // Seed the system message only if the conversation doesn't already have one (a restored
    // snapshot keeps its system message, so we must not add a duplicate).
    const hasSystem = this.history.some((m) => m.role === 'system');
    if (!hasSystem) {
      this.history.unshift({ role: 'system', content: this.systemBase() });
    }

    this.alive = true;
    this.emit({ kind: 'ready', model: this.config.model });
  }

  snapshot(): ConversationSnapshot {
    return { version: 1, messages: this.history };
  }

  restore(snap: ConversationSnapshot): void {
    if (snap?.version !== 1 || !Array.isArray(snap.messages)) {
      return;
    }
    // 0.9 hardening — stale-memory structural fix. A restored snapshot is ALWAYS from a prior session,
    // so the file contents baked into its tool results (and the agent's earlier conclusions) may be out
    // of date — this is the bug where the PM reported a `package.json` version it remembered. Drop any
    // previous marker, then append a fresh staleness note at the end so the model re-verifies file facts
    // in-turn instead of quoting the restored history as current. Doesn't delete context (crash recovery
    // still works); just flags it. Idempotent.
    this.history = (snap.messages as ChatMessage[]).filter(
      (m) => !(typeof m.content === 'string' && m.content.startsWith(RESTORE_STALENESS_MARK))
    );
    if (this.history.some((m) => m.role !== 'system')) {
      this.history.push({ role: 'user', content: RESTORE_STALENESS_NOTE });
    }
  }

  async compactHistory(summarizer: Summarizer, io: SummarizerIO, economyModel: string): Promise<void> {
    const plan = this.tokenCounter.softLimit(this.history);
    if (!plan.triggered || plan.toDrop.length === 0) {
      return;
    }

    const summary = await summarizer.summarize(io, plan.toDrop, this.extractRollingSummary(), economyModel);
    if (!summary.trim()) {
      return;
    }

    this.history = insertRollingSummary(
      plan.keep.filter((m) => !isRollingSummary(m)),
      summary
    );
    this.emit({
      kind: 'log',
      stream: 'stdout',
      line: `compacted ${plan.toDrop.length} older message(s) into a rolling summary using ${economyModel}.`,
    });
    this.emit({ kind: 'compacted', dropped: plan.toDrop.length, model: economyModel });
  }

  sendUserTurn(instruction: string, attachments?: TurnAttachments): void {
    if (!this.alive) {
      this.emit({ kind: 'error', message: 'Backend not started.' });
      return;
    }
    this.queue.push({ instruction, attachments });
    void this.drain();
  }

  async stop(): Promise<void> {
    this.abort();
    this.alive = false;
    this.queue = [];
    // Kill any background commands this agent left running so they don't outlive the session.
    await this.tools.disposeBackground();
    this.emit({ kind: 'exit', code: 0 });
  }

  abort(): void {
    this.team?.cancelPending('delegation cancelled by user');
    this.interjections = []; // an explicit abort discards any pending steering
    if (!this.busy) {
      return;
    }
    this.cancelRequested = true;
    this.currentAbortController?.abort();
  }

  /** G-001 mid-run steering: queue a user message into the running turn (folded in at the top of the
   *  tool loop). No-op when idle. Sync, like abort() — single-threaded, so a plain push is safe. */
  interject(text: string): void {
    const t = (text ?? '').trim();
    if (!t) {
      return;
    }
    if (!this.busy) {
      this.emit({ kind: 'log', stream: 'stderr', line: 'interject ignored: agent is idle.' });
      return;
    }
    this.interjections.push(t);
    this.emit({ kind: 'log', stream: 'stderr', line: `interjection queued (${this.interjections.length} pending).` });
  }

  /** Hot-swap the model for subsequent turns (tier change / fallback escalation). In-process, so the
   *  next chat() request body picks it up immediately. */
  setModel(model: string): void {
    if (model) {
      this.config.model = model;
    }
  }

  isAlive(): boolean {
    return this.alive;
  }

  // ─── Turn loop ────────────────────────────────────────────────────────

  private async drain(): Promise<void> {
    if (this.busy) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.busy = true;
    try {
      const result = await this.runTurn(next.instruction, next.attachments);
      this.emit({ kind: 'turn_complete', result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ kind: 'error', message });
      this.emit({ kind: 'turn_complete', result: { text: message, isError: true } });
    } finally {
      this.busy = false;
      if (this.alive && this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private async runTurn(instruction: string, attachments?: TurnAttachments): Promise<TurnResult> {
    this.cancelRequested = false;
    this.currentModel = attachments?.model;
    this.currentParams = attachments?.modelParams;
    this.currentMode = attachments?.mode === 'plan' ? 'plan' : 'act';
    this.gateAttempts = 0;
    this.toolPairingRecovered = false; // allow one tool-pairing-400 self-heal per turn
    this.assistantPrefillRecovered = false; // allow one assistant-prefill-400 self-heal per turn
    this.refreshProjectContext(attachments?.projectContext ?? '');
    // Cline #2: capture this turn's workspace orientation; injected EPHEMERALLY in buildChatBody (not
    // pushed to history), and re-set every turn so stale file content never accumulates. Capped as a
    // backstop even though the host also caps.
    this.currentWorkspaceContext = formatWorkspaceContext(attachments?.workspaceContext);
    this.history.push({ role: 'user', content: composeUserText(instruction, attachments) });

    const allToolSpecs = [
      ...this.tools.specs(),
      ...(this.team?.specs() ?? []),
      ...(this.mcp ? this.mcp.hub.getToolSpecs(this.mcp.grants) : []),
    ];
    const toolSpecs = this.currentMode === 'plan'
      ? allToolSpecs.filter((tool) => isToolAllowedInPlan(tool.function.name))
      : allToolSpecs;
    // Design C: choose the tool-calling protocol for this turn (xml needs the specs for the prompt
    // guide + arg coercion; native ignores them).
    this.currentProtocol = this.makeProtocol(toolSpecs);
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = '';
    // F8: auto-retry once when API returns empty content with no tool_calls (cold-start issue)
    let emptyRetryUsed = false;
    // Robustness (weaker models): break the "call same tool with same bad args -> fail -> blindly
    // retry" loop. Count failures per identical (name+arguments) signature this turn; once it has
    // failed REPEAT_FAIL_LIMIT times, stop executing it and feed back a firm corrective. If the model
    // ignores that and keeps repeating, end the turn rather than burning every tool iteration.
    const failCounts = new Map<string, number>();
    // Every identical (name+args) call this turn, success OR fail — to stop an agent spinning on a
    // succeeding read tool (the PM looping list_agents without ever delegating).
    const callCounts = new Map<string, number>();
    let circuitBreaks = 0;
    // Weak-model robustness: if the model announces an action ("let me check:") but doesn't call a
    // tool, nudge it to follow through instead of ending the turn half-finished (bounded).
    let announceNudges = 0;
    let distrustNudges = 0;
    // v0.5.2 Execution Engine — verification obligation state. `wroteAnything` = this turn made at
    // least one successful write; `verifiedSinceLastWrite` = since the last write, the agent either
    // ran a check command (run_command/run_checks) or the write's diagnostics came back clean.
    let wroteAnything = false;
    let verifiedSinceLastWrite = false;
    let verifyNudges = 0;
    // P2: did this turn call ANY tool? A write-capable worker that ends a turn having used no tools and
    // claims "already done / no changes needed" almost always answered from assumption/stale memory
    // without checking — nudge it once to actually look before concluding.
    let anyToolCalls = false;
    let noopNudges = 0;
    // PM-stall auto-advance: a coordinator that delegated work this turn but is ending without verifying or
    // finalizing is the last known orchestration stall — nudge it once to continue the loop.
    let delegatedThisTurn = false;
    let ranChecksThisTurn = false;
    let coordinatorNudges = 0;
    const canWrite = this.config.allowedTools?.includes('write') ?? false;
    // Directory-boundary block is TERMINAL (Codex): once a tool reports the target is outside the
    // working folder, end the turn — don't let a weak model keep trying other commands/paths.
    let outsideWorkdirBlocked = false;

    for (let i = 0; i < this.maxToolIterations; i++) {
      if (this.cancelRequested) {
        return this.finishStopped(inputTokens, outputTokens);
      }
      // G-001 mid-run steering: fold any queued user interjections into the conversation HERE — at the
      // top of the loop, the previous iteration has already answered every tool_call, so injecting a
      // user message can't break the OpenAI ordering rule (tool_calls must be answered before a user
      // turn). WAIT semantics: a steer sent during the in-flight request is seen next iteration, not
      // pre-empting it.
      while (this.interjections.length > 0) {
        const steer = this.interjections.shift()!;
        this.history.push({ role: 'user', content: `[User interjected mid-task] ${steer}` });
        this.emit({ kind: 'assistant', text: `↩ steering: ${steer}` });
      }
      // Context hard gate (P2): before issuing another (tool-bearing) request, refuse to keep going
      // if we're in the degradation band — better a bounded answer than truncated/hallucinated output.
      const ctx = this.tokenCounter.assess(this.tokenCounter.estimateMessages(this.history));
      if (ctx.hard && i > 0) {
        this.emit({
          kind: 'log',
          stream: 'stderr',
          line: `context hard gate at ${(ctx.ratio * 100).toFixed(0)}% (${ctx.tokens}/${ctx.window} tok); stopping tool loop and compacting.`,
        });
        finalText = finalText || `[Stopped: context window ~${(ctx.ratio * 100).toFixed(0)}% full; compacted history.]`;
        break;
      }
      let data: any;
      try {
        data = this.streamFetchFn ? await this.chatStream(toolSpecs) : await this.chat(toolSpecs);
      } catch (err) {
        if (this.cancelRequested) {
          return this.finishStopped(inputTokens, outputTokens);
        }
        throw err;
      }
      if (this.cancelRequested) {
        return this.finishStopped(inputTokens, outputTokens);
      }
      if (data.usage) {
        inputTokens += data.usage.prompt_tokens ?? 0;
        outputTokens += data.usage.completion_tokens ?? 0;
      }

      const choice = data.choices?.[0];
      const msg: ChatMessage = choice?.message ?? { role: 'assistant', content: '' };
      // F8: some gateways/models return an empty assistant turn on a cold start (200 OK, no content,
      // no tool_calls). Retry once before accepting it — but never when the model legitimately
      // produced tool_calls, and never after a cancel. The empty turn is NOT pushed to history.
      const isEmptyTurn =
        (!msg.content || (typeof msg.content === 'string' && msg.content.trim().length === 0)) &&
        (!msg.tool_calls || msg.tool_calls.length === 0);
      if (isEmptyTurn && !emptyRetryUsed && !this.cancelRequested && choice?.finish_reason !== 'tool_calls') {
        emptyRetryUsed = true;
        this.emit({
          kind: 'log',
          stream: 'stderr',
          line: 'empty assistant turn (no content, no tool_calls); retrying once.',
        });
        continue;
      }
      // Design C: parse tool calls via the active protocol (native tool_calls or XML in content).
      const calls = this.currentProtocol.parseCalls(msg);

      // When the call came from the message TEXT (XML mode, or native tokens a model leaked into
      // content), hide that markup from the transcript so the user sees prose, not the raw call.
      const fromContent = calls.length > 0 && (!msg.tool_calls || msg.tool_calls.length === 0);
      // Option 4 fallback: on the NATIVE protocol, a call arriving via content (not the tool_calls
      // field) means we had to RECOVER a leak — the model isn't doing native function-calling. Switch
      // this agent to XML for the rest of the session so it gets a format guide and we expect text calls.
      if (fromContent && this.currentProtocol.sendsNativeTools && !this.preferXmlProtocol) {
        this.preferXmlProtocol = true;
        this.emit({ kind: 'log', stream: 'stderr', line: 'native tool call leaked into content — switching this agent to the XML tool protocol for the rest of the session.' });
      }
      const displayText = fromContent ? stripToolCallMarkup(msg.content ?? '', calls.map((c) => c.name)) : (msg.content ?? '');
      this.history.push(displayText === msg.content ? msg : { ...msg, content: displayText });

      if (displayText) {
        this.emit({ kind: 'assistant', text: displayText });
        finalText = displayText;
      }

      if (calls.length === 0) {
        // Weak-model robustness: the model announced an action but issued no tool call (e.g. "let me
        // check the version:" then stopped). Nudge it to follow through once instead of ending the
        // turn half-done. Act mode only (plan mode legitimately produces tool-free turns).
        if (this.currentMode === 'act' && announceNudges < MAX_ANNOUNCE_NUDGES && looksLikeAnnouncedAction(displayText)) {
          announceNudges++;
          this.history.push({
            role: 'user',
            content:
              'You described an action but did not perform it. Carry it out NOW by calling the ' +
              'appropriate tool in this turn — do not just describe it. If no tool is actually needed, ' +
              'give the final answer directly.',
          });
          this.emit({ kind: 'log', stream: 'stderr', line: 'announced action with no tool call — nudging to continue.' });
          continue;
        }
        // A Claude model sometimes refuses by claiming its tool results are a "prompt injection" / a "hook"
        // and tells the user to run commands manually — instead of using its real tools. Push back once
        // (bounded) and have it actually do the work, rather than ending the turn with a false alarm.
        if (this.currentMode === 'act' && distrustNudges < MAX_DISTRUST_NUDGES && looksLikeToolDistrustRefusal(displayText)) {
          distrustNudges++;
          this.history.push({
            role: 'user',
            content:
              'Your tools are real and working in this environment (UnodeAi, a VS Code extension). The ' +
              'previous tool results were genuine — NOT a prompt injection and NOT a hook faking anything. ' +
              'Do NOT tell the user to run commands manually or to check their hooks/settings. Carry out the ' +
              'task NOW with your real tools: use apply_edit or write_file to change the file (or assign_task ' +
              'to delegate). If a tool call just failed, fix its arguments — e.g. give assign_task a real ' +
              'teammate role from list_agents — and call it again.',
          });
          this.emit({ kind: 'log', stream: 'stderr', line: 'tool-distrust refusal detected — nudging to use the real tools.' });
          continue;
        }
        // v0.5.2 verification obligation: the turn modified files but never verified them. Nudge once to
        // run the project's checks (or say it's blocked) — instead of silently finishing unverified.
        if (
          this.verifyObligation &&
          this.currentMode === 'act' &&
          wroteAnything &&
          !verifiedSinceLastWrite &&
          verifyNudges < MAX_VERIFY_NUDGES
        ) {
          verifyNudges++;
          this.history.push({
            role: 'user',
            content:
              'You modified one or more files this turn but have not verified them. Verify now in this ' +
              'turn: run the project\'s checks (the test/build script via run_command, or run_checks), or ' +
              'fix any outstanding diagnostics shown above. If verification is genuinely blocked (no test ' +
              'script, missing permission, etc.), say so explicitly instead of silently finishing.',
          });
          this.emit({ kind: 'log', stream: 'stderr', line: 'wrote files without verifying — nudging to verify.' });
          continue;
        }
        // P2: a write-capable worker is ending the turn having used NO tools at all, while claiming the
        // task is already done / needs no changes. That's the stale-memory failure (it didn't look).
        // Nudge once to actually read before concluding. Tightly scoped (completion-claim phrasing +
        // zero tools + write-capable + act) so it never fires on a normal tool-free Q&A answer.
        if (
          this.currentMode === 'act' &&
          canWrite &&
          !anyToolCalls &&
          noopNudges < MAX_NOOP_NUDGES &&
          looksLikeUnverifiedCompletion(displayText)
        ) {
          noopNudges++;
          this.history.push({
            role: 'user',
            content:
              'You concluded the task is already done / needs no changes, but you have not read any ' +
              'file this turn — do not rely on memory or assumptions. READ the relevant file(s) now to ' +
              'confirm their CURRENT contents, then make the change if it is needed, or confirm it is ' +
              'already correct AND cite what you just read. Use your tools in this turn.',
          });
          this.emit({ kind: 'log', stream: 'stderr', line: 'claimed "already done" with no tool calls — nudging to verify before concluding.' });
          continue;
        }
        // PM-stall auto-advance (the last known orchestration stall): a COORDINATOR delegated work this turn
        // but is now ending WITHOUT having verified (run_checks) or finalized — it often stops half-done and
        // hands back to the user. Nudge it ONCE to continue the loop, or to finalize explicitly if truly done.
        if (
          this.team &&
          this.currentMode === 'act' &&
          delegatedThisTurn &&
          !ranChecksThisTurn &&
          coordinatorNudges < MAX_COORDINATOR_NUDGES &&
          !this.cancelRequested
        ) {
          coordinatorNudges++;
          this.history.push({
            role: 'user',
            content:
              '[orchestration] A delegated task just returned, but the goal is not yet confirmed done. Do NOT ' +
              'stop or hand back to the user yet. Continue the loop in THIS turn: run_checks to verify (or send ' +
              'the work to the reviewer), update your todos, and delegate any remaining steps. Only report the ' +
              'goal complete once it is verified. If everything IS already verified and complete, say so ' +
              'explicitly and finalize — do not stall.',
          });
          this.emit({ kind: 'log', stream: 'stderr', line: 'coordinator delegated but ended without verifying/finalizing — nudging to advance.' });
          continue;
        }
        // Nudge spent but still unverified: do NOT block — surface it honestly so the user (and, in a
        // team, the PM) can see the work wasn't verified.
        if (this.verifyObligation && wroteAnything && !verifiedSinceLastWrite && !finalText.includes('⚠ Changes not verified')) {
          finalText = `${finalText}${finalText ? '\n\n' : ''}⚠ Changes not verified: files were modified but project checks were not run and any diagnostics remain unresolved.`;
          this.emit({ kind: 'assistant', text: finalText });
        }
        // G-001: a steer that arrived during this final request must not be dropped — keep the turn
        // alive so the drain at the top of the next iteration folds it in, instead of ending here.
        if (this.interjections.length > 0) {
          continue;
        }
        if (this.completionGate && this.currentMode === 'act') {
          const gate = this.completionGate;
          const checks = await gate.run();
          if (checks.blocked) {
            // A configured verify command that's blocked by policy is NOT a pass — say so plainly and
            // tell the user how to actually enable verification, rather than quietly finishing as if done.
            const note =
              `⚠ NOT verified — the verification command \`${gate.command}\` is blocked by your command ` +
              `policy, so the completion gate could not confirm this work. Approve it (unode.allowedCommands) ` +
              `or disable the gate (unode.gate.enabled). ${checks.output ?? ''}`.trim();
            finalText = `${finalText}${finalText ? '\n\n' : ''}${note}`;
            this.emit({ kind: 'assistant', text: note });
            break;
          }
          const outcome = decideCompletionGate(!!checks.ok, this.gateAttempts, gate.cfg);
          if (outcome.kind === 'pass') {
            this.gateAttempts = 0;
            break;
          }
          if (outcome.kind === 'retry') {
            this.history.push({
              role: 'user',
              content: buildGateRetryMessage(gate.command, checks.output ?? '', outcome.escalate),
            });
            this.gateAttempts++;
            this.emit({
              kind: 'log',
              stream: 'stderr',
              line: `completion gate failed; retry ${outcome.attempt} requested.`,
            });
            continue;
          }
          const handoff = buildGateHandoffMessage(gate.command, this.gateAttempts, checks.output ?? '');
          finalText = `${finalText}${finalText ? '\n\n' : ''}${handoff}`;
          this.emit({ kind: 'assistant', text: handoff });
          this.gateAttempts = 0;
          break;
        }
        break; // no tools requested -> turn is done
      }

      anyToolCalls = true; // reaching here means the model requested ≥1 tool this turn
      // Execute each requested tool and feed results back for the next iteration.
      for (const call of calls) {
        if (this.cancelRequested) {
          return this.finishStopped(inputTokens, outputTokens);
        }
        const signature = `${call.name}|${JSON.stringify(call.args)}`;

        // Circuit breaker: this exact call has already failed REPEAT_FAIL_LIMIT times — don't run it
        // again; return a firm corrective so the model changes course instead of looping.
        if ((failCounts.get(signature) ?? 0) >= REPEAT_FAIL_LIMIT) {
          circuitBreaks++;
          this.emit({ kind: 'tool_use', name: call.name, input: call.args });
          this.emit({ kind: 'tool_result', name: call.name, ok: false, summary: 'blocked: repeated failing call' });
          this.history.push(this.currentProtocol.formatResult(
            call,
            `Error: you have already called ${call.name} with these exact arguments and it ` +
            `failed every time. Do NOT repeat the same call — fix the arguments, try a different ` +
            `approach, or stop and explain what you need. Repeating it unchanged will not work.`
          ));
          continue;
        }

        // Anti-spin: this exact call has already run REPEAT_CALL_LIMIT times this turn (even succeeding).
        // Re-running won't change anything — feed back a firm "you already have this; act now" so a
        // coordinator can't burn the whole turn re-calling list_agents instead of delegating.
        const priorCalls = callCounts.get(signature) ?? 0;
        if (priorCalls >= REPEAT_CALL_LIMIT) {
          circuitBreaks++;
          this.emit({ kind: 'tool_use', name: call.name, input: call.args });
          this.emit({ kind: 'tool_result', name: call.name, ok: false, summary: 'blocked: repeated identical call' });
          this.history.push(this.currentProtocol.formatResult(
            call,
            `Error: you have already called ${call.name} with these exact arguments ${priorCalls} times ` +
            `this turn and you have the result. STOP re-checking and take the next concrete action NOW — ` +
            `delegate the task (assign_task / assign_task_async), write the file, or run the command. If ` +
            `you have no suitable teammate, do the task yourself or say what you need. Do NOT call ` +
            `${call.name} again.`
          ));
          continue;
        }
        callCounts.set(signature, priorCalls + 1);

        this.emit({ kind: 'tool_use', name: call.name, input: call.args });
        const result = await this.routeToolCall(call.name, call.args);
        this.emit({
          kind: 'tool_result',
          name: call.name,
          ok: result.ok,
          summary: result.summary,
          detail: result.detail,
          diff: result.diff,
        });
        this.history.push(this.currentProtocol.formatResult(call, result.output));
        if (result.output.includes(BLOCKED_OUTSIDE_WORKDIR)) {
          outsideWorkdirBlocked = true; // terminal — handled right after this loop
        }
        if (result.ok) {
          failCounts.delete(signature);
        } else {
          failCounts.set(signature, (failCounts.get(signature) ?? 0) + 1);
        }

        // v0.5.2 Execution Engine — write→feedback hook + verification tracking.
        // A successful check command satisfies the verification obligation. Use the EFFECTIVE (post-alias)
        // tool name — a model's `Bash` aliases to `run_command`, and that run must still count as a verify.
        const effName = result.effectiveName ?? call.name;
        if (result.ok && (effName === 'run_command' || effName === 'run_checks')) {
          verifiedSinceLastWrite = true;
        }
        // PM-stall tracking: remember if this coordinator delegated work and/or ran verification this turn.
        if (effName === 'assign_task' || effName === 'assign_task_async') { delegatedThisTurn = true; }
        if (effName === 'run_checks') { ranChecksThisTurn = true; }
        // A successful write: collect the editor's diagnostics for that file and feed any errors back
        // into the NEXT turn (appended to this write's tool result). Clean diagnostics count as verified;
        // errors — or no collector to prove it clean — leave the write unverified.
        if (result.writtenPath) {
          wroteAnything = true;
          verifiedSinceLastWrite = false;
          if (this.diagnostics) {
            let diags: FileDiagnostic[] = [];
            try {
              diags = await this.diagnostics([result.writtenPath]);
            } catch {
              /* a diagnostics failure must never break the turn */
            }
            const block = formatPostWriteDiagnostics(diags);
            if (block) {
              const last = this.history[this.history.length - 1];
              if (typeof last.content === 'string') {
                last.content += block;
              }
              this.emit({
                kind: 'log',
                stream: 'stderr',
                line: `post-write diagnostics for ${result.writtenPath}: ${diags.length} item(s) injected.`,
              });
            }
            if (!hasErrors(diags)) {
              verifiedSinceLastWrite = true; // editor is clean — treat the write as verified
            }
          }
        }
      }

      // Directory-boundary block is terminal: end the turn with a clear, framework-authored message so
      // the user is told what to do — regardless of whether the model would have flailed on more commands.
      if (outsideWorkdirBlocked) {
        const root = this.config.workingDirectory || process.cwd();
        finalText =
          `I can't reach that path — it's outside my working folder (${root}). Open that project in a new ` +
          `window (File → New Window → Open Folder…) so this chat stays, then resend the task there.`;
        this.emit({ kind: 'assistant', text: finalText });
        break;
      }

      // If the model keeps re-issuing calls we've already circuit-broken, stop the turn cleanly
      // instead of burning every remaining iteration on the same dead end.
      if (circuitBreaks >= MAX_CIRCUIT_BREAKS) {
        break;
      }
    }

    this.currentParams = undefined;
    this.currentMode = 'act';
    this.currentAbortController = undefined;
    this.cancelRequested = false;
    this.trimHistory();
    const context = this.currentContext();
    return {
      text: finalText,
      isError: false,
      usage: { inputTokens, outputTokens },
      context,
    };
  }

  /** Route a tool call to MCP (namespaced), then PM delegation, then the workspace sandbox. */
  private async routeToolCall(name: string, args: Record<string, any>): Promise<RoutedToolResult> {
    let output: string;
    let diff: string | undefined;
    let writtenPath: string | undefined;
    // Model-variance shim: a Claude/GPT/other model often calls a tool by its OWN harness's name
    // (Read/Bash/Write/Edit/LS/Grep/Task). Map those to Roam's real tools + args so they just work
    // (done before the plan-mode check so an aliased write/run is still gated correctly).
    const alias = this.aliasToolCall(name, args);
    if (alias) { name = alias.name; args = alias.args; }
    if (this.currentMode === 'plan' && !isToolAllowedInPlan(name)) {
      output = planModeRefusal(name);
      const summary = summarizeToolResult(name, args, output);
      return {
        output,
        ok: false,
        summary: summary.summary,
        detail: summary.detail,
        effectiveName: name,
      };
    }
    // The PM is a pure ORCHESTRATOR: if a coordinator that HAS teammates reaches for a file-write/command
    // tool, redirect it to DELEGATE rather than do the work itself (Solo mode is the self-do path). The tool
    // stays in its set so an aliased Edit doesn't hit an "unknown tool" the model distrusts — but USING it is
    // bounced to assign_task. With NO teammates, its file tools execute as a genuine fallback.
    if (SELF_DO_TOOLS.has(name) && this.team?.hasTeammates()) {
      output =
        `You have teammates — DELEGATE this instead of doing it yourself. Call ` +
        `assign_task("senior-dev", "<the full task: name the file and exactly what to change>") and report ` +
        `the result. As the lead you orchestrate; the specialist does the edit or runs the command.`;
      const summary = summarizeToolResult(name, args, output);
      return { output, ok: false, summary: summary.summary, detail: summary.detail, effectiveName: name };
    }
    if (this.mcp?.hub.hasTool(name)) {
      output = await this.mcp.hub.executeTool(name, args, this.mcp.grants);
    } else if (this.team?.has(name)) {
      output = await this.team.run(name, args);
    } else if (this.tools.specs().some((s) => s.function.name === name)) {
      output = await this.tools.run(name, args);
      const meta = this.tools.takeLastRunResult();
      const writeOk = meta?.kind === 'write' && !/^(Error:|Write blocked:)/.test(output.trim());
      if (writeOk) {
        // v0.5.2: remember the file we just wrote so runTurn can run the write→feedback hook on it.
        writtenPath = meta!.path ?? String(args.path ?? '');
        if (meta!.oldContent !== undefined && meta!.newContent !== undefined) {
          const rendered = createUnifiedDiff(meta!.oldContent, meta!.newContent, writtenPath || 'file');
          diff = rendered.truncated ? undefined : rendered.text;
        }
      }
    } else {
      // Unknown tool name — almost always a model reaching for a tool from another harness. Return a
      // FACTUAL list of the available tool names (no claims about the model's identity/environment — a
      // Claude model treats role assertions inside a tool error as a prompt-injection attack and refuses).
      output =
        `The tool "${name}" is not available. The available tools in this environment are: ` +
        `${this.knownToolNames().join(', ')}. Call one of those exact names to continue` +
        (this.team
          ? ` — for example assign_task to hand the work to a teammate, or your own file tools for a small change.`
          : '.');
    }

    const summary = summarizeToolResult(name, args, output);
    return {
      output,
      ok: summary.ok,
      summary: diff ? summary.summary : (diff === undefined && name === 'write_file' && output.startsWith('Wrote ') ? `${summary.summary} (diff omitted if too large)` : summary.summary),
      detail: summary.detail,
      diff,
      writtenPath,
      effectiveName: name,
    };
  }

  private finishStopped(inputTokens: number, outputTokens: number): TurnResult {
    this.currentParams = undefined;
    this.currentMode = 'act';
    this.currentAbortController = undefined;
    this.cancelRequested = false;
    return { ...stoppedResult(inputTokens, outputTokens), context: this.currentContext() };
  }

  private currentContext(): { tokens: number; window: number; ratio: number } {
    const ctx = this.tokenCounter.assess(this.tokenCounter.estimateMessages(this.history));
    return { tokens: ctx.tokens, window: ctx.window, ratio: ctx.ratio };
  }

  /**
   * Bound the retained conversation so context size and cost don't grow without limit. Compacts down
   * to the SOFT token budget (≈70%) AND the message cap — token-aware, not just message-count — so a
   * few long messages can't sit over the limit. Preserves: the system message, the ANCHOR (first user
   * turn = the original task/goal, so it's never silently forgotten), and the most recent turns; drops
   * the middle. The kept tail is snapped to a clean user boundary so a 'tool' result is never orphaned.
   *
   * NOTE: this is truncation that keeps anchors. Summarization-based compaction (replace dropped turns
   * with an LLM summary at the soft threshold) is the v0.2.0 plan — see docs. The Claude backend has
   * native compaction, so this only governs the in-process OpenAI-compatible loop.
   */
  private trimHistory(): void {
    const systemPrefix: ChatMessage[] = [];
    let idx = 0;
    while (idx < this.history.length && this.history[idx].role === 'system') {
      systemPrefix.push(this.history[idx]);
      idx++;
    }
    const rest = this.history.slice(idx);

    const hardTokens = this.tokenCounter.hardLimit();
    const withinBudget = (msgs: ChatMessage[]): boolean =>
      msgs.length <= MAX_HISTORY_MESSAGES &&
      this.tokenCounter.estimateMessages([...systemPrefix, ...msgs]) <= hardTokens;
    if (withinBudget(rest)) {
      return;
    }

    // Anchor = first user message (original task/goal). Keep it; drop the oldest of everything after
    // it until we're under budget, then snap the surviving tail to a user boundary.
    const anchorIdx = rest.findIndex((m) => m.role === 'user');
    const anchor = anchorIdx >= 0 ? rest[anchorIdx] : undefined;
    const body = anchorIdx >= 0 ? rest.slice(anchorIdx + 1) : rest.slice();
    const head = anchor ? [anchor] : [];

    while (body.length > 0 && !withinBudget([...head, ...body])) {
      body.shift();
    }
    while (body.length > 0 && body[0].role !== 'user') {
      body.shift();
    }

    const kept = [...head, ...body];
    this.history = [...systemPrefix, ...kept];
  }

  /** Keep the system prompt's project memory fresh for running/restored sessions (F4). */
  /** System-prompt prefix: identity + the agent's workspace root (so it knows where it can read/write,
   *  G-003) + its configured instructions. Shared by the initial seed and the project-context refresh.
   *  P1: Hard rule that tool calls must follow announced actions (prevent light-talking loops).
   *  P2: Transparency on available tools (environment clarity). */
  /** All tool names this agent can actually call (team + workspace), for the system prompt and the
   *  unknown-tool corrective. */
  private knownToolNames(): string[] {
    const team = this.team?.specs().map((s) => s.function.name) ?? [];
    const ws = this.tools.specs().map((s) => s.function.name);
    return [...team, ...ws];
  }

  /** Model-variance compatibility: map a familiar cross-model tool name (Claude Code's Read/Bash/Edit/…,
   *  GPT's, etc.) + its args onto Roam's real tool, so the model's muscle memory just works instead of
   *  erroring. Returns undefined when the name is already a real tool or has no safe mapping. */
  private aliasToolCall(rawName: string, args: Record<string, any>): { name: string; args: Record<string, any> } | undefined {
    const known = new Set(this.knownToolNames());
    if (known.has(rawName)) { return undefined; }
    const n = String(rawName).toLowerCase().replace(/[^a-z0-9]/g, '');
    const pick = (...keys: string[]): any => {
      for (const k of keys) { if (args?.[k] !== undefined && args?.[k] !== null) { return args[k]; } }
      return undefined;
    };
    if (['edit', 'editfile', 'stredit', 'strreplace', 'strreplaceeditor', 'applypatch', 'patchfile', 'replaceinfile', 'replacestring', 'multiedit'].includes(n) && known.has('apply_edit')) {
      return { name: 'apply_edit', args: {
        path: pick('path', 'file_path', 'filename', 'filepath', 'file'),
        old_string: pick('old_string', 'old_str', 'oldText', 'oldString', 'search', 'find', 'old'),
        new_string: pick('new_string', 'new_str', 'newText', 'newString', 'replace', 'replacement', 'new') ?? '',
        replace_all: pick('replace_all', 'replaceAll', 'all'),
      } };
    }
    if (['read', 'readfile', 'view', 'viewfile', 'cat', 'openfile'].includes(n) && known.has('read_file')) {
      return { name: 'read_file', args: { path: pick('path', 'file_path', 'filename', 'filepath', 'file'), offset: pick('offset', 'start'), limit: pick('limit', 'lines', 'count') } };
    }
    if (['bash', 'shell', 'sh', 'zsh', 'runshell', 'execute', 'exec', 'runcommand', 'command', 'terminal', 'runterminalcmd', 'cmd'].includes(n) && known.has('run_command')) {
      return { name: 'run_command', args: { command: pick('command', 'cmd', 'script', 'input', 'code') } };
    }
    if (['write', 'writefile', 'createfile', 'create', 'savefile', 'newfile', 'putfile'].includes(n) && known.has('write_file')) {
      return { name: 'write_file', args: { path: pick('path', 'file_path', 'filename', 'filepath'), content: pick('content', 'text', 'filetext', 'file_text', 'contents', 'data', 'body') ?? '' } };
    }
    if (['ls', 'list', 'listdir', 'listdirectory', 'listfiles', 'dir', 'readdir', 'listfolder'].includes(n) && known.has('list_dir')) {
      return { name: 'list_dir', args: { path: pick('path', 'dir', 'directory', 'file_path', 'folder') ?? '.' } };
    }
    if (['grep', 'search', 'ripgrep', 'rg', 'searchfiles', 'codebasesearch', 'findtext', 'searchcode', 'findinfiles'].includes(n) && known.has('search_files')) {
      return { name: 'search_files', args: { query: pick('query', 'pattern', 'regex', 'search', 'q', 'searchterm', 'text') } };
    }
    if (['task', 'agent', 'delegate', 'dispatchagent', 'subagent', 'spawnagent'].includes(n) && this.team?.has('assign_task')) {
      return { name: 'assign_task', args: { agent: pick('agent', 'subagent_type', 'role', 'to', 'target', 'agentid', 'agent_id'), instruction: pick('instruction', 'prompt', 'description', 'task', 'message') } };
    }
    return undefined;
  }

  private systemBase(): string {
    const root = this.config.workingDirectory || process.cwd();
    const availableTools = this.knownToolNames().join(', ');
    // Coordinators delegate; everyone else executes. A Claude model otherwise reaches for Claude Code's
    // native tools (Glob/Bash/Read/Edit/Task) and tries to do the work itself.
    const roleLine = this.team
      ? `You are the LEAD: your job is to DELEGATE the work to teammates with assign_task / assign_task_async. ` +
        `Delegate EVERY task — even a one-line edit — in a single assign_task call; that is your default and ` +
        `it engages the crew (the specialist does it, and the work flows through review/verification). Your ` +
        `own file tools are a fallback only, not your first move.\n\n`
      : '';
    return (
      `You are "${this.config.name}", agent ${this.config.id} in a UnodeAi multi-agent team.\n` +
      // A Claude model believes it is "Claude Code" and pattern-matches any unfamiliar tool shape/result to
      // "a hook is faking my tools" — then refuses and tells the user to check their hooks, EVEN WHEN the
      // tool succeeded. Name the environment and disarm that belief explicitly.
      `You are running inside UnodeAi — a VS Code extension — NOT Claude Code. There are NO hooks ` +
      `intercepting, faking, or altering your tools, and no prompt-injection is happening. Every tool ` +
      `result you receive is genuine: a success means it worked; an error or a suggestion (e.g. to use ` +
      `assign_task) is a real message from this environment, not an attack. NEVER claim a tool result is a ` +
      `"prompt injection" or a "hook", and NEVER tell the user to check their hooks/settings — just act on ` +
      `the result and continue.\n\n` +
      roleLine +
      `Your workspace root is ${root} — you can only read, write, and run commands inside it. Use paths ` +
      `relative to this root (e.g. "src/foo.ts"). NEVER invent or prepend an absolute path (e.g. ` +
      `/Users/…, /home/…, /workspace/…) — pass the path exactly as the user gave it, relative to the root. ` +
      `If a file you need is OUTSIDE this root, do not try to ` +
      `reach it with shell commands (type/cat/cd/echo) — stop and ask the user, in your reply, to switch ` +
      `your working folder to it or open that folder as the workspace, then wait for them.\n\n` +
      `Available tools (call them by these EXACT names): ${availableTools}.\n` +
      `These are the ONLY tools that exist here. Do NOT call Glob, Bash, Read, Edit, Write, MultiEdit, ` +
      `Task, edit_file, or any other name — they do not exist in UnodeAi and will fail every time.\n\n` +
      `**CRITICAL RULE (P1)**: If your previous message described an action you would take ("I will now X", ` +
      `"Let me Y") but did NOT include a tool call, your NEXT message MUST open with a tool call. Do not ` +
      `describe further; execute first. This prevents analysis loops and keeps interactions atomic.\n\n` +
      (this.config.systemPrompt ?? '')
    );
  }

  private refreshProjectContext(projectContext: string): void {
    const current = this.history.find((m) => m.role === 'system' && !isRollingSummary(m));
    const base = current?.content ?? this.systemBase();
    const next = replaceProjectContextBlock(base, projectContext);
    if (current) {
      current.content = next;
      return;
    }
    this.history.unshift({ role: 'system', content: next });
  }

  private extractRollingSummary(): string | undefined {
    const msg = this.history.find(isRollingSummary);
    if (!msg?.content) {
      return undefined;
    }
    return msg.content.slice(ROLLING_SUMMARY_PREFIX.length).trim();
  }

  private async chat(tools: ReturnType<WorkspaceTools['specs']>): Promise<any> {
    const url = `${this.baseUrl}/chat/completions`;
    // Bounded recovery LOOP, not a single retry: a custom gateway can reject several incompatible fields
    // in sequence (e.g. parallel_tool_calls, THEN reasoning_effort). Each recovery handler latches once,
    // so we apply at most one per failed attempt, rebuild the body, and retry until none applies or the cap.
    // Handlers: reasoning_effort drop (model-specific; Kimi caps at 'xhigh', DeepSeek takes none), the
    // parallel_tool_calls drop, and the wedged tool-pairing self-heal.
    for (let attempt = 0; ; attempt++) {
      try {
        return JSON.parse(await this.requestWithRetry(url, JSON.stringify(this.buildChatBody(tools, false))));
      } catch (err) {
        const recovered = attempt < MAX_BODY_RECOVERIES &&
          (this.dropEffortOnRejection(err) || this.dropParallelOnRejection(err) || this.recoverToolPairing(err) || this.recoverAssistantPrefill(err));
        if (!recovered) {
          throw err;
        }
      }
    }
  }

  /** Last-resort self-heal: if the gateway rejects the request because a tool_result has no matching
   *  tool_use ("unexpected tool_use_id … no corresponding tool_use in the immediately-preceding message"),
   *  the history is wedged in a way our pre-send normalizers didn't catch (e.g. a snapshot from an older
   *  build). FLATTEN the tool structure — drop tool results, turn each assistant tool-call turn into a short
   *  text note — so the request is unconditionally valid, then retry once. Lossy but unwedges the session. */
  private recoverToolPairing(err: unknown): boolean {
    if (this.toolPairingRecovered) {
      return false;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!isToolPairingError(msg)) {
      return false;
    }
    this.toolPairingRecovered = true;
    // Diagnostic: dump the role/tool_use_id sequence we actually sent (with orphans flagged), so a 400 seen
    // in the gateway backend (by request id) can be matched to the exact message that broke pairing.
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: `tool-pairing 400 — messages we sent: ${toolPairingTrace(this.history)}`,
    });
    this.history = this.history
      .filter((m) => m.role !== 'tool')
      .map((m) => {
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
          const names = m.tool_calls.map((c) => c.function?.name).filter(Boolean).join(', ');
          const text = typeof m.content === 'string' && m.content.trim() ? m.content : `(earlier I used: ${names || 'tools'})`;
          const { tool_calls: _tool_calls, ...rest } = m;
          return { ...rest, content: text };
        }
        return m;
      });
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: 'gateway rejected the tool-call history pairing; flattened prior tool calls to text and retrying (the session is unwedged, some tool-call detail was summarized).',
    });
    return true;
  }

  /** Self-heal two gateway "conversation-structure" 400s by flattening + retrying once:
   *   - "assistant message prefill / must end with a user message" (history ended on an assistant turn);
   *   - "reasoning_content … must be passed back" (a thinking model's prior turn is missing its reasoning).
   *  The flatten below (drop tool_results, assistant tool-call turns → short text notes, end on user) removes
   *  both the trailing-assistant and the dangling-reasoning structure, producing a convo the gateway accepts. */
  private recoverAssistantPrefill(err: unknown): boolean {
    if (this.assistantPrefillRecovered) {
      return false;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!isAssistantPrefillError(msg) && !isReasoningContentError(msg)) {
      return false;
    }
    this.assistantPrefillRecovered = true;
    this.emit({ kind: 'log', stream: 'stderr', line: `conversation-structure 400 (prefill/reasoning_content) — flattening + retrying; sent: ${toolPairingTrace(this.history)}` });
    // This gateway/model won't continue from a conversation that ends with a tool_result (or assistant). We
    // can't just append a user message — after a tool_result that makes two consecutive user turns, which
    // the Anthropic translation also rejects. So FLATTEN: drop tool_results, turn assistant tool-call turns
    // into short text notes, MERGE consecutive same-role turns (valid alternation), then end on a user
    // message. Lossy (tool detail → summary) but produces a clean convo this model accepts. Then retry once.
    const flattened: ChatMessage[] = [];
    for (const m of this.history) {
      if (m.role === 'tool') { continue; }
      let msg: ChatMessage = m;
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const names = m.tool_calls.map((c) => c.function?.name).filter(Boolean).join(', ');
        const text = typeof m.content === 'string' && m.content.trim() ? m.content : `(used: ${names || 'tools'})`;
        const { tool_calls: _tool_calls, ...rest } = m;
        msg = { ...rest, content: text };
      }
      const prev = flattened[flattened.length - 1];
      if (prev && prev.role === msg.role && typeof prev.content === 'string' && typeof msg.content === 'string') {
        prev.content = `${prev.content}\n${msg.content}`; // merge consecutive same-role turns
      } else {
        flattened.push({ ...msg });
      }
    }
    this.history = flattened;
    if (this.history.length === 0 || this.history[this.history.length - 1].role !== 'user') {
      this.history.push({ role: 'user', content: 'Continue with the task — make your next tool call now.' });
    }
    this.emit({ kind: 'log', stream: 'stderr', line: 'gateway rejected an assistant-message prefill; normalized the conversation to end with a user message and retrying.' });
    return true;
  }

  /** If the error is a stricter gateway rejecting the parallel_tool_calls field, latch it off and signal a
   *  retry. splitParallelToolCalls still guarantees valid pairing without it. */
  private dropParallelOnRejection(err: unknown): boolean {
    if (this.dropParallelToolCalls) {
      return false; // already dropped — don't loop
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!isParallelToolCallsError(msg)) {
      return false;
    }
    this.dropParallelToolCalls = true;
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: 'gateway rejected parallel_tool_calls; retrying without it (splitParallelToolCalls still prevents orphan tool_results).',
    });
    return true;
  }

  /** If the error is the gateway rejecting reasoning_effort, latch it off and signal a retry. */
  private dropEffortOnRejection(err: unknown): boolean {
    if (this.dropReasoningEffort) {
      return false; // already dropped — don't loop
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!isReasoningEffortError(msg)) {
      return false;
    }
    this.dropReasoningEffort = true;
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: `model rejected reasoning_effort "${this.currentParams?.reasoning_effort ?? ''}"; retrying without it (this model doesn't support that value).`,
    });
    return true;
  }

  private async chatStream(tools: ReturnType<WorkspaceTools['specs']>): Promise<OpenAIStreamResult> {
    const body = this.buildChatBody(tools, true);
    const reconstructor = new OpenAIStreamReconstructor();
    let emittedDelta = false;

    try {
      const stream = await this.fetchStreamOnce(`${this.baseUrl}/chat/completions`, JSON.stringify(body));
      for await (const event of parseSseEvents(stream)) {
        const { delta, reasoningDelta } = reconstructor.accept(event);
        if (reasoningDelta) {
          this.emit({ kind: 'reasoning_delta', delta: reasoningDelta });
        }
        if (delta) {
          emittedDelta = true;
          this.emit({ kind: 'assistant_delta', delta });
        }
      }
    } catch (err) {
      if (this.cancelRequested) {
        throw err;
      }
      if (!emittedDelta) {
        this.emit({
          kind: 'log',
          stream: 'stderr',
          line: `streaming request failed before content; falling back to non-streaming chat: ${err instanceof Error ? err.message : String(err)}`,
        });
        return this.chat(tools);
      }
      throw err;
    }

    const result = reconstructor.result();
    if (!result.usage) {
      const message = result.choices[0]?.message;
      const outputText = message?.content ?? JSON.stringify(message?.tool_calls ?? []);
      result.usage = {
        prompt_tokens: this.tokenCounter.estimateMessages(this.history),
        completion_tokens: estimateTokens(outputText),
      };
    }
    return result;
  }

  private buildChatBody(tools: ReturnType<WorkspaceTools['specs']>, stream: boolean): Record<string, unknown> {
    // F2/F1: resolved per-turn params win; fall back to legacy config fields for back-compat.
    const p = this.currentParams ?? {};
    const temperature = p.temperature ?? this.config.temperature;
    const maxTokens = p.max_tokens ?? this.config.maxTokens;

    // Self-heal the history before every request: an assistant `tool_calls` message left with an
    // unanswered tool_call_id (Stop/cancel mid tool-loop, or a snapshot restored at that moment) would
    // otherwise 400 the gateway ("insufficient tool messages following tool_calls"). Repair in place so
    // the fix also persists into the next snapshot. Idempotent on an already-valid history.
    // ...and split any parallel tool-call turn into sequential single-call pairs, so a gateway that
    // requires each tool_result immediately after its tool_use (Anthropic translation) can't orphan the
    // 2nd+ result of a parallel turn.
    this.history = splitParallelToolCalls(normalizeEmptyContent(sanitizeToolCallPairing(this.history)));
    // Never SEND a conversation that ends with an empty assistant turn (no text, no tool_calls): a stricter
    // gateway/model rejects it as an "assistant message prefill … must end with a user message" 400.
    while (this.history.length > 0) {
      const last = this.history[this.history.length - 1];
      const emptyAssistant = last.role === 'assistant'
        && (last.content === null || last.content === undefined || (typeof last.content === 'string' && last.content.trim() === ''))
        && (!last.tool_calls || last.tool_calls.length === 0);
      if (emptyAssistant) { this.history.pop(); } else { break; }
    }

    // Design C: in XML mode we don't advertise native `tools`; instead the tool manual is appended to
    // the system message (ephemerally — not persisted to history).
    const sendsNative = this.currentProtocol.sendsNativeTools;
    const guide = sendsNative ? '' : this.currentProtocol.renderToolGuide(tools);

    // Ephemeral system-message additions for THIS request only (never persisted to history): the XML tool
    // guide (xml mode) and the Cline #2 workspace orientation. Joined and appended to the system message.
    const ephemeral = [guide, this.currentWorkspaceContext].filter(Boolean).join('\n\n');
    const body: Record<string, unknown> = {
      model: this.currentModel ?? this.config.model,
      messages: ephemeral ? withSystemGuide(this.history, ephemeral) : this.history,
      stream,
    };
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (sendsNative && tools.length > 0) {
      body.tools = tools;
      // Ask for ONE tool call per turn. Parallel tool_calls produce multiple tool_results that an
      // Anthropic-translating gateway can orphan ("no corresponding tool_use in the immediately-preceding
      // message"); splitParallelToolCalls repairs any that slip through, this prevents most at the source.
      // Dropped if a stricter gateway rejects the field (see dropParallelOnRejection).
      if (!this.dropParallelToolCalls) {
        body.parallel_tool_calls = false;
      }
    }
    if (temperature !== undefined) {
      body.temperature = temperature;
    }
    if (maxTokens) {
      body.max_tokens = maxTokens;
    }
    // F1 full OpenAI-compatible surface — only send fields that were actually set.
    if (p.top_p !== undefined) body.top_p = p.top_p;
    if (p.presence_penalty !== undefined) body.presence_penalty = p.presence_penalty;
    if (p.frequency_penalty !== undefined) body.frequency_penalty = p.frequency_penalty;
    if (p.stop !== undefined) body.stop = p.stop;
    if (p.response_format) body.response_format = p.response_format;
    if (p.reasoning_effort && !this.dropReasoningEffort) body.reasoning_effort = p.reasoning_effort;
    if (p.thinking) body.thinking = p.thinking;
    // tool_choice only makes sense when native tools are offered.
    if (p.tool_choice && sendsNative && tools.length > 0) body.tool_choice = p.tool_choice;
    return body;
  }

  /**
   * POST with a per-attempt timeout and exponential backoff. Retries transient failures
   * (network errors, timeouts, HTTP 429 / 5xx) up to `maxRetries`; surfaces 4xx (other than 429)
   * and the final failure immediately. Without this, a single gateway hiccup hangs the agent
   * forever and stalls any PM `assign_task` awaiting it.
   */
  private async requestWithRetry(url: string, body: string): Promise<string> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryBaseMs * 2 ** (attempt - 1);
        this.emit({
          kind: 'log',
          stream: 'stderr',
          line: `retry ${attempt}/${this.maxRetries} after ${delay}ms: ${lastErr?.message ?? 'transient error'}`,
        });
        await sleep(delay);
      }

      let outcome: { ok: boolean; status: number; text: string };
      try {
        outcome = await this.fetchOnce(url, body);
      } catch (err) {
        // Network error or timeout — always retryable until we run out of attempts.
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (this.cancelRequested) {
          throw lastErr;
        }
        if (attempt < this.maxRetries) {
          continue;
        }
        throw lastErr;
      }

      if (outcome.ok) {
        return outcome.text;
      }

      const httpErr = new Error(
        `HTTP ${outcome.status} from ${this.baseUrl}: ${outcome.text.slice(0, 300)}`
      );
      if (isRetryableStatus(outcome.status) && attempt < this.maxRetries) {
        lastErr = httpErr;
        continue;
      }
      throw httpErr; // 4xx (non-429) or exhausted retries — fail fast.
    }
    throw lastErr ?? new Error('request failed');
  }

  /** A single HTTP attempt, aborted after `timeoutMs`. */
  private async fetchOnce(url: string, body: string): Promise<{ ok: boolean; status: number; text: string }> {
    const controller = new AbortController();
    this.currentAbortController = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      if (this.cancelRequested && controller.signal.aborted) {
        throw new Error('Request aborted by user');
      }
      if (controller.signal.aborted) {
        throw new Error(`Request to ${this.baseUrl} timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (this.currentAbortController === controller) {
        this.currentAbortController = undefined;
      }
    }
  }

  private async fetchStreamOnce(url: string, body: string): Promise<AsyncIterable<Uint8Array>> {
    if (!this.streamFetchFn) {
      throw new Error('Streaming fetch is not configured.');
    }
    const controller = new AbortController();
    this.currentAbortController = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.streamFetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = res.text ? await res.text() : '';
        throw new Error(`HTTP ${res.status} from ${this.baseUrl}: ${text.slice(0, 300)}`);
      }
      if (!res.body) {
        throw new Error('Streaming response did not include a body.');
      }
      return toAsyncIterable(res.body, controller);
    } catch (err) {
      if (this.cancelRequested && controller.signal.aborted) {
        throw new Error('Request aborted by user');
      }
      if (controller.signal.aborted) {
        throw new Error(`Request to ${this.baseUrl} timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
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

// ─── Helpers ──────────────────────────────────────────────────────────

function composeUserText(instruction: string, attachments?: TurnAttachments): string {
  const parts = attachments?.mode === 'plan'
    ? ['[PLAN MODE] Discuss, analyze, and plan only. Do not edit files or run commands.', instruction]
    : [instruction];
  if (attachments?.files?.length) {
    parts.push(`\nRelevant files:\n${attachments.files.map((f) => `- ${f}`).join('\n')}`);
  }
  if (attachments?.expectedOutput) {
    parts.push(`\nExpected output: ${attachments.expectedOutput}`);
  }
  if (attachments?.context && Object.keys(attachments.context).length > 0) {
    parts.push(`\nContext:\n\`\`\`json\n${JSON.stringify(attachments.context, null, 2)}\n\`\`\``);
  }
  return parts.join('\n');
}

/** 429 (rate limited) and 5xx (server-side) are worth retrying; other 4xx are caller errors. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** True when an HTTP error is the gateway rejecting the reasoning_effort value (model-specific). */
function isReasoningEffortError(message: string): boolean {
  return /effort/i.test(message) && /invalid option|expected one of|not (a )?valid|invalid value|unsupported/i.test(message);
}

/** A gateway rejecting the parallel_tool_calls field (unknown/unsupported/invalid). */
function isParallelToolCallsError(message: string): boolean {
  return /parallel_tool_calls/i.test(message) &&
    /unknown|unrecognized|unsupported|not (a )?valid|invalid|unexpected|no such|extra field/i.test(message);
}

/** The gateway rejected the message history because a tool_result has no matching tool_use (a wedged
 *  tool-call pairing it couldn't translate). Matches the Anthropic-translation wording and the OpenAI one. */
function isToolPairingError(message: string): boolean {
  return /tool_use_id|tool_result|tool_use/i.test(message) &&
    /no corresponding|does not correspond|unexpected|without|must (have|answer)|matching|insufficient tool|each tool_result/i.test(message);
}

/** The gateway/model rejected a conversation that ends with an assistant turn ("no assistant prefill /
 *  must end with a user message") — e.g. an empty model reply we appended. */
function isAssistantPrefillError(message: string): boolean {
  return /assistant message prefill|must end with (a )?user message|conversation must end with|does not support .*prefill/i.test(message);
}

/** Some thinking-model gateways (e.g. DeepSeek/extended-thinking via unodetech) 400 when a prior assistant
 *  turn's reasoning_content is missing from the replayed history. The flatten recovery (assistant tool-call
 *  turns → plain text, tool results dropped) removes the offending thinking-turn structure so a retry works. */
function isReasoningContentError(message: string): boolean {
  return /reasoning_content/i.test(message) && /(passed back|thinking mode|must be)/i.test(message);
}

/** A compact role / tool_use_id sequence of what we sent, with any orphan tool_result (no matching tool_use
 *  in the immediately-preceding assistant) flagged — for diagnosing a tool-pairing 400 against the gateway. */
export function toolPairingTrace(messages: ChatMessage[]): string {
  return messages.map((m, i) => {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return `asst[tool_use:${m.tool_calls.map((c) => c.id).join(',')}]`;
    }
    if (m.role === 'tool') {
      const prev = messages[i - 1];
      const paired = prev?.role === 'assistant' && (prev.tool_calls ?? []).some((c) => c.id === m.tool_call_id);
      return `tool_result(${m.tool_call_id})${paired ? '' : ' ⚠ORPHAN'}`;
    }
    return m.role;
  }).join('  |  ');
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function stoppedResult(inputTokens: number, outputTokens: number): TurnResult {
  return {
    text: '[Stopped by user]',
    isError: true,
    usage: { inputTokens, outputTokens },
  };
}

function isRollingSummary(message: ChatMessage): boolean {
  return (
    message.role === 'system' &&
    typeof message.content === 'string' &&
    message.content.startsWith(ROLLING_SUMMARY_PREFIX)
  );
}

function insertRollingSummary(messages: ChatMessage[], summary: string): ChatMessage[] {
  const summaryMessage: ChatMessage = {
    role: 'system',
    content: `${ROLLING_SUMMARY_PREFIX}\n${summary.trim()}`,
  };
  const systemIdx = messages.findIndex((m) => m.role === 'system');
  if (systemIdx < 0) {
    return [summaryMessage, ...messages];
  }
  return [
    ...messages.slice(0, systemIdx + 1),
    summaryMessage,
    ...messages.slice(systemIdx + 1),
  ];
}

/**
 * Design C (XML mode): return a shallow copy of the messages with the tool guide appended to the
 * first system message (or a new system message prepended if there is none). Ephemeral — never
 * mutates persisted history, so switching protocols or inspecting a snapshot stays clean.
 */
/** Backstop cap for the injected workspace orientation (the host caps too). ~6 KB keeps it from
 *  dominating the context window even if a host sends an oversized blob. */
const WORKSPACE_CONTEXT_MAX_CHARS = 6000;

/** Cline #2: cap + label the host-gathered workspace orientation, or '' when absent. */
function formatWorkspaceContext(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) {
    return '';
  }
  const capped = text.length > WORKSPACE_CONTEXT_MAX_CHARS
    ? `${text.slice(0, WORKSPACE_CONTEXT_MAX_CHARS)}\n[workspace context truncated]`
    : text;
  return (
    '[Workspace state — the files in your working folder (use these exact relative paths), plus the ' +
    'user\'s active editor file and diagnostics when available. It MAY be stale; re-read a file with ' +
    'read_file before editing if you need to be sure.]\n' +
    capped
  );
}

function withSystemGuide(messages: ChatMessage[], guide: string): ChatMessage[] {
  const idx = messages.findIndex((m) => m.role === 'system');
  if (idx === -1) {
    return [{ role: 'system', content: guide }, ...messages];
  }
  const copy = messages.slice();
  copy[idx] = { ...copy[idx], content: `${copy[idx].content}\n\n${guide}` };
  return copy;
}

/**
 * Enforce the OpenAI invariant: every assistant message bearing `tool_calls` must be immediately
 * followed by one `tool` message per `tool_call_id`. A turn interrupted mid tool-loop (Stop/cancel),
 * or a history restored from a snapshot taken at that moment, can leave an assistant `tool_calls`
 * message with some/all ids unanswered — the gateway then 400s with "insufficient tool messages
 * following tool_calls message". We backfill a synthetic result for any missing id (preserving the
 * real results that ARE present), so a Stop in the middle of a tool call can never wedge the session.
 * Idempotent: re-running on an already-valid history is a no-op (returns the same shape).
 */
/**
 * Anthropic-translating gateways (e.g. a Claude-backed Roam route) reject EMPTY text content blocks:
 * `messages: text content blocks must be non-empty`. OpenAI permits an assistant tool-call turn with
 * `content: ""` and an empty tool result, but each becomes an empty text block downstream → 400. Normalize:
 *  - assistant turn whose only payload is `tool_calls` → `content: null` (no text block; never `""`);
 *  - tool result with empty content → a `(no output)` marker so the tool_result block is non-empty.
 * Idempotent; safe for native-OpenAI gateways too (null content with tool_calls is valid OpenAI).
 */
export function normalizeEmptyContent(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const empty = typeof m.content === 'string' && m.content.trim() === '';
    if (!empty) { return m; }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return m.content === null ? m : { ...m, content: null };
    }
    if (m.role === 'tool') {
      return { ...m, content: '(no output)' };
    }
    return m;
  });
}

export function sanitizeToolCallPairing(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    // An ORPHAN tool result (no preceding assistant tool_calls run claims it) — drop it. An
    // Anthropic-translating gateway 400s with "unexpected tool_use_id … must have a corresponding
    // tool_use in the previous message" on a tool_result whose id has no matching tool_use.
    if (m.role === 'tool') {
      continue;
    }
    out.push(m);
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) {
      continue;
    }
    // Consume the contiguous run of tool results, keeping ONLY those that answer THIS message's calls
    // (drop orphans + duplicates), then backfill any of this message's calls left unanswered.
    const callIds = new Set(m.tool_calls.map((c) => c.id));
    const answered = new Set<string>();
    let j = i + 1;
    for (; j < messages.length && messages[j].role === 'tool'; j++) {
      const id = messages[j].tool_call_id;
      if (id && callIds.has(id) && !answered.has(id)) {
        answered.add(id);
        out.push(messages[j]);
      }
      // else: orphan (wrong/absent id) or duplicate result → dropped (j still advances, so it's skipped).
    }
    for (const call of m.tool_calls) {
      if (!answered.has(call.id)) {
        out.push({ role: 'tool', tool_call_id: call.id, content: '[tool call interrupted — no result was produced]' });
      }
    }
    i = j - 1; // skip the tool run we just folded in
  }
  return out;
}

/**
 * Split a PARALLEL tool-call turn (one assistant message with >1 `tool_calls`) into a sequence of
 * single-call assistant messages, each immediately followed by its one tool result. OpenAI permits N
 * tool_calls answered by N `tool` messages, but an Anthropic-translating gateway requires every
 * tool_result to sit in the message DIRECTLY after the tool_use it answers ("no corresponding tool_use
 * block in the immediately-preceding message"); when it splits the N results into separate user messages,
 * the 2nd+ become orphans and it 400s. Splitting yields strict assistant→tool→assistant→tool adjacency
 * that any gateway accepts. Run AFTER sanitizeToolCallPairing (results are present, matching, adjacent).
 * Idempotent: a turn with ≤1 tool_call passes through unchanged.
 */
export function splitParallelToolCalls(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length <= 1) {
      out.push(m);
      continue;
    }
    // Map this turn's contiguous tool results by id, then re-emit one (assistant→result) pair per call.
    const results = new Map<string, ChatMessage>();
    let j = i + 1;
    for (; j < messages.length && messages[j].role === 'tool'; j++) {
      const id = messages[j].tool_call_id;
      if (id) { results.set(id, messages[j]); }
    }
    m.tool_calls.forEach((call, idx) => {
      // Keep the assistant's own text on the FIRST split message; the rest are synthetic single-call turns
      // (no text). BOTH spread ...m so provider fields a thinking-model gateway requires on every assistant
      // turn — notably reasoning_content — survive the split; dropping it from the 2nd+ segment triggers the
      // "reasoning_content … must be passed back" 400.
      const seg: ChatMessage = idx === 0
        ? { ...m, content: m.content ?? null, tool_calls: [call] }
        : { ...m, content: null, tool_calls: [call] };
      out.push(seg);
      out.push(results.get(call.id) ?? { role: 'tool', tool_call_id: call.id, content: '[tool result missing]' });
    });
    i = j - 1;
  }
  return out;
}

function defaultFetch(): FetchFn {
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') {
    throw new Error('Global fetch is unavailable; Node 18+ required for OpenAICompatBackend.');
  }
  return f.bind(globalThis) as FetchFn;
}

function defaultStreamFetch(): StreamFetchFn {
  const f = (globalThis as any).fetch;
  if (typeof f !== 'function') {
    throw new Error('Global fetch is unavailable; Node 18+ required for OpenAICompatBackend streaming.');
  }
  return f.bind(globalThis) as StreamFetchFn;
}

async function* toAsyncIterable(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  controller: AbortController
): AsyncGenerator<Uint8Array> {
  if (Symbol.asyncIterator in Object(body)) {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      yield chunk;
    }
    return;
  }

  const reader = (body as ReadableStream<Uint8Array>).getReader();
  try {
    while (true) {
      if (controller.signal.aborted) {
        throw new Error('Stream aborted');
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        yield value;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
