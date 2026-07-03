/*---------------------------------------------------------------------------------------------
 *  UnodeAi - TeamTools
 *  The delegation tool surface given to a coordinator agent (the PM). Lets one agent manage
 *  others: see the roster, hand a task to a teammate and wait for the result, or broadcast.
 *
 *  This is what turns the "pm" role from a teammate that merely writes a plan into an
 *  orchestrator that actually drives the crew. It plugs into the MessageBus we already use, so
 *  an assign_task simply flows through SessionManager's normal routing to the target's backend.
 *
 *  Decoupled from SessionManager via the TeamView interface so the backend layer stays
 *  independent of session/.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { killProcessTree } from './processTree';
import { v4 as uuidv4 } from 'uuid';
import { MessageBus } from '../bus/MessageBus';
import { ToolSpec, CommandApprover } from './WorkspaceTools';
import { sanitizedCommandEnv } from './commandEnv';
import { CommandPolicy } from './CommandPolicy';
import { TaskClaimRegistry } from './TaskClaimRegistry';

export interface TeamRosterEntry {
  id: string;
  role: string;
  name: string;
  status: string;
}

/** Minimal read view of the team, supplied by the extension from SessionManager. */
export interface TeamView {
  list(): TeamRosterEntry[];
  resolve(ref: string): { id: string } | undefined;
}

const TEAM_TOOL_NAMES = new Set([
  'list_agents',
  'assign_task',
  'assign_task_async',
  'await_tasks',
  'broadcast',
  'run_checks',
]);

/** Per-result size cap in await_tasks output, to bound the PM's context/cost. */
const AWAIT_RESULT_MAX = 8000;
const DEFAULT_CANCEL_REASON = 'delegation cancelled by user';

interface ActiveDispatch {
  cancel: (reason?: string) => void;
}

interface PendingAsyncTask {
  ref: string;
  promise: Promise<string>;
}

/** A dispatch promise resolves to an error/timeout string on failure (see dispatch()). */
function isTaskFailure(text: string): boolean {
  return /^Error\b/i.test(text.trim());
}

/** Runs a shell command for the verification gate; injectable so tests need no real build. */
export type CommandRunner = (command: string, cwd: string) => Promise<{ code: number | null; output: string }>;

export interface TeamToolsOptions {
  timeoutMs?: number;
  /** User-configured verify command (e.g. "npm run build"); run by run_checks. Empty = disabled. */
  verifyCommand?: string;
  cwd?: string;
  runCommand?: CommandRunner;
  commandPolicy?: CommandPolicy;
  /** Called when run_checks is blocked by CommandPolicy, so the extension can warn the user (B2).
   *  Kept as a vscode-free callback so TeamTools stays unit-testable. */
  onCommandBlocked?: (reason: string) => void;
  /** 'ask'-mode approver, SAME one run_command uses. Without it, run_checks can't get past 'ask' and the
   *  PM deadlocks: its only verify path is blocked while run_command is delegate-gated. Optional for tests. */
  requestApproval?: CommandApprover;
  /** Router v1: called with a one-line audit string when a delegation is routed to a teammate
   *  (e.g. "Routed 'senior-dev' → senior-dev-2 (idle, least-recently-assigned)"). The extension wires
   *  it to the output channel so agent selection is explainable/reproducible. vscode-free for tests. */
  onRoute?: (line: string) => void;
  /** Max async delegations in flight at once (Option B). Beyond this, assign_task_async asks the PM
   *  to collect with await_tasks first — bounds teammate inbox pressure and PM wait time. */
  maxParallelDelegations?: number;
  /** Option B step 2: shared file-ownership registry. When set, assign_task_async's `files` are
   *  claimed and overlapping parallel dispatches are rejected up front. */
  claims?: TaskClaimRegistry;
  /** L3 agent-robustness escalation: switch a stuck teammate (returns nothing twice) to its fallback
   *  model for one more attempt. Wired to SessionManager.escalateToFallback. Returns what happened so
   *  the PM can be told precisely (e.g. "no fallback configured"). Absent in tests that don't need it. */
  escalate?: (agentId: string) => EscalateResult;
}

export type EscalateResult = {
  switched: boolean;
  reason: 'switched' | 'no-fallback' | 'already-on-fallback' | 'unknown-agent';
  from?: string;
  to?: string;
};

export class TeamTools {
  private timeoutMs: number;
  private verifyCommand: string;
  private cwd: string;
  private runCommand: CommandRunner;
  private commandPolicy?: CommandPolicy;
  private onCommandBlocked?: (reason: string) => void;
  private requestApproval?: CommandApprover;
  private onRoute?: (line: string) => void;
  private maxParallel: number;
  private claims?: TaskClaimRegistry;
  private escalate?: (agentId: string) => EscalateResult;
  /** In-flight async delegations (Option B): handle -> { ref, promise }. Drained by await_tasks. */
  private pending = new Map<string, PendingAsyncTask>();
  /** Every teammate wait currently owned by this coordinator, including blocking assign_task retries. */
  private activeDispatches = new Map<string, ActiveDispatch>();
  /** Role-spread bookkeeping: how many of THIS coordinator's tasks each teammate is running right now
   *  (so a role ref skips a teammate we've already loaded up), and a monotonic "last assigned" stamp
   *  per teammate (so sequential role delegations round-robin instead of always hitting the first). */
  private busyCount = new Map<string, number>();
  private lastAssigned = new Map<string, number>();
  private dispatchSeq = 0;

  constructor(
    private selfId: string,
    private view: TeamView,
    private bus: MessageBus,
    opts: TeamToolsOptions = {}
  ) {
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.verifyCommand = opts.verifyCommand ?? '';
    this.cwd = opts.cwd ?? process.cwd();
    this.runCommand = opts.runCommand ?? defaultRunner;
    this.commandPolicy = opts.commandPolicy;
    this.onCommandBlocked = opts.onCommandBlocked;
    this.requestApproval = opts.requestApproval;
    this.onRoute = opts.onRoute;
    this.maxParallel = Math.max(1, opts.maxParallelDelegations ?? 5);
    this.claims = opts.claims;
    this.escalate = opts.escalate;
  }

  has(name: string): boolean {
    return TEAM_TOOL_NAMES.has(name);
  }

  /** True when this coordinator has at least one teammate to delegate to. Used to gate the PM's own
   *  write/command tools: with teammates it must delegate; with none, its file tools are a real fallback. */
  hasTeammates(): boolean {
    return this.view.list().some((a) => a.id !== this.selfId);
  }

  specs(): ToolSpec[] {
    return [
      spec('list_agents', 'List your teammates (id, role, status) so you can decide who to delegate to.', {}, []),
      spec(
        'assign_task',
        'Hand a task to a teammate by id or role and wait for their result. Returns the teammate\'s final output. Delegate one task at a time.',
        {
          agent: { type: 'string', description: 'Target teammate id (preferred — exact) or role. If you target a role and several teammates share it, an available one is auto-selected and repeated calls round-robin across them, so you can fan work out by role.' },
          instruction: { type: 'string', description: 'The task for the teammate, with all context they need.' },
        },
        ['agent', 'instruction']
      ),
      spec(
        'assign_task_async',
        'Dispatch a task to a teammate and return IMMEDIATELY with a handle (does NOT wait). Use this to run several teammates in PARALLEL when their work is independent and touches NON-OVERLAPPING files: call assign_task_async once per teammate, then call await_tasks to collect all results. Only safe for independent work — if task B needs task A\'s output, use assign_task instead. Pass `files` (the paths/globs this task will own) so overlapping parallel dispatches are rejected up front — re-partition with the architect if you get a conflict.',
        {
          agent: { type: 'string', description: 'Target teammate id (preferred — exact) or role. If you target a role and several teammates share it, an available one is auto-selected and repeated calls round-robin across them, so you can fan work out by role.' },
          instruction: { type: 'string', description: 'The task for the teammate, with all context they need.' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Paths/globs this task will own, e.g. ["src/auth/**","src/types/auth.ts"]. Used to detect conflicts with other parallel tasks.',
          },
        },
        ['agent', 'instruction']
      ),
      spec(
        'await_tasks',
        'Wait for previously dispatched assign_task_async tasks to finish and return all their results together. Omit handles to await every pending task; or pass specific handles to await just those.',
        {
          handles: {
            type: 'array',
            items: { type: 'string' },
            description: 'Handles returned by assign_task_async. Omit to await all pending tasks.',
          },
        },
        []
      ),
      spec(
        'broadcast',
        'Send an informational message to every teammate (fire-and-forget, no reply awaited).',
        { message: { type: 'string', description: 'The announcement to broadcast.' } },
        ['message']
      ),
      spec(
        'run_checks',
        'Build/type-check/test the WHOLE project to catch cross-file breakage after teammates edit different files. Returns pass or the failing output. Run this after implementation and after any fix.',
        {},
        []
      ),
    ];
  }

  async run(name: string, args: Record<string, any>): Promise<string> {
    switch (name) {
      case 'list_agents':
        return this.listAgents();
      case 'assign_task':
        return this.assignAndAwait(String(args.agent ?? ''), String(args.instruction ?? ''));
      case 'assign_task_async':
        return this.assignAsync(
          String(args.agent ?? ''),
          String(args.instruction ?? ''),
          Array.isArray(args.files) ? args.files.map(String) : undefined
        );
      case 'await_tasks':
        return this.awaitTasks(Array.isArray(args.handles) ? args.handles.map(String) : undefined);
      case 'broadcast':
        this.bus.broadcast(this.selfId, 'broadcast.info', { instruction: String(args.message ?? '') });
        return 'Broadcast sent to all teammates.';
      case 'run_checks':
        return this.runChecks();
      default:
        return `Error: unknown team tool "${name}".`;
    }
  }

  /**
   * Cancel every delegation wait owned by this coordinator. Used when the user presses Stop or the
   * coordinator backend is torn down; releases async file claims immediately so future work is not
   * blocked by stale ownership.
   */
  cancelPending(reason = DEFAULT_CANCEL_REASON): number {
    const active = [...this.activeDispatches.values()];
    for (const dispatch of active) {
      dispatch.cancel(reason);
    }
    const pendingHandles = [...this.pending.keys()];
    for (const handle of pendingHandles) {
      this.pending.delete(handle);
      this.claims?.release(handle);
    }
    return active.length + pendingHandles.length;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  /** A compact "here's who you can delegate to" line for error recovery (e.g. when a model calls a
   *  delegation tool with an empty/unknown target — list the real roles so it can retry correctly). */
  private rosterHint(): string {
    const roster = this.view.list().filter((a) => a.id !== this.selfId);
    if (roster.length === 0) { return 'You have no teammates to delegate to — make the change yourself.'; }
    const roles = [...new Set(roster.map((a) => a.role))].join(', ');
    return `Specify which teammate by role (one of: ${roles}) or id, then call assign_task again.`;
  }

  private listAgents(): string {
    const roster = this.view.list().filter((a) => a.id !== this.selfId);
    if (roster.length === 0) {
      return 'You have no teammates yet. Ask the user to add agents to the team.';
    }
    // Intentionally DO NOT surface a "stopped"/"idle" status per agent: coordinators read that as
    // "unavailable" and refuse to delegate (they loop list_agents instead). Every teammate is
    // assignable — a stopped one starts automatically when you assign to it. Status is the runtime's
    // job, not the PM's.
    const lines = roster.map((a) => `- ${a.id} (role: ${a.role})`).join('\n');
    return `Your teammates — assign work to any of them with assign_task or assign_task_async. You do NOT ` +
      `need to wait, "check the team", or have them "running" first: a teammate starts automatically when ` +
      `you assign a task to it. Pick by role and delegate now.\n${lines}`;
  }

  /**
   * Resolve a delegation target from an id OR a role. Exact id always wins — explicit targeting is
   * never reinterpreted. For a ROLE that matches several teammates, SPREAD the work instead of always
   * picking the first match (the bug where a PM with two "senior-dev"s delegated both tasks to one):
   *   - prefer a teammate this coordinator isn't already running a task on, and that looks idle
   *     (catches parallel assign_task_async fan-out), then
   *   - among equals, prefer the least-recently-assigned / never-assigned one
   *     (round-robins sequential assign_task calls across same-role teammates).
   * Falls back to the extension's own resolver for names/aliases the roster lookup didn't catch.
   */
  private resolveTarget(ref: string): { id: string; reason: string } | undefined {
    const needle = ref.trim();
    if (!needle) { return undefined; }
    const roster = this.view.list().filter((a) => a.id !== this.selfId);
    const byId = roster.find((a) => a.id === needle);
    if (byId) { return { id: byId.id, reason: 'pinned by exact id' }; }
    // Match by role OR display name (case-insensitive) — the PM sees both in list_agents and may use
    // either. Whichever matches several teammates, spread the work across them.
    const lc = needle.toLowerCase();
    const candidates = roster.filter((a) => a.role.toLowerCase() === lc || a.name.toLowerCase() === lc);
    if (candidates.length > 0) {
      // Router — hard filter: only an ERRORED teammate is "don't route here". A 'stopped' teammate is NOT
      // unavailable — it just hasn't started and auto-starts when assigned, so it's a FREE target. (If ALL
      // matches are errored, fall back to them so the task still resolves and the audit notes it.)
      const usable = candidates.filter((a) => !isUnavailableStatus(a.status));
      const pool = usable.length > 0 ? usable : candidates;
      // Rank: FREE (idle or stopped — not running a task and not loaded by this PM) before BUSY (running),
      // then least-recently-assigned (round-robin). So a busy agent is skipped for a free one; if every
      // candidate is busy, the least-loaded/least-recent gets it and the task simply queues (delay expected).
      const ranked = pool
        .map((a) => ({
          id: a.id,
          busy: (this.busyCount.get(a.id) ?? 0) > 0 || isBusyStatus(a.status),
          last: this.lastAssigned.get(a.id) ?? -1,
        }))
        .sort((x, y) => Number(x.busy) - Number(y.busy) || x.last - y.last);
      const pick = ranked[0];
      // Auditable "why this teammate" string (Router explainability).
      const reason = candidates.length === 1
        ? `only '${needle}' on the team`
        : `'${needle}': ${pick.busy ? 'least-busy (all candidates busy — will queue)' : 'free'}, ` +
          `least-recently-assigned (1 of ${pool.length}${usable.length === 0 ? ', all currently errored' : ''})`;
      return { id: pick.id, reason };
    }
    const resolved = this.view.resolve(needle);
    return resolved ? { id: resolved.id, reason: 'resolved by name/alias' } : undefined;
  }

  /** Record that a task is now running on a teammate (for role-spread). */
  private markBusy(agentId: string): void {
    this.lastAssigned.set(agentId, this.dispatchSeq++);
    this.busyCount.set(agentId, (this.busyCount.get(agentId) ?? 0) + 1);
  }

  /** Record that a task on a teammate finished (for role-spread). */
  private markFree(agentId: string): void {
    const left = (this.busyCount.get(agentId) ?? 1) - 1;
    if (left <= 0) { this.busyCount.delete(agentId); } else { this.busyCount.set(agentId, left); }
  }

  /**
   * Layer 2 — verification gate. Runs the user-configured verify command over the whole project.
   * This is the only reliable detector of cross-file semantic breakage (the compiler/tests), so
   * the PM runs it after implementation and feeds failures back as fix tasks.
   */
  private async runChecks(): Promise<string> {
    if (!this.verifyCommand.trim()) {
      return 'No verification command configured. Ask the user to set "roam.verifyCommand" (e.g. "npm run build" or "npx tsc --noEmit").';
    }
    const verdict = this.commandPolicy?.check(this.verifyCommand);
    if (verdict && !verdict.allowed) {
      // 'ask' mode (the DEFAULT): prompt the user with the same approval card run_command uses, instead of
      // dead-ending. Without this the PM deadlocks — run_checks is blocked "awaiting approval" while
      // run_command is delegate-gated, so it can never verify and never reaches the reviewer.
      if (verdict.ask && this.requestApproval) {
        const decision = await this.requestApproval(this.verifyCommand);
        if (!decision.allow) {
          const note = decision.note ? ` The user said: "${decision.note}".` : '';
          return `Verification command not approved by the user.${note} Ask them how to proceed, or delegate the checks to a teammate.`;
        }
        // approved (once / session / project) → fall through and run it.
      } else {
        // Surface to the user too — otherwise the block is silent (only the LLM sees this string). B2.
        this.onCommandBlocked?.(verdict.reason ?? 'command execution is disabled');
        return `Verification command blocked by roam.commandApproval: ${verdict.reason}`;
      }
    }
    const { code, output } = await this.runCommand(this.verifyCommand, this.cwd);
    const tail = output.length > 8000 ? output.slice(-8000) : output;
    return code === 0
      ? `[checks passed] \`${this.verifyCommand}\` exited 0.\n${tail}`.trimEnd()
      : `[checks FAILED] \`${this.verifyCommand}\` exited ${code}. These errors often mean one teammate's change broke a file another teammate depends on — assign a fix to the right teammate, then run_checks again.\n\n${tail}`;
  }

  /**
   * Blocking delegation: dispatch and wait for the one result, with agent-robustness enforcement when
   * a teammate hands back nothing usable (empty / "no output" — the classic weak-model refusal):
   *   L2 — force one firm retry on the same model.
   *   L3 — if still nothing, escalate the teammate to its fallback model and try once more.
   *   If there's no fallback (or the fallback also returns nothing), return a clear "this teammate's
   *   model is refusing; it needs a new/working model" message — which flows back to the PM (the agent
   *   talking to the user) as the assign_task result, so the user gets told.
   * Conservative: only truly-empty output triggers any of this, so a reviewer's legitimate short
   * verdict (or an explicit error) is never second-guessed.
   */
  private async assignAndAwait(ref: string, instruction: string): Promise<string> {
    // Resolve once (role → concrete teammate) so we can audit the choice, then dispatch by the exact
    // id (retries inside enforceCompliance stay on that same teammate).
    const target = this.resolveTarget(ref);
    if (!target) { return `Error: no teammate "${ref}". ${this.rosterHint()}`; }
    if (target.id === this.selfId) { return 'Error: you cannot assign a task to yourself.'; }
    const first = this.dispatch(target.id, instruction);
    if (!first.ok) { return first.error; }
    this.onRoute?.(`Routed "${ref}" → ${target.id} (${target.reason})`); // only after the dispatch is real
    return this.enforceCompliance(ref, target.id, instruction, await first.promise);
  }

  /**
   * Shared agent-robustness ladder for a delegated result, used by BOTH the blocking (assign_task)
   * and async (assign_task_async/await_tasks) paths: a teammate that returns nothing usable gets
   *   L2 — one firm retry on the same model, then
   *   L3 — escalation to its fallback model and one more try,
   * else a clear "this teammate's model is refusing; change its model" message. `firstResult` is the
   * awaited result of the initial dispatch; `targetId` is the resolved teammate id (for escalation).
   */
  private async enforceCompliance(ref: string, targetId: string, instruction: string, firstResult: string): Promise<string> {
    if (!returnedNothing(firstResult)) { return firstResult; }
    // Retry the SAME teammate (by exact id), never re-resolve the role — under role-spread a role ref
    // would round-robin the retry onto a different teammate.
    const retry = this.dispatch(targetId, this.firmRetry(instruction));
    if (!retry.ok) { return firstResult; }
    return this.escalateIfStillEmpty(ref, targetId, instruction, retry.promise);
  }

  /** Shared firm-retry instruction wrapper used by L2/L3. */
  private firmRetry(instruction: string): string {
    return (
      `Your previous response did not do the task — you returned no usable output. This is required, ` +
      `not optional: carry it out NOW using your tools (read the relevant files, make the change with ` +
      `write_file, run any needed commands) and return the concrete result. Do not return an empty ` +
      `response again.\n\nTask: ${instruction}`
    );
  }

  /** L3: after a firm retry, if the teammate STILL returned nothing, escalate to its fallback model
   *  and try once more; otherwise report that its model is refusing and a new model is needed. */
  private async escalateIfStillEmpty(
    ref: string,
    targetId: string,
    instruction: string,
    retryPromise: Promise<string>
  ): Promise<string> {
    const second = await retryPromise;
    if (!returnedNothing(second)) { return second; }

    const esc = this.escalate?.(targetId);
    if (esc?.switched) {
      const third = this.dispatch(targetId, this.firmRetry(instruction));
      if (third.ok) {
        const out = await third.promise;
        if (!returnedNothing(out)) {
          return `[Note: ${ref} produced nothing on ${esc.from}; switched it to its fallback model ${esc.to} and retried.]\n\n${out}`;
        }
      }
      return `[BLOCKED: ${ref} returned nothing even after switching to its fallback model (${esc.to}). ` +
        `Its model appears to be refusing this task. Tell the user that ${ref} needs a different, working ` +
        `model — Edit the agent and change its model — then retry.]`;
    }

    const why = esc?.reason === 'already-on-fallback'
      ? 'and it is already on its fallback model'
      : 'and no fallback model is configured for it';
    return `[BLOCKED: ${ref} returned nothing across a firm retry, ${why}. Its model appears to be ` +
      `refusing this task. Tell the user that ${ref} needs a working model — Edit the agent to change ` +
      `its model (and optionally set a fallback model) — then retry.]`;
  }

  /**
   * Non-blocking delegation (Option B): dispatch and return a handle immediately. The teammate runs
   * concurrently; collect its result later with await_tasks. Independent, non-overlapping work only —
   * cross-file collisions are still caught by the FileCoordinator (re-read & retry) and run_checks.
   */
  private assignAsync(ref: string, instruction: string, files?: string[]): string {
    if (this.pending.size >= this.maxParallel) {
      return `Error: too many parallel tasks in flight (${this.pending.size}/${this.maxParallel}). Call await_tasks to collect results before dispatching more.`;
    }
    const target = this.resolveTarget(ref);
    if (!target) {
      return `Error: no teammate "${ref}". ${this.rosterHint()}`;
    }
    if (target.id === this.selfId) {
      return 'Error: you cannot assign a task to yourself.';
    }
    // Option B step 2: claim the declared files BEFORE dispatching so two parallel tasks never own
    // overlapping files. The handle doubles as the claim id (released when the task is collected).
    const handle = uuidv4();
    if (this.claims && files && files.length > 0) {
      const verdict = this.claims.claim(handle, target.id, files);
      if (!verdict.ok) {
        return `Error: file conflict — ${(verdict.conflicts ?? []).join('; ')}. Ask the architect to re-partition ownership, or await in-flight tasks before dispatching this one.`;
      }
    }
    // Dispatch to the exact resolved id (not the role ref) so the file claim above and the actual
    // target can't diverge under role-spread, and so each parallel fan-out keeps its own teammate.
    const d = this.dispatch(target.id, instruction, handle);
    if (!d.ok) {
      this.claims?.release(handle);
      return d.error;
    }
    // Audit only once the task is actually dispatched (after the file-claim gate), so a conflict-rejected
    // delegation never produces a false "Routed …" line — auditability is the whole point of Router v1.
    this.onRoute?.(`Routed "${ref}" → ${target.id} (${target.reason}) [async]`);
    // Wrap with the same empty-retry + fallback-escalation ladder as the blocking path, so an async
    // teammate that returns nothing is retried/escalated too — not silently collected empty by
    // await_tasks. The file claim is released by awaitTasks AFTER this wrapped promise settles, so
    // retries hold their claim until the final result (no leak).
    const compliant = d.promise.then((r) => this.enforceCompliance(ref, d.ref, instruction, r));
    this.pending.set(d.handle, { ref: d.ref, promise: compliant });
    const base = `Dispatched to ${d.ref}. Handle: ${d.handle}. Call await_tasks to collect the result.`;
    // Conflict protection is opt-in: with no declared files this task isn't claim-guarded against
    // overlapping parallel work. Nudge the PM so it either declares files or serializes.
    const warn = !files || files.length === 0
      ? ' WARNING: no files declared — this task is NOT protected against file conflicts with other parallel tasks. Pass `files`, or use the blocking assign_task for sequential safety.'
      : '';
    return base + warn;
  }

  /** Wait for dispatched async tasks and return their results together. */
  private async awaitTasks(handles?: string[]): Promise<string> {
    const wanted = handles && handles.length > 0
      ? handles.filter((h) => this.pending.has(h))
      : [...this.pending.keys()];
    if (wanted.length === 0) {
      return handles && handles.length > 0
        ? 'No matching pending tasks for those handles (already collected or never dispatched).'
        : 'No pending tasks to await.';
    }

    const entries = wanted.map((h) => ({ handle: h, ...this.pending.get(h)! }));
    const settled = await Promise.allSettled(entries.map((e) => e.promise));
    // Remove collected tasks and release their file claims so the paths free up for the next dispatch.
    for (const h of wanted) {
      this.pending.delete(h);
      this.claims?.release(h);
    }

    let anyFailed = false;
    const sections = entries.map((e, i) => {
      const r = settled[i];
      const text = r.status === 'fulfilled' ? r.value : `Error: ${String((r as PromiseRejectedResult).reason)}`;
      // A teammate that stayed empty through retry+escalation comes back as "[BLOCKED …]" — count it
      // as a failed subtask so the whole step is flagged and the PM sees it needs attention.
      if (r.status === 'rejected' || isTaskFailure(text) || text.trimStart().startsWith('[BLOCKED')) {
        anyFailed = true;
      }
      const body = text.length > AWAIT_RESULT_MAX ? text.slice(-AWAIT_RESULT_MAX) : text;
      return `=== ${e.ref} (${e.handle}) ===\n${body}`;
    });

    // Prefix so the tool card / summary marks the whole step as failed when any subtask failed
    // (isToolError in toolSummary recognizes "[tasks FAILED]").
    const header = anyFailed ? '[tasks FAILED] one or more delegated tasks failed.\n\n' : '';
    return header + sections.join('\n\n');
  }

  /**
   * Core dispatch shared by the blocking and async paths. Returns a handle (correlationId) and a
   * promise that resolves to the teammate's final output (or an error/timeout string — never rejects).
   */
  private dispatch(
    ref: string,
    instruction: string,
    handle: string = uuidv4()
  ): { ok: true; handle: string; ref: string; promise: Promise<string> } | { ok: false; error: string } {
    const target = this.resolveTarget(ref);
    if (!target) {
      return { ok: false, error: `Error: no teammate "${ref}". ${this.rosterHint()}` };
    }
    if (target.id === this.selfId) {
      return { ok: false, error: 'Error: you cannot assign a task to yourself.' };
    }

    // The handle is the correlation id stamped on the assign so even a synchronous completion is
    // matched — SessionManager echoes it back on the teammate's task.complete.
    const pendingId = handle;
    this.markBusy(target.id);

    let resolvePromise!: (text: string) => void;
    let settled = false;
    let offComplete: () => void = () => undefined;
    let offError: () => void = () => undefined;

    const promise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });
    const finish = (text: string) => {
      if (settled) { return; }
      settled = true;
      offComplete();
      offError();
      clearTimeout(timer);
      this.activeDispatches.delete(pendingId);
      this.markFree(target.id);
      resolvePromise(text);
    };

    offComplete = this.bus.onType('task.complete', (m) => {
      if (m.correlationId === pendingId) {
        finish(m.payload.instruction || '(teammate returned no output)');
      }
    });
    offError = this.bus.onType('system.error', (m) => {
      if (m.correlationId === pendingId) {
        finish(`Error from ${ref}: ${m.payload.instruction || 'task failed'}`);
      }
    });
    const timer = setTimeout(
      () => finish(`Error: timed out after ${Math.round(this.timeoutMs / 1000)}s waiting for ${ref}.`),
      this.timeoutMs
    );
    this.activeDispatches.set(pendingId, {
      cancel: (reason = DEFAULT_CANCEL_REASON) => finish(`Error: ${reason}.`),
    });

    this.bus.send(this.selfId, target.id, 'task.assign', { instruction: this.normalizeSharedPaths(instruction) }, 'high', pendingId);

    return { ok: true, handle: pendingId, ref: target.id, promise };
  }

  /** Convert absolute paths under the shared workspace root to workspace-RELATIVE before handing a task to
   *  a teammate. A worker isolated in its own worktree has a different root, so a shared absolute path would
   *  land outside its sandbox (the shell guard blocks it); a relative path resolves correctly in any root.
   *  No-op when the root doesn't appear in the text. */
  private normalizeSharedPaths(instruction: string): string {
    const root = (this.cwd ?? '').trim();
    if (!root) {
      return instruction;
    }
    let out = instruction;
    for (const r of [root, root.replace(/\\/g, '/')]) {
      out = out.split(r + '\\').join('').split(r + '/').join('');
    }
    return out;
  }
}

/**
 * True only when a delegated teammate handed back nothing usable — an empty/whitespace turn or the
 * "(teammate returned no output)" placeholder dispatch() substitutes for a blank result. Deliberately
 * narrow: a non-empty answer (including a reviewer's short verdict or an explicit error) is NOT treated
 * as "nothing", so the firm retry only fires on the unambiguous refusal case. Exported for testing.
 */
export function returnedNothing(result: string): boolean {
  const t = (result ?? '').trim();
  return t === '' || t === '(teammate returned no output)';
}

/** A roster status that means "already working a turn" — used to skip loaded-up same-role teammates
 *  when spreading a role delegation. Matches SessionManager's status vocabulary. */
function isBusyStatus(status: string): boolean {
  const s = (status ?? '').toLowerCase();
  return s === 'running' || s === 'starting';
}

/** A teammate we should not route new work to (truly broken). 'stopped' is NOT here — a stopped agent is
 *  just not-yet-started and auto-starts on assignment, so it's a valid free target, not "unavailable". */
function isUnavailableStatus(status: string): boolean {
  return (status ?? '').toLowerCase() === 'error';
}

function spec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ToolSpec {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

/** Wall-clock cap for run_checks' default runner so a hung/watch-mode verify command can't block the
 *  PM indefinitely and orphan the process (audit #5). */
const RUN_CHECKS_TIMEOUT_MS = 300_000;

const defaultRunner: CommandRunner = (command, cwd) =>
  new Promise((resolve) => {
    const proc = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: sanitizedCommandEnv() });
    let output = '';
    let settled = false;
    const done = (r: { code: number | null; output: string }) => { if (settled) { return; } settled = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      killProcessTree(proc); // Windows: kill the whole tree, not just cmd.exe (audit N2)
      done({ code: null, output: `${output}\n[checks timed out after ${RUN_CHECKS_TIMEOUT_MS / 1000}s — ensure the command exits (not a watch mode) and doesn't wait for input]` });
    }, RUN_CHECKS_TIMEOUT_MS);
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));
    proc.on('close', (code) => done({ code, output }));
    proc.on('error', (err) => done({ code: 1, output: `Failed to run command: ${err.message}` }));
  });
