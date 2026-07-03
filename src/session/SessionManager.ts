/*---------------------------------------------------------------------------------------------
 *  UnodeAi - SessionManager
 *  Owns the lifecycle of agent sessions and is the bridge between the MessageBus and the
 *  per-agent backend processes.
 *
 *  This is the piece that makes inter-agent communication real:
 *    - Inbound:  a MessageBus message addressed to an agent  -> backend.sendUserTurn()
 *    - Outbound: a backend's turn_complete                   -> MessageBus 'task.complete'
 *  Without both directions wired, "agents talking to each other" is just a log panel.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'events';
import {
  AgentConfig,
  AgentModelParams,
  ChatMode,
  Message,
  MessageType,
  SessionEvent,
  SessionInfo,
  SessionStatus,
} from '../types';
import { MessageBus } from '../bus/MessageBus';
import { AgentBackend, BackendEvent, BackendFactory, ConversationSnapshot, TurnAttachments } from '../backend/AgentBackend';
import { projectContextBlock } from './RulesFile';
import { Summarizer, SummarizerIO } from './Summarizer';
import { TaskTokenTracker } from './TaskTokenTracker';
import type { TurnContext } from '../backend/AgentBackend';

/**
 * Typed payloads per event, so listeners get real types instead of `any`.
 * `fire()` always emits a SessionEvent; `data` is narrowed by the event key here.
 */
export interface SessionEventData {
  'session.created': undefined;
  'session.removed': undefined;
  'session.started': { status: SessionStatus };
  'session.stopped': { exitCode: number | null };
  'session.error': { error: string };
  'session.output': { stream: 'stdout' | 'stderr'; content: string };
  'session.stream': { delta: string };
  'session.reasoning': { delta: string };
  'session.tool': {
    phase: 'use' | 'result';
    name: string;
    input?: unknown;
    ok?: boolean;
    summary?: string;
    detail?: string;
    diff?: string;
  };
  'session.context': TurnContext;
  'session.compacted': { dropped: number; model: string };
  'session.status': { status: SessionStatus };
  'session.modelSwitched': { from: string; to: string; reason: string };
  /** Start was deferred because the concurrency cap is full; it will auto-start when a slot frees. */
  'session.queued': { reason: string };
  /** A user-initiated task finished; its per-agent token usage was recorded (Dashboard "Latest tasks"). */
  'session.taskTokens': { taskId: string };
}

/** Re-exported so existing importers (e.g. DashboardProvider) keep their import path. */
export type { TaskTokenRecord } from './TaskTokenTracker';

/** Cap on retained per-task token records. */
const MAX_TASK_TOKEN_RECORDS = 50;

export type SessionManagerEvent = keyof SessionEventData;

/** A SessionEvent whose `data` is narrowed to the payload for event `K`. */
export interface TypedSessionEvent<K extends SessionManagerEvent> extends SessionEvent {
  data: SessionEventData[K];
}

/** Consecutive turn failures before we switch an agent to its fallback model (P1#6). */
const FALLBACK_AFTER_FAILURES = 2;
/** Cap on retained cost-timeline samples (for the Dashboard trend sparkline). */
const MAX_COST_SAMPLES = 240;

/** Message types that should be delivered to an agent as a new task turn. */
const ACTIONABLE_INBOUND: ReadonlySet<MessageType> = new Set<MessageType>([
  'task.assign',
  'handoff',
  'review.request',
  'review.feedback',
  'ask.question',
  // A DIRECTED inter-agent message (send_message) is delivered as a turn so the recipient actually
  // reads it. Broadcasts (to '*') are filtered out in routeInbound — they stay informational.
  'agent.message',
]);

export interface SessionManagerDeps {
  /** Produces a backend for a config (defaults to ClaudeHeadlessBackend in extension wiring). */
  createBackend: BackendFactory;
  /** Resolves the process env (incl. API keys from SecretStorage) for a given agent. */
  resolveEnv: (config: AgentConfig) => Promise<NodeJS.ProcessEnv>;
  /** Worktree fan-out (v0.6.x): resolve the sandbox root for this agent's run, e.g. a per-agent git
   *  worktree path. Called at start, before the backend is built; the returned path becomes the
   *  agent's workingDirectory (so all its file ops are isolated there). Return undefined to use the
   *  agent's normal working directory. Best-effort — a throw/undefined falls back to the normal root. */
  resolveWorkingDirectory?: (config: AgentConfig) => Promise<string | undefined>;
  /** Worktree fan-out (v0.6.x): notified when an agent finishes a turn, so the host can commit +
   *  merge that agent's worktree into the integration branch. Fire-and-forget (must not block). */
  onTurnComplete?: (agentId: string, isError: boolean) => void;
  /** Load a saved conversation snapshot for an agent (L2 crash recovery). Optional. */
  loadSnapshot?: (agentId: string) => ConversationSnapshot | undefined;
  /** Persist an agent's conversation snapshot after each completed turn. Optional. */
  saveSnapshot?: (agentId: string, snapshot: ConversationSnapshot) => void;
  /** Drop a persisted snapshot (on agent removal). Optional. */
  clearSnapshot?: (agentId: string) => void;
  /** Estimate USD cost from token usage when a backend reports tokens but no cost. Optional. */
  estimateCost?: (model: string, inputTokens: number, outputTokens: number) => number | undefined;
  /** A top-tier premium model id (e.g. claude-opus-4-8) used as the "all-premium" cost baseline for the
   *  savings comparison. The same tokens are priced against this to show what mixed routing saved. */
  premiumCostModel?: string;
  /** Resolve effective model/sampling params for an agent's turn (F2). Optional. */
  resolveModelParams?: (config: AgentConfig, smartTierParams?: AgentModelParams) => AgentModelParams;
  /** Smart Mode (F3): pick the model this task should run at; applied via setModel before the turn.
   *  Return undefined to leave the agent on its current model. */
  resolveTaskModel?: (config: AgentConfig, msg: Message) => string | undefined;
  /** Smart Mode (F2/F3): optional tier-level params for the selected task tier. */
  resolveTaskModelParams?: (config: AgentConfig, msg: Message) => AgentModelParams | undefined;
  /** Session Memory (F4): current `.unode/rules.md` content to append to each agent's system prompt
   *  at start (wrapped in <project_context>). Empty/undefined = no project memory. */
  getProjectContext?: () => string;
  /** Optional host-side workspace context gatherer (opt-in): returns a formatted string to attach to turns.
   *  Provided by the extension wiring when `unode.engine.workspaceContext` is enabled. */
  /** @param root the agent's runtime working directory (worktree/workspace) so an isolated worker is
   *  grounded to its ACTUAL tool root, not the global workspace. */
  getWorkspaceContext?: (root?: string) => Promise<string | undefined> | string | undefined;
  /** v0.2.0 E1: summarizer injected into backends that support history compaction. */
  summarizer?: Summarizer;
  summarizerIO?: (config: AgentConfig) => SummarizerIO;
  summarizerModel?: (config: AgentConfig) => string;
}

export class SessionManager {
  private emitter = new EventEmitter();
  private sessions = new Map<string, SessionInfo>();
  private backends = new Map<string, AgentBackend>();
  private busDisposers = new Map<string, () => void>();
  /** The message currently being worked on by a session, so we can reply to its sender. */
  private pendingOrigin = new Map<string, Message>();
  /** Turns queued for a session that is not yet ready. */
  private inbox = new Map<string, Message[]>();
  /** Sessions whose start was deferred by the concurrency cap; drained FIFO as slots free. */
  private pendingStarts: string[] = [];
  /** Consecutive failed turns per session, for model-fallback (reset on success). */
  private consecutiveErrors = new Map<string, number>();
  /** Model actually used for the turn in flight; Smart Mode can choose it without mutating config. */
  private pendingTurnModel = new Map<string, string>();
  /** Rolling cumulative-cost timeline samples for the Dashboard trend (cost in USD over time). */
  private costTimeline: Array<{ t: number; cost: number }> = [];
  /** Per-task token usage for the Dashboard "Latest tasks" panel. A "task" = one user turn (from:'user')
   *  and all the delegated sub-work it triggered; attribution is by origin so concurrent user tasks on
   *  different agents never double-count. */
  private taskTokens = new TaskTokenTracker(MAX_TASK_TOKEN_RECORDS);
  /** message id → the task id it was bound to at dispatch (so a queued delegation inherits the right task
   *  even if its delegator's turn already ended). Cleared when the turn starts or the recipient is removed. */
  private pendingMsgTask = new Map<string, string>();

  constructor(
    private maxConcurrent: number,
    private bus: MessageBus,
    private deps: SessionManagerDeps
  ) {}

  setMaxConcurrent(n: number): void {
    this.maxConcurrent = n;
    // Raising the cap should let queued agents start now; drain respects the new cap so a
    // lowered cap is a no-op here (running agents finish naturally).
    this.drainPendingStarts();
  }

  /**
   * Switch an agent's model at runtime. For the in-process OpenAICompatBackend this takes effect
   * on the very next turn (it reads config.model each request) — no restart, context preserved.
   * Returns false if the agent is unknown or already on that model. (Foundation for tier hot-swap
   * and the fallback path below.)
   */
  setModel(sessionId: string, model: string): boolean {
    const info = this.sessions.get(sessionId);
    if (!info || !model || info.config.model === model) {
      return false;
    }
    info.config.model = model;
    // The running backend holds its own config copy (withProjectContext / baseUrl resolution clone it),
    // so push the change there too — otherwise the swap never reaches the in-flight agent.
    this.backends.get(sessionId)?.setModel?.(model);
    return true;
  }

  /**
   * L3 agent-robustness escalation: move an agent onto its configured fallback model so a
   * persistently-refusing/empty worker gets one more attempt on a (typically stronger) model. Returns
   * the outcome so the caller can tell the user precisely what happened. Does not retry the turn itself.
   */
  escalateToFallback(sessionId: string): { switched: boolean; reason: 'switched' | 'no-fallback' | 'already-on-fallback' | 'unknown-agent'; from?: string; to?: string } {
    const info = this.sessions.get(sessionId);
    if (!info) {
      return { switched: false, reason: 'unknown-agent' };
    }
    const fallback = info.config.fallbackModel;
    if (!fallback) {
      return { switched: false, reason: 'no-fallback' };
    }
    if (info.config.model === fallback) {
      return { switched: false, reason: 'already-on-fallback' };
    }
    const from = info.config.model;
    this.setModel(sessionId, fallback);
    this.consecutiveErrors.set(sessionId, 0);
    this.fire('session.modelSwitched', sessionId, 'status_change', {
      from,
      to: fallback,
      reason: 'teammate returned nothing usable; escalated to fallback model',
    });
    return { switched: true, reason: 'switched', from, to: fallback };
  }

  /** Cumulative-cost samples (oldest→newest) for the Dashboard cost trend. */
  getCostTimeline(): ReadonlyArray<{ t: number; cost: number }> {
    return this.costTimeline;
  }

  // ─── Registration ───────────────────────────────────────────────────

  create(config: AgentConfig): SessionInfo {
    const info: SessionInfo = {
      id: config.id,
      config,
      status: 'stopped',
      restartCount: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, premiumCostUsd: 0 },
    };
    this.sessions.set(info.id, info);

    // Subscribe this session to messages addressed to it (the bus also delivers '*' broadcasts).
    const dispose = this.bus.subscribe({ to: info.id }, (msg) => this.routeInbound(info.id, msg));
    this.busDisposers.set(info.id, dispose);

    this.fire('session.created', info.id, 'start');
    return info;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async start(sessionId: string): Promise<SessionInfo> {
    const info = this.sessions.get(sessionId);
    if (!info) {
      throw new Error(`Session '${sessionId}' not found`);
    }
    if (info.status === 'running' || info.status === 'starting' || info.status === 'idle') {
      return info;
    }
    if (this.getRunningCount() >= this.maxConcurrent) {
      // B1: don't fail — queue the start and auto-resume when a running session frees a slot.
      if (!this.pendingStarts.includes(sessionId)) {
        this.pendingStarts.push(sessionId);
      }
      info.pendingStart = true;
      const reason = `Max concurrent agents (${this.maxConcurrent}) reached`;
      this.fire('session.queued', sessionId, 'status_change', { reason });
      return info;
    }
    // If we're starting it now, it's no longer waiting on a slot.
    this.pendingStarts = this.pendingStarts.filter((id) => id !== sessionId);
    info.pendingStart = false;

    info.status = 'starting';
    info.errorMessage = undefined;
    info.startedAt = new Date().toISOString();
    this.fire('session.status', info.id, 'status_change', { status: info.status });

    // F4: append project memory (.unode/rules.md) to the system prompt. Use a derived copy so we never
    // mutate the stored config — a later restart re-derives with whatever the rules file says then.
    const runConfig = this.withProjectContext(info.config);
    // Worktree fan-out (v0.6.x): isolate this agent in its own git worktree by rooting it there.
    // Best-effort — if assignment fails we fall back to the agent's normal working directory.
    if (this.deps.resolveWorkingDirectory) {
      try {
        const wd = await this.deps.resolveWorkingDirectory(info.config);
        if (wd) { runConfig.workingDirectory = wd; }
      } catch { /* fall back to the normal root */ }
    }
    // Record the ACTUAL root the backend/tools will use (worktree path or current workspace) as the single
    // runtime truth — used for workspace grounding, chat preflight, diagnostics. Not persisted to the roster.
    info.runtimeWorkingDirectory = runConfig.workingDirectory;
    const backend = this.deps.createBackend(runConfig);
    this.backends.set(sessionId, backend);
    backend.onEvent((evt) => this.onBackendEvent(info, evt));

    // L2 recovery: seed the backend with its prior conversation (before start) so a restart/crash
    // doesn't wipe the agent's context.
    const snapshot = this.deps.loadSnapshot?.(sessionId);
    if (snapshot && backend.restore) {
      backend.restore(snapshot);
    }

    try {
      const env = await this.deps.resolveEnv(info.config);
      await backend.start(env);
      info.pid = backend.pid;
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      info.status = 'error';
      info.errorMessage = message;
      this.backends.delete(sessionId);
      this.fire('session.error', info.id, 'error', { error: message });
      this.drainPendingStarts();
      throw err;
    }
  }

  async stop(sessionId: string, forceTimeoutMs = 10000): Promise<void> {
    this.cancelPendingStart(sessionId);
    const info = this.sessions.get(sessionId);
    if (!info || info.status === 'stopped' || info.status === 'stopping') {
      return;
    }
    info.status = 'stopping';
    this.fire('session.status', info.id, 'status_change', { status: info.status });

    const backend = this.backends.get(sessionId);
    if (backend) {
      await backend.stop(forceTimeoutMs);
    }
    // The backend 'exit' event flips status to 'stopped' and cleans up.
  }

  async restart(sessionId: string): Promise<SessionInfo> {
    const info = this.sessions.get(sessionId);
    if (!info) {
      throw new Error(`Session '${sessionId}' not found`);
    }
    await this.stop(sessionId);
    info.restartCount++;
    return this.start(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    await this.stop(sessionId);
    this.busDisposers.get(sessionId)?.();
    this.busDisposers.delete(sessionId);
    this.backends.delete(sessionId);
    this.pendingOrigin.delete(sessionId);
    // Cancel still-queued (never-run) turns for this agent and release their reserved task-token slots, so a
    // removed worker can't keep its root task open forever.
    this.cancelQueuedTaskWork(sessionId);
    this.pendingStarts = this.pendingStarts.filter((id) => id !== sessionId);
    this.consecutiveErrors.delete(sessionId);
    this.taskTokens.removeSession(sessionId); // drop any in-flight task tag / rooted task so it can't leak
    this.sessions.delete(sessionId);
    this.deps.clearSnapshot?.(sessionId);
    this.fire('session.removed', sessionId, 'stop');
  }

  async startAll(): Promise<SessionInfo[]> {
    const results: SessionInfo[] = [];
    for (const info of this.sessions.values()) {
      if (info.status === 'stopped' || info.status === 'error') {
        try {
          results.push(await this.start(info.id));
        } catch {
          /* respect concurrency cap / surface per-agent errors elsewhere */
        }
      }
    }
    return results;
  }

  async stopAll(): Promise<void> {
    this.pendingStarts = [];
    for (const info of this.sessions.values()) {
      info.pendingStart = false;
    }
    await Promise.allSettled(Array.from(this.sessions.keys()).map((id) => this.stop(id)));
  }

  // ─── Queries ────────────────────────────────────────────────────────

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getAll(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /** The most recent user-initiated tasks (newest first), with per-agent token breakdown. Drives the
   *  Dashboard "Latest tasks" panel. */
  getRecentTaskTokens(limit = 10): ReturnType<TaskTokenTracker['recent']> {
    return this.taskTokens.recent(limit);
  }

  /** Resolve a workflow reference that may be either a concrete session id or a role key. */
  resolveByRoleOrId(ref: string): SessionInfo | undefined {
    return this.sessions.get(ref) ?? this.getAll().find((s) => s.config.role === ref);
  }

  getRunningCount(): number {
    let count = 0;
    for (const info of this.sessions.values()) {
      if (info.status === 'running' || info.status === 'starting' || info.status === 'idle') {
        count++;
      }
    }
    return count;
  }

  isRunning(sessionId: string): boolean {
    const s = this.sessions.get(sessionId)?.status;
    return s === 'running' || s === 'starting' || s === 'idle';
  }

  interrupt(sessionId: string): void {
    this.backends.get(sessionId)?.abort?.();
  }

  /** G-001 mid-run steering: route a user message into a running agent's current turn. */
  interjectAgent(sessionId: string, text: string): void {
    this.backends.get(sessionId)?.interject?.(text);
  }

  // ─── Events ─────────────────────────────────────────────────────────

  on<K extends SessionManagerEvent>(event: K, listener: (e: TypedSessionEvent<K>) => void): void {
    this.emitter.on(event, listener as (e: SessionEvent) => void);
  }

  off<K extends SessionManagerEvent>(event: K, listener: (e: TypedSessionEvent<K>) => void): void {
    this.emitter.off(event, listener as (e: SessionEvent) => void);
  }

  dispose(): void {
    this.stopAll();
    this.busDisposers.forEach((d) => d());
    this.busDisposers.clear();
    this.sessions.clear();
    this.backends.clear();
    this.emitter.removeAllListeners();
  }

  // ─── Inbound: MessageBus -> backend ─────────────────────────────────

  private routeInbound(sessionId: string, msg: Message): void {
    // Never react to our own outgoing messages.
    if (msg.from === sessionId) {
      return;
    }
    if (!ACTIONABLE_INBOUND.has(msg.type)) {
      return;
    }
    // Broadcast messages (to '*') are informational only — never start a turn on every teammate.
    // Only a directed message becomes a turn. (A 'task.assign' is always directed.)
    if (msg.type === 'agent.message' && msg.to === '*') {
      return;
    }

    const backend = this.backends.get(sessionId);
    const info = this.sessions.get(sessionId);
    if (!info) {
      return;
    }

    // Per-task token tracking: bind a delegation to its root task NOW (at dispatch), not when the worker's
    // turn finally starts. The delegator is still in its turn here, so its task id is available; binding
    // later would lose it for an async delegation to a STOPPED/queued worker that the PM out-runs. Reserve
    // an active slot so the root task waits for this worker even if the PM finishes first.
    if (msg.from !== 'user') {
      const taskId = this.taskTokens.taskIdOf(msg.from);
      if (taskId) {
        this.pendingMsgTask.set(msg.id, taskId);
        this.taskTokens.markPending(taskId);
      }
    }

    // Deliver ONLY when the agent is idle — never while a turn is in flight. A single pendingOrigin
    // slot tracks the in-flight task's sender; delivering to a 'running' agent would overwrite it and
    // misroute both completions. Busy/starting/stopped → queue; flushInbox delivers the next on
    // turn_complete (one task at a time).
    if (backend && this.isIdle(sessionId)) {
      this.deliverTurn(sessionId, msg);
    } else {
      // Queue and lazily start the session so a handoff to a stopped agent still lands.
      const q = this.inbox.get(sessionId) ?? [];
      q.push(msg);
      this.inbox.set(sessionId, q);
      if (info.status === 'stopped' || info.status === 'error') {
        this.start(sessionId).catch((err) => {
          this.fire('session.error', sessionId, 'error', { error: String(err) });
          // The lazy start failed, so these queued turns will never run — cancel them and release their
          // reserved task-token slots, or the root task's active count never reaches zero (it would never
          // appear in "Latest tasks" and the tracker would keep an open task forever).
          this.cancelQueuedTaskWork(sessionId);
        });
      }
    }
  }

  /** Cancel a session's still-queued (never-delivered) turns and release any per-task token slots reserved
   *  for them at dispatch. Use whenever those turns can't run (agent removed, lazy-start failed, queued work
   *  cancelled). Finalizes + notifies the Dashboard if releasing a slot completes a task. */
  private cancelQueuedTaskWork(sessionId: string): void {
    for (const queued of this.inbox.get(sessionId) ?? []) {
      const tid = this.pendingMsgTask.get(queued.id);
      if (!tid) { continue; }
      this.pendingMsgTask.delete(queued.id);
      const record = this.taskTokens.cancelPending(tid);
      if (record) { this.fire('session.taskTokens', sessionId, 'message', { taskId: record.id }); }
    }
    this.inbox.delete(sessionId);
  }

  private deliverTurn(sessionId: string, msg: Message): void {
    const backend = this.backends.get(sessionId);
    const info = this.sessions.get(sessionId);
    if (!backend || !info) {
      return;
    }
    // Smart Mode (F3): choose a model for this task without mutating the agent's configured model.
    // Persistent retunes still go through setModel(); Smart Mode is request-scoped.
    const taskModel = this.deps.resolveTaskModel?.(info.config, msg);
    const taskModelParams = this.deps.resolveTaskModelParams?.(info.config, msg);
    if (taskModel) {
      this.pendingTurnModel.set(sessionId, taskModel);
    } else {
      this.pendingTurnModel.delete(sessionId);
    }

    // A directed inter-agent message (send_message) carries its text in payload.message, not
    // payload.instruction; frame it so the recipient knows who it's from. Everything else uses
    // payload.instruction as before.
    const turnText = msg.type === 'agent.message'
      ? `Message from ${msg.from}: ${msg.payload.message ?? msg.payload.instruction ?? ''}`
      : (msg.payload.instruction ?? '');

    this.pendingOrigin.set(sessionId, msg);
    // Per-task token tracking: a user turn (from:'user') ROOTS a new task; a delegated turn INHERITS the
    // task id of the agent that delegated it (msg.from). Tagging by origin (not a global usage snapshot)
    // means two user tasks running concurrently on different agents never count each other's tokens.
    if (msg.from === 'user') {
      this.taskTokens.startRoot(sessionId, turnText.slice(0, 160));
    } else {
      // Inherit the task id bound at dispatch (markPending already reserved the active slot there).
      const taskId = this.pendingMsgTask.get(msg.id);
      this.pendingMsgTask.delete(msg.id);
      this.taskTokens.startInheritedByTask(sessionId, taskId);
    }
    info.status = 'running';
    info.currentTask = turnText.slice(0, 120);
    info.lastActiveAt = new Date().toISOString();
    this.fire('session.status', sessionId, 'status_change', { status: 'running' });

    const attachments: TurnAttachments = {
      mode: normalizeChatMode(msg.payload.mode),
      files: msg.payload.files,
      context: msg.payload.context,
      expectedOutput: msg.payload.expectedOutput,
      model: taskModel,
      modelParams: this.deps.resolveModelParams?.(info.config, taskModelParams),
      projectContext: this.deps.getProjectContext?.() ?? '',
    };
    const sendTurn = (): void => backend.sendUserTurn(turnText, attachments);

    // Preserve the original synchronous path unless context/summarization work is actually needed.
    if (!this.deps.getWorkspaceContext && !this.canSummarize(backend)) {
      sendTurn();
      return;
    }

    const workspaceContextPromise = this.deps.getWorkspaceContext
      ? Promise.resolve()
          .then(() => this.deps.getWorkspaceContext?.(info.runtimeWorkingDirectory))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.fire('session.output', sessionId, 'message', {
              stream: 'stderr',
              content: `Workspace context gather skipped: ${message}`,
            });
            return undefined;
          })
      : Promise.resolve(undefined);

    void (async () => {
      if (this.canSummarize(backend)) {
        try {
          await this.summarizeIfNeeded(info, backend);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.fire('session.output', sessionId, 'message', {
            stream: 'stderr',
            content: `History summarization skipped: ${message}`,
          });
        }
      }

      const workspaceContext = await workspaceContextPromise;
      if (workspaceContext?.trim()) {
        attachments.workspaceContext = workspaceContext;
      }
      sendTurn();
    })();
  }

  private async summarizeIfNeeded(info: SessionInfo, backend: AgentBackend): Promise<void> {
    if (!this.canSummarize(backend)) {
      return;
    }
    const compactHistory = backend.compactHistory!;
    await compactHistory.call(
      backend,
      this.deps.summarizer!,
      this.deps.summarizerIO!(info.config),
      this.deps.summarizerModel!(info.config)
    );
  }

  private canSummarize(backend: AgentBackend): boolean {
    return !!backend.compactHistory && !!this.deps.summarizer && !!this.deps.summarizerIO && !!this.deps.summarizerModel;
  }

  private flushInbox(sessionId: string): void {
    const q = this.inbox.get(sessionId);
    if (!q || q.length === 0) {
      return;
    }
    // Deliver one turn now; remaining turns are delivered as each completes (one task at a time).
    const next = q.shift()!;
    this.deliverTurn(sessionId, next);
  }

  /** Ready to accept a NEW turn right now: idle (started and not mid-turn). 'running' is NOT idle —
   *  a turn is in flight and its origin must not be overwritten (see routeInbound). */
  private isIdle(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.status === 'idle';
  }

  /**
   * F4: return a config whose system prompt has the worker-compliance protocol (for non-coordinator
   * agents) and the current project memory appended. Returns the original config unchanged when there's
   * nothing to add. The worker protocol goes BEFORE the <project_context> block so the openai backend's
   * per-turn refresh (which only swaps the tagged block) never strips it. Never mutates the stored config.
   */
  private withProjectContext(config: AgentConfig): AgentConfig {
    const worker = workerComplianceProtocol(config);
    const block = projectContextBlock(this.deps.getProjectContext?.() ?? '');
    if (!worker && !block) {
      return config;
    }
    return { ...config, systemPrompt: config.systemPrompt + worker + block };
  }

  /**
   * B1: start any sessions deferred by the concurrency cap, FIFO, while slots remain. `start()` sets
   * status to 'starting' synchronously (before its first await), so getRunningCount() reflects each
   * launch immediately and we never exceed the cap within this loop.
   */
  private drainPendingStarts(): void {
    while (this.pendingStarts.length > 0 && this.getRunningCount() < this.maxConcurrent) {
      const next = this.pendingStarts.shift()!;
      const info = this.sessions.get(next);
      if (!info || info.status !== 'stopped') {
        if (info) {
          info.pendingStart = false;
        }
        continue; // removed, or already started by another path
      }
      this.start(next).catch((err) =>
        this.fire('session.error', next, 'error', { error: String(err) })
      );
    }
  }

  /** Remove a deferred start request when the user stops/removes the agent before it gets a slot. */
  private cancelPendingStart(sessionId: string): void {
    this.pendingStarts = this.pendingStarts.filter((id) => id !== sessionId);
    const info = this.sessions.get(sessionId);
    if (info) {
      info.pendingStart = false;
    }
  }

  // ─── Outbound: backend -> MessageBus + UI ───────────────────────────

  private onBackendEvent(info: SessionInfo, evt: BackendEvent): void {
    switch (evt.kind) {
      case 'ready':
        info.status = 'idle';
        info.backendSessionId = evt.backendSessionId;
        info.pid = this.backends.get(info.id)?.pid;
        info.lastActiveAt = new Date().toISOString();
        this.fire('session.started', info.id, 'status_change', { status: 'idle' });
        this.flushInbox(info.id);
        break;

      case 'assistant':
        info.lastActiveAt = new Date().toISOString();
        this.fire('session.output', info.id, 'message', { stream: 'stdout', content: evt.text });
        break;

      case 'assistant_delta':
        info.lastActiveAt = new Date().toISOString();
        this.fire('session.stream', info.id, 'message', { delta: evt.delta });
        break;

      case 'reasoning_delta':
        info.lastActiveAt = new Date().toISOString();
        this.fire('session.reasoning', info.id, 'message', { delta: evt.delta });
        break;

      case 'tool_use':
        this.fire('session.tool', info.id, 'message', {
          phase: 'use',
          name: evt.name,
          input: evt.input,
        });
        this.fire('session.output', info.id, 'message', {
          stream: 'stdout',
          content: `[tool: ${evt.name}]`,
        });
        break;

      case 'tool_result':
        this.fire('session.tool', info.id, 'message', {
          phase: 'result',
          name: evt.name,
          ok: evt.ok,
          summary: evt.summary,
          detail: evt.detail,
          diff: evt.diff,
        });
        break;

      case 'compacted':
        this.fire('session.compacted', info.id, 'message', {
          dropped: evt.dropped,
          model: evt.model,
        });
        break;

      case 'turn_complete': {
        if (evt.result.usage) {
          const usage = evt.result.usage;
          const u = info.usage!;
          u.inputTokens += usage.inputTokens;
          u.outputTokens += usage.outputTokens;
          // Prefer the backend's real cost (Claude); otherwise estimate from token usage + price table.
          const modelForCost = this.pendingTurnModel.get(info.id) ?? info.config.model;
          const cost =
            usage.costUsd ??
            this.deps.estimateCost?.(modelForCost, usage.inputTokens, usage.outputTokens) ??
            0;
          u.costUsd += cost;
          // Premium baseline: the TRUE estimate of the same tokens on a top-tier model (always estimated,
          // even when the turn reported a real cost) so "all-premium vs mixed" is apples-to-apples. Store
          // it honestly — NOT max(premium, actual) — so the UI can show a real cost delta if mixed routing
          // ever came out pricier. Falls back to the actual cost only when no premium model/estimator wired.
          const premiumModel = this.deps.premiumCostModel;
          const premiumCost = (premiumModel
            ? this.deps.estimateCost?.(premiumModel, usage.inputTokens, usage.outputTokens)
            : undefined) ?? cost;
          u.premiumCostUsd = (u.premiumCostUsd ?? 0) + premiumCost;
          u.turns += 1;
          // Attribute THIS turn's usage to the task it belongs to (for the Dashboard "Latest tasks" panel).
          this.taskTokens.attribute(info.id, info.config.name, usage.inputTokens, usage.outputTokens, cost);
        }
        // Track per-turn success/failure for model fallback, and sample total cost for the trend.
        this.pendingTurnModel.delete(info.id);
        this.recordTurnOutcome(info, evt.result.isError);
        this.sampleCost();
        if (evt.result.context) {
          this.fire('session.context', info.id, 'status_change', evt.result.context);
        }
        // End this turn's task tag. If this session ROOTS the task, the whole orchestration (root turn +
        // everything it delegated) is finished → a record is returned, so notify the Dashboard.
        const finished = this.taskTokens.endTurn(info.id);
        if (finished) {
          this.fire('session.taskTokens', info.id, 'message', { taskId: finished.id });
        }
        info.status = 'idle';
        info.currentTask = undefined;

        // Persist the agent's conversation after each turn so a later restart resumes its context.
        const snap = this.backends.get(info.id)?.snapshot?.();
        if (snap) {
          this.deps.saveSnapshot?.(info.id, snap);
        }

        // Reply to whoever assigned this task, so workflows/askers get a completion.
        const origin = this.pendingOrigin.get(info.id);
        this.pendingOrigin.delete(info.id);
        const replyType: MessageType = evt.result.isError ? 'system.error' : 'task.complete';
        this.bus.send(
          info.id,
          origin?.from ?? '*',
          replyType,
          {
            instruction: evt.result.text,
            metadata: { isError: evt.result.isError, usage: evt.result.usage },
          },
          'normal',
          origin?.correlationId ?? origin?.id
        );

        this.fire('session.status', info.id, 'status_change', { status: 'idle' });
        // Worktree fan-out: let the host merge this agent's worktree now that its turn is done.
        this.deps.onTurnComplete?.(info.id, evt.result.isError);
        this.flushInbox(info.id);
        break;
      }

      case 'log':
        this.fire('session.output', info.id, 'message', { stream: evt.stream, content: evt.line });
        break;

      case 'error':
        info.errorMessage = evt.message;
        this.fire('session.error', info.id, 'error', { error: evt.message });
        // Only a DEAD backend frees a concurrency slot. A turn-level error (backend still alive) is
        // followed by turn_complete, which restores 'idle' — so marking 'error' or draining here would
        // release the slot mid-turn and let a queued agent breach maxConcurrent. Defer to 'exit' for
        // genuine death; only handle the no-following-turn_complete case (backend not alive).
        if (!this.backends.get(info.id)?.isAlive()) {
          info.status = 'error';
          this.drainPendingStarts();
        }
        break;

      case 'exit': {
        const wasUnexpected = info.status !== 'stopping';
        info.status = 'stopped';
        info.pid = undefined;
        info.currentTask = undefined;
        this.backends.delete(info.id);
        this.fire('session.stopped', info.id, 'stop', { exitCode: evt.code });

        // Basic crash recovery: restart once-per-incident with backoff if configured.
        if (wasUnexpected && info.config.autoRestart && info.restartCount < 5) {
          info.restartCount++;
          setTimeout(() => {
            this.start(info.id).catch(() => undefined);
          }, Math.min(1000 * info.restartCount, 5000));
        }
        // A slot just freed — start anything queued by the concurrency cap (B1).
        this.drainPendingStarts();
        break;
      }
    }
  }

  /**
   * Model fallback (P1#6): count consecutive failed turns; once a primary model fails
   * FALLBACK_AFTER_FAILURES times in a row and a `fallbackModel` is configured, switch to it so a
   * persistently-down primary doesn't wedge the agent. A successful turn resets the counter.
   */
  private recordTurnOutcome(info: SessionInfo, isError: boolean): void {
    if (!isError) {
      this.consecutiveErrors.set(info.id, 0);
      return;
    }
    const n = (this.consecutiveErrors.get(info.id) ?? 0) + 1;
    this.consecutiveErrors.set(info.id, n);

    const fallback = info.config.fallbackModel;
    if (n >= FALLBACK_AFTER_FAILURES && fallback && info.config.model !== fallback) {
      const from = info.config.model;
      info.config.model = fallback;
      this.consecutiveErrors.set(info.id, 0);
      this.fire('session.modelSwitched', info.id, 'status_change', {
        from,
        to: fallback,
        reason: `primary model failed ${n} turns in a row`,
      });
    }
  }

  /** Append a cumulative-cost sample to the trend timeline (bounded). */
  private sampleCost(): void {
    const total = this.getAll().reduce((sum, s) => sum + (s.usage?.costUsd ?? 0), 0);
    this.costTimeline.push({ t: Date.now(), cost: total });
    if (this.costTimeline.length > MAX_COST_SAMPLES) {
      this.costTimeline.splice(0, this.costTimeline.length - MAX_COST_SAMPLES);
    }
  }

  private fire(event: SessionManagerEvent, sessionId: string, type: SessionEvent['type'], data?: unknown): void {
    this.emitter.emit(event, {
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      data,
    } as SessionEvent);
  }
}

function normalizeChatMode(mode: unknown): ChatMode {
  return mode === 'plan' ? 'plan' : 'act';
}

/**
 * Agent robustness: a firm protocol injected into every NON-coordinator agent's system prompt, so a
 * delegated worker actually carries out the task it's handed instead of returning empty, replying with
 * only a plan/analysis, or telling the requester to run a script themselves. Coordinators (the PM /
 * any agent with the `delegate` tool) are excluded — they orchestrate, they don't execute. Phrased
 * to fit read-only roles too: a reviewer's "deliverable" is its PASS/FAIL verdict, not an edit.
 * Returns '' for coordinators. Exported for unit testing.
 */
export function workerComplianceProtocol(config: AgentConfig): string {
  const isCoordinator = config.role === 'pm' || (config.allowedTools?.includes('delegate') ?? false);
  // Applies to EVERY agent — coordinator, worker, or solo. The single most common dogfood failure is an
  // agent stating a fact (a version, a config value, file contents) it remembers from an earlier turn or
  // session, which has since changed. Force a fresh read before citing.
  const freshRead = `

## Cite from a fresh read, never from memory (required)
Before you state any fact about the project — a version number, a config value, file contents, whether
something exists, or current status — READ it THIS turn with read_file (or search_files). The workspace
and files change between turns and sessions, so your memory of an earlier read may be stale. Never
present a remembered or assumed value as if you verified it ("I read this directly…") unless you
actually read it in this turn. If you haven't checked, say so or go check first.`;
  if (isCoordinator) {
    return freshRead;
  }
  return freshRead + `

## Ground the task in the REAL code before you act (required)
An instruction tells you the INTENT — it is not a literal script to type out blindly. Weak execution
looks like this: read the instruction, immediately start writing code, never look at what's actually
there. Do NOT work that way. Before you change anything:
- READ the actual files the task touches and understand how they work RIGHT NOW — the real structure,
  types, naming, patterns, and where the relevant logic lives. Use read_file / search_files first.
- RECONCILE the instruction with what you found. Adapt it to the real code (its actual APIs, conventions,
  and file layout). Do NOT invent a function, file, import, or pattern the codebase doesn't use, and do
  NOT assume the layout — confirm it.
- If the instruction CONFLICTS with reality (it names something that moved, was renamed, or never
  existed), STOP and say so, quoting the specific lines you just read — don't force a change that doesn't
  fit, and don't paper over the mismatch.
- MATCH the surrounding code: follow the patterns already in the file you're editing, not a generic
  template from memory.
Going straight from instruction → code without first reading the source it touches is the single most
common way a task gets done wrong. Understand the current code first, THEN make the change.

## Carrying out an assigned task (required)
When the PM or a teammate assigns you a task, it is a direct instruction from your coordinator — not a
suggestion. Do it now:
- Actually DO the work with your tools. If the task needs code, read the relevant files and then make
  the change with write_file (and verify with run_command). Produce the concrete deliverable the task
  asks for — do not reply with only a plan, only analysis, or "here's what you should do".
- You are the one assigned. Do NOT tell the requester to run a command or make the change themselves.
  If a script needs running, YOU run it (use the project's own scripts; don't invent commands).
- Stay on the task you were given. If you believe it's the wrong task, say so briefly, then still do
  the closest correct thing you can.
- Check reality before claiming "already done". Before you say a task is already complete or needs no
  changes, READ the relevant file(s) with read_file to confirm their CURRENT contents. Never rely on
  your memory of an earlier change — the files may differ from what you recall.
- Make the checks pass by fixing the CODE, never by weakening the tests. Do NOT edit, delete, or loosen
  a test (e.g. changing an assertion to match buggy output) just to make it go green. If a test is
  genuinely wrong, say so explicitly and explain why — never silently neuter it to pass.
- Work in small, verifiable steps: make the smallest change that satisfies the task, verify it, then
  stop. Don't bundle in unrelated edits.
- Keep your todo list honest. If you're tracking steps with update_todos, before you report the task
  done make sure the list reflects reality — mark the FINAL step completed too. Don't leave a step
  showing "in progress" after you've actually finished it.
- Only report that you cannot proceed if you are genuinely blocked — and then state the exact blocker
  (the specific file, command, or error). Never hand back a vague "the environment is broken" or an
  empty response; that is treated as a failure to do the work.
- ACT, don't just announce. NEVER end your message by saying you are *about to* do something (e.g.
  "let me read the file", "I'll run the tests now") and then stop. If you say you will use a tool,
  issue that tool call in the SAME message. Stopping after an announcement stalls the whole team and
  forces the user to prod you — which is a failure. Do the action, then report the result.`;
}
