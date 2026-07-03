/*---------------------------------------------------------------------------------------------
 *  UnodeAi - AgentBackend
 *  Transport-agnostic contract for "how a single agent session actually runs".
 *
 *  v1 ships ClaudeHeadlessBackend (spawns `claude` in stream-json mode). Future backends
 *  (codex, gemini, raw provider API) implement the same interface so SessionManager and the
 *  rest of the extension never care how an agent is powered.
 *--------------------------------------------------------------------------------------------*/

import { AgentConfig, AgentModelParams, ChatMode } from '../types';
import type { Summarizer, SummarizerIO } from '../session/Summarizer';

/**
 * Normalized events every backend emits, regardless of the underlying CLI/protocol.
 * SessionManager translates these into session-status changes and MessageBus traffic.
 */
export type BackendEvent =
  | { kind: 'ready'; backendSessionId?: string; model?: string }
  | { kind: 'assistant_delta'; delta: string }
  | { kind: 'reasoning_delta'; delta: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool_use'; name: string; input: unknown }
  | { kind: 'tool_result'; name: string; ok: boolean; summary: string; detail?: string; diff?: string }
  | { kind: 'compacted'; dropped: number; model: string }
  | { kind: 'turn_complete'; result: TurnResult }
  | { kind: 'log'; stream: 'stdout' | 'stderr'; line: string }
  | { kind: 'error'; message: string }
  | { kind: 'exit'; code: number | null };

/**
 * Outcome of one user turn (one task handed to the agent).
 */
export interface TurnResult {
  /** Final assistant text for the turn, if the backend surfaces one. */
  text: string;
  isError: boolean;
  usage?: TurnUsage;
  context?: TurnContext;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  /** USD cost for the turn if the backend reports it (Claude Code does). */
  costUsd?: number;
}

export interface TurnContext {
  tokens: number;
  window: number;
  ratio: number;
}

export type BackendEventHandler = (event: BackendEvent) => void;

/**
 * Serializable conversation state for an agent, so its context survives a restart/crash
 * (L2 recovery). Opaque `messages` — each backend owns its own wire format.
 */
export interface ConversationSnapshot {
  version: 1;
  messages: unknown[];
}

/**
 * One running (or runnable) agent process.
 *
 * Lifecycle: `start()` spawns the process and resolves once it is ready to accept turns.
 * `sendUserTurn()` hands the agent a task (a natural-language instruction, optionally with
 * file/context attachments). Results come back asynchronously via the event handler as a
 * `turn_complete` event, which SessionManager republishes onto the MessageBus.
 */
export interface AgentBackend {
  readonly agentId: string;

  /** Register the single event sink. Returns a disposer. */
  onEvent(handler: BackendEventHandler): () => void;

  /** Spawn the underlying process. Resolves when the process has spawned (not necessarily ready). */
  start(env: NodeJS.ProcessEnv): Promise<void>;

  /** Hand the agent a user turn (task instruction + optional attachments). */
  sendUserTurn(instruction: string, attachments?: TurnAttachments): void;

  /** Gracefully terminate (SIGTERM), force-killing after `forceTimeoutMs`. */
  stop(forceTimeoutMs?: number): Promise<void>;

  /** Best-effort cancellation of the current turn. Optional per backend. */
  abort?(): void;

  /**
   * G-001 mid-run steering: queue a user message into the CURRENTLY RUNNING turn. It is folded in at the
   * next safe point (the top of the tool loop) and the agent re-plans from it. No-op when idle. Optional
   * per backend — the Claude backend omits it (it runs its own loop).
   */
  interject?(text: string): void;

  /** Switch the model used for subsequent turns (tier hot-swap / fallback escalation). The running
   *  backend holds its own config copy, so SessionManager must push the change here, not just into
   *  the stored config. Optional per backend (claude applies it on the next spawn). */
  setModel?(model: string): void;

  /** Whether the process is currently alive. */
  isAlive(): boolean;

  readonly pid: number | undefined;

  /** Capture the agent's conversation so it can be restored later. Optional per backend. */
  snapshot?(): ConversationSnapshot | undefined;

  /** Seed the agent's conversation from a prior snapshot. Call BEFORE start(). Optional. */
  restore?(snapshot: ConversationSnapshot): void;

  /**
   * Optional history compaction hook. OpenAI-compatible backends implement this so SessionManager
   * can inject a summarizer before dispatching a turn. Claude backends omit it because Claude
   * manages its own context window.
   */
  compactHistory?(summarizer: Summarizer, io: SummarizerIO, economyModel: string): Promise<void>;
}

export interface TurnAttachments {
  mode?: ChatMode;
  files?: string[];
  context?: Record<string, unknown>;
  expectedOutput?: string;
  /** Per-turn model override. Used by OpenAI-compatible Smart Mode without mutating AgentConfig.model. */
  model?: string;
  /** Resolved model/sampling params for this turn (F2). Backends apply what they support. */
  modelParams?: AgentModelParams;
  /** Latest `.unode/rules.md` project memory for this turn (F4). */
  projectContext?: string;
  /**
   * Cline #2: proactive workspace orientation for THIS turn — the active editor file (capped) + current
   * Error/Warning diagnostics, **pre-formatted host-side into a string**. Injected ephemerally into the
   * system message (NOT persisted to history, so stale file content can't accumulate). Opt-in
   * (`unode.engine.workspaceContext`). Host formats the string; backend caps + injects. (Single contract:
   * string. If the host has structured data, format it before attaching.)
   */
  workspaceContext?: string;
}

/**
 * Factory signature — given an agent config, produce a backend instance.
 * Registered per `AgentConfig.backend` (defaults to 'claude').
 */
export type BackendFactory = (config: AgentConfig) => AgentBackend;
