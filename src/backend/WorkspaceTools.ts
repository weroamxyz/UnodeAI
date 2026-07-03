/*---------------------------------------------------------------------------------------------
 *  UnodeAi - WorkspaceTools
 *  The tool surface exposed to HTTP backends (OpenAICompatBackend), sandboxed to a root dir.
 *
 *  Every path is resolved against the sandbox root and rejected if it escapes it (path
 *  traversal), implementing the PRD's "agent may only touch its working directory" rule.
 *  Tools are gated by AgentConfig.allowedTools (read / write / execute).
 *
 *  F1: read_file now supports offset/limit pagination with a separate 100 KB cap
 *      (READ_FILE_MAX_OUTPUT), leaving the original 16 KB cap for run_command only
 *      (COMMAND_MAX_OUTPUT).
 *--------------------------------------------------------------------------------------------*/

import { spawn, ChildProcess } from 'child_process';
import { sanitizedCommandEnv } from './commandEnv';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { FileCoordinator, NoopFileCoordinator } from './FileCoordinator';
import { CommandPolicy } from './CommandPolicy';
import { webFetch } from './webFetch';
import { parseTodos, todoSummary } from './Todos';
import { MessageBus } from '../bus/MessageBus';

/**
 * 'ask'-mode approver: shown a command, the user allows it (once / this session / this project) or
 * denies it, optionally with a note relayed back to the agent. Allow-latching (session/project) is the
 * approver's job. Wired by the extension to a VS Code modal; absent in tests.
 */
export interface CommandApprovalDecision {
  allow: boolean;
  note?: string;
}
export type CommandApprover = (command: string) => Promise<CommandApprovalDecision>;

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface WorkspaceToolRunResult {
  name: string;
  output: string;
  kind: 'read' | 'list' | 'write' | 'run' | 'unknown';
  path?: string;
  command?: string;
  oldContent?: string | null;
  newContent?: string;
}

/** F1: read_file gets its own generous cap (100 KB) so agents can read full source files. */
/** Hard, machine-readable prefix for "the target is outside the agent's working folder" (G-003). The
 *  tool loop treats it as a TERMINAL block — not an ordinary tool failure the model can retry around. */
export const BLOCKED_OUTSIDE_WORKDIR = 'BLOCKED_OUTSIDE_WORKDIR';

const READ_FILE_MAX_OUTPUT = 100_000;

/** F1: run_command output cap stays at 16 KB to avoid drowning the model context. */
const COMMAND_MAX_OUTPUT = 16_000;

/**
 * F1: Pure exported helper – generates a pagination footer (LINE-based) so the agent knows
 * exactly which lines it received and how to fetch the next chunk. Lines are 0-indexed and the end
 * is exclusive, so the footer's `offset=<end>` reads the very next line.
 *
 *   formatPaginationFooter(0,  50, 818) → "…[showing lines 0–50 of 818 total. Use offset=50 to continue.]"
 *   formatPaginationFooter(50, 90, 818) → "…[showing lines 50–90 of 818 total. Use offset=90 to continue.]"
 */
export function formatPaginationFooter(startLine: number, endLineExclusive: number, totalLines: number): string {
  return `…[showing lines ${startLine}–${endLineExclusive} of ${totalLines} total. Use offset=${endLineExclusive} to continue.]`;
}

/**
 * Find the first absolute path token in a shell command that points OUTSIDE `root` (G-003). Catches the
 * common ways a command escapes the file-tool sandbox — `type C:\…`, `Get-Content C:\…`, UNC `\\…`, or a
 * unix `/a/b` path. Relative paths (`src/foo.ts`, `./x`) and short flags (`/d`) are ignored. Returns the
 * offending absolute path, or undefined if every referenced absolute path is inside the root.
 */
export function detectOutsideRootPath(command: string, root: string): string | undefined {
  const resolvedRoot = path.resolve(root);
  // An INLINE-SCRIPT body (node -e "…", python -c "…", perl -e "…") is source code, not shell argv:
  // it's full of regex literals and string escapes — /\r?\n/, '\\n', '/g' — that look like Windows/UNC
  // or unix paths but aren't, and they caused repeated false "outside your working folder" blocks that
  // wedged agents. Path-sniff only the argv BEFORE the eval flag; the interpreter and any REAL file
  // arguments before it are still checked, the script source after it is not. Gated on a known
  // interpreter so an ordinary `-p`/`-e` flag on another tool (e.g. `git log -p`) isn't truncated.
  let scanned = command;
  if (/\b(?:node|deno|bun|ts-node|tsx|python|python3|ruby|perl|php)\b/.test(command)) {
    const evalAt = command.search(/(?:^|\s)-(?:e|c|p)\b|(?:^|\s)--(?:eval|exec|print|check)\b/);
    if (evalAt >= 0) {
      scanned = command.slice(0, evalAt);
    }
  }
  // Windows drive (C:\ or C:/), UNC (\\server\…), or a unix ABSOLUTE path with ≥2 segments (/a/b…).
  // The unix branch requires the leading "/" to be at a boundary (start, whitespace, or a shell
  // separator/quote/paren). Without that, the "/b/c" TAIL of a RELATIVE path like "src/b/c" is read as
  // the absolute path "/b/c" → resolves to "C:\b\c" → a bogus "outside root" (this blocked a task whose
  // prose merely mentioned "src/backend/AgentBackend.ts").
  const re = /(?:[A-Za-z]:[\\/]|\\\\)[^\s"'|&;<>]*|(?<![\w.~)\]/])\/[^\s"'/|&;<>]+\/[^\s"'|&;<>]*/g;
  for (const raw of scanned.match(re) ?? []) {
    // Paths written in PROSE carry trailing punctuation — "(c:\proj).", "c:\proj," — strip a trailing
    // run of it, or "c:\proj)." is mistaken for a SIBLING of the working root and flagged as outside.
    const tok = raw.replace(/[)\]}.,;:'"!?]+$/, '');
    if (!tok) {
      continue;
    }
    // A real filesystem path we'd want to block never contains a `?` or `*` (invalid in Windows
    // filenames; shell globs/regex elsewhere). When they appear, the token is almost always a regex
    // literal or glob inside an inline script — e.g. `node -e "…split(/\r?\n/)…"` matched `/\r?\n/`,
    // and a doubled `\\r?\\n` matched `C:\r?\n…` — NOT a path. Skipping these stops the false
    // "outside your working folder" block that wedged agents on otherwise-legit commands.
    if (/[?*]/.test(tok)) {
      continue;
    }
    // `/dev/null` (and friends) is the standard "discard output" sink, not an out-of-workspace path —
    // e.g. `grep … 2>/dev/null`. Don't flag it (it was producing a bogus "C:\dev\null is outside…").
    if (/^\/dev\/(?:null|stdout|stderr|tty|zero|random|urandom|fd\/\d+)$/i.test(tok)) {
      continue;
    }
    let abs: string;
    try {
      abs = path.resolve(tok);
    } catch {
      continue;
    }
    const rel = path.relative(resolvedRoot, abs);
    if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
      return abs;
    }
  }
  return undefined;
}

/** Result of running a foreground command: raw exit code + combined stdout/stderr. */
export interface CommandExecResult {
  code: number | null;
  output: string;
  timedOut?: boolean;
  /** Spawn-level failure (e.g. ENOENT) — surfaced as `Error: <error>`. */
  error?: string;
}

/**
 * How a foreground command actually runs. Injected so the execution mechanism can be swapped (#13:
 * a VS Code integrated-terminal/PTY runner) without changing the policy/normalize/framing logic.
 * Default = raw `child_process.spawn` (sanitized env). The runner only executes; gating, the
 * npx→npm rewrite, and the `[exit N]`/truncation framing stay in WorkspaceTools.
 */
export type CommandExecutor = (command: string, opts: { cwd: string; timeoutMs: number }) => Promise<CommandExecResult>;

/**
 * V1 Checkpoints: notified on each successful file write with the content before/after, so the
 * extension can record a restore point. Injected (and name-resolution left to the caller) so the tool
 * surface stays free of checkpoint storage/vscode. `before` is null when the file was newly created.
 */
export type CheckpointRecorder = (entry: { agentId: string; path: string; before: string | null; after: string }) => void;

/**
 * V2 Write approval: asked before a file write is committed when unode.writeApproval is 'ask'. The user
 * previews the change (diff) and decides. 'deny' blocks the write; 'once'/'always' allow it (the
 * 'always' session-latch is the approver's job, symmetric with CommandApprover).
 */
export type WriteApprover = (req: { path: string; before: string | null; after: string }) => Promise<'once' | 'always' | 'deny'>;

/** Shared team memory writer, injected by the extension so WorkspaceTools stays storage-agnostic. */
export type MemoryWriter = (agentId: string, note: string) => Promise<string>;

export const defaultSpawnExecutor: CommandExecutor = (command, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const proc = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: sanitizedCommandEnv() });
    let out = '';
    let finished = false;
    const done = (r: CommandExecResult) => {
      if (finished) { return; }
      finished = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => { proc.kill('SIGKILL'); done({ code: null, output: out, timedOut: true }); }, timeoutMs);
    proc.stdout?.on('data', (d) => (out += d.toString()));
    proc.stderr?.on('data', (d) => (out += d.toString()));
    proc.on('close', (code) => done({ code, output: out }));
    proc.on('error', (err) => done({ code: null, output: out, error: err.message }));
  });

/**
 * A long-running command started with `run_command(background:true)`. The process keeps running
 * across tool calls; the agent polls it with `check_command` and stops it with `kill_command`.
 * Output accumulates (capped) so a later check still sees what scrolled past.
 */
interface BgCommand {
  id: string;
  command: string;
  proc: ChildProcess;
  output: string;
  status: 'running' | 'exited' | 'killed' | 'error';
  exitCode: number | null;
  error?: string;
}

export class WorkspaceTools {
  private lastResult: WorkspaceToolRunResult | undefined;
  private bgCommands = new Map<string, BgCommand>();
  private bgCounter = 0;

  constructor(
    private root: string,
    private allowed: ReadonlySet<string>,
    private agentId = 'agent',
    private coordinator: FileCoordinator = new NoopFileCoordinator(),
    // Safe by default: with no policy injected, command execution is denied.
    private commandPolicy: CommandPolicy = new CommandPolicy('none', []),
    private commandTimeoutMs = 120_000,
    // 'ask' mode: prompt the user (Run once / Always allow / Deny). Without an approver, 'ask' denies.
    private requestApproval?: CommandApprover,
    private bus?: MessageBus,
    // Agent robustness: rewrite a direct test/type/lint-runner call (e.g. `npx vitest`) into the
    // project's matching npm script before it runs. See commandNormalize.
    private commandNormalizer?: (command: string) => { command: string; note?: string },
    // #13: how foreground commands execute. Default = raw spawn; the extension can inject a VS Code
    // integrated-terminal/PTY runner so agents can run TTY-needing tools (e.g. vitest).
    private commandExecutor: CommandExecutor = defaultSpawnExecutor,
    // V1 Checkpoints: optional sink for write before/after content (restore points). No-op if absent.
    private checkpointRecorder?: CheckpointRecorder,
    // V2 Write approval: read LIVE per write (a thunk, not a captured string) so toggling
    // unode.writeApproval applies to already-running agents without a restart. true => prompt first.
    private writeApprovalAsk: () => boolean = () => false,
    private requestWriteApproval?: WriteApprover,
    private memoryWriter?: MemoryWriter,
    // G-003c: notified when a tool path is rejected for being outside the sandbox root, so the host can
    // offer (in context) to move the agent's working folder there instead of leaving it stuck.
    private onOutsideRoot?: (attemptedPath: string) => void,
    // Worktree fan-out: a READ-ONLY overlay root (the unode/integration worktree). read_file/list_dir
    // fall back to it for paths not present in the agent's own worktree, so every agent can READ the
    // team's merged work while WRITES stay isolated to its own root. Undefined = no overlay.
    private sharedReadRoot?: string,
    // Workspace Trust: returns false in an untrusted workspace, where writes/edits/deletes are refused
    // (agent runs read-only). Default = always trusted (keeps tests and non-VS Code callers unchanged).
    private isTrustedWorkspace: () => boolean = () => true,
  ) {
    this.root = path.resolve(root);
    this.sharedReadRoot = sharedReadRoot ? path.resolve(sharedReadRoot) : undefined;
    // A degenerate overlay (shared root === own root) would just double-read; ignore it.
    if (this.sharedReadRoot && this.sharedReadRoot === this.root) {
      this.sharedReadRoot = undefined;
    }
  }

  /** OpenAI-format tool declarations for the tools this agent is allowed to use. */
  specs(): ToolSpec[] {
    const specs: ToolSpec[] = [];
    if (this.allowed.has('read')) {
      specs.push(
        fn('read_file', 'Read a UTF-8 text file relative to the working directory.', {
          path: { type: 'string', description: 'File path relative to the working directory.' },
          offset: { type: 'integer', description: 'Line number to start reading from (0-indexed). Omit to read from the beginning.' },
          limit: { type: 'integer', description: 'Maximum number of lines to return. Omit to read to the end (subject to a 100 KB size cap).' },
        }, ['path']),
        fn('list_dir', 'List entries of a directory relative to the working directory.', {
          path: { type: 'string', description: 'Directory path (use "." for the root).' },
        }, ['path']),
        {
          type: 'function' as const,
          function: {
            name: 'fetch_url',
            description: 'Fetch a public http/https web page or API URL and return its text content. HTML tags are stripped; JSON is returned as-is. Output is truncated to 100,000 characters.',
            parameters: {
              type: 'object' as const,
              properties: {
                url: { type: 'string' as const, description: 'The URL to fetch (must be a public http or https URL; private/internal addresses are rejected).' },
              },
              required: ['url'],
            },
          },
        },
        fn('search_files', 'Search the working directory for a regex (or plain substring) and return matching file:line results. Use this to FIND code or text — do NOT write scratch scripts to grep. Skips node_modules/.git/build dirs and binary files.', {
          query: { type: 'string', description: 'A JavaScript regular expression, or plain text to find.' },
          path: { type: 'string', description: 'Optional subdirectory to limit the search to (relative to the working directory). Omit to search everything.' },
          max_results: { type: 'integer', description: 'Maximum matches to return (default 100, max 1000).' },
        }, ['query'])
      );
    }
    if (this.allowed.has('write')) {
      specs.push(
        fn('write_file', 'Create or overwrite a UTF-8 text file relative to the working directory.', {
          path: { type: 'string', description: 'File path relative to the working directory.' },
          content: { type: 'string', description: 'Full file content to write.' },
        }, ['path', 'content']),
        fn('apply_edit', 'Make a TARGETED edit to an existing file: replace an exact snippet with new text (read the file first to copy the exact text). Preferred over write_file for small changes — no need to resend the whole file.', {
          path: { type: 'string', description: 'File path relative to the working directory.' },
          old_string: { type: 'string', description: 'The exact existing text to replace (copy it verbatim, including indentation). Must be unique in the file unless replace_all is true.' },
          new_string: { type: 'string', description: 'The replacement text (use an empty string to delete the old text).' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match.' },
        }, ['path', 'old_string']),
        fn('delete_file', 'Delete a single file relative to the working directory. The deletion is checkpointed (restorable). Use this to remove a file — do NOT shell out (e.g. node -e unlink / rm).', {
          path: { type: 'string', description: 'File path relative to the working directory.' },
        }, ['path'])
      );
    }
    if (this.allowed.has('execute')) {
      specs.push(
        fn('run_command', 'Run a shell command in the working directory and return its output.', {
          command: { type: 'string', description: 'The shell command to execute.' },
          background: { type: 'boolean', description: 'When true, run in background and return immediately with an ID.' },
        }, ['command']),
        fn('check_command', 'Check status and output of a background command by ID.', { id: { type: 'string', description: 'Background command ID from run_command.' } }, ['id']),
        fn('kill_command', 'Kill a background command by ID.', { id: { type: 'string', description: 'Background command ID from run_command.' } }, ['id'])
      );
    }
    if (this.allowed.has('message')) {
      specs.push(
        fn('send_message', 'Send a message to a teammate by id or role. Use "*" as target to broadcast to all.', {
          target: { type: 'string', description: 'Agent id or role, or "*" to broadcast.' },
          message: { type: 'string', description: 'The message content.' },
        }, ['target', 'message'])
      );
    }
    // C3: real-time Todo list — offered to any agent that actually does work (has ≥1 capability), a
    // pure planning signal with no side effects. A zero-permission pure-chat agent advertises nothing.
    specs.push(
      fn('memory_note', 'Record a short note to the team\'s SHARED memory (.unode/memory/notes.md) so other agents and future sessions see it. Use for decisions made, gotchas/pitfalls discovered, interface contracts, or who-owns-what. Keep it one line.', {
        note: { type: 'string', description: 'A short one-line note for shared team memory.' },
      }, ['note'])
    );
    if (this.allowed.size > 0) {
      specs.push({
      type: 'function' as const,
      function: {
        name: 'update_todos',
        description:
          'Maintain a live checklist for multi-step work, shown to the user in real time. Call this ' +
          'when you start a non-trivial task (lay out the steps) and again whenever a step\'s status ' +
          'changes — mark exactly one step "in_progress" at a time and "completed" as you finish it. ' +
          'Each call REPLACES the entire list, so always send the full set of steps. Skip it for ' +
          'trivial single-step asks.',
        parameters: {
          type: 'object' as const,
          properties: {
            todos: {
              type: 'array' as const,
              description: 'The full ordered checklist (replaces the previous one).',
              items: {
                type: 'object' as const,
                properties: {
                  content: { type: 'string' as const, description: 'Short imperative description of the step.' },
                  status: {
                    type: 'string' as const,
                    enum: ['pending', 'in_progress', 'completed'],
                    description: 'Step status. Keep at most one step in_progress.',
                  },
                },
                required: ['content', 'status'],
              },
            },
          },
          required: ['todos'],
        },
      },
      });
    }
    return specs;
  }

  /** Execute a tool call. Returns a string result (errors are returned, not thrown). */
  async run(name: string, args: Record<string, any>): Promise<string> {
    this.lastResult = undefined;
    // Robustness (weaker models): reject a call that's missing required parameters BEFORE executing,
    // with a precise corrective message — instead of running with `undefined` args and producing a
    // confusing failure the model then blind-retries. Generalizes the write_file empty-path guard.
    const missing = missingRequiredParams(name, args);
    if (missing.length > 0) {
      const msg =
        `Error: ${name} is missing required parameter(s): ${missing.join(', ')}. Nothing was done. ` +
        `Provide them in the arguments, or don't call ${name} if you didn't mean to use it.`;
      this.lastResult = { name, kind: 'unknown', output: msg };
      return msg;
    }
    const result = await this.execute(name, args);
    if (!this.lastResult) {
      this.lastResult = fallbackRunResult(name, args, result);
    }
    // Layer 1: warn the agent if a file it read was changed by a teammate since (cross-file deps).
    const stale = this.coordinator.takeStaleNotices(this.agentId);
    if (stale.length > 0) {
      const rels = stale.map((p) => path.relative(this.root, p) || p).join(', ');
      return `⚠️ Dependency changed: file(s) you previously read were edited by a teammate since: ${rels}. Re-read them before relying on their contents.\n\n${result}`;
    }
    return result;
  }

  takeLastRunResult(): WorkspaceToolRunResult | undefined {
    const result = this.lastResult;
    this.lastResult = undefined;
    return result;
  }

  private async execute(name: string, args: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'read_file': return await this.readFile(args.path, args.offset, args.limit);
        case 'list_dir': return await this.listDir(args.path);
        case 'search_files': return await this.searchFiles(args.query, args.path, args.max_results);
        case 'write_file': return await this.writeFile(args.path, args.content ?? '');
        case 'apply_edit': return await this.applyEdit(args);
        case 'delete_file': return await this.deleteFile(args.path);
        case 'run_command': return await this.runCommand(args.command, args.background === true);
        case 'check_command': return this.checkCommand(args.id);
        case 'kill_command': return this.killCommand(args.id);
        case 'send_message': return await this.sendMessage(args.target, args.message);
        case 'fetch_url': return await this.fetchUrl(args.url);
        case 'update_todos': return this.updateTodos(args.todos);
        case 'memory_note': return await this.recordMemoryNote(args.note);
        default: return `Error: unknown tool "${name}".`;
      }
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private resolve(p: string): string {
    const abs = path.resolve(this.root, p ?? '.');
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      // Model-variance recovery: a model (esp. Claude) often prepends a foreign sandbox prefix
      // (e.g. /Users/dev/workspace-xxxx/) to what should be a workspace-relative path. Re-root it to the
      // matching file INSIDE the sandbox before treating this as an escape — so the path "just works".
      const recovered = this.reRootHallucinatedPath(p ?? '');
      if (recovered) { return recovered; }
      this.onOutsideRoot?.(abs); // let the host offer to move the agent's folder here (G-003c)
      // Terminal block code, not a dead-end the model retries around: directory boundary is a
      // first-class rule. The tool loop ends the turn on this (G-003).
      throw new Error(
        `${BLOCKED_OUTSIDE_WORKDIR}: "${p}" is outside your working folder (${this.root}). If you used an ` +
        `ABSOLUTE path, retry with the path RELATIVE to the workspace root (e.g. "README.md", not ` +
        `"/some/abs/README.md"). If the file genuinely lives in another folder, ask the user — in your ` +
        `reply — to open that folder as the workspace, then wait.`
      );
    }
    return abs;
  }

  /** Recover a path a model mangled by prepending a bogus absolute prefix: match the LONGEST trailing
   *  suffix that exists INSIDE the sandbox. Always returns an in-sandbox path (never an escape), and is
   *  existence-gated so a genuine outside path with no in-workspace twin still hits the boundary block.
   *  The symlink/junction realpath checks still run downstream, so a re-rooted path can't tunnel out. */
  private reRootHallucinatedPath(p: string): string | null {
    const segs = p.split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..');
    for (let i = 0; i < segs.length; i++) {
      const candidate = segs.slice(i).join(path.sep);
      if (!candidate) { continue; }
      const candAbs = path.resolve(this.root, candidate);
      const candRel = path.relative(this.root, candAbs);
      if (candRel.startsWith('..') || path.isAbsolute(candRel)) { continue; } // never escape
      if (existsSync(candAbs)) { return candAbs; } // longest existing in-sandbox suffix wins
    }
    return null;
  }

  private async readFile(p: string, offset?: number, limit?: number): Promise<string> {
    if (!this.allowed.has('read')) { return 'Error: read not permitted.'; }
    let abs = this.resolve(p);
    let fromShared = false;
    try {
      await this.assertExistingPathInsideSandbox(abs, p);
    } catch (err) {
      if (!isNotFound(err)) { throw err; }
      // Not in the agent's own worktree — try the read-only shared overlay (the team's merged work).
      const shared = this.sharedResolve(p);
      if (shared) {
        try {
          await this.assertExistingPathInsideSandbox(shared, p, this.sharedReadRoot!);
          abs = shared;
          fromShared = true;
        } catch (err2) {
          if (!isNotFound(err2)) { throw err2; }
        }
      }
      if (!fromShared) { return notFoundHint(p, 'file'); }
    }

    const fullContent = (await fs.readFile(abs)).toString('utf8');
    // Only own-worktree reads feed optimistic-concurrency: the agent can write its own files (CAS), but
    // a file read from the shared overlay isn't writable here, so recording it would be meaningless.
    if (!fromShared) { this.coordinator.recordRead(this.agentId, abs, fullContent); }

    // F1: offset/limit are LINE-based — offset = 0-indexed start line, limit = max lines — the
    // convention models expect (Claude Code / Cline use line offsets; byte offsets confused agents
    // into reading tiny fragments). READ_FILE_MAX_OUTPUT stays a HARD byte ceiling so a runaway
    // limit can't dump a huge file into context; the agent paginates further with offset.
    const lines = fullContent.split('\n');
    const totalLines = lines.length;

    const start = typeof offset === 'number' ? Math.max(0, Math.floor(offset)) : 0;
    if (start >= totalLines) {
      return `Error: offset ${start} is beyond the end of the file (${totalLines} lines).`;
    }
    const maxLines = typeof limit === 'number' ? Math.max(0, Math.floor(limit)) : totalLines;
    const hardEnd = Math.min(start + maxLines, totalLines);

    // Grow the slice line-by-line until the byte ceiling, always returning at least one line so a
    // single huge line still makes progress.
    let end = start;
    let bytes = 0;
    for (let i = start; i < hardEnd; i++) {
      const lineBytes = Buffer.byteLength(lines[i], 'utf8') + 1; // +1 for the joining newline
      if (i > start && bytes + lineBytes > READ_FILE_MAX_OUTPUT) { break; }
      bytes += lineBytes;
      end = i + 1;
    }

    const sliced = lines.slice(start, end).join('\n');

    // A one-line marker so the agent knows this came from the team's shared (merged) state. It's
    // read-only in THIS tree, but editing is legitimate: a write_file forks your own copy and merges
    // back (conflicts are reconciled) — so the wording invites valid cross-file edits rather than
    // discouraging them, while making clear the shared copy isn't changed in place.
    const sharedNote = fromShared
      ? `\n…[read-only in your tree — from the team's shared integration view. Editing is fine if you need to: write_file forks your own copy and merges back (conflicts are reconciled); it does not change the shared file in place.]`
      : '';

    // No footer when the whole file is returned in a single slice.
    if (start === 0 && end >= totalLines) {
      return sliced + sharedNote;
    }

    return sliced + '\n' + formatPaginationFooter(start, end, totalLines) + sharedNote;
  }

  private async listDir(p: string): Promise<string> {
    if (!this.allowed.has('read')) { return 'Error: read not permitted.'; }
    const abs = this.resolve(p);

    // Read the agent's own worktree view of the directory.
    let ownExists = false;
    const names = new Map<string, boolean>(); // name -> isDirectory
    try {
      await this.assertExistingPathInsideSandbox(abs, p);
      ownExists = true;
      for (const e of await fs.readdir(abs, { withFileTypes: true })) {
        names.set(e.name, e.isDirectory());
      }
    } catch (err) {
      if (!isNotFound(err)) { throw err; }
    }

    // Overlay the shared (integration) view: add entries the agent doesn't have locally, so it can see
    // teammates' merged files/dirs. Own entries win on a name clash (the agent sees its own version).
    let sharedExists = false;
    const shared = this.sharedResolve(p);
    if (shared) {
      try {
        await this.assertExistingPathInsideSandbox(shared, p, this.sharedReadRoot!);
        sharedExists = true;
        for (const e of await fs.readdir(shared, { withFileTypes: true })) {
          if (!names.has(e.name)) { names.set(e.name, e.isDirectory()); }
        }
      } catch (err) {
        if (!isNotFound(err)) { throw err; }
      }
    }

    if (!ownExists && !sharedExists) { return notFoundHint(p, 'directory'); }
    // Sort only when we merged two sources (deterministic union); otherwise keep native readdir order.
    const formatted = [...names.entries()].map(([name, isDir]) => (isDir ? `${name}/` : name));
    if (ownExists && sharedExists) { formatted.sort(); }
    return formatted.join('\n') || '(empty)';
  }

  /** Standard refusal when a mutating tool is used in an untrusted workspace (agent is read-only). */
  private untrustedWorkspaceRefusal(tool: string): string {
    return `Blocked: this workspace is not trusted, so ${tool} is disabled (the agent is read-only until you trust the workspace via Workspace Trust). You can still read and analyze files.`;
  }

  private async writeFile(p: string, content: string): Promise<string> {
    if (!this.isTrustedWorkspace()) { return this.untrustedWorkspaceRefusal('write_file'); }
    const relPath = String(p ?? '');
    if (!this.allowed.has('write')) {
      this.lastResult = {
        name: 'write_file',
        kind: 'write',
        path: relPath,
        output: 'Error: write not permitted.',
      };
      return 'Error: write not permitted.';
    }
    // Robustness: some models emit an empty/parameterless write_file call (e.g. when merely *discussing*
    // it). Reject it up front with a corrective message instead of writing to the sandbox root — and
    // tell the model not to call the tool unless it actually means to write. Breaks the empty-call loop.
    if (!relPath.trim()) {
      const msg =
        "Error: write_file requires a non-empty 'path' (and 'content'); nothing was written. " +
        "Do not call write_file unless you intend to create or overwrite a file.";
      this.lastResult = { name: 'write_file', kind: 'write', path: relPath, output: msg };
      return msg;
    }
    const abs = this.resolve(p);
    await this.assertWritablePathInsideSandbox(abs, p);

    // Optimistic concurrency: only allow the write if the file still matches what this agent
    // last read (compare-and-swap). Rejection is returned to the model so it can re-read & retry.
    const diskContent = await this.readIfExists(abs);
    const decision = this.coordinator.checkWrite(this.agentId, abs, diskContent);
    if (!decision.ok) {
      this.lastResult = {
        name: 'write_file',
        kind: 'write',
        path: relPath,
        oldContent: diskContent,
        newContent: content,
        output: `Write blocked: ${decision.reason}`,
      };
      return `Write blocked: ${decision.reason}`;
    }

    // 0.9 hardening — catastrophic-truncation guard. write_file REPLACES THE ENTIRE FILE; a weak model
    // that treats it like a patch tool can wipe a large file (observed: a 97 KB source replaced with
    // ~2 KB). If this write would shrink a substantial existing file to a tiny fraction, block it with a
    // corrective so the agent re-reads and supplies the FULL content (or uses delete_file if it meant to
    // remove the file). Thresholds are deliberately extreme so normal edits/refactors are never caught.
    if (diskContent !== null) {
      const oldBytes = Buffer.byteLength(diskContent);
      const newBytes = Buffer.byteLength(content);
      if (oldBytes >= 4000 && newBytes < oldBytes * 0.2) {
        const cut = Math.round((1 - newBytes / oldBytes) * 100);
        const msg =
          `Write blocked: this would shrink ${relPath} from ${oldBytes} to ${newBytes} bytes (a ${cut}% cut). ` +
          `write_file REPLACES THE WHOLE FILE — it looks like you dropped most of it by accident. Re-read ` +
          `${relPath} with read_file and write back its FULL content with your change applied. If you ` +
          `genuinely meant to remove the file, use delete_file instead.`;
        this.lastResult = { name: 'write_file', kind: 'write', path: relPath, oldContent: diskContent, newContent: content, output: msg };
        return msg;
      }
    }

    // V2 Write approval: let the user preview + approve/deny before the write lands. 'deny' blocks it
    // (returned to the model so it can adjust); 'once'/'always' proceed. CAS already passed, so the
    // before/after shown to the user matches what will actually be written.
    if (this.writeApprovalAsk() && this.requestWriteApproval) {
      const decision = await this.requestWriteApproval({ path: relPath, before: diskContent, after: content });
      if (decision === 'deny') {
        const msg = 'Write blocked: the user denied this file write. Do not retry it unchanged; revise the approach or ask what they want instead.';
        this.lastResult = { name: 'write_file', kind: 'write', path: relPath, oldContent: diskContent, newContent: content, output: msg };
        return msg;
      }
    }

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    this.coordinator.recordWrite(this.agentId, abs, content);
    // V1 Checkpoints: capture a restore point (before/after). Never let recording break the write.
    try {
      this.checkpointRecorder?.({ agentId: this.agentId, path: relPath, before: diskContent, after: content });
    } catch { /* recording is best-effort */ }
    this.lastResult = {
      name: 'write_file',
      kind: 'write',
      path: relPath,
      oldContent: diskContent,
      newContent: content,
      output: `Wrote ${Buffer.byteLength(content)} bytes to ${p}.`,
    };
    return `Wrote ${Buffer.byteLength(content)} bytes to ${p}.`;
  }

  /** Targeted edit: replace an exact snippet in an existing file with new text, then write through the
   *  full write path (CAS + shrink-guard + approval + checkpoint). Also the alias target for a model's
   *  native Edit/str_replace tool. */
  private async applyEdit(args: Record<string, any>): Promise<string> {
    if (!this.isTrustedWorkspace()) { return this.untrustedWorkspaceRefusal('apply_edit'); }
    if (!this.allowed.has('write')) {
      this.lastResult = { name: 'apply_edit', kind: 'write', path: String(args.path ?? ''), output: 'Error: write not permitted.' };
      return 'Error: write not permitted.';
    }
    const relPath = String(args.path ?? args.file_path ?? '').trim();
    const oldString = args.old_string ?? args.old_str ?? args.oldText ?? '';
    const newString = String(args.new_string ?? args.new_str ?? args.newText ?? '');
    const replaceAll = args.replace_all === true || args.replaceAll === true;
    if (!relPath) { return 'Error: apply_edit requires a non-empty "path".'; }
    if (typeof oldString !== 'string' || oldString === '') {
      return 'Error: apply_edit requires "old_string" — the exact existing text to replace. To create a NEW file, use write_file.';
    }
    const abs = this.resolve(relPath);
    // Run the symlink/junction sandbox check BEFORE reading — otherwise a workspace symlink to an outside
    // file could let apply_edit probe whether old_string exists (and how often) before the write is blocked.
    await this.assertWritablePathInsideSandbox(abs, relPath);
    const content = await this.readIfExists(abs);
    if (content === null) {
      return `Error: cannot edit "${relPath}" — file not found. Use write_file to create it.`;
    }
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      return `Error: old_string was not found in ${relPath}. Read the file and copy the exact text (including whitespace/indentation) you want to replace.`;
    }
    if (occurrences > 1 && !replaceAll) {
      return `Error: old_string appears ${occurrences} times in ${relPath}; it must be unique. Add surrounding context to make it unique, or pass "replace_all": true.`;
    }
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
    // Reuse the full write path (CAS, shrink-guard, write-approval, checkpoint, lastResult/diff).
    return await this.writeFile(relPath, updated);
  }

  /** Delete a single file (sandboxed + checkpointed for undo). Destructive, so it goes through the same
   *  write-approval gate as a write. Refuses directories and missing files with a clear message. */
  private async deleteFile(p: string): Promise<string> {
    if (!this.isTrustedWorkspace()) { return this.untrustedWorkspaceRefusal('delete_file'); }
    const relPath = String(p ?? '');
    if (!this.allowed.has('write')) {
      this.lastResult = { name: 'delete_file', kind: 'write', path: relPath, output: 'Error: write not permitted.' };
      return 'Error: write not permitted.';
    }
    if (!relPath.trim()) {
      const msg = "Error: delete_file requires a non-empty 'path'; nothing was deleted.";
      this.lastResult = { name: 'delete_file', kind: 'write', path: relPath, output: msg };
      return msg;
    }
    const abs = this.resolve(p);
    await this.assertWritablePathInsideSandbox(abs, p);
    const before = await this.readIfExists(abs);
    if (before === null) {
      let isDir = false;
      try { isDir = (await fs.stat(abs)).isDirectory(); } catch { /* missing */ }
      const msg = isDir
        ? `Error: delete_file removes a single file, not a directory (${relPath}).`
        : `Error: ${relPath} does not exist — nothing to delete.`;
      this.lastResult = { name: 'delete_file', kind: 'write', path: relPath, output: msg };
      return msg;
    }
    // Destructive: same approval gate as a write (before = content, after = '' i.e. gone).
    if (this.writeApprovalAsk() && this.requestWriteApproval) {
      const decision = await this.requestWriteApproval({ path: relPath, before, after: '' });
      if (decision === 'deny') {
        const msg = 'Delete blocked: the user denied removing this file. Do not retry it unchanged.';
        this.lastResult = { name: 'delete_file', kind: 'write', path: relPath, output: msg };
        return msg;
      }
    }
    await fs.unlink(abs);
    this.coordinator.recordWrite(this.agentId, abs, ''); // CAS bookkeeping: file is now gone
    try {
      this.checkpointRecorder?.({ agentId: this.agentId, path: relPath, before, after: '' });
    } catch { /* recording is best-effort */ }
    this.lastResult = { name: 'delete_file', kind: 'write', path: relPath, oldContent: before, newContent: '', output: `Deleted ${relPath}.` };
    return `Deleted ${relPath}.`;
  }

  /** Regex/substring search across the sandbox, returning `relpath:line: text`. Read-only; skips
   *  node_modules/.git/build dirs, large files, and binaries. Bounded so a huge repo can't hang it. */
  private async searchFiles(queryRaw: string, subdir?: string, maxResultsRaw?: number): Promise<string> {
    const query = String(queryRaw ?? '');
    if (!query.trim()) { return "Error: search_files requires a non-empty 'query'."; }
    let re: RegExp;
    try {
      re = new RegExp(query, 'i');
    } catch {
      re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); // invalid regex → literal
    }
    const max = Math.max(1, Math.min(1000, Number(maxResultsRaw) || 100));
    const startAbs = subdir ? this.resolve(subdir) : this.root;
    try {
      await this.assertExistingPathInsideSandbox(startAbs, subdir ?? '.');
    } catch {
      return `Error: "${subdir}" is outside the working folder.`;
    }
    const IGNORE = new Set(['node_modules', '.git', 'out', 'out-e2e', 'dist', 'build', '.vscode-test', 'coverage', '.unode', '.npm-cache', '.worktrees']);
    const results: string[] = [];
    let filesScanned = 0;
    const walk = async (dir: string): Promise<void> => {
      if (results.length >= max || filesScanned > 8000) { return; }
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (results.length >= max || filesScanned > 8000) { return; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORE.has(e.name)) { await walk(full); }
          continue;
        }
        if (!e.isFile()) { continue; }
        filesScanned++;
        let content: string;
        try {
          if ((await fs.stat(full)).size > 1_000_000) { continue; } // skip big files
          content = await fs.readFile(full, 'utf8');
        } catch { continue; }
        if (content.indexOf(String.fromCharCode(0)) !== -1) { continue; } // skip binary (NUL byte)
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            const rel = path.relative(this.root, full).replace(/\\/g, '/');
            results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (results.length >= max) { return; }
          }
        }
      }
    };
    await walk(startAbs);
    if (results.length === 0) { return `No matches for /${query}/.`; }
    const capped = results.length >= max ? ` (capped at ${max})` : '';
    return `${results.length} match${results.length === 1 ? '' : 'es'} for /${query}/${capped}:\n${results.join('\n')}`;
  }

  private async readIfExists(abs: string): Promise<string | null> {
    try {
      return await fs.readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  /** Resolve a path against the read-only shared overlay (integration worktree), or undefined if there
   *  is no overlay or the path escapes it. Never calls onOutsideRoot — the overlay is a read fallback,
   *  not the agent's primary sandbox. */
  private sharedResolve(p: string): string | undefined {
    if (!this.sharedReadRoot) { return undefined; }
    const abs = path.resolve(this.sharedReadRoot, p ?? '.');
    const rel = path.relative(this.sharedReadRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { return undefined; }
    return abs;
  }

  private async assertExistingPathInsideSandbox(abs: string, original: string, root: string = this.root): Promise<void> {
    const real = await fs.realpath(abs);
    await this.assertRealPathInsideSandbox(real, original, root);
  }

  private async assertWritablePathInsideSandbox(abs: string, original: string): Promise<void> {
    try {
      await this.assertExistingPathInsideSandbox(abs, original);
    } catch (err) {
      if (!isNotFound(err)) {
        throw err;
      }
    }

    const ancestor = await this.nearestExistingAncestor(path.dirname(abs));
    const realAncestor = await fs.realpath(ancestor);
    await this.assertRealPathInsideSandbox(realAncestor, original);
  }

  private async nearestExistingAncestor(absDir: string): Promise<string> {
    let current = absDir;
    while (true) {
      try {
        const stat = await fs.lstat(current);
        if (stat.isDirectory() || stat.isSymbolicLink()) {
          return current;
        }
      } catch (err) {
        if (!isNotFound(err)) {
          throw err;
        }
      }
      const next = path.dirname(current);
      if (next === current) {
        throw new Error(`No existing parent directory for "${absDir}".`);
      }
      current = next;
    }
  }

  private async assertRealPathInsideSandbox(realPath: string, original: string, root: string = this.root): Promise<void> {
    const realRoot = await fs.realpath(root);
    const rel = path.relative(realRoot, realPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path "${original}" escapes the working directory sandbox via a symlink or junction.`);
    }
  }

  /**
   * Gate a command through policy + 'ask' approval before it reaches a shell. Returns null when the
   * command may run, or an error string explaining why it was blocked/denied. Shared by the
   * foreground and background paths so background commands get the same default-deny treatment.
   */
  private async gateCommand(command: string): Promise<string | null> {
    const verdict = this.commandPolicy.check(command);
    if (verdict.ask && this.requestApproval) {
      // 'ask' mode: let the user decide. Session/project allow-latching is the approver's job.
      const decision = await this.requestApproval(command);
      if (!decision.allow) {
        const note = decision.note ? ` The user said: "${decision.note}". Adjust accordingly or ask them what to do.` : '';
        return `Command blocked: not approved by the user.${note}`;
      }
      // allowed (once / this session / this project).
    } else if (!verdict.allowed) {
      // Point the agent at the legal path instead of a dead-end (G-003): chained/piped shell isn't
      // allowed, and editing files should use write_file, not shell redirection.
      const guidance = /control character/i.test(verdict.reason ?? '')
        ? ' Run ONE simple command without `;`/`|`/`&&`/`>`. To edit a file, use the write_file tool (not shell redirection); to read one, use read_file.'
        : '';
      return `Command blocked: ${verdict.reason}${guidance}`;
    }
    return null;
  }

  private async runCommand(command: string, background = false): Promise<string> {
    if (!this.allowed.has('execute')) { return 'Error: execute not permitted.'; }

    // Agent robustness: rewrite a direct runner call (e.g. `npx vitest`) into the project's script
    // BEFORE policy + spawn, so the policy gates what actually runs and the agent can't hang on watch.
    let runNote: string | undefined;
    if (this.commandNormalizer) {
      const norm = this.commandNormalizer(command);
      command = norm.command;
      runNote = norm.note;
    }
    const withNote = (text: string) => (runNote ? `${runNote}\n${text}` : text);

    // Sandbox the shell too (G-003): a command must not reach files OUTSIDE the workspace root via an
    // absolute path (e.g. `type C:\other\secret`, `Get-Content …`) — that's both a sandbox escape and
    // the way a weak model tries to smuggle around the file-tool sandbox. Block it, tell the agent to
    // stop and ask, and signal the host so it can offer to switch the agent's working folder.
    const outside = detectOutsideRootPath(command, this.root);
    if (outside) {
      this.onOutsideRoot?.(outside);
      return withNote(
        `${BLOCKED_OUTSIDE_WORKDIR}: this command references "${outside}", outside your working folder ` +
        `(${this.root}). Do not try another command. Ask the user, in your reply, to switch your working ` +
        `folder to that folder or open it as the workspace, then wait.`
      );
    }

    // Gate every command through the policy (default-deny) before it ever reaches a shell.
    const blocked = await this.gateCommand(command);
    if (blocked) { return withNote(blocked); }

    if (background) { return withNote(this.runCommandBackground(command)); }

    // Execute via the injected runner (default spawn; #13 may swap in a terminal/PTY runner). Gating,
    // the npx→npm rewrite (above), and the framing below stay here regardless of executor.
    const r = await this.commandExecutor(command, { cwd: this.root, timeoutMs: this.commandTimeoutMs });
    if (r.error !== undefined) {
      return withNote(`Error: ${r.error}`);
    }
    const text = r.timedOut
      ? `[timed out after ${Math.round(this.commandTimeoutMs / 1000)}s]\n${r.output}`
      : `[exit ${r.code}]\n${r.output}`;
    return withNote(truncate(text));
  }

  /** Spawn a long-running command, register it, and return its handle immediately. */
  private runCommandBackground(command: string): string {
    const id = `bg_${++this.bgCounter}`;
    const proc = spawn(command, { cwd: this.root, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: sanitizedCommandEnv() });
    const entry: BgCommand = { id, command, proc, output: '', status: 'running', exitCode: null };
    this.bgCommands.set(id, entry);

    const append = (d: Buffer) => {
      entry.output += d.toString();
      // Keep only the tail so a long-lived process can't grow output unbounded in memory.
      if (entry.output.length > COMMAND_MAX_OUTPUT * 2) {
        entry.output = entry.output.slice(-COMMAND_MAX_OUTPUT * 2);
      }
    };
    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);
    proc.on('close', (code) => {
      // A SIGKILL from kill_command surfaces as close with null code; don't overwrite 'killed'.
      if (entry.status === 'running') {
        entry.status = 'exited';
        entry.exitCode = code;
      }
    });
    proc.on('error', (err) => {
      entry.status = 'error';
      entry.error = err.message;
    });

    return `Background command started. ID: ${id}\nCommand: ${command}\nUse check_command with ID "${id}" to poll its output, or kill_command to stop it.`;
  }

  private checkCommand(idRaw: any): string {
    const id = String(idRaw ?? '').trim();
    const entry = this.bgCommands.get(id);
    if (!entry) { return `Error: no background command with ID "${id}".`; }
    const header =
      entry.status === 'running' ? `[${id} running]`
      : entry.status === 'exited' ? `[${id} exited ${entry.exitCode}]`
      : entry.status === 'killed' ? `[${id} killed]`
      : `[${id} error: ${entry.error ?? 'unknown'}]`;
    const body = entry.output.length > 0 ? entry.output : '(no output yet)';
    return truncate(`${header}\n${body}`);
  }

  private killCommand(idRaw: any): string {
    const id = String(idRaw ?? '').trim();
    const entry = this.bgCommands.get(id);
    if (!entry) { return `Error: no background command with ID "${id}".`; }
    if (entry.status !== 'running') { return `Background command "${id}" already ${entry.status}.`; }
    entry.status = 'killed';
    entry.proc.kill('SIGKILL');
    return `Background command "${id}" killed.`;
  }

  /** Kill every still-running background command. Call when the agent/session is torn down. */
  async disposeBackground(): Promise<void> {
    for (const entry of this.bgCommands.values()) {
      if (entry.status === 'running') {
        entry.status = 'killed';
        entry.proc.kill('SIGKILL');
      }
    }
    this.bgCommands.clear();
  }

  private async fetchUrl(url: string): Promise<string> {
    if (!this.allowed.has('read')) { return 'Error: read not permitted.'; }
    this.lastResult = {
      name: 'fetch_url',
      kind: 'read',
      path: url,
      output: '',
    };
    const result = await webFetch(url);
    this.lastResult.output = result;
    return result;
  }

  private sendMessage(targetRaw: any, messageRaw: any): string {
    if (!this.allowed.has('message')) { return 'Error: messaging not permitted.'; }
    if (!this.bus) { return 'Error: messaging not available (no bus configured).'; }
    const target = String(targetRaw ?? '').trim();
    const msg = String(messageRaw ?? '').trim();
    if (!target) { return 'Error: target is required.'; }
    if (!msg) { return 'Error: message is required.'; }
    if (target === '*') {
      this.bus.broadcast(this.agentId, 'agent.message', { message: msg });
      return `Message broadcast to all teammates.`;
    }
    this.bus.send(this.agentId, target, 'agent.message', { message: msg });
    return `Message sent to "${target}".`;
  }

  /**
   * C3: record the agent's live checklist. No side effects — the value to the user comes from the
   * chat view rendering the tool-call input as a pinned checklist; here we just confirm to the model.
   */
  private updateTodos(todosRaw: unknown): string {
    const todos = parseTodos(todosRaw);
    if (todos.length === 0) {
      return 'Plan cleared (no steps).';
    }
    const current = todos.find((t) => t.status === 'in_progress');
    const where = current ? ` Current: ${current.content}` : '';
    return `Plan updated — ${todoSummary(todos)}.${where}`;
  }
  private async recordMemoryNote(noteRaw: unknown): Promise<string> {
    const note = String(noteRaw ?? '').trim();
    if (!note) {
      return "Error: memory_note requires a non-empty 'note'.";
    }
    if (!this.memoryWriter) {
      return 'Shared memory is not available in this context.';
    }
    return this.memoryWriter(this.agentId, note);
  }
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Actionable "not found" message for a path that IS inside the working folder but doesn't exist —
 * a plain typo/wrong-guess. Steers a weak agent to recover (list_dir the parent) instead of flailing
 * into other paths and tripping the directory-boundary block. NOT the same as BLOCKED_OUTSIDE_WORKDIR.
 */
function notFoundHint(original: string, kind: 'file' | 'directory'): string {
  const parent = original.replace(/[\\/]+$/, '').split(/[\\/]/).slice(0, -1).join('/') || '.';
  return (
    `Error: ${kind} not found: "${original}". It is inside your working folder but does not exist — ` +
    `you likely have the path slightly wrong. Use list_dir("${parent}") to see what's actually there, ` +
    `then read the correct path. Do NOT retry the same path or guess other paths blindly.`
  );
}

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ToolSpec {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

/**
 * Required parameters per tool (mirrors the `required` arrays in specs()). Used to reject a call with
 * missing args up front. Present-check only (undefined/null = missing) so a legitimately-empty value
 * passes — e.g. write_file with content:'' (empty file) or update_todos with todos:[] (clear plan).
 * Per-param non-empty rules (e.g. a whitespace-only path) stay in the individual handlers.
 */
const REQUIRED_PARAMS: Record<string, string[]> = {
  read_file: ['path'],
  list_dir: ['path'],
  search_files: ['query'],
  apply_edit: ['path', 'old_string'],
  write_file: ['path', 'content'],
  delete_file: ['path'],
  run_command: ['command'],
  check_command: ['id'],
  kill_command: ['id'],
  send_message: ['target', 'message'],
  fetch_url: ['url'],
  update_todos: ['todos'],
  memory_note: ['note'],
};

function missingRequiredParams(name: string, args: Record<string, any>): string[] {
  const required = REQUIRED_PARAMS[name];
  if (!required) {
    return [];
  }
  return required.filter((p) => args?.[p] === undefined || args?.[p] === null);
}

function fallbackRunResult(name: string, args: Record<string, any>, output: string): WorkspaceToolRunResult {
  switch (name) {
    case 'read_file':
      return { name, kind: 'read', path: String(args.path ?? ''), output };
    case 'list_dir':
      return { name, kind: 'list', path: String(args.path ?? ''), output };
    case 'run_command':
      return { name, kind: 'run', command: String(args.command ?? ''), output };
    case 'write_file':
      return { name, kind: 'write', path: String(args.path ?? ''), output };
    default:
      return { name, kind: 'unknown', output };
  }
}

/** F1: command-output truncation uses COMMAND_MAX_OUTPUT (16 KB). */
function truncate(s: string): string {
  return s.length > COMMAND_MAX_OUTPUT ? s.slice(0, COMMAND_MAX_OUTPUT) + `\n…[truncated ${s.length - COMMAND_MAX_OUTPUT} chars]` : s;
}
