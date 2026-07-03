/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Multi-Agent AI Team for VS Code
 *  Core type definitions
 *--------------------------------------------------------------------------------------------*/

/**
 * Team configuration loaded from .teamrc / team.config.json
 */
export interface TeamConfig {
  version: '1.0';
  name: string;
  description?: string;
  members: AgentConfig[];
  workflows: WorkflowConfig[];
  settings: TeamSettings;
  /** 段2: team-level MCP server registry. Agents reference these by id (default-deny). */
  mcpServers?: MCPServerConfig[];
  /** F3: Smart Mode tier auto-selection. Absent = off. */
  smartMode?: SmartModeConfig;
  /** F3: optional override of DEFAULT_MODEL_TIERS (tier → provider → model). Absent = built-in. */
  modelTiers?: Record<ModelTier, Record<string, string>>;
}

/**
 * 段2: an MCP server the team can mount. stdio = local subprocess; streamable-http/sse = remote.
 * `env` values may contain ${VAR} placeholders resolved from SecretStorage at runtime — never
 * stored resolved (no secrets on disk). A server is exposed to an agent ONLY when that agent's
 * skills (type 'mcp-server') or `mcpServers` explicitly reference it (default-deny).
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  command?: string; // stdio
  args?: string[]; // stdio
  url?: string; // http/sse
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Sensitive servers (filesystem, github, …) should require explicit user approval to mount. */
  requiresApproval?: boolean;
}

/**
 * Configuration for a single AI agent
 */
export interface AgentConfig {
  id: string;
  name: string;
  role: AgentRole;
  skill: string;
  skills?: AgentSkill[];
  provider: ProviderRef;
  model: string;
  systemPrompt: string;
  description?: string;
  icon?: string;
  color?: string;
  autoApprove: boolean;
  allowedTools: string[];
  /** @deprecated v0.1.1 — prefer `modelParams.max_tokens`; kept as a fallback for old team.json. */
  maxTokens?: number;
  /** @deprecated v0.1.1 — prefer `modelParams.temperature`; kept as a fallback for old team.json. */
  temperature?: number;
  /** Advanced model/sampling parameters (F2). Falls back to global defaults then hard defaults. */
  modelParams?: AgentModelParams;
  /** Per-agent Smart Mode tier override. When Smart Mode is on, this beats the role's tier so two
   *  same-role agents can run at different tiers. Absent = follow the role/default tier. */
  tier?: ModelTier;
  workingDirectory?: string;
  env?: Record<string, string>;
  /** Which runtime powers this agent. Defaults to 'claude' (headless stream-json). */
  backend?: AgentBackendKind;
  /** Endpoint base URL for HTTP backends (e.g. 算力仓 / any OpenAI-compatible gateway). */
  baseUrl?: string;
  /** Restart automatically (with backoff) if the process exits unexpectedly. */
  autoRestart?: boolean;
  /** Fallback model to switch to after repeated turn failures on the primary model (P1#6). */
  fallbackModel?: string;
  /** Context window (tokens) for the soft/hard context gates (P2). Defaults to 128k. */
  contextWindowTokens?: number;
  /** 段2: extra MCP server ids this agent may use (all tools). Merged with skill-derived grants. */
  mcpServers?: string[];
  /**
   * v0.8.6 Agent Builder: skill *playbook* ids (into the skill catalog / skills.json) the user attached
   * to this agent. SEPARATE from `skills` (capability tokens → allowedTools): playbooks are procedure
   * text folded into the system prompt under `## Playbooks` via applyPlaybooks(). Capped at
   * MAX_AGENT_PLAYBOOKS. Optional/absent = no attached playbooks.
   */
  playbooks?: string[];
  /**
   * How an openai-compat agent calls tools (design C). 'native' = OpenAI function calling (default);
   * 'xml' = Cline-style XML tool calls in the prompt, which weaker models follow more reliably.
   */
  toolProtocol?: ToolProtocolKind;
}

export type ToolProtocolKind = 'native' | 'xml';

export type AgentBackendKind = 'claude' | 'openai-compat';
export type ChatMode = 'plan' | 'act';

/**
 * Quality/cost tier for a role (v0.1.1 F3). Decouples "how capable a model a role needs" from a
 * specific model id; `DEFAULT_MODEL_TIERS` (RoleConfig) maps each tier→model per provider.
 * Lives here (not RoleConfig) so TeamConfig/SmartModeConfig can reference it without a cycle.
 */
export type ModelTier = 'premium' | 'standard' | 'economy';

/**
 * Smart Mode (v0.1.1 F3): auto-select a model tier per task instead of pinning one model per agent.
 * Reuses the existing tier infra — `selectTier()` resolves a tier, then TierController/modelFor maps
 * it to a concrete model for the agent's provider and hot-swaps it (openai-compat: next turn).
 */
export interface SmartModeConfig {
  enabled: boolean;
  /** Fallback tier when nothing more specific matches. */
  defaultTier: ModelTier;
  /** Per-role tier override (role → tier); beats the role template's tier, loses to a task hint. */
  roleTiers?: Record<string, ModelTier>;
  /** Per-message-type tier hint (msg.type → tier), e.g. { 'review.request': 'economy' }. */
  taskTierHints?: Record<string, ModelTier>;
}

/**
 * Advanced model/sampling parameters for an agent (v0.1.1 F1). All optional — resolved layer-by-layer
 * by ModelParamResolver: agent.modelParams > smart tier > global unode.modelDefaults.* > hard defaults.
 *
 * BACKEND SUPPORT: the full surface applies to OpenAI-compatible backends (passed in the request
 * body). The `claude` headless CLI only honors `reasoning_effort` (→ --effort) and, partially,
 * `response_format` (→ --json-schema); all other fields are ignored for claude agents (no CLI flags).
 */
export interface AgentModelParams {
  // ── Sampling ──
  temperature?: number; // 0.0–2.0
  top_p?: number; // 0.0–1.0
  // ── Penalties ──
  presence_penalty?: number; // -2.0–2.0
  frequency_penalty?: number; // -2.0–2.0
  // ── Thinking / Reasoning ──
  thinking?: { type: 'enabled'; budget_tokens?: number } | { type: 'disabled' };
  reasoning_effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  // ── Output control ──
  max_tokens?: number;
  stop?: string | string[]; // max 4
  response_format?: { type: 'text' | 'json_object' };
  // ── Tool behavior ──
  tool_choice?: 'auto' | 'none' | string;
  stream?: boolean;
}

/**
 * Predefined or custom agent roles
 */
export type AgentRole =
  | 'architect'
  | 'developer'
  | 'reviewer'
  | 'qa'
  | 'pm'
  | 'product-manager'
  | 'devops'
  | 'tech-writer'
  | 'security'
  | 'data-engineer'
  | 'senior-dev'
  | 'tester'
  | 'solo'
  | 'custom';

export type SkillCategory =
  | 'development'
  | 'testing'
  | 'design'
  | 'documentation'
  | 'management'
  | 'security'
  | 'infrastructure'
  | 'data'
  | 'external'; // 段2: MCP-backed external services (GitHub, browser, DB …)

/**
 * How a skill is actually fulfilled — turns a skill from a label into a capability declaration.
 *  - builtin:   grants capability tokens consumed by WorkspaceTools/TeamTools
 *               ('read' | 'write' | 'execute' | 'search' | 'delegate'). NOT low-level function
 *               names — WorkspaceTools maps 'read'→read_file/list_dir, 'write'→write_file,
 *               'execute'→run_command; 'delegate' gates TeamTools (PM delegation).
 *  - composite: the union of other skills (recursively resolved, cycle-safe).
 *  - mcp-server: tools from a mounted MCP server (consumed in 段2, not by allowedTools).
 */
export type SkillImplementation =
  | { type: 'builtin'; tools: string[] }
  | { type: 'composite'; skillIds: string[] }
  | { type: 'mcp-server'; serverId: string; toolFilter: 'all' | 'allowlist' | 'denylist'; toolList?: string[] };

/**
 * Agent skill definition (goes beyond the simple role string).
 * `implementation` is optional: a skill without it is a legacy label that grants no tools, so
 * existing configs keep relying on their explicit `allowedTools` (backward compatible).
 */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  implementation?: SkillImplementation;
}

/**
 * Reference to a provider configuration
 */
export interface ProviderRef {
  providerId: string;
  apiKeySecretName: string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';
  baseUrl: string;
  apiKeySecretName: string;
  models: ModelConfig[];
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  costPerToken?: {
    input: number;
    output: number;
  };
}

/**
 * Individual model configuration within a provider
 */
export interface ModelConfig {
  id: string;
  name: string;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
}

/**
 * Team-wide settings
 */
export interface TeamSettings {
  maxConcurrentAgents: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  messageRetentionDays: number;
  autoSaveInterval: number;
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  triggers?: WorkflowTrigger[];
}

/**
 * A single step in a workflow
 */
export interface WorkflowStep {
  id: string;
  from: string;
  to: string;
  action: string;
  condition?: string;
  autoTransition: boolean;
  /**
   * P2 conditional routing: after this step completes, the first matching branch wins and the
   * workflow jumps to `goto` (enables if/else and loops). No match → linear next step.
   */
  branches?: WorkflowBranch[];
}

/** A conditional transition out of a step. A branch with no `whenResultContains` always matches. */
export interface WorkflowBranch {
  /** Match if the completing agent's result text contains this substring (case-insensitive). */
  whenResultContains?: string;
  /** Step id to jump to when this branch matches. */
  goto: string;
}

/**
 * Trigger that activates a workflow
 */
export interface WorkflowTrigger {
  type: 'message' | 'file_change' | 'git_event' | 'schedule';
  config: Record<string, unknown>;
}

/*---------------------------------------------------------------------------------------------
 *  Session
 *--------------------------------------------------------------------------------------------*/

export type SessionStatus =
  | 'stopped'
  | 'starting'
  | 'idle'
  | 'running'
  | 'error'
  | 'stopping';

export interface SessionInfo {
  id: string;
  config: AgentConfig;
  status: SessionStatus;
  pid?: number;
  backendSessionId?: string;
  startedAt?: string;
  lastActiveAt?: string;
  currentTask?: string;
  errorMessage?: string;
  /** True when start was requested but deferred by the concurrency cap. */
  pendingStart?: boolean;
  /** The ACTUAL root the running backend/tools are sandboxed to this session (a worktree path, or the
   *  current workspace) — resolved at start, NOT persisted. The single source of truth for "where this
   *  agent operates": use it for workspace grounding, chat preflight, and diagnostics. config.workingDirectory
   *  may be stale/absent; never trust it for the runtime root. */
  runtimeWorkingDirectory?: string;
  restartCount: number;
  /** Rolling token/cost totals for this session, accumulated from turn results. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; turns: number;
    /** What the same tokens would have cost on a top-tier premium model — the baseline for the
     *  "mixed routing saved you $X" comparison. Accrued in parallel with costUsd. */
    premiumCostUsd?: number };
  /** Latest measured context-window usage (from the backend's session.context event). */
  contextUsage?: { tokens: number; window: number; ratio: number };
}

export interface SessionEvent {
  type: 'start' | 'stop' | 'error' | 'status_change' | 'message';
  sessionId: string;
  timestamp: string;
  data?: unknown;
}

/*---------------------------------------------------------------------------------------------
 *  Messages
 *--------------------------------------------------------------------------------------------*/

export type MessageType =
  | 'task.assign'
  | 'task.status'
  | 'task.complete'
  | 'review.request'
  | 'review.feedback'
  | 'ask.question'
  | 'ask.answer'
  | 'handoff'
  | 'broadcast.info'
  | 'agent.message'
  | 'system.error'
  | 'system.heartbeat';

export type MessagePriority = 'high' | 'normal' | 'low';

export interface MessagePayload {
  instruction?: string;
  message?: string;
  mode?: ChatMode;
  files?: string[];
  context?: Record<string, unknown>;
  expectedOutput?: string;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  correlationId?: string;
  from: string;
  to: string | '*';
  type: MessageType;
  priority: MessagePriority;
  payload: MessagePayload;
  timestamp: string;
  ttl?: number;
}

export type MessageHandler = (message: Message) => void | Promise<void>;

export interface MessagePattern {
  type?: MessageType;
  from?: string;
  to?: string;
  priority?: MessagePriority;
}

export interface MessageFilter {
  before?: string;
  after?: string;
  from?: string;
  to?: string;
  type?: MessageType;
  limit?: number;
}

/*---------------------------------------------------------------------------------------------
 *  Workflow Runtime
 *--------------------------------------------------------------------------------------------*/

export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface WorkflowInstance {
  id: string;
  config: WorkflowConfig;
  status: WorkflowStatus;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  context: Record<string, unknown>;
}

export interface WorkflowEvent {
  type: 'start' | 'step_complete' | 'complete' | 'pause' | 'resume' | 'cancel' | 'error';
  workflowId: string;
  timestamp: string;
  data?: unknown;
}

/*---------------------------------------------------------------------------------------------
 *  Usage / Cost Tracking
 *--------------------------------------------------------------------------------------------*/

export interface UsageStats {
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  requests: number;
  lastUsed: string;
}

/*---------------------------------------------------------------------------------------------
 *  Extension State
 *--------------------------------------------------------------------------------------------*/

export interface UnodeCrewState {
  teamConfig: TeamConfig | null;
  sessions: SessionInfo[];
  messages: Message[];
  providers: ProviderConfig[];
  activeWorkflows: WorkflowInstance[];
  usageStats: UsageStats[];
}
