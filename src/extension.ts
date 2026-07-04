/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Extension Entry Point
 *  Wires SessionManager + MessageBus + backends + SecretStorage + persistence + VS Code UI.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SessionManager, TypedSessionEvent } from './session/SessionManager';
import { MessageBus } from './bus/MessageBus';
import { AgentConfigBuilder, DEFAULT_PROVIDERS, DEFAULT_PROVIDER_CONFIGS, DEFAULT_MODEL_TIERS, ROLE_TEMPLATES, modelForRole } from './roles/RoleConfig';
import { selectTier, resolveModelTiers, modelForTier } from './workflow/SmartMode';
import * as fs from 'fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'path';
import { RulesFile, rulesFilePath } from './session/RulesFile';
import { SharedMemory, memoryFilePath } from './session/SharedMemory';
import { ProjectConventions } from './session/ProjectConventions';
import { DiagnosticItem, expandContextMentions } from './session/ContextMentions';
import { buildEvidenceReport, EvidenceChecks } from './backend/evidenceReport';
import { shouldRestartAfterAgentConfigEdit } from './session/sessionLifecycle';
import { AgentConfig, AgentModelParams, Message, ModelTier, SmartModeConfig } from './types';
import { TeamViewProvider } from './views/TeamViewProvider';
import { DashboardProvider } from './views/DashboardProvider';
import { MessageLogProvider } from './views/MessageLogProvider';
import { ChatViewProvider } from './views/ChatViewProvider';
import { OrchestrationProgressTracker } from './views/orchestrationProgress';
import { summarizeArchive } from './views/chatArchive';
import { registerUnodeChatParticipant } from './chat/UnodeChatParticipant';
import { WorkflowEditor } from './views/WorkflowEditor';
import { OnboardingWizard } from './views/OnboardingWizard';
import { openTeamRulesPanel } from './views/TeamRulesPanel';
import { WorkflowEngine } from './workflow/WorkflowEngine';
import { TierController } from './workflow/TierController';
import { SecretsManager } from './secrets/SecretsManager';
import { PersistenceManager } from './state/PersistenceManager';
import { ClaudeHeadlessBackend, ClaudeHeadlessBackendDeps } from './backend/ClaudeHeadlessBackend';
import { OpenAICompatBackend } from './backend/OpenAICompatBackend';
import { EngineOptions, FileDiagnostic } from './backend/Diagnostics';
import { sanitizedCommandEnv } from './backend/commandEnv';
import { createUnifiedDiff } from './backend/diff';
import { resolveOpenAICompatBaseUrl, canonicalRoamBaseUrl, ROAM_DEFAULT_BASE_URL, UNODE_DEFAULT_BASE_URL } from './backend/openAICompatBaseUrl';
import { webFetch } from './backend/webFetch';
import { AgentBackend } from './backend/AgentBackend';
import { TeamTools, TeamView } from './backend/TeamTools';
import { FileCoordinator, OptimisticFileCoordinator, NoopFileCoordinator } from './backend/FileCoordinator';
import { WorktreeManager, WORKTREES_DIR } from './backend/WorktreeManager';
import { GitMergeOrchestrator } from './backend/MergeOrchestrator';
import { WorktreeCoordinator } from './backend/WorktreeCoordinator';
import { Verifier } from './backend/Verifier';
import { DEFAULT_COMPLETION_GATE_CONFIG } from './backend/completionGate';
import { spawn as cpSpawn } from 'child_process';
import { killProcessTree } from './backend/processTree';
import { WorktreePanel, WorktreeReview } from './views/WorktreePanel';
import { TaskClaimRegistry } from './backend/TaskClaimRegistry';
import { CommandPolicy, CommandApprovalMode } from './backend/CommandPolicy';
import { CommandApprovalDecision, detectOutsideRootPath } from './backend/WorkspaceTools';
import { normalizeRunnerCommand } from './backend/commandNormalize';
import { defaultBackendKind, isSupportedProviderId, providerUsesCliAuth } from './backend/backendKind';
import { TerminalManager } from './terminal/TerminalManager';
import { CheckpointStore } from './backend/Checkpoints';
import { promptCommandApproval, showBlockedWarning } from './backend/CommandApprovalPrompter';

import { MCPServerConfig } from './types';
import { MCPHub, McpServerGrant } from './mcp/MCPHub';
import { createRealMcpClient } from './mcp/RealMcpClient';
import { buildClaudeMcpConfig } from './mcp/ClaudeMcpConfig';
import { createLocalMcpServer, LocalMcpServer } from './mcp/LocalMcpServer';
import { TeamMcpBridge } from './mcp/TeamMcpBridge';
import { SkillResolver, agentMcpGrants } from './roles/SkillResolver';
import { SKILL_LIBRARY } from './roles/RoleConfig';
import { ModelCatalog, ModelInfo } from './models/ModelCatalog';
import { resolveModelCatalogBaseUrl } from './models/modelCatalogBaseUrl';
import { ModelPricing, DEFAULT_MODEL_PRICES, ModelPrice } from './models/ModelPricing';
import { LivePriceService } from './models/LivePriceService';
import { BalanceService } from './models/BalanceService';
import { SettingsBridge, ProviderDef, ConfigStore } from './settings/SettingsBridge';
import { ModelParamResolver } from './params/ModelParamResolver';
import { sanitizeParams } from './params/sanitizeModelParams';
import { SettingsPanel } from './views/SettingsPanel';
import { MarketplacePanel, asMarketplaceTab } from './views/MarketplacePanel';
import { AgentBuilderPanel, AgentBuilderSavePayload, AgentBuilderViewModel } from './views/AgentBuilderPanel';
import { MAX_AGENT_ICON_BYTES } from './views/agentIcon';
import { MarketplaceCatalog, MarketplaceInstallAction, CatalogSourceName, McpCatalogEntry } from './marketplace/catalog';
import { RawCatalog, resolveCatalog, ROAM_CATALOG_PUBLIC_KEY_PEM } from './marketplace/catalogSource';
import { toAgentConfig, toMcpServerConfig, mountSkillPlaybooks, applyPlaybooks } from './marketplace/install';
import {
  createChatExportPayload,
  createMessagesExportPayload,
  parseChatImportPayload,
  parseMessagesImportPayload,
} from './views/transcriptPort';
import { LlmSummarizer } from './session/Summarizer';
import { approvalKey, needsApproval } from './mcp/McpApproval';
import { resolveServerPlaceholders } from './mcp/McpPlaceholders';
import { GuidedMcpTransport, isValidMcpUrl, parseMcpArgs, parseMcpEnvInput } from './mcp/McpForm';
import { DEMO_TASKS } from './state/DemoTasks';
import * as dialogs from './dialogs';
import { DialogDeps } from './dialogs';

let sessionManager: SessionManager;
let messageBus: MessageBus;
let workflowEngine: WorkflowEngine;
let teamViewProvider: TeamViewProvider;
const terminalManager = new TerminalManager();
const checkpointStore = new CheckpointStore();
let checkpointSaveTimer: ReturnType<typeof setTimeout> | undefined;
let dashboardProvider: DashboardProvider;
/** The open Dashboard webview panel (retained so the N-control + task events can re-render it). */
let dashboardPanel: vscode.WebviewPanel | undefined;
/** Re-render the Dashboard panel if it's open. */
async function refreshDashboardPanel(): Promise<void> {
  if (!dashboardPanel) { return; }
  try {
    dashboardPanel.webview.html = await dashboardProvider.getDashboardHtml(dashboardPanel.webview);
  } catch { /* a refresh failure must never throw into an event handler */ }
}
let messageLogProvider: MessageLogProvider;
let chatViewProvider: ChatViewProvider;
let orchestrationProgress: OrchestrationProgressTracker;
let secrets: SecretsManager;
let persistence: PersistenceManager;
let fileCoordinator: FileCoordinator;
/** Worktree fan-out (v0.6.x): isolates eligible agents in per-agent worktrees + merges them back. */
let worktreeCoordinator: WorktreeCoordinator | undefined;

/** Shared across all coordinator agents so parallel file-ownership claims are workspace-global. */
const taskClaims = new TaskClaimRegistry();
let commandPolicy: CommandPolicy;
let mcpHub: MCPHub;
let modelCatalog: ModelCatalog;
let pricing: ModelPricing;
let livePrices: LivePriceService;
let balanceService: BalanceService;
let settingsBridge: SettingsBridge;
let rulesFile: RulesFile;
let sharedMemory: SharedMemory;
let projectConventions: ProjectConventions;
const skillResolver = new SkillResolver(SKILL_LIBRARY);
/** Team-level MCP server registry (id -> config), loaded from .unode/team.json. */
const mcpRegistry = new Map<string, MCPServerConfig>();
const WORKSPACE_CONTEXT_ACTIVE_FILE_CHAR_CAP = 12000;
const WORKSPACE_CONTEXT_ACTIVE_FILE_LINE_CAP = 150;
const WORKSPACE_CONTEXT_DIAGNOSTIC_LIMIT = 40; // bounded so diagnostics don't crowd out the file within the backend's ~6 KB cap
const WORKSPACE_TREE_FILE_CAP = 200; // bounded file listing — enough to ground the model, capped to stay small

/** A compact, relative file listing of the workspace so the model uses REAL paths instead of
 *  confabulating an absolute sandbox path (the grounding Cline/Kilo provide by default). Respects the
 *  user's files.exclude/search.exclude via findFiles, and skips heavy build/vendor dirs. */
async function listWorkspaceTree(root: string): Promise<string> {
  let uris: vscode.Uri[];
  try {
    uris = await vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,dist,out,build,.next,coverage,.venv,venv,__pycache__,target,bin,obj}/**',
      WORKSPACE_TREE_FILE_CAP
    );
  } catch {
    return '';
  }
  if (uris.length === 0) { return ''; }
  const rels = uris
    .map((u) => path.relative(root, u.fsPath).split(path.sep).join('/'))
    .filter((r) => r && !r.startsWith('..'))
    .sort();
  if (rels.length === 0) { return ''; }
  const capped = rels.length >= WORKSPACE_TREE_FILE_CAP;
  return rels.join('\n') + (capped ? '\n… (listing capped — use list_dir / search_files for the rest)' : '');
}
/** Sensitive MCP servers the user has approved to mount (persisted; P1#4). */
const approvedMcp = new Set<string>();
/** Debounce handle for persisting message history (P1#5). */
let messageSaveTimer: NodeJS.Timeout | undefined;

/** One Output channel per agent, holding that agent's own transcript (assistant text + tools). */
const agentChannels = new Map<string, vscode.OutputChannel>();

function resolveAgentName(id: string): string {
  if (id === 'user') { return 'You'; }
  if (id === '*') { return 'everyone'; }
  if (id === 'workflow') { return 'Workflow'; }
  return sessionManager?.get(id)?.config.name ?? id;
}

function getAgentChannel(id: string): vscode.OutputChannel {
  let ch = agentChannels.get(id);
  if (!ch) {
    ch = vscode.window.createOutputChannel(`UnodeAi · ${resolveAgentName(id)}`);
    agentChannels.set(id, ch);
  }
  return ch;
}

let outputChannel: vscode.LogOutputChannel;
let statusBarItem: vscode.StatusBarItem;
let unodeVersion = ''; // set at activate; kept in every status-bar text so the version always shows

// ─── Network egress consent ───────────────────────────────────────────
// No prompt or code leaves the machine until the user has explicitly approved the destination gateway
// host. Consent is per-host and persisted (globalState), so each provider is confirmed once.
let extensionContext: vscode.ExtensionContext | undefined;
const consentedEgressHosts = new Set<string>();
const EGRESS_CONSENT_KEY = 'unode.egressConsentHosts';

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

/** Ask once per gateway host before any model request. Returns false if the user declines (nothing is sent). */
async function ensureEgressConsent(host: string): Promise<boolean> {
  if (!host || consentedEgressHosts.has(host)) { return true; }
  const choice = await vscode.window.showWarningMessage(
    `UnodeAi is about to send this agent's prompt — and any workspace files it includes — to “${host}” to generate a response.\n\n` +
    `Your prompts and code go only to the AI provider you configure; UnodeAi has no servers of its own, no telemetry, and no other network destinations.\n\n` +
    `Allow UnodeAi to contact ${host}?`,
    { modal: true },
    'Allow',
    'Cancel'
  );
  if (choice !== 'Allow') { return false; }
  consentedEgressHosts.add(host);
  await extensionContext?.globalState.update(EGRESS_CONSENT_KEY, [...consentedEgressHosts]);
  return true;
}

/** Egress hook passed to backends. Throws (aborting the request, before anything is sent) if the user declines. */
async function egressGate(url: string): Promise<void> {
  const host = hostOf(url);
  if (!(await ensureEgressConsent(host))) {
    throw new Error(`Network egress to ${host} was declined — no prompt or code was sent. Approve the provider to use it.`);
  }
}

// ─── Activation ───────────────────────────────────────────────────────

/**
 * One-time migration of user settings from the legacy `roam.*` configuration namespace to `unode.*`
 * (the extension was rebranded Roam Crew → UnodeAi). Reads the extension's own declared `unode.*`
 * config keys and copies any value the user explicitly set under the old `roam.*` key, unless the new
 * key is already set. Provider ids, secrets, and per-extension state are untouched. Idempotent via a
 * globalState flag. Best-effort: failures are logged, never fatal.
 */
async function migrateRoamSettingsToUnode(context: vscode.ExtensionContext): Promise<void> {
  const FLAG = 'unode.migration.namespace.v1';
  if (context.globalState.get(FLAG)) { return; }
  try {
    const props: Record<string, unknown> =
      (context.extension?.packageJSON?.contributes?.configuration?.properties) ?? {};
    const oldCfg = vscode.workspace.getConfiguration('roam');
    const newCfg = vscode.workspace.getConfiguration('unode');
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    let migrated = 0;
    for (const fullKey of Object.keys(props)) {
      if (!fullKey.startsWith('unode.')) { continue; }
      const key = fullKey.slice('unode.'.length);
      const oldI = oldCfg.inspect(key);
      const newI = newCfg.inspect(key);
      if (oldI?.globalValue !== undefined && newI?.globalValue === undefined) {
        await newCfg.update(key, oldI.globalValue, vscode.ConfigurationTarget.Global);
        migrated++;
      }
      if (hasWorkspace && oldI?.workspaceValue !== undefined && newI?.workspaceValue === undefined) {
        await newCfg.update(key, oldI.workspaceValue, vscode.ConfigurationTarget.Workspace);
        migrated++;
      }
    }
    await context.globalState.update(FLAG, true);
    if (migrated > 0) { outputChannel.info(`Migrated ${migrated} setting(s) from roam.* to unode.* namespace.`); }
  } catch (e) {
    outputChannel.warn(`Settings migration (roam.* → unode.*) skipped: ${String(e)}`);
  }
}

/**
 * One-time migration of the per-workspace data directory `.roam/` → `.unode/` (rebrand). Holds the
 * team roster (team.json), project/shared memory (rules.md, memory/), MCP config, and worktrees.
 * Renames the directory if the old one exists and the new one does not, then repairs any git worktrees
 * whose gitdir links the move invalidated. Best-effort; failures are logged, never fatal.
 */
async function migrateRoamWorkspaceDir(): Promise<void> {
  try {
    if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) { return; } // never touch process.cwd() fallback
    const root = workspaceRoot();
    const oldDir = path.join(root, '.roam');
    const newDir = path.join(root, '.unode');
    const exists = async (p: string) => { try { await fs.access(p); return true; } catch { return false; } };
    if (!(await exists(oldDir)) || (await exists(newDir))) { return; }
    await fs.rename(oldDir, newDir);
    outputChannel.info('Migrated workspace data dir .roam/ → .unode/');
    // The move broke gitdir links for any worktrees under .unode/worktrees; repair them (best-effort).
    await new Promise<void>((resolve) => {
      const p = cpSpawn('git', ['-C', root, 'worktree', 'repair'], { stdio: 'ignore' });
      const t = setTimeout(() => { try { p.kill(); } catch { /* ignore */ } resolve(); }, 15000);
      p.on('close', () => { clearTimeout(t); resolve(); });
      p.on('error', () => { clearTimeout(t); resolve(); });
    });
  } catch (e) {
    outputChannel.warn(`Workspace dir migration (.roam → .unode) skipped: ${String(e)}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('UnodeAi', { log: true });
  outputChannel.info('UnodeAi activating...');
  extensionContext = context;
  for (const h of context.globalState.get<string[]>(EGRESS_CONSENT_KEY, [])) { consentedEgressHosts.add(h); }
  await migrateRoamSettingsToUnode(context); // rebrand: carry legacy roam.* settings into unode.*
  await migrateRoamWorkspaceDir();           // rebrand: move legacy .roam/ workspace data → .unode/

  // Workspace Trust: when the user grants trust mid-session, mount any MCP servers referenced by agents
  // (they were skipped at activation while untrusted). Command execution is checked live, so it needs no
  // re-arming here. Registered on the context so it's disposed on deactivate.
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
    outputChannel.info('Workspace trusted — mounting referenced MCP servers.');
    try { registerReferencedMcpServers(); } catch (e) { outputChannel.warn(`MCP mount after trust failed: ${String(e)}`); }
  }));

  secrets = new SecretsManager(context.secrets);
  persistence = new PersistenceManager(context);
  checkpointStore.restoreFrom(persistence.loadCheckpoints()); // V1: restore points survive reloads
  messageBus = new MessageBus();
  fileCoordinator = makeFileCoordinator();
  worktreeCoordinator = makeWorktreeCoordinator();
  // Live review board (A2): when a lane's verify state changes (merge gate, re-verify), refresh the
  // open worktree panel so the user sees ✓/✗ flips without reopening it.
  worktreeCoordinator.onChange = () => { void refreshWorktreePanel(); };
  commandPolicy = makeCommandPolicy();
  commandPolicy.onFirstBlock = () => showBlockedWarning();
  // MCP host for in-process (openai-compat) agents. Secrets for ${VAR} placeholders are resolved
  // from SecretStorage — never process.env. claude agents use claude's native MCP instead.
  mcpHub = new MCPHub(createRealMcpClient, (name) => secrets.get(name));

  // Remotely-configurable model list: live {baseUrl}/v1/models + optional Roam-hosted catalog,
  // with the static provider configs as offline fallback.
  modelCatalog = new ModelCatalog(
    (pk) =>
      (DEFAULT_PROVIDER_CONFIGS[pk]?.models ?? []).map(
        (m): ModelInfo => ({ id: m.id, name: m.name, vision: m.supportsVision, source: 'static' })
      ),
    (url, init) => (globalThis as any).fetch(url, init),
    { catalogUrl: vscode.workspace.getConfiguration('unode').get<string>('modelCatalogUrl', '') || undefined }
  );

  // F4: project memory (.unode/rules.md), appended to every agent's system prompt at start.
  rulesFile = new RulesFile(rulesFilePath(workspaceRoot()));
  sharedMemory = new SharedMemory(memoryFilePath(workspaceRoot()));
  // A1/A2: auto-detected project conventions (package.json scripts + how to run them), injected the
  // same way as rules so every agent (even weak ones) uses the right commands instead of inventing them.
  projectConventions = new ProjectConventions(workspaceRoot());
  // P3: await the initial loads during activation so the very first turn already carries project
  // context — otherwise a user who sends a message the instant the extension loads could get an agent
  // turn with no scripts/rules injected. Both are cheap disk reads; watchers still hot-reload on change.
  // Guarded + skipped without a workspace: these must never abort activation (which happens before the
  // webview providers register below) — otherwise the panels show only their titles, no content. When
  // no folder is open, workspaceRoot() falls back to process.cwd() (e.g. an unwritable `/` on macOS
  // launched from the Dock), so there's no project to attach memory to: just skip the disk work.
  if (vscode.workspace.workspaceFolders?.length) {
    try {
      await rulesFile.ensureExists();
      await rulesFile.load();
      await sharedMemory.load();
      await projectConventions.load();
    } catch (err) {
      outputChannel.warn(`Project memory/conventions load skipped: ${String(err)}`);
    }
  }

  // F2: resolve effective model/sampling params (agent override > global unode.modelDefaults > defaults).
  const modelParamResolver = new ModelParamResolver(makeConfigStore());
  const summarizer = new LlmSummarizer();
  const localMcpServerFactory = createSharedLocalMcpServerFactory();

  // The backend factory decides "how an agent runs", keyed off config.backend (falling back to
  // a provider-based default). Add codex/gemini/etc. factories here as they land.
  const SOLO_MAX_TOOL_ITERATIONS = 25;
  const createBackend = (config: AgentConfig): AgentBackend => {
    const kind = config.backend ?? defaultBackendKind(config);
    const runtimeConfig = kind === 'openai-compat' ? withOpenAICompatBaseUrl(config) : config;
    const grants = agentMcpGrants(runtimeConfig, skillResolver);
    // Approval card names the requesting agent, so a teammate's prompt is identifiable from any chat view
    // (the bar is global). Shared by the OpenAI-compat run_command path and the Claude permission gate.
    const approveForAgent = (command: string) => requestCommandApproval(command, runtimeConfig.name);
    if (kind === 'openai-compat') {
      // Coordinator agents (the PM) get delegation tools so they can drive the crew.
      const team = canDelegate(runtimeConfig) ? makeCoordinatorTeamTools(runtimeConfig) : undefined;
      // In-process agents host MCP via the shared Hub (default-deny: only granted servers).
      const mcp = grants.length > 0 ? { hub: mcpHub, grants } : undefined;
      // Agent robustness: rewrite direct runner calls (e.g. `npx vitest`) into the project's scripts.
      const commandNormalizer = (cmd: string) => normalizeRunnerCommand(cmd, projectConventions.getInfo());
      // Solo mode (v0.3.0): a single agent has no teammates to spread work across, so give it more
      // tool-loop iterations to finish a whole task itself.
      const isSolo = runtimeConfig.role === 'solo';
      const net = isSolo
        ? { maxToolIterations: SOLO_MAX_TOOL_ITERATIONS, onBeforeEgress: egressGate }
        : { onBeforeEgress: egressGate };
      // A solo agent has no teammates, so the optimistic "read the file before you overwrite it"
      // guard is pure friction (it can't clobber anyone). Skip it for solo; teams keep it.
      // Worktree fan-out: an isolated agent (workingDirectory under .unode/worktrees/) has its own
      // tree, so the optimistic cross-agent guard is pure friction there too — use Noop.
      const isolated = !!runtimeConfig.workingDirectory && runtimeConfig.workingDirectory.includes(WORKTREES_DIR);
      const coordinator = (isSolo || isolated) ? new NoopFileCoordinator() : fileCoordinator;
      // #13: run the agent's commands in a real VS Code terminal (PTY) so TTY-needing tools (vitest)
      // work and the user sees them; falls back to raw spawn where shell integration is unavailable.
      const rawCommandExecutor = terminalManager.executorFor(runtimeConfig.id, `Unode: ${runtimeConfig.name}`);
      // Workspace Trust gate: never execute a shell command in an untrusted workspace (checked live, so
      // granting trust mid-session takes effect immediately without restarting the agent).
      const commandExecutor: typeof rawCommandExecutor = (command, opts) =>
        vscode.workspace.isTrusted
          ? rawCommandExecutor(command, opts)
          : Promise.resolve({ code: null, output: 'Blocked: this workspace is not trusted, so shell commands are disabled. Trust the workspace (Workspace Trust) to enable them.' });
      // Live thunk so toggling unode.writeApproval applies to running agents without a restart.
      const writeApprovalAsk = () => vscode.workspace.getConfiguration('unode').get<'none' | 'ask'>('writeApproval', 'none') === 'ask';
      const memoryWriter = async (agentId: string, note: string) => {
        const ok = await sharedMemory.append(agentId, note);
        if (!ok) {
          return 'Error: shared memory is unavailable (no workspace folder open, or .unode/memory is not writable). The note was NOT saved.';
        }
        void sharedMemory.load();
        return 'Noted to shared team memory.';
      };
      // v0.5.2 Execution Engine: write→feedback diagnostics + verification obligation (each kill-switched).
      const engineCfg = vscode.workspace.getConfiguration('unode');
      const agentCwd = runtimeConfig.workingDirectory || workspaceRoot();
      // Worktree fan-out: in worktree mode, let every agent READ the team's merged work from the
      // integration worktree when a file isn't in its own tree (writes stay isolated). The path is the
      // same for isolated agents (a sibling of their worktree) and the PM (nested under its root).
      const worktreeMode = engineCfg.get<string>('concurrencyStrategy', 'optimistic') === 'worktree';
      const integrationRoot = path.join(workspaceRoot(), WORKTREES_DIR, '_integration');
      const verifyCommand = engineCfg.get<string>('verifyCommand', '').trim();
      const gateEnabled = engineCfg.get<boolean>('gate.enabled', true);
      const completionGate = canDelegate(runtimeConfig) && !worktreeMode && gateEnabled && verifyCommand
        ? {
            command: verifyCommand,
            run: runVerifyChecks,
            cfg: {
              maxSelfRetries: engineCfg.get<number>('gate.maxSelfRetries', DEFAULT_COMPLETION_GATE_CONFIG.maxSelfRetries),
              maxRedelegations: engineCfg.get<number>('gate.maxRedelegations', DEFAULT_COMPLETION_GATE_CONFIG.maxRedelegations),
            },
          }
        : undefined;
      const engine: EngineOptions = {
        diagnostics: engineCfg.get<boolean>('engine.postWriteDiagnostics', true)
          ? (paths) => collectFileDiagnostics(paths, agentCwd)
          : undefined,
        verifyObligation: engineCfg.get<boolean>('engine.verifyObligation', true),
        completionGate,
        sharedReadRoot: worktreeMode && path.resolve(integrationRoot) !== path.resolve(agentCwd) ? integrationRoot : undefined,
        isTrusted: () => vscode.workspace.isTrusted, // untrusted workspace → writes/edits/deletes refused
      };
      return new OpenAICompatBackend(runtimeConfig, undefined, team, coordinator, commandPolicy, net, mcp, undefined, approveForAgent, messageBus, commandNormalizer, commandExecutor, recordCheckpoint, writeApprovalAsk, requestWriteApproval, memoryWriter, engine);
    }
    // Claude agents use claude's NATIVE MCP: translate their granted servers into --mcp-config. Workspace
    // Trust: in an untrusted workspace, hand claude NO MCP servers (they spawn processes / reach the network).
    const mcpConfig = vscode.workspace.isTrusted
      ? buildClaudeMcpConfig(grantedServerConfigs(grants, { approvedOnly: true }))
      : undefined;
    // F1: pass resolved params so buildArgs can map reasoning_effort → --effort at spawn.
    const claudeDeps: ClaudeHeadlessBackendDeps = {
      // Command-approval gate: route this Claude agent's shell commands through Roam's CommandPolicy +
      // approval card (named for this agent) — unifies "Ask each" across Claude and OpenAI-compat agents.
      commandPermission: { policy: commandPolicy, requestApproval: approveForAgent, isTrusted: () => vscode.workspace.isTrusted },
      // Egress consent: confirm the destination host once before the claude CLI is spawned (nothing sent
      // otherwise). Claude agents reach Anthropic via the user's own `claude` CLI config (api.anthropic.com).
      onBeforeEgress: () => egressGate('https://api.anthropic.com'),
    };
    if (canDelegate(config)) {
      // PM also gets the team bridge so a Claude PM can delegate (list_agents/assign_task/…).
      claudeDeps.localMcpServerFactory = localMcpServerFactory;
      claudeDeps.teamMcpBridge = new TeamMcpBridge(makeCoordinatorTeamTools(config));
    }
    return new ClaudeHeadlessBackend(config, mcpConfig, modelParamResolver.resolve(config), claudeDeps);
  };

  // Cost estimator: built-in price table, overridden by the unode.modelPrices setting, and kept
  // current by live refreshes from gateway /api/pricing endpoints (see refreshPrices).
  const priceOverrides = vscode.workspace.getConfiguration('unode').get<Record<string, ModelPrice>>('modelPrices', {});
  pricing = new ModelPricing({ ...DEFAULT_MODEL_PRICES, ...priceOverrides });
  livePrices = new LivePriceService((url, init) => (globalThis as any).fetch(url, init));
  balanceService = new BalanceService((url, init) => (globalThis as any).fetch(url, init));
  void refreshPrices(); // refresh now…
  const priceTimer = setInterval(() => void refreshPrices(), 24 * 60 * 60 * 1000); // …and daily.
  context.subscriptions.push({ dispose: () => clearInterval(priceTimer) });

  sessionManager = new SessionManager(
    vscode.workspace.getConfiguration('unode').get('maxConcurrentAgents', 10),
    messageBus,
    {
      createBackend,
      resolveEnv,
      // Worktree fan-out (v0.6.x): isolate eligible agents in their own worktree. When NOT isolated, root
      // the agent at the CURRENT workspace folder — never a stale per-agent workingDirectory pinned at
      // creation in a different folder (that caused "outside my working folder" on the open project), and
      // never process.cwd() (the extension host's dir). This always wins over the persisted value.
      resolveWorkingDirectory: async (config) => (await worktreeCoordinator?.assignWorkingDirectory(config)) ?? workspaceRoot(),
      onTurnComplete: (agentId, isError) => {
        // Don't drop the merge promise on the floor — a rejection would otherwise surface as an
        // unhandled process-level error. mergeAgent catches internally, but be defensive. (Audit #11.)
        worktreeCoordinator?.onTurnComplete(agentId, isError)?.catch(
          (e) => outputChannel.warn(`[worktree] merge after turn failed: ${String(e)}`)
        );
      },
      loadSnapshot: (id) => persistence.loadSnapshot(id),
      saveSnapshot: (id, snap) => persistence.saveSnapshot(id, snap),
      clearSnapshot: (id) => persistence.clearSnapshot(id),
      estimateCost: (model, inTok, outTok) => pricing.estimate(model, inTok, outTok),
      premiumCostModel: DEFAULT_MODEL_TIERS.premium.roam, // top-tier baseline for the "saved $X" comparison

      resolveModelParams: (config, tierParams) => modelParamResolver.resolve(config, tierParams),
      resolveTaskModel: (config, msg) => resolveTaskModelSelection(config, msg)?.model,
      resolveTaskModelParams: (config, msg) => resolveTaskModelSelection(config, msg)?.modelParams,
      getProjectContext: () => [projectConventions.get(), rulesFile.get(), sharedMemory.block()].filter((s) => s.trim()).join('\n\n'),
      getWorkspaceContext: async (runtimeRoot?: string) => {
        try {
          // Ground to the agent's ACTUAL runtime root (a worktree path when isolated), not the global
          // workspace — otherwise an isolated worker is told the wrong folder and its shared-path use is
          // (correctly) sandbox-blocked. Falls back to the workspace root when no runtime root is known.
          const root = runtimeRoot || workspaceRoot();
          const parts: string[] = [];
          // Explicit working-directory grounding. Claude models are trained in a Linux sandbox and
          // confabulate a '/Users/dev/workspace-<id>/' working folder (a different random id each turn),
          // both in prose and as file-path prefixes. State the REAL root and that there is no such sandbox
          // so the model uses workspace-relative paths. (File ops also get re-rooted downstream, but this
          // stops the model from *reporting* a wrong folder and reduces bad path prefixes up front.)
          parts.push(
            `--- Your working directory ---\n${root}\nAll file paths are relative to this folder. You are ` +
            `NOT in a Unix sandbox such as /Users/<name>/workspace-... or /workspace/... — do not prefix ` +
            `paths with one. If asked your working folder, it is exactly the path above.`
          );
          // ALWAYS ground the model with the real file listing — this prevents a strong model (e.g. Claude)
          // from confabulating an absolute sandbox path when it only knows the root string. On by default,
          // unlike the richer diagnostics/active-file context below.
          const tree = await listWorkspaceTree(root);
          if (tree) {
            parts.push(`--- Files in your workspace (paths are relative to ${root}) ---`);
            parts.push(tree);
          }
          // Richer per-turn orientation (diagnostics + active editor file) stays opt-in via the flag.
          const cfg = vscode.workspace.getConfiguration('unode');
          if (cfg.get<boolean>('engine.workspaceContext', false)) {
            const editor = vscode.window.activeTextEditor;
            // Diagnostics FIRST: compact + high-value, so they survive the backend's total cap even when the
            // active file is large (the agent can always read_file for the full file, but lost errors hurt).
            const diags = diagnosticsSnapshot(root).items.slice(0, WORKSPACE_CONTEXT_DIAGNOSTIC_LIMIT);
            if (diags.length > 0) {
              parts.push('--- Diagnostics ---');
              for (const d of diags) {
                parts.push(`${d.file}:${d.line}:${d.col} [${d.severity}] ${d.message}`);
              }
            }
            if (editor?.document?.uri.scheme === 'file') {
              const abs = editor.document.uri.fsPath;
              const rel = path.relative(root, abs);
              if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
                parts.push(`Active file: ${rel.split(path.sep).join('/')}`);
                parts.push('--- Active editor snippet ---');
                parts.push(capWorkspaceContextFile(editor.document.getText()));
              }
            }
          }
          return parts.length > 0 ? parts.join('\n') : undefined;
        } catch (err) {
          outputChannel.warn(`Workspace context gather failed: ${String(err)}`);
          return undefined;
        }
      },
      summarizer,
      summarizerIO: (config) => ({ chatCompletion: (messages, model, params) => summarizerChatCompletion(config, messages, model, params) }),
      summarizerModel: (config) => economyModelFor(config),
    }
  );
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('unode.maxConcurrentAgents')) {
      sessionManager.setMaxConcurrent(vscode.workspace.getConfiguration('unode').get('maxConcurrentAgents', 10));
    }
    if (event.affectsConfiguration('unode.chatParticipant.enabled')) {
      syncRoamChatParticipant();
    }
    if (event.affectsConfiguration('unode.concurrencyStrategy')) {
      syncConcurrencyContext(); // keep the title-bar icon in sync when changed from Settings
      teamViewProvider?.refresh();
      void refreshDashboardPanel();
    }
    // Smart Mode on/off, role tiers, or the tier→model matrix changed → re-render the team cards so the
    // ⚡ Smart → <model> badge reflects reality immediately (Settings-panel edits AND raw settings.json edits).
    if (event.affectsConfiguration('unode.smartMode') || event.affectsConfiguration('unode.modelTiers')) {
      teamViewProvider?.refresh();
    }
    // Keep the LIVE command gate in sync with Settings-UI edits. Without this, changing
    // unode.commandApproval / unode.allowedCommands in Settings had no effect until a window reload (the
    // policy only reloaded via the approval-bar dropdown / "Allow for project") — so an emptied allowlist
    // or a switch to "ask" silently didn't take, and commands kept running ungated.
    if (event.affectsConfiguration('unode.commandApproval') || event.affectsConfiguration('unode.allowedCommands')) {
      const cfg = vscode.workspace.getConfiguration('unode');
      commandPolicy.reload(cfg.get<CommandApprovalMode>('commandApproval', 'ask'), cfg.get<string[]>('allowedCommands', []));
      outputChannel.info(`[policy] reloaded: commandApproval=${cfg.get('commandApproval', 'ask')}, allowedCommands=${(cfg.get<string[]>('allowedCommands', []) ?? []).length}`);
    }
  }));

  // F4: reload .unode/rules.md when it changes so newly (re)started agents pick up edits.
  const rulesWatcher = vscode.workspace.createFileSystemWatcher('**/.unode/rules.md');
  const reloadRules = () => {
    void rulesFile.load().then(() => outputChannel.info('Reloaded .unode/rules.md project memory.'));
  };
  rulesWatcher.onDidChange(reloadRules);
  rulesWatcher.onDidCreate(reloadRules);
  rulesWatcher.onDidDelete(reloadRules);
  context.subscriptions.push(rulesWatcher);

  const memoryWatcher = vscode.workspace.createFileSystemWatcher('**/.unode/memory/notes.md');
  const reloadMemory = () => {
    void sharedMemory.load().then(() => outputChannel.info('Reloaded .unode/memory/notes.md shared memory.'));
  };
  memoryWatcher.onDidChange(reloadMemory);
  memoryWatcher.onDidCreate(reloadMemory);
  memoryWatcher.onDidDelete(reloadMemory);
  context.subscriptions.push(memoryWatcher);

  // A1: re-detect project conventions when the root package.json changes (scripts added/renamed).
  const pkgWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
  const reloadConventions = () => { void projectConventions.load(); };
  pkgWatcher.onDidChange(reloadConventions);
  pkgWatcher.onDidCreate(reloadConventions);
  pkgWatcher.onDidDelete(reloadConventions);
  context.subscriptions.push(pkgWatcher);
  // L3 recovery: persist running workflow instances whenever they change.
  // Gate machinery (P2): tier hot-swap across agents + objective run_checks for gated workflows.
  const tierController = new TierController({
    listAgents: () =>
      sessionManager.getAll().map((s) => ({ id: s.id, role: s.config.role, providerId: s.config.provider.providerId })),
    setModel: (id, m) => sessionManager.setModel(id, m),
  });
  workflowEngine = new WorkflowEngine(
    sessionManager,
    messageBus,
    () => persistence.saveWorkflows(workflowEngine.exportState()),
    { tierController, runChecks: runVerifyChecks },
    persistence
  );

  // SettingsBridge centralizes config/secret/MCP access (powers the Settings panel + trims wiring).
  settingsBridge = new SettingsBridge(
    secrets,
    makeConfigStore(),
    providerDefs(),
    {
      registry: mcpRegistry,
      connected: (id) => mcpHub.listServers().find((s) => s.id === id),
      grantedTo: (id) => agentsGrantedServer(id),
    }
  );

  orchestrationProgress = new OrchestrationProgressTracker(resolveAgentName);

  wireEvents();

  teamViewProvider = new TeamViewProvider(
    context.extensionUri,
    sessionManager,
    messageBus,
    context.extension.packageJSON.version,
    smartModeCardPreview,
    () => checkpointStore.list()
  );
  messageLogProvider = new MessageLogProvider(messageBus, resolveAgentName);
  // TEMPORARY DIAGNOSTIC: log messages involving product-manager
  messageBus.on('message.sent', (msg: any) => {
    if (msg.to?.includes('product-manager') || msg.from?.includes('product-manager') || msg.to?.includes('0649af3b') || msg.from?.includes('0649af3b')) {
      console.log('[DIAG] message.sent involving product-manager:', JSON.stringify({ id: msg.id, from: msg.from, to: msg.to, type: msg.type, timestamp: msg.timestamp }));
    }
  });
  chatViewProvider = new ChatViewProvider(context.extensionUri, {
    listAgents: () => sessionManager.getAll().map((s) => ({
      id: s.config.id,
      name: s.config.name,
      role: s.config.role,
      icon: s.config.icon,
      backend: s.config.backend ?? defaultBackendKind(s.config),
    })),
    send: async (agentId, text, mode) => {
      // Proactive (framework-detected, not agent-reasoned): if the task references a path OUTSIDE this
      // agent's working folder, offer up front to point the agent there — before it runs and gets stuck.
      const session = sessionManager.getAll().find((s) => s.config.id === agentId);
      if (session) {
        // Use the agent's RUNTIME root (worktree/workspace resolved at start), else the current workspace.
        // Never fall back to the persisted config.workingDirectory — it can be a stale pin from an older
        // build, and a stopped agent (no runtime root yet) starts at the current workspace anyway.
        const agentRoot = session.runtimeWorkingDirectory || workspaceRoot();
        const outside = detectOutsideRootPath(text, agentRoot);
        if (outside) {
          // In-panel, clear, and honest: the agent works on the OPEN folder, so the user must open the
          // target folder themselves to change it. Don't route the turn — it can't reach files there.
          const target = await inferProjectRoot(outside);
          chatViewProvider?.postNotice(
            agentId,
            `⚠ This task points at "${outside}", which is in "${target}" — outside my working folder ` +
            `(${agentRoot}). I can only read, write, and run commands INSIDE ${agentRoot}.\n\n` +
            `Best: open that project in a NEW window so this chat stays here — ` +
            `File → New Window (Ctrl+Shift+N) → Open Folder… → "${target}", then resend your task there. ` +
            `(Opening it in THIS window instead switches the workspace; this conversation is saved per-folder and won't follow.)`
          );
          return;
        }
      }
      // C1: expand explicit @file/@folder/@problems/@url mentions before routing the turn.
      const root = workspaceRoot();
      const expanded = await expandContextMentions(text, root, {
        readFile: (p) => fs.readFile(p, 'utf8'),
        stat: (p) => fs.stat(p),
        readDir: (p) => fs.readdir(p, { withFileTypes: true }),
        diagnostics: () => diagnosticsSnapshot(root),
        fetchText: fetchMentionUrl,
      });
      // Route as a turn; routeInbound lazy-starts a stopped agent for ask.question.
      messageBus.send('user', agentId, 'ask.question', { instruction: expanded, mode }, 'normal');
    },
    interject: (agentId, text) => sessionManager.interjectAgent(agentId, text),
    interrupt: (agentId) => sessionManager.interrupt(agentId),
    onSelectAgent: () => syncSoloContext(),
    // Subscribe to ALL completions, not just those addressed to 'user': when the PM delegates to a
    // teammate, the teammate's task.complete is addressed to the PM, so a {to:'user'} filter would
    // never fire for it — leaving that agent's chat stuck on "Stop" and its reply unfinalized. We key
    // by `from` and the handler scopes each completion to that agent's own chat tab.
    onReply: (cb) =>
      messageBus.subscribe({}, (msg) => {
        if (msg.type === 'task.complete' || msg.type === 'system.error' || msg.type === 'ask.answer') {
          cb({
            from: msg.from,
            fromName: resolveAgentName(msg.from),
            text: String(msg.payload.instruction ?? ''),
            isError: msg.type === 'system.error' || !!(msg.payload.metadata as { isError?: boolean } | undefined)?.isError,
          });
        }
      }),
    state: context.workspaceState,
    getApprovals: () => {
      const cfg = vscode.workspace.getConfiguration('unode');
      return { command: cfg.get<string>('commandApproval', 'ask'), write: cfg.get<string>('writeApproval', 'none') };
    },
    setApproval: async (kind, value) => {
      const cfg = vscode.workspace.getConfiguration('unode');
      const key = kind === 'write' ? 'writeApproval' : 'commandApproval';
      await cfg.update(key, value, vscode.ConfigurationTarget.Workspace);
      if (kind === 'command') {
        commandPolicy.reload(cfg.get<CommandApprovalMode>('commandApproval', 'ask'), cfg.get<string[]>('allowedCommands', []));
      }
    },
  });
  dashboardProvider = new DashboardProvider(context.extensionUri, sessionManager, messageBus, {
    agentStates: () => orchestrationProgress.agentStates(),
    filesByAgent: dashboardFilesByAgent,
    worktreeReview: async () =>
      vscode.workspace.getConfiguration('unode').get<string>('concurrencyStrategy', 'optimistic') === 'worktree'
        ? gatherWorktreeReview()
        : undefined,
    recentTaskCount: () => context.globalState.get<number>('roam.dashboard.recentTaskCount', 5),
    concurrencyMode: () => vscode.workspace.getConfiguration('unode').get<string>('concurrencyStrategy', 'optimistic'),
  });
  // Live-refresh the open dashboard when a task's token usage is recorded, so "Latest tasks" stays current.
  sessionManager.on('session.taskTokens', () => { void refreshDashboardPanel(); });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('unode.teamPanel', teamViewProvider),
    vscode.window.registerWebviewViewProvider('unode.messageLog', messageLogProvider),
    vscode.window.registerWebviewViewProvider('unode.activityPanel', messageLogProvider),
    vscode.window.registerWebviewViewProvider('unode.chat', chatViewProvider),
    chatViewProvider,
    outputChannel
  );

  // @unode Chat-panel participant — ADDITIVE (the sidebar views above are untouched; both run at once).
  // The handler routes the goal to the crew's PM (or first agent) on UnodeAi's OWN backend, streaming
  // the run into the chat panel. Toggle live via unode.chatParticipant.enabled.
  const runCrewGoal = async (
    prompt: string,
    onText: (md: string) => void,
    token: vscode.CancellationToken
  ): Promise<{ ok: boolean; agentName?: string; error?: string }> => {
    const agents = sessionManager.getAll();
    const target = agents.find((s) => canDelegate(s.config)) ?? agents[0];
    if (!target) {
      return { ok: false, error: 'No agents yet. Open the UnodeAi sidebar and run "Create Default Team", then try @unode again.' };
    }
    const agentId = target.config.id;
    const agentName = target.config.name;
    let anyDelta = false;
    const onStream = (e: TypedSessionEvent<'session.stream'>) => {
      if (e.sessionId === agentId && e.data?.delta) { anyDelta = true; onText(e.data.delta); }
    };
    sessionManager.on('session.stream', onStream);
    try {
      const result = await new Promise<{ ok: boolean; error?: string; finalText?: string }>((resolve) => {
        const off = messageBus.subscribe({}, (msg) => {
          if (msg.from !== agentId) { return; }
          if (msg.type === 'task.complete') { off(); resolve({ ok: true, finalText: String(msg.payload.instruction ?? '') }); }
          else if (msg.type === 'system.error') { off(); resolve({ ok: false, error: String(msg.payload.instruction ?? 'the crew reported an error') }); }
        });
        token.onCancellationRequested(() => { off(); sessionManager.interrupt(agentId); resolve({ ok: false, error: 'Cancelled.' }); });
        // Route the goal as a turn (routeInbound lazy-starts a stopped agent for ask.question).
        messageBus.send('user', agentId, 'ask.question', { instruction: prompt, mode: 'act' }, 'normal');
      });
      // If the backend didn't stream deltas (non-streaming model), surface the final text once.
      if (result.ok && !anyDelta && result.finalText) { onText(result.finalText); }
      return { ok: result.ok, agentName, error: result.error };
    } finally {
      sessionManager.off('session.stream', onStream);
    }
  };
  let unodeChatParticipant: vscode.Disposable | undefined;
  const syncRoamChatParticipant = () => {
    const enabled = vscode.workspace.getConfiguration('unode').get<boolean>('chatParticipant.enabled', true);
    if (enabled && !unodeChatParticipant) {
      try {
        unodeChatParticipant = registerUnodeChatParticipant(context.extensionUri, { runGoal: runCrewGoal });
        context.subscriptions.push(unodeChatParticipant);
      } catch (err) {
        outputChannel.warn(`[chat] @unode participant registration failed: ${String(err)}`);
      }
    } else if (!enabled && unodeChatParticipant) {
      unodeChatParticipant.dispose();
      unodeChatParticipant = undefined;
    }
  };
  syncRoamChatParticipant();

  // Always-visible anchor: shows the build version no matter which sidebar sections are collapsed
  // (a collapsed Team section folds away its title-bar version), and one click reopens the Unode sidebar.
  unodeVersion = String(context.extension.packageJSON.version ?? '');
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = `$(organization) Unode v${unodeVersion}`;
  statusBarItem.command = 'unode.showTeamPanel';
  statusBarItem.tooltip = 'UnodeAi — show the Team panel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Restore persisted state (P1#4/#5): approved MCP servers, message history, then roster.
  for (const id of persistence.loadApprovedMcpServers()) {
    approvedMcp.add(id);
  }
  messageBus.importMessages(persistence.loadMessages());

  registerCommands(context);
  void vscode.commands.executeCommand('setContext', 'unode.teamCompact', false);
  syncConcurrencyContext(); // pick the right concurrency icon for the Team title bar
  await migrateToProviderSplit(context); // 0.9.0: Roam→weroam default; existing roam agents+key kept on Unode
  await correctStaleRoamBaseUrl(); // every launch (idempotent): heal a stale persisted unode.baseUrl=unode
  await restoreRoster();
  syncSoloContext(); // solid ⚡ only while the current chat target is Solo
  // L3: resume any workflows that were mid-flight before the reload (agents now exist).
  workflowEngine.restore(persistence.loadWorkflows());
  updateStatusBar();

  if (sessionManager.getAll().length === 0) {
    const onboardingTimer = setTimeout(() => void vscode.commands.executeCommand('unode.onboarding'), 1000);
    context.subscriptions.push({ dispose: () => clearTimeout(onboardingTimer) });
  }

  outputChannel.info('UnodeAi activated');
}

export function deactivate() {
  outputChannel?.info('UnodeAi deactivating, stopping all agents...');
  if (messageSaveTimer) {
    clearTimeout(messageSaveTimer);
    persistence?.saveMessages(messageBus.exportMessages());
  }
  if (checkpointSaveTimer) {
    clearTimeout(checkpointSaveTimer);
    persistence?.saveCheckpoints(checkpointStore.serialize());
  }
  sessionManager?.dispose();
  messageBus?.dispose();
  terminalManager.disposeAll();
  void mcpHub?.stopAll();
}

// ─── Backend env (joins config with SecretStorage) ────────────────────

async function resolveEnv(config: AgentConfig): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...config.env };
  const secretName = config.provider.apiKeySecretName;
  const key = await secrets.get(secretName);
  if (key) {
    env[secretName] = key;
  }
  env.ROAM_AGENT_ID = config.id;
  env.ROAM_AGENT_ROLE = config.role;

  // For a claude agent that hosts MCP servers, inject the secrets those servers reference via
  // ${VAR} so claude can expand them when it spawns the servers (no secrets written to disk).
  const kind = config.backend ?? defaultBackendKind(config);
  if (kind === 'claude') {
    const grants = agentMcpGrants(config, skillResolver);
    for (const cfg of grantedServerConfigs(grants, { approvedOnly: true })) {
      for (const varName of secretVarsInServer(cfg)) {
        if (env[varName]) {
          continue;
        }
        const secretVal = await secrets.get(varName);
        if (secretVal) {
          env[varName] = secretVal;
        }
      }
    }
  }
  return env;
}

function withOpenAICompatBaseUrl(config: AgentConfig): AgentConfig {
  const pinned = config.provider.providerId === 'roam' || config.provider.providerId === 'unode';
  const providerDefault = pinned ? undefined : DEFAULT_PROVIDER_CONFIGS[config.provider.providerId]?.baseUrl;
  const baseUrl = resolveOpenAICompatBaseUrl(
    config.provider.providerId,
    config.baseUrl ?? providerDefault,
    undefined,
    getConfiguredRoamBaseUrl(),
    getConfiguredUnodeBaseUrl()
  );
  return baseUrl === config.baseUrl?.replace(/\/$/, '') ? config : { ...config, baseUrl };
}

/** Read the current Smart Mode config from settings (F3). */
function readSmartMode(): SmartModeConfig {
  const cfg = vscode.workspace.getConfiguration('unode');
  return {
    enabled: cfg.get<boolean>('smartMode.enabled', false),
    defaultTier: cfg.get<ModelTier>('smartMode.defaultTier', 'standard'),
    roleTiers: cfg.get<Record<string, ModelTier>>('smartMode.roleTiers', {}),
    taskTierHints: cfg.get<Record<string, ModelTier>>('smartMode.taskTierHints', {}),
  };
}

interface TaskModelSelection {
  model?: string;
  modelParams?: AgentModelParams;
}

/** Smart Mode (F3): pick the model and optional tier params for this task.
 *  Reuses the existing tier tables (DEFAULT_MODEL_TIERS + unode.modelTiers override). */
function resolveTaskModelSelection(config: AgentConfig, msg: Message): TaskModelSelection | undefined {
  if ((config.backend ?? defaultBackendKind(config)) !== 'openai-compat') {
    return undefined;
  }
  const sm = readSmartMode();
  if (!sm.enabled) {
    return undefined;
  }
  const roleDefault: ModelTier =
    config.tier ?? sm.roleTiers?.[config.role] ?? ROLE_TEMPLATES[config.role]?.tier ?? sm.defaultTier;
  const tier = selectTier(msg, sm, roleDefault);
  const tiers = resolveModelTiers(
    vscode.workspace.getConfiguration('unode').get<Partial<Record<ModelTier, Record<string, string>>>>('modelTiers', {})
  );
  const rawTierParams = vscode.workspace
    .getConfiguration('unode')
    .get<Partial<Record<ModelTier, AgentModelParams>>>('modelTierParams', {});
  const modelParams = sanitizeParams(rawTierParams[tier]);
  const providerModel = tiers[tier]?.[config.provider.providerId];
  if (!providerModel) {
    // No model is defined for THIS agent's provider at this tier. Do NOT fall back to another provider's id
    // (it would 400 here — exactly what the Settings tier matrix warns about). Skip the swap entirely so the
    // agent runs its own configured model. Fill the provider's column in the tier matrix to enable Smart Mode.
    return undefined;
  }
  return {
    model: providerModel,
    modelParams: Object.keys(modelParams).length > 0 ? modelParams : undefined,
  };
}

function economyModelFor(config: AgentConfig): string {
  const tiers = resolveModelTiers(
    vscode.workspace.getConfiguration('unode').get<Partial<Record<ModelTier, Record<string, string>>>>('modelTiers', {})
  );
  // Exact economy model for THIS provider, else the agent's own configured model (always valid for its
  // provider). Never fall back to another provider's id — that would 400 (e.g. during summarization).
  return tiers.economy?.[config.provider.providerId] ?? config.model;
}

/** Team-card Smart Mode preview: the tier + the model an agent will ACTUALLY run on (its provider's exact
 *  tier model), or undefined when Smart Mode is off. `model` undefined = no tier model for this provider →
 *  the agent keeps its configured model (mirrors resolveTaskModelSelection's no-cross-provider-swap rule). */
function smartModeCardPreview(
  config: { role: string; tier?: string; provider: { providerId: string } }
): { tier: ModelTier; model?: string } | undefined {
  const sm = readSmartMode();
  if (!sm.enabled) {
    return undefined;
  }
  const tier: ModelTier =
    (config.tier as ModelTier | undefined) ?? sm.roleTiers?.[config.role] ?? ROLE_TEMPLATES[config.role]?.tier ?? sm.defaultTier;
  const tiers = resolveModelTiers(
    vscode.workspace.getConfiguration('unode').get<Partial<Record<ModelTier, Record<string, string>>>>('modelTiers', {})
  );
  return { tier, model: tiers[tier]?.[config.provider.providerId] };
}

async function summarizerChatCompletion(
  config: AgentConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  model: string,
  params?: AgentModelParams
): Promise<string> {
  const env = await resolveEnv(config);
  const apiKey = env[config.provider.apiKeySecretName] ?? '';
  if (!apiKey) {
    throw new Error(`No API key for ${config.provider.apiKeySecretName}.`);
  }

  const body: Record<string, unknown> = { model, messages, stream: false };
  if (params?.temperature !== undefined) {
    body.temperature = params.temperature;
  }
  if (params?.max_tokens !== undefined) {
    body.max_tokens = params.max_tokens;
  }

  const summarizerUrl = `${openAIBaseUrlFor(config, env)}/chat/completions`;
  await egressGate(summarizerUrl); // egress consent — no content sent until the host is approved
  const res = await (globalThis as any).fetch(summarizerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while summarizing history: ${String(text).slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  return String(data.choices?.[0]?.message?.content ?? '');
}

function openAIBaseUrlFor(config: AgentConfig, env: NodeJS.ProcessEnv): string {
  const pinned = config.provider.providerId === 'roam' || config.provider.providerId === 'unode';
  const providerDefault = pinned ? undefined : DEFAULT_PROVIDER_CONFIGS[config.provider.providerId]?.baseUrl;
  return resolveOpenAICompatBaseUrl(
    config.provider.providerId,
    config.baseUrl ?? providerDefault,
    env.OPENAI_BASE_URL,
    getConfiguredRoamBaseUrl(),
    getConfiguredUnodeBaseUrl()
  );
}

function getConfiguredRoamBaseUrl(): string {
  // Blank, or a stale persisted unode/OpenAI value, must NOT win — canonicalRoamBaseUrl collapses those to
  // the weroam gateway so Roam agents (and the Roam pricing fetch) never land on Unode/OpenAI.
  return canonicalRoamBaseUrl(vscode.workspace.getConfiguration('unode').get<string>('baseUrl', DEFAULT_PROVIDER_CONFIGS.roam.baseUrl));
}

/** The configured Unode base URL (unode.unodeBaseUrl), used by unode agents/runtime/pricing. */
function getConfiguredUnodeBaseUrl(): string {
  const configured = vscode.workspace.getConfiguration('unode').get<string>('unodeBaseUrl', UNODE_DEFAULT_BASE_URL);
  return configured && configured.trim() ? configured.trim() : UNODE_DEFAULT_BASE_URL;
}

/** Build the run_command gatekeeper from settings. Default-deny: execution is off unless the
 *  user picks a mode and (for allowlist) lists trusted command prefixes. */
function makeCommandPolicy(): CommandPolicy {
  const cfg = vscode.workspace.getConfiguration('unode');
  const mode = cfg.get<CommandApprovalMode>('commandApproval', 'ask');
  const allowlist = cfg.get<string[]>('allowedCommands', []);
  return new CommandPolicy(mode, allowlist);
}

/**
 * v0.2.8 'ask' mode: prompt the user before an agent runs a not-yet-allowlisted command, modeled on
 * Claude Code's Yes / Yes-for-this-project / No. "Always allow" appends the command's TEMPLATE
 * (e.g. "git status", not bare "git") to unode.allowedCommands and reloads the live policy, so future
 * matching commands run without a prompt — without green-lighting dangerous siblings.
 */
/**
 * #4b: after a team is created, prompt the user to set team rules (governance the whole crew follows,
 * e.g. "developers must have the architect review their work"). Only nags when no rules exist yet, so
 * re-creating a team with existing rules is quiet. Modal so it's a deliberate choice, but skippable.
 */
async function maybePromptTeamRules(): Promise<void> {
  await rulesFile.load();
  if (rulesFile.get().trim()) {
    return; // rules already set — don't nag
  }
  const SET = 'Set Rules';
  const SKIP = 'Skip for now';
  const choice = await vscode.window.showInformationMessage(
    'Set your team\'s rules? They govern how your agents work together — e.g. "Developers must have the architect review their work before it\'s done." You can edit them anytime via the Rules button on the Team panel.',
    { modal: true },
    SET,
    SKIP
  );
  if (choice === SET) {
    await vscode.commands.executeCommand('unode.editTeamRules');
  }
}

// Command templates the user approved for THIS session only (in-memory, not persisted).
const sessionApprovedCommands = new Set<string>();

async function requestCommandApproval(command: string, agentName = 'An agent'): Promise<CommandApprovalDecision> {
  const template = CommandPolicy.commandTemplate(command);
  // Already approved for this session → run without prompting again.
  if (template && sessionApprovedCommands.has(template)) {
    return { allow: true };
  }
  // Prefer the in-panel approval card; fall back to a native modal if the chat webview isn't available.
  const { action, note } = chatViewProvider?.canPromptApproval()
    ? await chatViewProvider.requestApproval({ kind: 'command', agentName, command, template })
    : await nativeCommandApprovalChoice(command, template);
  return applyCommandApproval(action, note, template);
}

/** Apply a command-approval action (from the panel card or the native modal) + its side effects. */
async function applyCommandApproval(action: string, note: string | undefined, template?: string): Promise<CommandApprovalDecision> {
  if (action === 'once') {
    return { allow: true };
  }
  if (action === 'session') {
    if (template) { sessionApprovedCommands.add(template); }
    return { allow: true };
  }
  if (action === 'project') {
    const cfg = vscode.workspace.getConfiguration('unode');
    const list = cfg.get<string[]>('allowedCommands', []);
    if (template && !list.map((p) => p.toLowerCase()).includes(template)) {
      await cfg.update('allowedCommands', [...list, template], vscode.ConfigurationTarget.Workspace);
    }
    commandPolicy.reload(
      cfg.get<CommandApprovalMode>('commandApproval', 'ask'),
      cfg.get<string[]>('allowedCommands', [])
    );
    return { allow: true };
  }
  // 'deny' or anything unexpected → deny (optionally with a note for the agent).
  return { allow: false, note: note?.trim() || undefined };
}

/** Native-modal fallback for command approval. Returns the same {action, note} shape as the panel card. */
async function nativeCommandApprovalChoice(command: string, template?: string): Promise<{ action: string; note?: string }> {
  const ONCE = 'Allow once';
  const SESSION = 'Allow this session';
  const PROJECT = template ? `Allow for project ("${template}")` : 'Allow for project';
  const DENY_NOTE = 'Deny with note…';
  const choice = await vscode.window.showWarningMessage(
    `An agent wants to run a command:\n\n${command}`,
    { modal: true },
    ONCE,
    SESSION,
    PROJECT,
    DENY_NOTE
  );
  if (choice === ONCE) { return { action: 'once' }; }
  if (choice === SESSION) { return { action: 'session' }; }
  if (choice === PROJECT) { return { action: 'project' }; }
  if (choice === DENY_NOTE) {
    const note = await vscode.window.showInputBox({
      title: 'Deny command — note to the agent (optional)',
      prompt: 'Tell the agent why, or what to do instead. Leave empty to just deny.',
      placeHolder: 'e.g. don\'t use rm; clean the build with "npm run clean" instead',
      ignoreFocusOut: true,
    });
    return { action: 'deny', note: note?.trim() || undefined };
  }
  return { action: 'deny' };
}

// V2: session latch for "Approve all writes" — once set, stop prompting for this VS Code session.
let writeApprovedAll = false;

/** V2: preview a pending file write (diff) and let the user approve once / approve all / deny. */
async function requestWriteApproval(req: { path: string; before: string | null; after: string }): Promise<'once' | 'always' | 'deny'> {
  if (writeApprovedAll) {
    return 'once';
  }
  const { text } = createUnifiedDiff(req.before ?? '', req.after, req.path);
  const MAX_PREVIEW = 1500;
  const preview = text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}\n…(diff truncated)` : text;
  const verb = req.before === null ? 'create' : 'overwrite';

  // Prefer the in-panel approval card; fall back to a native modal if the chat webview isn't available.
  let action: string;
  if (chatViewProvider?.canPromptApproval()) {
    action = (await chatViewProvider.requestApproval({ kind: 'write', agentName: 'An agent', path: req.path, verb, diff: preview })).action;
  } else {
    const APPROVE = 'Approve';
    const ALL = 'Approve all (session)';
    const choice = await vscode.window.showWarningMessage(
      `An agent wants to ${verb} ${req.path}:\n\n${preview}`,
      { modal: true },
      APPROVE,
      ALL
    );
    action = choice === ALL ? 'always' : choice === APPROVE ? 'once' : 'deny';
  }

  if (action === 'always') {
    writeApprovedAll = true;
    return 'always';
  }
  return action === 'once' ? 'once' : 'deny';
}

/** Drive `unode.soloActive` so the Team toolbar shows the solid ⚡ only while Solo is selected. */
function syncSoloContext(): void {
  const selectedIsSolo = isSoloSelected();
  void vscode.commands.executeCommand('setContext', 'unode.soloActive', selectedIsSolo);
  teamViewProvider?.refresh();
}

function isSoloSelected(): boolean {
  const agents = sessionManager?.getAll() ?? [];
  const selected = chatViewProvider?.getSelectedAgentId();
  return selected
    ? agents.some((s) => s.id === selected && s.config.role === 'solo')
    : agents.length === 1 && agents[0]?.config.role === 'solo';
}

/** Walk up from a path to the nearest folder with a package.json/.git (the likely project root). */
async function inferProjectRoot(p: string): Promise<string> {
  const start = path.extname(p) ? path.dirname(p) : p;
  let dir = start;
  for (let i = 0; i < 8; i++) {
    for (const marker of ['package.json', '.git']) {
      try { await fs.access(path.join(dir, marker)); return dir; } catch { /* keep walking up */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }
  return start;
}

/**
 * Build the SHARED file-concurrency coordinator. In `worktree` mode, isolated agents get their own
 * tree (handled by the WorktreeCoordinator + a per-agent Noop in createBackend); the shared coordinator
 * still guards any agents left on the shared root (the PM, or fallback when git/clean checks fail).
 * Optimistic CAS is the right shared guard in both modes.
 */
function makeFileCoordinator(): FileCoordinator {
  return new OptimisticFileCoordinator();
}

/** Worktree fan-out (v0.6.x): wire the per-agent worktree + merge-back coordinator from config. */
/** One-time toast when worktree mode is on but the workspace isn't a git repo (so isolation silently can't
 *  engage and Roam uses the shared workspace). Offers a one-click switch to Optimistic. */
let worktreeGitWarningShown = false;
async function warnWorktreeNeedsGit(): Promise<void> {
  if (worktreeGitWarningShown) {
    return;
  }
  worktreeGitWarningShown = true;
  const OPTIMISTIC = 'Switch to Optimistic';
  const INIT = 'Initialize Git';
  const choice = await vscode.window.showWarningMessage(
    'UnodeAi: Worktree mode needs a git repository, but this workspace isn’t one — agents are sharing the ' +
      'workspace (no per-agent isolation). Switch to Optimistic mode, or initialize a git repo to enable isolation.',
    OPTIMISTIC,
    INIT
  );
  if (choice === OPTIMISTIC) {
    await vscode.workspace.getConfiguration('unode').update('concurrencyStrategy', 'optimistic', vscode.ConfigurationTarget.Workspace);
    void vscode.window.showInformationMessage('UnodeAi: switched to Optimistic concurrency (shared workspace). It applies to each agent’s next turn.');
  } else if (choice === INIT) {
    await initGitRepoForWorktree();
  }
}

/** Sync the `unode.worktreeMode` context key so the Team title bar shows the right concurrency icon. */
function syncConcurrencyContext(): void {
  const worktree = vscode.workspace.getConfiguration('unode').get<string>('concurrencyStrategy', 'optimistic') === 'worktree';
  void vscode.commands.executeCommand('setContext', 'unode.worktreeMode', worktree);
}

/** Cheap "is the workspace a git repo" check (no WorktreeManager instance needed) for the mode toggle. */
function isWorkspaceGitRepo(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = cpSpawn('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspaceRoot(), shell: process.platform === 'win32' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

/** One-click `git init` + a safe .gitignore for the workspace, so worktree mode can engage. Deliberately
 *  does NOT auto-commit — the user reviews what to stage (avoids committing secrets/large files). */
async function initGitRepoForWorktree(): Promise<void> {
  const root = workspaceRoot();
  const runGit = (args: string[]) => new Promise<void>((resolve, reject) => {
    const p = cpSpawn('git', args, { cwd: root, shell: process.platform === 'win32' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} exited ${code}`))));
  });
  try {
    const gi = path.join(root, '.gitignore');
    try { await fs.access(gi); } catch { await fs.writeFile(gi, 'node_modules/\n.unode/\n.env\n*.log\n', 'utf8'); }
    await runGit(['init']);
    void vscode.window.showInformationMessage(
      `UnodeAi: initialized a git repo at ${root} and added a .gitignore. Review the changes, then commit ` +
        `(git add -A && git commit -m "init") — worktree isolation engages once the tree has a commit.`
    );
  } catch (e) {
    void vscode.window.showWarningMessage(
      `UnodeAi: couldn't run git init (${e instanceof Error ? e.message : String(e)}). Make sure git is installed, then run 'git init' + commit in a terminal.`
    );
  }
}

function makeWorktreeCoordinator(): WorktreeCoordinator {
  const root = workspaceRoot();
  const cfg = () => vscode.workspace.getConfiguration('unode');
  return new WorktreeCoordinator({
    manager: new WorktreeManager(root),
    orchestrator: new GitMergeOrchestrator(root),
    isEnabled: () => cfg().get<string>('concurrencyStrategy', 'optimistic') === 'worktree',
    autoMerge: () => cfg().get<boolean>('worktree.autoMerge', false),
    maxParallel: () => cfg().get<number>('worktree.maxParallel', 4),
    // The delegating PM and solo agents stay on the live shared tree (the PM must see real state to
    // coordinate; solo has no teammates to isolate from).
    isEligible: (config) => !canDelegate(config) && config.role !== 'solo',
    log: (m) => outputChannel.info(`[worktree] ${m}`),
    onNonGitRepo: () => void warnWorktreeNeedsGit(),
    notifyAgent: (agentId, message) =>
      messageBus.send('user', agentId, 'ask.question', { instruction: message, mode: 'act' }, 'normal'),
    // v0.7.0 verifier-as-gate: run the project's verify command in the worker's worktree before merge.
    // Returns 'skipped' (→ no gating) when worktree mode or the gate is off, or no verifyCommand is set.
    verify: (cwd) => {
      const c = cfg();
      const gateOn = c.get<string>('concurrencyStrategy', 'optimistic') === 'worktree'
        && c.get<boolean>('worktree.verifyBeforeMerge', true);
      if (!gateOn) {
        return Promise.resolve({ status: 'skipped' as const, command: '', output: 'Verify gate disabled.' });
      }
      return new Verifier({
        command: () => c.get<string>('verifyCommand', ''),
        run: verifyCommandRunner,
        commandPolicy,
      }).verify(cwd);
    },
    // v0.7.0 anti-cheat: surface a passing lane that also edited the tests (review-board flag).
    changedFiles: (wt) => changedFilesInWorktree(wt.path),
  });
}

/** Spawn the verify command in a worktree and capture exit code + combined output (sanitized env).
 *  Has a HARD timeout: the gate is serialized with merges/finalize, so a watch-mode or input-waiting
 *  verify command must never hang the chain — on timeout we kill it and report failure (exit non-zero),
 *  which blocks the (unverifiable) merge and tells the agent. Timeout via unode.worktree.verifyTimeoutSeconds. */
const verifyCommandRunner = (command: string, cwd: string): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve) => {
    // Workspace Trust gate: the verify command is a shell command, so it must not run in an untrusted workspace.
    if (!vscode.workspace.isTrusted) {
      resolve({ code: null, output: 'Verification skipped: this workspace is not trusted, so the verify command was not run. Trust the workspace (Workspace Trust) to enable it.' });
      return;
    }
    const seconds = Math.max(10, vscode.workspace.getConfiguration('unode').get<number>('worktree.verifyTimeoutSeconds', 300));
    const proc = cpSpawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: sanitizedCommandEnv() });
    let output = '';
    let settled = false;
    const done = (r: { code: number | null; output: string }) => { if (settled) { return; } settled = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      killProcessTree(proc); // Windows: kill the whole tree, not just cmd.exe (audit N2)
      done({ code: null, output: `${output}\n[verify timed out after ${seconds}s — ensure unode.verifyCommand exits (e.g. not a watch mode) and doesn't wait for input]` });
    }, seconds * 1000);
    proc.stdout?.on('data', (d) => (output += d.toString()));
    proc.stderr?.on('data', (d) => (output += d.toString()));
    proc.on('close', (code) => done({ code, output }));
    proc.on('error', (err) => done({ code: 1, output: `Failed to run verify command: ${err.message}` }));
  });

/**
 * After a finalize advances the base ref (via update-ref, which doesn't touch the work tree), bring
 * the user's checkout up to it — but only when the tree is clean, so we never clobber their edits.
 */
/** Run git in a given directory. Best-effort: resolves with code/stdout, never throws. */
function runGitIn(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const p = cpSpawn('git', args, { cwd });
    let stdout = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.on('close', (code) => resolve({ code: code ?? -1, stdout }));
    p.on('error', () => resolve({ code: -1, stdout: '' }));
  });
}

/** Run git in the workspace root. Best-effort: resolves with code/stdout, never throws. */
function runGitInRoot(args: string[]): Promise<{ code: number; stdout: string }> {
  return runGitIn(workspaceRoot(), args);
}

/** v0.7.0 anti-cheat: files a worktree's branch changed vs the base branch (for test-tamper flagging). */
async function changedFilesInWorktree(worktreePath: string): Promise<string[]> {
  const base = (await runGitInRoot(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || 'HEAD';
  const r = await runGitIn(worktreePath, ['diff', '--name-only', `${base}...HEAD`]);
  return r.code === 0 ? r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
}

/** Unified diff of a lane's worktree vs the base branch (optionally scoped to one file), for the
 *  review panel's "View diff" / per-file links. Empty string when there's nothing to show. */
async function laneDiff(worktreePath: string, file?: string): Promise<string> {
  const base = (await runGitInRoot(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || 'HEAD';
  const args = ['diff', `${base}...HEAD`];
  if (file) { args.push('--', file); }
  const r = await runGitIn(worktreePath, args);
  return r.code === 0 ? r.stdout : '';
}

/** Re-render the open worktree review panel (if any) from a fresh snapshot. Wired to the
 *  coordinator's onChange so lane verify-state changes refresh the board live. Best-effort. */
async function refreshWorktreePanel(): Promise<void> {
  if (!WorktreePanel.current) { return; }
  try {
    WorktreePanel.current.update(await gatherWorktreeReview());
  } catch (err) {
    outputChannel.warn(`[worktree] panel refresh failed: ${String(err)}`);
  }
}

/** Snapshot of the crew's worktree/integration state for the review panel. */
async function gatherWorktreeReview(): Promise<WorktreeReview> {
  const base = (await runGitInRoot(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || 'HEAD';
  const integrationBranch = 'unode/integration';
  const lanes: WorktreeReview['lanes'] = [];
  for (const wt of worktreeCoordinator?.active() ?? []) {
    const v = wt.agentId ? worktreeCoordinator?.verification(wt.agentId) : undefined;
    const agentId = wt.agentId ?? wt.branch;
    lanes.push({
      agentId,
      agent: wt.agentId ? (sessionManager.get(wt.agentId)?.config.name ?? wt.agentId) : wt.branch,
      branch: wt.branch,
      path: wt.path,
      // v0.7.0 verifier-as-gate: per-lane status for the review board (✓ verified / ✗ failing / ⚠ unverified),
      // plus any test files a passing change also touched (anti-cheat flag).
      verification: v ? { status: v.status, command: v.command, output: v.output, touchedTests: v.touchedTests } : undefined,
      // 0.8.x review board (A2): the files this lane changed vs base, so the panel can show them
      // per-agent and open a diff. Best-effort — a failure to diff just yields an empty list.
      changedFiles: await changedFilesInWorktree(wt.path),
    });
  }
  const hasIntegration =
    (await runGitInRoot(['show-ref', '--verify', '--quiet', `refs/heads/${integrationBranch}`])).code === 0;
  let integrationFiles: string[] = [];
  if (hasIntegration) {
    const diff = await runGitInRoot(['diff', '--name-only', `${base}...${integrationBranch}`]);
    if (diff.code === 0) {
      integrationFiles = diff.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return { base, integrationBranch, hasIntegration, lanes, integrationFiles };
}

function dashboardFilesByAgent(): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const cp of checkpointStore.list()) {
    const files = grouped.get(cp.agentId) ?? [];
    if (!files.includes(cp.path)) {
      files.push(cp.path);
    }
    grouped.set(cp.agentId, files);
  }
  return grouped;
}

/** A coordinator (PM) agent gets delegation tools; others don't. */
function canDelegate(config: AgentConfig): boolean {
  return config.role === 'pm' || (config.allowedTools?.includes('delegate') ?? false);
}

function makeCoordinatorTeamTools(config: AgentConfig): TeamTools {
  return new TeamTools(config.id, makeTeamView(), messageBus, {
    verifyCommand: vscode.workspace.getConfiguration('unode').get<string>('verifyCommand', ''),
    cwd: config.workingDirectory || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
    commandPolicy,
    onCommandBlocked: notifyCommandBlocked,
    // Same 'ask'-mode approver run_command uses, so run_checks can prompt instead of dead-ending (the PM
    // deadlock: run_checks blocked "awaiting approval" while run_command is delegate-gated).
    requestApproval: (command) => requestCommandApproval(command, config.name),
    // Router v1: log why each delegation went to a specific teammate (explainable/reproducible routing).
    onRoute: (line) => outputChannel.info(`[route] ${config.id}: ${line}`),
    claims: taskClaims,
    // L3: a teammate that returns nothing twice gets escalated to its fallback model for one more try.
    escalate: (agentId) => sessionManager.escalateToFallback(agentId),
  });
}

function createSharedLocalMcpServerFactory(): () => LocalMcpServer {
  let shared = createLocalMcpServer();
  let refs = 0;
  return () => ({
    get port() {
      return shared.port;
    },
    get token() {
      return shared.token;
    },
    addLocalTool(tool) {
      shared.addLocalTool(tool);
    },
    async start(bridge) {
      if (refs === 0) {
        await shared.start(bridge);
      }
      refs++;
    },
    async stop() {
      if (refs > 0) {
        refs--;
      }
      if (refs === 0) {
        await shared.stop();
        shared = createLocalMcpServer();
      }
    },
  });
}

/** The workspace root (the ${WORKDIR} placeholder for MCP server args). */
function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

// ─── V1 Checkpoints: record file writes + one-click restore ──────────────────

/** Sink injected into each agent's WorkspaceTools — records a restore point per successful write. */
function recordCheckpoint(entry: { agentId: string; path: string; before: string | null; after: string }): void {
  checkpointStore.record({ ...entry, agentName: resolveAgentName(entry.agentId) });
  if (checkpointSaveTimer) { clearTimeout(checkpointSaveTimer); }
  checkpointSaveTimer = setTimeout(() => persistence.saveCheckpoints(checkpointStore.serialize()), 1500);
}

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) { return `${secs}s ago`; }
  const mins = Math.round(secs / 60);
  if (mins < 60) { return `${mins}m ago`; }
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : new Date(ts).toLocaleString();
}

/** Open a read-only unified diff for a recorded checkpoint (from a team-card "changed files" link). */
async function showCheckpointDiffCommand(checkpointId: unknown): Promise<void> {
  const id = typeof checkpointId === 'number' ? checkpointId : Number(checkpointId);
  if (!Number.isFinite(id)) {
    vscode.window.showInformationMessage('Could not open checkpoint diff: missing checkpoint id.');
    return;
  }
  const cp = checkpointStore.get(id);
  if (!cp) {
    vscode.window.showInformationMessage(`Could not find checkpoint #${id}.`);
    return;
  }
  if (cp.truncated) {
    vscode.window.showInformationMessage(`Checkpoint diff for ${cp.path} is unavailable because the file content was truncated.`);
    return;
  }
  const { text, truncated } = createUnifiedDiff(cp.before ?? '', cp.after, cp.path);
  const doc = await vscode.workspace.openTextDocument({ content: text, language: 'diff' });
  await vscode.window.showTextDocument(doc, { preview: true });
  if (truncated) {
    vscode.window.showInformationMessage(`Diff for ${cp.path} was truncated for display.`);
  }
}

/** Pick a restore point and revert that file to its pre-edit content (or delete it if it was new). */
async function restoreCheckpointCommand(): Promise<void> {
  const items = checkpointStore.restorable();
  if (items.length === 0) {
    vscode.window.showInformationMessage('No restore points yet — UnodeAi creates one each time an agent edits a file.');
    return;
  }
  const picks = items.map((c) => ({
    label: `$(history) ${c.path}`,
    description: `${c.agentName} · ${timeAgo(c.ts)}`,
    detail: c.before === null
      ? 'Restoring deletes this file (it did not exist before this edit).'
      : `Restore to the version before this edit (${c.before.length} bytes).`,
    cp: c,
  }));
  const chosen = await vscode.window.showQuickPick(picks, {
    placeHolder: 'Restore a file to a previous version',
    matchOnDescription: true,
  });
  if (!chosen) { return; }
  const c = chosen.cp;
  const confirm = await vscode.window.showWarningMessage(
    c.before === null
      ? `Delete ${c.path}? It didn't exist before ${c.agentName}'s edit.`
      : `Restore ${c.path} to the version before ${c.agentName}'s edit? The current contents will be overwritten.`,
    { modal: true },
    'Restore'
  );
  if (confirm !== 'Restore') { return; }
  try {
    const abs = path.join(workspaceRoot(), c.path);
    if (c.before === null) {
      await fs.rm(abs, { force: true });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, c.before, 'utf8');
    }
    vscode.window.showInformationMessage(`Restored ${c.path}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Could not restore ${c.path}: ${String(err)}`);
  }
}

function diagnosticsSnapshot(root: string): { items: DiagnosticItem[] } {
  const resolvedRoot = path.resolve(root);
  const items: DiagnosticItem[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') {
      continue;
    }
    const abs = path.resolve(uri.fsPath);
    const rel = path.relative(resolvedRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      continue;
    }
    for (const d of diagnostics) {
      const severity = diagnosticSeverity(d.severity);
      if (severity !== 'error' && severity !== 'warning') {
        continue;
      }
      items.push({
        file: rel.split(path.sep).join('/'),
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        severity,
        message: d.message,
        code: diagnosticCode(d.code),
      });
    }
  }
  return { items };
}

function capWorkspaceContextFile(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > WORKSPACE_CONTEXT_ACTIVE_FILE_LINE_CAP) {
    return lines.slice(0, WORKSPACE_CONTEXT_ACTIVE_FILE_LINE_CAP).join('\n') + '\n(truncated - use read_file for the rest)';
  }
  if (text.length > WORKSPACE_CONTEXT_ACTIVE_FILE_CHAR_CAP) {
    return text.slice(0, WORKSPACE_CONTEXT_ACTIVE_FILE_CHAR_CAP) + '\n(truncated - use read_file for the rest)';
  }
  return text;
}

/**
 * v0.5.2 Execution Engine: collect the editor's diagnostics for files an agent just wrote. Lets the
 * language servers settle briefly first (an edit retriggers TS/ESLint asynchronously), then reads only
 * Error/Warning for the given paths. Paths are echoed back verbatim so the agent sees the name it used.
 */
async function collectFileDiagnostics(paths: string[], cwd: string): Promise<FileDiagnostic[]> {
  await new Promise((r) => setTimeout(r, 800)); // let TS/ESLint recompute after the write
  const out: FileDiagnostic[] = [];
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.file(abs);
    } catch {
      continue;
    }
    for (const d of vscode.languages.getDiagnostics(uri)) {
      const severity = diagnosticSeverity(d.severity);
      if (severity !== 'error' && severity !== 'warning') {
        continue;
      }
      out.push({
        path: p,
        line: d.range.start.line + 1,
        severity,
        message: typeof d.message === 'string' ? d.message : String(d.message),
        source: d.source,
      });
    }
  }
  return out;
}

function diagnosticSeverity(severity: vscode.DiagnosticSeverity): DiagnosticItem['severity'] {
  if (severity === vscode.DiagnosticSeverity.Error) {
    return 'error';
  }
  if (severity === vscode.DiagnosticSeverity.Warning) {
    return 'warning';
  }
  if (severity === vscode.DiagnosticSeverity.Information) {
    return 'info';
  }
  return 'hint';
}

function diagnosticCode(code: vscode.Diagnostic['code']): string | undefined {
  if (typeof code === 'string' || typeof code === 'number') {
    return String(code);
  }
  if (code && typeof code === 'object' && 'value' in code) {
    return String(code.value);
  }
  return undefined;
}

async function fetchMentionUrl(url: string): Promise<{ ok: boolean; text: string }> {
  // @url only runs for an explicit user-typed mention. webFetch handles timeout, size cap, redirects,
  // and practical SSRF checks; failures are treated as "not attached" by the pure expander.
  const text = await webFetch(url);
  return { ok: !text.startsWith('Error:'), text };
}

/** B2: when a command is blocked by unode.commandApproval, warn the user (not just the LLM) — with a
 *  shortcut to the setting. Debounced so a PM looping run_checks can't spam toasts. */
let lastCommandBlockedToast = 0;
function notifyCommandBlocked(reason: string): void {
  outputChannel.warn(`Command blocked by unode.commandApproval: ${reason}`);
  const now = Date.now();
  if (now - lastCommandBlockedToast < 30_000) {
    return;
  }
  lastCommandBlockedToast = now;
  void vscode.window
    .showWarningMessage(`Command blocked by unode.commandApproval: ${reason}`, 'Open Settings')
    .then((choice) => {
      if (choice === 'Open Settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'unode.commandApproval');
      }
    });
}

/**
 * Objective gate check for gated workflows (P2): run the user-configured unode.verifyCommand over the
 * whole project. Empty command = no objective gate (passes). The command is user-set (not LLM-chosen),
 * so it bypasses CommandPolicy by design — same trust model as TeamTools.run_checks.
 */
async function runVerifyChecks(): Promise<{ ok: boolean; output?: string; blocked?: boolean }> {
  const cmd = vscode.workspace.getConfiguration('unode').get<string>('verifyCommand', '').trim();
  if (!cmd) {
    return { ok: true };
  }
  const verdict = commandPolicy.check(cmd);
  if (!verdict.allowed) {
    // blocked = config problem (execution disabled / not allowlisted), not a quality failure.
    notifyCommandBlocked(verdict.reason ?? 'command execution is disabled');
    return { ok: false, blocked: true, output: `Verification command blocked by unode.commandApproval: ${verdict.reason}` };
  }
  // Reuse the worktree verify runner: cp.spawn + a hard timeout that SIGKILLs the child. The old
  // cp.exec({timeout}) did NOT reliably kill the child on Windows and lost output on timeout, so a
  // watch-mode/stdin-waiting test could stall the whole gate for the full window. (Audit #3.)
  const { code, output } = await verifyCommandRunner(cmd, workspaceRoot());
  return { ok: code === 0, output: (output ?? '').slice(-4000) };
}

/** Resolve a set of grants to the server configs in the team registry (skipping unknown ids).
 *  ${WORKDIR} in args/url is substituted here so claude's --mcp-config gets a concrete path. */
function grantedServerConfigs(grants: McpServerGrant[], opts: { approvedOnly?: boolean } = {}): MCPServerConfig[] {
  const out: MCPServerConfig[] = [];
  for (const g of grants) {
    const cfg = mcpRegistry.get(g.serverId);
    if (cfg) {
      if (opts.approvedOnly && needsApproval(cfg, approvedMcp, workspaceRoot())) {
        outputChannel.warn(`Agent references MCP server "${g.serverId}" but it is not approved for this workspace/spec.`);
        continue;
      }
      out.push(resolveServerPlaceholders(cfg, { WORKDIR: workspaceRoot() }));
    } else {
      outputChannel.warn(`Agent references MCP server "${g.serverId}" which is not in .unode/team.json mcpServers.`);
    }
  }
  return out;
}

/** Names referenced as ${VAR} in a server's env (so claude can be handed those secrets at spawn). */
function secretVarsInServer(cfg: MCPServerConfig): string[] {
  const names: string[] = [];
  for (const raw of Object.values(cfg.env ?? {})) {
    for (const m of raw.matchAll(/\$\{(\w+)\}/g)) {
      names.push(m[1]);
    }
  }
  return names;
}

/**
 * Register (in the background) every MCP server referenced by an in-process (openai-compat) agent.
 * claude agents host their own servers, so we skip them here. A slow/failed server doesn't block
 * activation; getToolSpecs simply omits servers that aren't ready yet.
 */
function registerReferencedMcpServers(): void {
  const wanted = new Set<string>();
  for (const info of sessionManager.getAll()) {
    const kind = info.config.backend ?? defaultBackendKind(info.config);
    if (kind !== 'openai-compat') {
      continue; // claude hosts its own MCP servers
    }
    for (const g of agentMcpGrants(info.config, skillResolver)) {
      wanted.add(g.serverId);
    }
  }
  for (const id of wanted) {
    const cfg = mcpRegistry.get(id);
    if (!cfg || mcpHub.isRegistered(id)) {
      continue;
    }
    void mountMcpServer(cfg);
  }
}

/**
 * Mount one MCP server, gating sensitive ones (requiresApproval) behind a one-time user
 * confirmation that is then persisted (P1#4 / MCP design §7.2). Best-effort: a declined or failed
 * mount is logged and skipped — getToolSpecs simply omits servers that aren't ready.
 */
/** Best-effort PATH check for a stdio server's bare command (uvx/npx/docker), so a missing tool gives a
 *  clear "X isn't installed" instead of an opaque "Connection closed". */
function mcpCommandOnPath(command: string): boolean {
  if (!command) { return true; }
  if (command.includes('/') || command.includes('\\')) { return existsSync(command); }
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) { continue; }
    for (const ext of exts) {
      if (existsSync(path.join(dir, command + ext))) { return true; }
    }
  }
  return false;
}

/** Actionable hint for a missing MCP command. */
function mcpCommandHint(command: string): string {
  const c = command.toLowerCase();
  if (c === 'uvx' || c === 'uv') { return `needs uv (the Python tool that provides uvx) — install it: https://docs.astral.sh/uv/`; }
  if (c === 'npx' || c === 'node') { return `needs Node.js — install it: https://nodejs.org/`; }
  if (c === 'docker') { return `needs Docker installed and running.`; }
  return `needs "${command}" installed and on your PATH.`;
}

/** Extra detail for the most recent mount failure (e.g. a missing command), surfaced in the user toast. */
let lastMcpMountDetail = '';

async function mountMcpServer(cfg: MCPServerConfig): Promise<'mounted' | 'skipped' | 'error'> {
  lastMcpMountDetail = '';
  // Workspace Trust gate: MCP servers can spawn local processes (stdio: npx/uvx/docker) or reach the
  // network (remote), so never mount them in an untrusted workspace. They are (re)mounted when the user
  // grants trust (see the onDidGrantWorkspaceTrust handler in activate).
  if (!vscode.workspace.isTrusted) {
    lastMcpMountDetail = `"${cfg.name}" is disabled until you trust this workspace (Workspace Trust).`;
    outputChannel.warn(`MCP server "${cfg.id}" not mounted: workspace is not trusted.`);
    return 'skipped';
  }
  // Pre-flight: a stdio server whose command isn't installed would just close the connection — catch it
  // here with a clear, actionable message instead of the opaque MCP "Connection closed" error.
  if (cfg.transport === 'stdio' && cfg.command && !mcpCommandOnPath(cfg.command)) {
    lastMcpMountDetail = `"${cfg.name}" ${mcpCommandHint(cfg.command)}`;
    outputChannel.error(`MCP server "${cfg.id}" can't mount: command "${cfg.command}" not found on PATH — ${mcpCommandHint(cfg.command)}`);
    return 'error';
  }
  if (needsApproval(cfg, approvedMcp, workspaceRoot())) {
    const choice = await vscode.window.showWarningMessage(
      `MCP server "${cfg.name}" can access resources beyond the file sandbox (${cfg.transport}). Mount it for this team?`,
      { modal: true },
      'Approve & Mount',
      'Skip'
    );
    if (choice !== 'Approve & Mount') {
      outputChannel.warn(`MCP server "${cfg.id}" skipped (not approved).`);
      return 'skipped';
    }
    approvedMcp.add(approvalKey(cfg, workspaceRoot()));
    await persistence.saveApprovedMcpServers([...approvedMcp]);
  }
  try {
    // Substitute ${WORKDIR} in args/url before spawning (secrets in env are resolved inside the Hub).
    await mcpHub.register(resolveServerPlaceholders(cfg, { WORKDIR: workspaceRoot() }));
    outputChannel.info(`MCP server "${cfg.id}" mounted.`);
    settingsPanelRefresh();
    return 'mounted';
  } catch (err) {
    outputChannel.error(`MCP server "${cfg.id}" failed to mount: ${String(err)}`);
    return 'error';
  }
}

/** A user-facing message for an MCP mount outcome (the server is already saved to the team file either way). */
function mcpMountMessage(name: string, outcome: 'mounted' | 'skipped' | 'error'): { ok: boolean; message: string } {
  if (outcome === 'mounted') {
    return { ok: true, message: `Added MCP server "${name}". Grant it to an agent (Settings or Agent Builder) to use it.` };
  }
  if (outcome === 'skipped') {
    return { ok: false, message: `"${name}" was saved but NOT mounted (approval skipped). Mount it later from Settings → MCP Servers.` };
  }
  // If we know WHY it failed (e.g. a missing command), say so in the toast instead of only the output channel.
  const why = lastMcpMountDetail ? ` ${lastMcpMountDetail}.` : ' See the UnodeAi output channel for details.';
  return { ok: false, message: `"${name}" was saved but FAILED to mount —${why}` };
}

/** Nudge the Settings panel (if open) to re-render after MCP/connection changes. */
function settingsPanelRefresh(): void {
  // SettingsPanel re-renders on its own message round-trips; this is a hook point for future
  // push updates. Intentionally a no-op today to avoid forcing a webview reload mid-edit.
}

/** A ConfigStore adapter over the roam.* configuration section (for SettingsBridge). */
function makeConfigStore(): ConfigStore {
  return {
    get: <T>(key: string, fallback: T) => vscode.workspace.getConfiguration('unode').get<T>(key, fallback),
    update: (key: string, value: unknown) =>
      Promise.resolve(
        vscode.workspace.getConfiguration('unode').update(key, value, vscode.ConfigurationTarget.Workspace)
      ),
  };
}

/** Provider definitions for the Settings panel: which use a stored key vs the claude CLI's own auth. */
function providerDefs(): ProviderDef[] {
  const baseUrl = getConfiguredRoamBaseUrl();
  return Object.entries(DEFAULT_PROVIDERS).filter(([id]) => isSupportedProviderId(id)).map(([id, p]) => {
    const usesCliAuth = providerUsesCliAuth(id);
    return {
      providerId: id,
      name: id === 'roam' ? 'Roam' : id.charAt(0).toUpperCase() + id.slice(1),
      apiKeySecretName: p.apiKeySecretName,
      baseUrl: id === 'roam' ? baseUrl : undefined,
      usesCliAuth,
    };
  });
}

/** Agent ids currently granted a given MCP server (default-deny visibility for the Settings panel). */
function agentsGrantedServer(serverId: string): string[] {
  const out: string[] = [];
  for (const info of sessionManager.getAll()) {
    if (agentMcpGrants(info.config, skillResolver).some((g) => g.serverId === serverId)) {
      out.push(info.config.name);
    }
  }
  return out;
}

/** Read view of the live team for TeamTools, backed by SessionManager. */
function makeTeamView(): TeamView {
  return {
    list: () =>
      sessionManager.getAll().map((s) => ({
        id: s.id,
        role: s.config.role,
        name: s.config.name,
        status: s.status,
      })),
    resolve: (ref) => sessionManager.resolveByRoleOrId(ref),
  };
}

/** Pre-filled endpoint + model for the add-agent dialog, per provider. */
function _endpointDefaults(providerKey: string): { baseUrl: string; model: string } {
  switch (providerKey) {
    case 'roam':
      return {
        baseUrl: getConfiguredRoamBaseUrl(),
        model: 'deepseek-v4-flash',
      };
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' };
    default:
      return { baseUrl: '', model: '' };
  }
}

/**
 * Model picker for the add-agent dialog. Opens immediately with the static list, then asynchronously
 * fills in the live catalog (gateway /v1/models + optional Roam-hosted catalog) via ModelCatalog.
 * Always accepts a free-typed model id too, so an empty/slow catalog never blocks the user.
 */
async function _pickModel(
  providerKey: string,
  defaultModel: string,
  baseUrl?: string,
  apiKey?: string
): Promise<string | undefined> {
  // Selecting a model is a good moment to make sure prices are current. Capture the promise so we can
  // RE-RENDER the rows once the user's DISCOUNTED prices land — the model catalog (/v1/models) usually
  // resolves before /api/pricing, so labels built at catalog time show list price, not the user's price.
  const pricesReady = refreshPrices();

  const priceLabel = (id: string): string => {
    const p = pricing?.priceFor(id);
    return p ? `$${p.input}/$${p.output} per 1M` : '';
  };
  const toItem = (m: ModelInfo): vscode.QuickPickItem => ({
    label: m.id,
    description: [
      m.name,
      m.id === defaultModel ? 'recommended' : '',
      m.vision ? 'vision' : '',
      m.source === 'endpoint' ? 'live' : '',
      priceLabel(m.id),
    ]
      .filter(Boolean)
      .join(' · '),
  });

  return new Promise<string | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick();
    qp.title = 'UnodeAi — Model';
    qp.placeholder = 'Pick a model or type a custom model id (e.g. deepseek-v4-flash, gpt-4o)';
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;

    let catalogItems: vscode.QuickPickItem[] = [];
    let done = false;

    // Rebuild the item list for the current typed value, injecting a "use this custom id" row.
    const rebuild = (): void => {
      const typed = qp.value.trim();
      const exists = catalogItems.some((i) => i.label === typed);
      qp.items = typed && !exists ? [{ label: typed, description: 'custom model id' }, ...catalogItems] : catalogItems;
    };

    // Re-map the catalog rows from the LATEST prices (so a discounted refresh shows through) and
    // re-render, preserving the user's current highlight.
    let catalogModels: ModelInfo[] = [];
    const renderCatalog = (): void => {
      const activeLabel = qp.activeItems[0]?.label;
      catalogItems = catalogModels.map(toItem);
      rebuild();
      if (activeLabel) {
        const match = qp.items.find((i) => i.label === activeLabel);
        if (match) { qp.activeItems = [match]; }
      }
    };

    const finish = (val: string | undefined): void => {
      if (done) { return; }
      done = true;
      resolve(val);
      qp.hide();
    };

    qp.onDidChangeValue(rebuild);
    qp.onDidAccept(() => finish(qp.selectedItems[0]?.label ?? (qp.value.trim() || undefined)));
    qp.onDidHide(() => {
      if (!done) { done = true; resolve(undefined); }
      qp.dispose();
    });

    qp.busy = true;
    qp.show();

    modelCatalog
      .list(providerKey, baseUrl, apiKey)
      .then((models) => {
        if (done) { return; }
        catalogModels = models;
        renderCatalog();
        const recommended = catalogItems.find((i) => i.label === defaultModel);
        if (recommended) {
          qp.activeItems = [recommended];
        } else if (defaultModel && !qp.value) {
          qp.value = defaultModel; // not in the catalog (e.g. custom gateway) — prefill as free text
          rebuild();
        }
      })
      .catch((err) => outputChannel.warn(`Model catalog fetch failed: ${String(err)}`))
      .finally(() => {
        if (!done) { qp.busy = false; }
      });

    // Discounted prices arrive asynchronously; when they do, re-render the labels in place so the
    // picker shows the user's real (post-discount) price instead of the frozen list price.
    void pricesReady.then(() => {
      if (!done && catalogModels.length > 0) { renderCatalog(); }
    });
  });
}

/**
 * Refresh the cost table from live gateway /api/pricing endpoints — the Roam gateway (unode.baseUrl)
 * plus any new-api-compatible gateways the user lists in unode.pricingSources. Called on activation,
 * daily, and when the model picker opens, so prices refresh online and stay current. Best-effort:
 * a failing source logs and leaves the static/override table in place.
 */
async function refreshPrices(): Promise<void> {
  if (!livePrices || !pricing) { return; }
  const cfg = vscode.workspace.getConfiguration('unode');
  const roamBase = getConfiguredRoamBaseUrl();   // sanitized: never the old unode URL (no Roam-key leak)
  const unodeBase = getConfiguredUnodeBaseUrl();
  const priceGroup = cfg.get<string>('priceGroup', '').trim() || undefined;
  // Each gateway is fetched WITH that gateway's own key so /api/pricing returns the account's discount
  // group (group_ratio); keys are NOT sent to third-party pricingSources. Roam = weroam, Unode = unodetech.
  const roamKey = await secrets.get(DEFAULT_PROVIDERS.roam.apiKeySecretName);
  const unodeKey = await secrets.get(DEFAULT_PROVIDERS.unode.apiKeySecretName);
  const sources: Array<{ url: string; apiKey?: string; group?: string }> = [
    { url: roamBase, apiKey: roamKey, group: priceGroup },
    { url: unodeBase, apiKey: unodeKey, group: priceGroup },
    ...cfg.get<string[]>('pricingSources', []).map((url) => ({ url })),
  ].filter((s) => typeof s.url === 'string' && s.url.length > 0);

  for (const { url, apiKey, group } of sources) {
    try {
      const prices = await livePrices.fetchGatewayPrices(url, apiKey, group);
      const count = Object.keys(prices).length;
      if (count > 0) {
        pricing.merge(prices);
        outputChannel.info(`Refreshed ${count} model price(s) from ${url}`);
      }
    } catch (err) {
      outputChannel.warn(`Price refresh failed for ${url}: ${String(err)}`);
    }
  }
}

// ─── Persistence ──────────────────────────────────────────────────────

/**
 * 0.9.0 provider split: Roam now defaults to the weroam gateway; the previous endpoint is the separate
 * "Unode" provider. One-time, idempotent (globalState-guarded) migration so existing users are NOT broken:
 *  - the existing ROAM_API_KEY is actually a Unode key → preserve it as UNODE_API_KEY, then clear ROAM_API_KEY
 *    (so Roam awaits a fresh weroam key instead of 401'ing with the unode one — its value is kept under Unode);
 *  - existing roam agents (on the old unode endpoint, or no explicit base) move to the `unode` provider so
 *    they keep running unchanged. New roam agents (weroam, no base) are unaffected because this runs once.
 */
/**
 * Cosmetic, idempotent, runs EVERY launch (not flag-guarded): reset a persisted unode.baseUrl that still
 * points at the old unode endpoint to the weroam default, so the Settings UI matches reality. Runtime/pricing
 * are already safe via canonicalRoamBaseUrl — this just fixes what's stored/shown (covers users who launched
 * 0.9.0 before this landed, whose once-migration flag is already set). A no-op once the value is canonical.
 */
async function correctStaleRoamBaseUrl(): Promise<void> {
  try {
    const cfg = vscode.workspace.getConfiguration('unode');
    const inspected = cfg.inspect<string>('baseUrl');
    const staleUnode = (v?: string) => !!v && /unodetech\.xyz/i.test(v);
    if (staleUnode(inspected?.workspaceValue)) { await cfg.update('baseUrl', ROAM_DEFAULT_BASE_URL, vscode.ConfigurationTarget.Workspace); }
    if (staleUnode(inspected?.globalValue)) { await cfg.update('baseUrl', ROAM_DEFAULT_BASE_URL, vscode.ConfigurationTarget.Global); }
  } catch (err) {
    outputChannel.warn(`unode.baseUrl correction skipped: ${String(err)}`);
  }
}

async function migrateToProviderSplit(context: vscode.ExtensionContext): Promise<void> {
  // The SECRET move is GLOBAL (VS Code SecretStorage is global) → guard it in globalState, once per install.
  // The AGENT-ROSTER move is PER-WORKSPACE (workspaceState + .unode/team.json) → guard it in workspaceState,
  // so a second/older workspace opened later still migrates its own old roam agents (Codex fix). Splitting
  // the two guards prevents the first workspace from consuming a global flag that then skips other rosters.
  const SECRET_FLAG = 'roam.migration.providerSplit.v0_9';
  const ROSTER_FLAG = 'roam.migration.providerSplitRoster.v0_9';

  let movedKey = false;
  if (!context.globalState.get<boolean>(SECRET_FLAG)) {
    const roamKey = await secrets.get('ROAM_API_KEY');
    const unodeKey = await secrets.get('UNODE_API_KEY');
    if (roamKey && !unodeKey) {
      await secrets.set('UNODE_API_KEY', roamKey);
      await secrets.delete('ROAM_API_KEY');
      movedKey = true;
    }
    await context.globalState.update(SECRET_FLAG, true);
  }

  let agentsMoved = 0;
  if (!context.workspaceState.get<boolean>(ROSTER_FLAG)) {
    const migrate = (configs: AgentConfig[]): { configs: AgentConfig[]; changed: number } => {
      let changed = 0;
      const out = configs.map((c) => {
        if (c.provider?.providerId !== 'roam') { return c; }
        const base = c.baseUrl?.trim();
        if (base && !/unodetech\.xyz/i.test(base)) { return c; } // a genuinely custom roam base — leave it
        changed++;
        return { ...c, provider: { providerId: 'unode', apiKeySecretName: 'UNODE_API_KEY' }, baseUrl: UNODE_DEFAULT_BASE_URL };
      });
      return { configs: out, changed };
    };
    try {
      const last = persistence.loadAgents();
      if (last.length) {
        const r = migrate(last);
        if (r.changed) { await persistence.saveAgents(r.configs); agentsMoved += r.changed; }
      }
      const team = await persistence.loadTeamConfig();
      if (team?.members?.length) {
        const r = migrate(team.members);
        if (r.changed) { await persistence.saveTeamConfig({ ...team, members: r.configs }); agentsMoved += r.changed; }
      }
      await context.workspaceState.update(ROSTER_FLAG, true);
    } catch (err) {
      outputChannel.warn(`Provider-split agent migration skipped: ${String(err)}`); // leave the flag unset → retry next launch
    }
  }

  if (movedKey || agentsMoved) {
    void vscode.window.showInformationMessage(
      'UnodeAi now defaults to the new Roam (weroam) gateway. Your existing agents and API key were kept on ' +
      'Unode (unchanged). To use the new Roam gateway, add your Roam API key in Settings.'
    );
  }
}

async function restoreRoster(): Promise<void> {
  // Load the team-level MCP server registry first, so backends built below can resolve grants.
  const teamConfig = await persistence.loadTeamConfig();
  mcpRegistry.clear();
  for (const cfg of teamConfig?.mcpServers ?? []) {
    mcpRegistry.set(cfg.id, cfg);
  }

  const lastUsed = persistence.loadAgents();
  const fromFile = teamConfig?.members ?? [];
  const agents = lastUsed.length > 0 ? lastUsed : fromFile;
  for (const config of agents) {
    sessionManager.create(config);
  }
  if (agents.length > 0) {
    outputChannel.info(
      `Restored ${agents.length} agent(s) from ${lastUsed.length > 0 ? 'last workspace state' : '.unode/team.json'}.`
    );
    teamViewProvider?.refresh();
  }
  if (mcpRegistry.size > 0) {
    outputChannel.info(`Loaded ${mcpRegistry.size} MCP server(s) from .unode/team.json.`);
    registerReferencedMcpServers();
  }
}

async function saveRoster(): Promise<void> {
  await persistence.saveAgents(sessionManager.getAll().map((s) => s.config));
}

// ─── Events ───────────────────────────────────────────────────────────

function wireEvents(): void {
  const refreshTeam = () => {
    teamViewProvider?.refresh();
    chatViewProvider?.refresh();
    updateStatusBar();
  };

  sessionManager.on('session.created', () => { refreshTeam(); void saveRoster(); });
  sessionManager.on('session.removed', (e) => {
    chatViewProvider?.clearAgent(e.sessionId);
    refreshTeam();
    void saveRoster();
    agentChannels.get(e.sessionId)?.dispose();
    agentChannels.delete(e.sessionId);
    void worktreeCoordinator?.release(e.sessionId); // tear down the agent's worktree, if any
  });
  sessionManager.on('session.started', refreshTeam);
  sessionManager.on('session.stopped', refreshTeam);
  // B1: start deferred by the concurrency cap — tell the user it's queued, not failed.
  sessionManager.on('session.queued', (e) => {
    refreshTeam();
    const name = resolveAgentName(e.sessionId);
    outputChannel.info(`Agent ${name} queued: ${e.data.reason}`);
    void vscode.window.showInformationMessage(
      `Agent '${name}' queued — it will start when a slot frees (${e.data.reason}).`
    );
  });
  sessionManager.on('session.status', () => teamViewProvider?.refresh());
  sessionManager.on('session.error', (e) => {
    refreshTeam();
    outputChannel.error(`Agent ${resolveAgentName(e.sessionId)}: ${e.data?.error ?? 'error'}`);
    getAgentChannel(e.sessionId).appendLine(`❌ ERROR: ${e.data?.error ?? 'error'}`);
  });
  // A persistently-failing primary model was swapped to its fallback — make it visible.
  sessionManager.on('session.modelSwitched', (e) => {
    refreshTeam();
    const note = `Switched ${resolveAgentName(e.sessionId)} to fallback model ${e.data.to} (${e.data.reason}).`;
    outputChannel.warn(note);
    getAgentChannel(e.sessionId).appendLine(`↪ ${note}`);
  });
  // Each agent's own transcript (assistant text + tool calls) goes to its dedicated channel.
  sessionManager.on('session.output', (e) => {
    const content = e.data?.content;
    if (content && e.sessionId) {
      getAgentChannel(e.sessionId).appendLine(String(content).trimEnd());
    }
  });
  sessionManager.on('session.stream', (e) => {
    if (e.sessionId && e.data?.delta) {
      chatViewProvider?.appendDelta(e.sessionId, e.data.delta);
    }
  });
  sessionManager.on('session.reasoning', (e) => {
    if (e.sessionId && e.data?.delta) {
      chatViewProvider?.appendReasoning(e.sessionId, e.data.delta);
    }
  });
  sessionManager.on('session.tool', (e) => {
    if (e.sessionId && e.data) {
      chatViewProvider?.appendToolActivity(e.sessionId, e.data);
    }
  });
  sessionManager.on('session.context', (e) => {
    if (e.sessionId && e.data) {
      chatViewProvider?.setContext(e.sessionId, e.data);
      // Stash the latest usage on the session so the Dashboard can show per-agent context %.
      const info = sessionManager.get(e.sessionId);
      if (info) {
        info.contextUsage = e.data as { tokens: number; window: number; ratio: number };
      }
      teamViewProvider?.refresh(); // live ctx%/cost in the Team panel cards
    }
  });
  sessionManager.on('session.compacted', (e) => {
    if (e.sessionId && e.data) {
      chatViewProvider?.appendCompactionMarker(e.sessionId, e.data.dropped);
    }
  });

  messageBus.on('message.sent', (msg) => {
    if (orchestrationProgress.recordMessage(msg as Message)) {
      const summaries = orchestrationProgress.snapshot();
      chatViewProvider?.setDelegationProgress(summaries);
      messageLogProvider?.setDelegationProgress(summaries);
      teamViewProvider?.setDelegationProgress(orchestrationProgress.agentStates());
    }
    messageLogProvider?.refresh();
    scheduleMessageSave();
  });
}

/** Debounced persistence of recent message history (P1#5), so the log survives a reload. */
function scheduleMessageSave(): void {
  if (messageSaveTimer) {
    clearTimeout(messageSaveTimer);
  }
  messageSaveTimer = setTimeout(() => {
    persistence.saveMessages(messageBus.exportMessages());
  }, 1500);
}

// ─── Commands ─────────────────────────────────────────────────────────

/**
 * "UnodeAi: Reset Workspace State" — wipe this workspace's persisted Roam state so the user can
 * start clean (e.g. after a stale roster/chat history bleeds across reinstalls). Optionally clears
 * stored provider API keys too. Reloads the window so everything re-initializes from empty (the
 * setup wizard then reopens because no agents are restored).
 */
async function resetWorkspaceStateCommand(): Promise<void> {
  const RESET = 'Reset';
  const RESET_KEYS = 'Reset + clear API keys';
  const choice = await vscode.window.showWarningMessage(
    'Reset UnodeAi in this workspace? This permanently clears the team roster (including .unode/team.json), all chat history, the message log, saved conversations, workflows, and approved MCP servers for this workspace, then reopens the setup wizard. This cannot be undone.',
    { modal: true },
    RESET,
    RESET_KEYS
  );
  if (choice !== RESET && choice !== RESET_KEYS) {
    return;
  }

  // Stop deactivate() from flushing the in-memory message buffer back into the state we're wiping.
  if (messageSaveTimer) {
    clearTimeout(messageSaveTimer);
    messageSaveTimer = undefined;
  }

  // Tear down live agents first (shrinks the persisted roster and clears their chat entries).
  for (const session of [...sessionManager.getAll()]) {
    await sessionManager.remove(session.config.id).catch(() => undefined);
  }

  await persistence.resetWorkspaceState();
  // Also drop .unode/team.json — otherwise the now-empty workspaceState would re-seed the cleared
  // roster from it on reload (the "Browser keeps coming back after Reset" bug).
  await persistence.deleteTeamFile();

  if (choice === RESET_KEYS) {
    const names = new Set(Object.values(DEFAULT_PROVIDERS).map((p) => p.apiKeySecretName));
    for (const name of names) {
      await secrets.delete(name);
    }
  }

  await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

const JSON_FILTERS = { JSON: ['json'] };

function timestampForFile(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'transcript';
}

function defaultJsonUri(fileName: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  return folder ? vscode.Uri.joinPath(folder, fileName) : undefined;
}

async function saveJsonPayload(defaultName: string, payload: unknown): Promise<boolean> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: defaultJsonUri(defaultName),
    filters: JSON_FILTERS,
  });
  if (!uri) {
    return false;
  }
  await fs.writeFile(uri.fsPath, JSON.stringify(payload, null, 2), 'utf8');
  return true;
}

async function readJsonFromDialog(): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: JSON_FILTERS,
  });
  const uri = uris?.[0];
  return uri ? await fs.readFile(uri.fsPath, 'utf8') : undefined;
}

function registerCommands(context: vscode.ExtensionContext) {
  const reg = (cmd: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));

  reg('unode.showTeamPanel', () => vscode.commands.executeCommand('workbench.view.extension.unode'));

  reg('unode.showDashboard', () => guard(async () => {
    if (dashboardPanel) { dashboardPanel.reveal(vscode.ViewColumn.One); await refreshDashboardPanel(); return; }
    const panel = vscode.window.createWebviewPanel(
      'roamDashboard',
      'UnodeAi Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: false, enableCommandUris: true, retainContextWhenHidden: true }
    );
    dashboardPanel = panel;
    panel.onDidDispose(() => { if (dashboardPanel === panel) { dashboardPanel = undefined; } });
    panel.webview.html = await dashboardProvider.getDashboardHtml(panel.webview);
  }));

  // "Latest tasks" panel N control (command-URI link from the scripts-disabled dashboard). Clamps to a
  // sane range, persists, and re-renders the open dashboard.
  reg('unode.setDashboardTaskCount', (n: unknown) => guard(async () => {
    const parsed = Math.round(Number(n));
    const count = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 5;
    await context.globalState.update('roam.dashboard.recentTaskCount', count);
    await refreshDashboardPanel();
  }));

  // Brand icon in the editor title bar (top-right) → open UnodeAi's Mission Control (the Dashboard
  // tab), like the one-click "open in tab" icon Claude/GPT/Kilo place there.
  reg('unode.openMissionControl', () => vscode.commands.executeCommand('unode.showDashboard'));

  // Evidence Report: turn the crew's recent run into a skimmable "what happened + was it verified"
  // Markdown doc — the verifier-gate made tangible. Gathers delegations (orchestration tracker),
  // changed files (checkpoints), and runs the project's checks for the verdict.
  reg('unode.generateEvidenceReport', () => guard(async () => {
    const summaries = orchestrationProgress.snapshot();
    const agents = summaries.flatMap((s) => s.items.map((it) => ({
      agentName: it.agentName,
      task: it.instruction,
      status: it.status,
      result: it.result,
    })));
    // Only count files changed DURING this run — the checkpoint store persists ~200 points across
    // sessions, so without a cutoff the report would list files from earlier/older tasks. Use the
    // earliest delegation's start as the boundary; with no delegations, fall back to all (best effort).
    const runStartMs = summaries.length ? Date.parse(summaries[0].startedAt) : NaN;
    const since = Number.isFinite(runStartMs) ? runStartMs : 0;
    const filesChanged = [...new Set(
      checkpointStore.list().filter((c) => (c.ts ?? 0) >= since).map((c) => c.path)
    )];
    if (agents.length === 0 && filesChanged.length === 0) {
      void vscode.window.showInformationMessage('UnodeAi: no recent crew activity to report yet — run a task first.');
      return;
    }
    const cmd = vscode.workspace.getConfiguration('unode').get<string>('verifyCommand', '').trim();
    let checks: EvidenceChecks | undefined;
    let verified = false;
    let blocked = false;
    if (cmd) {
      const r = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `UnodeAi: verifying (${cmd})…` },
        () => runVerifyChecks()
      );
      checks = { command: cmd, passed: !!r.ok, outputTail: r.output };
      verified = !!r.ok;
      blocked = !!r.blocked; // verify command blocked by policy → 🚧 Blocked, not silently Unverified
    }
    const md = buildEvidenceReport({
      goal: 'UnodeAi — latest run',
      coordinatorName: summaries.length ? summaries[summaries.length - 1].coordinatorName : undefined,
      agents,
      filesChanged,
      checks,
      verified,
      blocked,
      startedAt: summaries.length ? summaries[0].startedAt : undefined,
      completedAt: summaries.length ? summaries[summaries.length - 1].completedAt : undefined,
    });
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: md });
    await vscode.window.showTextDocument(doc, { preview: false });
  }));

  reg('unode.showMessageLog', () => vscode.commands.executeCommand('unode.messageLog.focus'));

  // Team panel compact mode: collapse agents to icon chips to free room for Chat/Messages.
  const setTeamCompact = (compact: boolean) => {
    teamViewProvider?.setCompact(compact);
    void vscode.commands.executeCommand('setContext', 'unode.teamCompact', compact);
  };
  reg('unode.collapseTeam', () => setTeamCompact(true));
  reg('unode.expandTeam', () => setTeamCompact(false));

  reg('unode.exportChat', () => guard(async () => {
    const selected = chatViewProvider?.exportSelected();
    if (!selected) {
      vscode.window.showInformationMessage('Select an agent chat first, then export it.');
      return;
    }
    const saved = await saveJsonPayload(
      `roam-chat-${safeFilePart(selected.agent.name)}-${timestampForFile()}.json`,
      createChatExportPayload(selected.agent, selected.messages)
    );
    if (saved) {
      vscode.window.showInformationMessage(`Exported chat with ${selected.agent.name}.`);
    }
  }));

  reg('unode.importChat', () => guard(async () => {
    const who = chatViewProvider?.getSelectedAgentName();
    if (!who) {
      vscode.window.showInformationMessage('Select an agent chat first, then import into it.');
      return;
    }
    const raw = await readJsonFromDialog();
    if (raw === undefined) {
      return;
    }
    const parsed = parseChatImportPayload(raw);
    if (!parsed.ok) {
      vscode.window.showErrorMessage(`Could not import chat: ${parsed.error}`);
      return;
    }
    if (chatViewProvider.hasSelectedMessages()) {
      const REPLACE = 'Replace';
      const choice = await vscode.window.showWarningMessage(
        `Importing this chat will replace the current visible chat with ${who}.`,
        { modal: true },
        REPLACE
      );
      if (choice !== REPLACE) {
        return;
      }
    }
    if (chatViewProvider.importToSelected(parsed.messages)) {
      vscode.window.showInformationMessage(`Imported ${parsed.messages.length} chat message(s) into ${who}.`);
    }
  }));

  reg('unode.exportMessages', () => guard(async () => {
    const items = messageLogProvider?.exportItems() ?? [];
    const saved = await saveJsonPayload(
      `roam-messages-${timestampForFile()}.json`,
      createMessagesExportPayload(items)
    );
    if (saved) {
      vscode.window.showInformationMessage(`Exported ${items.length} message log item(s).`);
    }
  }));

  reg('unode.importMessages', () => guard(async () => {
    const raw = await readJsonFromDialog();
    if (raw === undefined) {
      return;
    }
    const parsed = parseMessagesImportPayload(raw);
    if (!parsed.ok) {
      vscode.window.showErrorMessage(`Could not import messages: ${parsed.error}`);
      return;
    }
    if (messageLogProvider?.hasItems()) {
      const REPLACE = 'Replace';
      const choice = await vscode.window.showWarningMessage(
        'Importing messages will replace the current visible team activity feed.',
        { modal: true },
        REPLACE
      );
      if (choice !== REPLACE) {
        return;
      }
    }
    messageLogProvider?.importItems(parsed.messages);
    vscode.window.showInformationMessage(
      `Imported ${parsed.messages.length} message(s) into the activity feed for viewing (not restored to history — cleared on reload).`
    );
  }));

  reg('unode.toggleChatCompact', () => {
    const compact = chatViewProvider?.setCompact();
    void vscode.commands.executeCommand('setContext', 'unode.chatCompact', compact === true);
  });

  reg('unode.toggleMessagesCompact', () => {
    const compact = messageLogProvider?.setCompact();
    void vscode.commands.executeCommand('setContext', 'unode.messagesCompact', compact === true);
  });

  // Clear buttons (view title bars) — with a light confirmation noting the consequences.
  reg('unode.clearChat', () => guard(async () => {
    const who = chatViewProvider?.getSelectedAgentName();
    if (!who) {
      vscode.window.showInformationMessage('Select an agent chat first, then clear it.');
      return;
    }
    const CLEAR = 'Clear';
    const choice = await vscode.window.showWarningMessage(
      `Clear the chat with ${who}? This permanently deletes the saved conversation history with this agent. It can't be undone.`,
      { modal: true },
      CLEAR
    );
    if (choice === CLEAR) {
      chatViewProvider?.clearSelectedAgent();
    }
  }));
  reg('unode.archiveChat', () => guard(async () => {
    const who = chatViewProvider?.getSelectedAgentName();
    if (!who) {
      vscode.window.showInformationMessage('Select an agent chat first, then archive it.');
      return;
    }
    const archived = chatViewProvider?.archiveSelectedAgent() ?? 0;
    if (archived === 0) {
      vscode.window.showInformationMessage(`Nothing to archive — the chat with ${who} is empty.`);
      return;
    }
    vscode.window.showInformationMessage(
      `Archived the chat with ${who}. It's hidden but not deleted — restore it via "UnodeAi: View Archived Chats".`
    );
  }));
  reg('unode.viewArchivedChats', () => guard(async () => {
    const archives = chatViewProvider?.listArchivedChats() ?? [];
    if (archives.length === 0) {
      vscode.window.showInformationMessage('No archived chats yet. Use the Archive button in the Chat panel to save one.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      archives.map((a) => ({
        label: a.agentName,
        description: new Date(a.archivedAt).toLocaleString(),
        detail: summarizeArchive(a),
        id: a.id,
        agentId: a.agentId,
      })),
      { placeHolder: 'Restore an archived chat…', matchOnDescription: true, matchOnDetail: true }
    );
    if (!pick) {
      return;
    }
    // Restoring overwrites the agent's current transcript — confirm if there's live content to lose.
    const liveCount = chatViewProvider?.getMessageCount(pick.agentId) ?? 0;
    if (liveCount > 0) {
      const RESTORE = 'Restore';
      const choice = await vscode.window.showWarningMessage(
        `Restore this archived chat into "${pick.label}"? Its current ${liveCount} message(s) will be replaced (archive or clear them first to keep them).`,
        { modal: true },
        RESTORE
      );
      if (choice !== RESTORE) {
        return;
      }
    }
    const result = chatViewProvider?.restoreArchive(pick.id);
    if (!result?.ok) {
      const msg = result?.reason === 'agent-gone'
        ? `Can't restore — "${pick.label}" is no longer in the team. Re-add the agent, then restore.`
        : 'Could not restore that archived chat.';
      vscode.window.showWarningMessage(msg);
      return;
    }
    void vscode.commands.executeCommand('unode.chat.focus').then(undefined, () => { /* view focus is best-effort */ });
    vscode.window.showInformationMessage(`Restored the archived chat with ${pick.label}.`);
  }));
  reg('unode.clearMessageLog', () => guard(async () => {
    const CLEAR = 'Clear';
    const choice = await vscode.window.showWarningMessage(
      "Clear all team messages? This empties the cross-agent activity feed and its saved history. It can't be undone.",
      { modal: true },
      CLEAR
    );
    if (choice === CLEAR) {
      messageBus.clearMessages();
      void persistence.saveMessages([]);
      messageLogProvider?.clear();
    }
  }));

  reg('unode.startAllAgents', () => guard(async () => {
    const result = await sessionManager.startAll();
    vscode.window.showInformationMessage('Starting all UnodeAi agents...');
    return result;
  }));

  reg('unode.stopAllAgents', () => guard(async () => {
    await sessionManager.stopAll();
    vscode.window.showInformationMessage('All UnodeAi agents stopped');
    return sessionManager.getAll();
  }));

  reg('unode.openAgentBuilder', (agentId?: string) =>
    AgentBuilderPanel.createOrShow(context.extensionUri, {
      getViewModel: (id) => agentBuilderViewModel(context.extensionUri, id),
      listModels: (providerId, baseUrl) => agentBuilderListModels(providerId, baseUrl),
      save: (payload) => handleAgentBuilderSave(payload, context.extensionUri),
      pickIcon: () => pickAgentBuilderIcon(),
      openSkillLibrary: async () => {
        const raw = vscode.workspace.getConfiguration('unode').get<string>(
          'marketplace.skillLibraryUrl',
          'https://github.com/weroamxyz/unode-skills'
        );
        await vscode.env.openExternal(vscode.Uri.parse(raw));
      },
      // Open the MCP Marketplace (its MCP tab) — what users expect from "Browse MCP Marketplace…" in the
      // builder. Installing there registers the server; the builder refreshes its grant list on focus.
      addMcpServer: async () => { await vscode.commands.executeCommand('unode.openMarketplace', 'mcp'); },
    }, typeof agentId === 'string' ? agentId : undefined)
  );

  reg('unode.addMcpServer', () => guard(() => guidedAddMcpServer()));

  reg('unode.addAgent', () => guard(() => dialogs.showAddAgentDialog(dialogDeps())));
  // D1 UI: pick a team preset (software crew or a knowledge-work team) and create it.
  reg('unode.createTeamPreset', () => guard(async () => {
    const result = await dialogs.createTeamFromPreset(dialogDeps());
    if (result.length && context.extensionMode !== vscode.ExtensionMode.Test) {
      void maybePromptTeamRules();
    }
    teamViewProvider?.refresh();
    return result;
  }));
  reg('unode.createDefaultTeam', () => guard(async () => {
    const result = await dialogs.createDefaultTeam(dialogDeps());
    // Prompt for team rules on real user-driven creation only — never in headless e2e (a modal
    // would break the test), and don't block/alter the command's return value (the created agents).
    if (context.extensionMode !== vscode.ExtensionMode.Test) {
      void maybePromptTeamRules();
    }
    return result;
  }));
  // Solo / Fast mode (v0.3.0): one generalist agent, the fast path for simple asks.
  // ⚡ toggles between the Solo agent and the team: if you're already viewing Solo, it flips the chat
  // back to the first (team) agent; otherwise it creates/focuses the Solo agent. If Solo is the only
  // agent, it stays on Solo. The toolbar icon is the outline ⚡ normally, solid ⚡ while Solo is selected.
  const soloToggleHandler = () => guard(async () => {
    const agents = sessionManager.getAll();
    const solo = agents.find((s) => s.config.role === 'solo');
    const selected = chatViewProvider?.getSelectedAgentId();
    if (solo && selected === solo.id) {
      const first = agents[0];
      if (first && first.id !== solo.id) {
        chatViewProvider?.selectAgent(first.id);
        await vscode.commands.executeCommand('unode.chatWithAgent', first.id);
        return first.config;
      }
      return solo.config; // Solo is the first/only agent — stay on it
    }
    const config = await dialogs.createSoloAgent(dialogDeps());
    if (!config) { return undefined; } // user cancelled
    teamViewProvider?.refresh();
    chatViewProvider?.refresh();
    syncSoloContext();
    await vscode.commands.executeCommand('unode.chatWithAgent', config.id);
    return config;
  });
  reg('unode.startSolo', soloToggleHandler);
  reg('unode.startSoloActive', soloToggleHandler); // solid-icon variant shown while a Solo agent exists
  reg('unode.editTeamRules', () => guard(() => openTeamRulesPanel({
    rulesFilePath: rulesFile.path,
    onSaved: () => { void rulesFile.load(); },
  })));
  reg('unode.agentStart', (id: string) => guard(() => sessionManager.start(id)));
  reg('unode.agentStop', (id: string) => guard(async () => {
    await sessionManager.stop(id);
    return sessionManager.getAll();
  }));
  reg('unode.agentRestart', (id: string) => guard(() => sessionManager.restart(id)));
  reg('unode.agentRemove', (id: string) => guard(async () => { terminalManager.dispose(id); const r = await sessionManager.remove(id); syncSoloContext(); return r; }));
  // #13 Phase 2: reveal an agent's command terminal (from the Team panel). Creates one on demand
  // so every agent — even a PM that only delegates — has its own visible terminal thread.
  reg('unode.showAgentTerminal', (id: string) => terminalManager.reveal(id, `Unode: ${resolveAgentName(id)}`, workspaceRoot()));
  // V1 Checkpoints: revert a file an agent edited back to a previous version.
  reg('unode.restoreCheckpoint', () => guard(() => restoreCheckpointCommand()));
  reg('unode.showCheckpointDiff', (checkpointId: unknown) => guard(() => showCheckpointDiffCommand(checkpointId)));
  reg('unode.resetWorkspaceState', () => guard(() => resetWorkspaceStateCommand()));

  // F2: one-click guided command-execution enablement
  context.subscriptions.push(
    vscode.commands.registerCommand('unode.enableCommands', async () => {
      const accepted = await promptCommandApproval(commandPolicy.approvalMode);
      if (accepted) {
        const cfg = vscode.workspace.getConfiguration('unode');
        commandPolicy.reload(
          cfg.get<CommandApprovalMode>('commandApproval', 'ask'),
          cfg.get<string[]>('allowedCommands', [])
        );
      }
    })
  );
  reg('unode.agentEdit', (id: string) => guard(() => dialogs.showEditAgentDialog(dialogDeps(), id)));
  reg('unode.showAgentOutput', (id: string) => getAgentChannel(id).show());

  // Flip the concurrency mode from the Team-panel title-bar icon (or command palette). Switching to Worktree
  // on a non-git folder reuses the same git-init / Optimistic prompt agents hit at runtime. The toolbar shows
  // one of two icons gated on the unode.worktreeMode context key (set here + on activation + on config change).
  reg('unode.toggleConcurrencyMode', () => guard(async () => {
    const cfg = vscode.workspace.getConfiguration('unode');
    const next = cfg.get<string>('concurrencyStrategy', 'optimistic') === 'worktree' ? 'optimistic' : 'worktree';
    await cfg.update('concurrencyStrategy', next, vscode.ConfigurationTarget.Workspace);
    syncConcurrencyContext();
    teamViewProvider?.refresh();
    if (next === 'optimistic') {
      void vscode.window.showInformationMessage('UnodeAi: switched to Optimistic mode — agents share this workspace. Applies to each agent’s next turn.');
    } else if (await isWorkspaceGitRepo()) {
      void vscode.window.showInformationMessage('UnodeAi: switched to Worktree mode — each agent gets an isolated git worktree on its next start.');
    } else {
      worktreeGitWarningShown = false; // let the non-git warning surface for this explicit switch
      await warnWorktreeNeedsGit();
    }
  }));
  // The two title-bar icons (Optimistic vs Worktree) both just trigger the toggle; the icon shown indicates
  // the CURRENT mode (see package.json view/title when-clauses on unode.worktreeMode).
  reg('unode.concurrencyMode.optimistic', () => vscode.commands.executeCommand('unode.toggleConcurrencyMode'));
  reg('unode.concurrencyMode.worktree', () => vscode.commands.executeCommand('unode.toggleConcurrencyMode'));

  reg('unode.sendMessage', (request?: unknown) => guard(async () => {
    const agents = sessionManager.getAll();
    if (agents.length === 0) {
      vscode.window.showWarningMessage('No agents configured. Add an agent first.');
      return;
    }
    return dialogs.showSendMessageDialog(dialogDeps(), agents.map((a) => a.config), request);
  }));

  reg('unode.openChat', () => guard(async () => {
    if (sessionManager.getAll().length === 0) {
      const pick = await vscode.window.showInformationMessage(
        'No agents yet. Create a team first?', 'Create Team'
      );
      if (pick === 'Create Team') {
        await vscode.commands.executeCommand('unode.createTeamPreset');
      }
      if (sessionManager.getAll().length === 0) {
        return;
      }
    }
    chatViewProvider.refresh();
    await vscode.commands.executeCommand('unode.chat.focus');
  }));

  reg('unode.chatWithAgent', (agentId: string) => guard(async () => {
    if (typeof agentId === 'string') {
      chatViewProvider.selectAgent(agentId);
      syncSoloContext();
    }
    await vscode.commands.executeCommand('unode.chat.focus');
  }));

  reg('unode.runWorkflow', () => guard(() => dialogs.showRunWorkflowDialog(dialogDeps())));
  reg('unode.editWorkflow', () => guard(() =>
    WorkflowEditor.createOrShow(context.extensionUri, {
      listWorkflows: () => workflowEngine.listWorkflows(),
      listAgents: () => sessionManager.getAll().map((session) => ({
        id: session.config.id,
        name: session.config.name,
        role: session.config.role,
      })),
      saveWorkflow: (workflow) => workflowEngine.saveWorkflow(workflow),
      deleteWorkflow: (id) => workflowEngine.deleteWorkflow(id),
    })
  ));
  reg('unode.setApiKey', () => guard(() => dialogs.showSetApiKeyDialog(dialogDeps())));

  reg('unode.onboarding', (options?: unknown) => guard(async () => {
    if (isOnboardingCompleteRequest(options)) {
      // Programmatic/test completion hook: just set the flag (no UI). The command-execution prompt
      // belongs to the real wizard "Finish" (onboardingDeps().complete()), not this hook.
      await context.workspaceState.update('roam.onboardingComplete', true);
      return context.workspaceState.get<boolean>('roam.onboardingComplete', false);
    }
    OnboardingWizard.createOrShow(context.extensionUri, onboardingDeps(context));
    return true;
  }));

  reg('unode.runDemoTask', (taskId?: string) => guard(() => runDemoTask(taskId)));

  reg('unode.openSettings', () =>
    SettingsPanel.createOrShow(context.extensionUri, {
      bridge: settingsBridge,
      promptAndStoreSecret: (secretName) => secrets.promptAndStore(secretName, secretName),
      openTeamFile: () => guard(openTeamFile),
      resetWorkspace: () => vscode.commands.executeCommand('unode.resetWorkspaceState'),
      listAgentTunings: () =>
        sessionManager.getAll().map((s) => ({
          id: s.config.id,
          name: s.config.name,
          role: s.config.role,
          providerId: s.config.provider?.providerId ?? '',
          backend: s.config.backend ?? defaultBackendKind(s.config),
          model: s.config.model,
          modelParams: s.config.modelParams,
          contextWindowTokens: s.config.contextWindowTokens,
        })),
      setAgentTuning: async (id, modelParams, contextWindowTokens) => {
        const info = sessionManager.get(id);

        if (!info) {
          return;
        }
        // Applies on the agent's next turn (openai-compat reads config each request via the resolver);
        // contextWindowTokens is read when the backend starts, so it takes effect on next start.
        info.config.modelParams = modelParams;
        info.config.contextWindowTokens = contextWindowTokens;
        await saveRoster();
        teamViewProvider?.refresh();
      },
      getSmartMode: () => {
        const sm = readSmartMode();
        const tiers = resolveModelTiers(
          vscode.workspace.getConfiguration('unode').get<Partial<Record<ModelTier, Record<string, string>>>>('modelTiers', {})
        );
        const providerIds = Array.from(new Set([
          ...Object.keys(tiers.premium),
          ...sessionManager.getAll().map((s) => s.config.provider.providerId),
        ]));
        return {
          enabled: sm.enabled,
          defaultTier: sm.defaultTier,
          roleTiers: sm.roleTiers ?? {},
          taskTierHints: sm.taskTierHints ?? {},
          modelTiers: tiers,
          providerIds,
        };
      },
      updateSmartMode: async (patch) => {
        const cfg = makeConfigStore();
        switch (patch.kind) {
          case 'enabled':
            await cfg.update('smartMode.enabled', patch.value);
            break;
          case 'defaultTier':
            await cfg.update('smartMode.defaultTier', patch.value);
            break;
          case 'roleTier': {
            const rt: Record<string, ModelTier> = { ...readSmartMode().roleTiers };
            if (patch.value) {
              rt[patch.role] = patch.value;
            } else {
              delete rt[patch.role];
            }
            await cfg.update('smartMode.roleTiers', rt);
            break;
          }
          case 'modelTierCell': {
            // Store only deltas in unode.modelTiers so future default changes still flow through.
            const raw = vscode.workspace.getConfiguration('unode').get<Record<string, Record<string, string>>>('modelTiers', {});
            const next: Record<string, Record<string, string>> = { ...raw, [patch.tier]: { ...(raw[patch.tier] ?? {}) } };
            if (patch.value) {
              next[patch.tier][patch.provider] = patch.value;
            } else {
              delete next[patch.tier][patch.provider];
            }
            await cfg.update('modelTiers', next);
            break;
          }
          case 'taskTierHints':
            await cfg.update('smartMode.taskTierHints', patch.value);
            break;
        }
      },
      // Reuse the Agent Builder's live model source so the tier-matrix datalists suggest each provider's real ids.
      listModels: (providerId, baseUrl) => agentBuilderListModels(providerId, baseUrl),
      // 0.9.8: live balance for ANY provider's Providers-tab card. Read host-side with that provider's stored
      // key (never sent to the webview); only the computed numbers + threshold cross the boundary. The billing
      // endpoint is new-api-style, so Roam/Unode (and custom new-api gateways) return a figure and others
      // (OpenAI/Anthropic/OpenRouter) just resolve to undefined → the card shows nothing.
      getProviderBalance: async (providerId: string) => {
        const provider = DEFAULT_PROVIDERS[providerId];
        if (!provider) { return undefined; }
        const apiKey = await secrets.get(provider.apiKeySecretName);
        if (!apiKey) { return undefined; }
        const base = providerId === 'roam' ? getConfiguredRoamBaseUrl()
          : providerId === 'unode' ? getConfiguredUnodeBaseUrl()
          : DEFAULT_PROVIDER_CONFIGS[providerId]?.baseUrl;
        if (!base) { return undefined; }
        const info = await balanceService.fetchBalance(base, apiKey);
        if (!info) { return undefined; }
        const thresholdUsd = vscode.workspace.getConfiguration('unode').get<number>('lowBalanceThresholdUsd', 5);
        return { ...info, thresholdUsd };
      },
    })
  );

  reg('unode.openMarketplace', (tab?: unknown) =>
    MarketplacePanel.createOrShow(
      context.extensionUri,
      (action) => handleMarketplaceInstall(action, context.extensionUri),
      asMarketplaceTab(tab)
    )
  );

  // Worktree fan-out: the "approve" action — merge the integration branch (all agents' reviewed work)
  // into your branch and refresh the checkout.
  reg('unode.worktree.finalize', () => guard(async () => {
    if (!worktreeCoordinator) { return; }
    const review = await gatherWorktreeReview();
    const r = await worktreeCoordinator.finalize(review.base);
    const msg =
      r.status === 'merged' ? `Merged the team's worktree work into ${r.branch}.`
      : r.status === 'nothing' ? 'Nothing to finalize — no new worktree work on the integration branch.'
      : r.status === 'conflict' ? `Finalize conflicted on: ${(r.conflictedFiles ?? []).join(', ')}. Resolve in the integration branch, then retry.`
      : `Finalize failed: ${r.message}`;
    void vscode.window.showInformationMessage(`UnodeAi: ${msg}`);
  }));

  // Worktree fan-out: the review board — each agent's isolation lane + what's staged on integration,
  // with a Finalize → your branch button.
  reg('unode.openWorktreeReview', () => WorktreePanel.createOrShow(
    context.extensionUri,
    gatherWorktreeReview,
    async () => {
      const review = await gatherWorktreeReview();
      const r = await worktreeCoordinator?.finalize(review.base);
      if (!r) { return { ok: false, message: 'Worktree mode is not active.' }; }
      const message =
        r.status === 'merged' ? `Merged the crew's work into ${r.branch}.`
        : r.status === 'nothing' ? 'Nothing to finalize yet.'
        : r.status === 'conflict' ? `Conflict on: ${(r.conflictedFiles ?? []).join(', ')} — resolve on the integration branch, then retry.`
        : `Finalize failed: ${r.message}`;
      return { ok: r.status === 'merged' || r.status === 'nothing', message };
    },
    // A2 lane actions use stable agentId; display names are not unique and can change mid-review.
    async (action) => {
      const wt = (worktreeCoordinator?.active() ?? []).find(
        (w) => w.agentId === action.agentId
      );
      if (!wt || !wt.agentId) {
        void vscode.window.showWarningMessage(`UnodeAi: that lane (${action.agentId}) is no longer active.`);
        return;
      }
      const agentName = sessionManager.get(wt.agentId)?.config.name ?? wt.agentId;
      if (action.command === 'openLaneDiff') {
        const diff = await laneDiff(wt.path, action.file);
        if (!diff.trim()) {
          void vscode.window.showInformationMessage(`No changes to show for ${agentName}${action.file ? ` · ${action.file}` : ''}.`);
          return;
        }
        const doc = await vscode.workspace.openTextDocument({ content: diff, language: 'diff' });
        await vscode.window.showTextDocument(doc, { preview: true });
        return;
      }
      if (action.command === 'reverifyLane') {
        const r = await worktreeCoordinator?.reverify(wt.agentId);
        void vscode.window.showInformationMessage(
          r ? `Re-verified ${agentName}: ${r.status}.` : 'Verification is not configured for this workspace.'
        );
        await refreshWorktreePanel();
        return;
      }
      // handBackLane: send the agent back to finish its worktree (its branch stays intact).
      messageBus.send('user', wt.agentId, 'ask.question', {
        instruction:
          `Please return to your worktree (${wt.branch}) and finish the task: review your changes, run ` +
          `the project's checks, fix anything failing, and complete the work. Your branch is intact.`,
        mode: 'act',
      }, 'normal');
      void vscode.window.showInformationMessage(`Handed the lane back to ${agentName}.`);
    }
  ));

}

async function guidedAddMcpServer(): Promise<void> {
  const start = await vscode.window.showQuickPick(
    [
      { label: '$(server) Add with guided form', action: 'guided' as const },
      { label: '$(json) Open .unode/team.json instead', action: 'open' as const },
    ],
    { title: 'Add MCP Server', placeHolder: 'Use the guided form or edit the team file directly' }
  );
  if (!start) {
    return;
  }
  if (start.action === 'open') {
    await openTeamFile();
    return;
  }

  const name = await vscode.window.showInputBox({
    title: 'Add MCP Server: Name',
    prompt: 'Enter a display name for this MCP server.',
    placeHolder: 'GitHub MCP',
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? null : 'Enter a server name.',
  });
  if (name === undefined) {
    return;
  }

  const transportPick = await vscode.window.showQuickPick(
    [
      { label: 'stdio', description: 'Run a local MCP command', transport: 'stdio' as const },
      { label: 'streamable-http', description: 'Connect to an HTTP MCP endpoint', transport: 'streamable-http' as const },
      { label: 'sse', description: 'Connect to an SSE MCP endpoint', transport: 'sse' as const },
      { label: '$(json) Open .unode/team.json instead', description: 'Edit the raw team file', transport: undefined },
    ],
    { title: 'Add MCP Server: Transport', placeHolder: 'Choose how UnodeAi connects to this server' }
  );
  if (!transportPick) {
    return;
  }
  if (!transportPick.transport) {
    await openTeamFile();
    return;
  }
  const transport: GuidedMcpTransport = transportPick.transport;

  let command: string | undefined;
  let args: string[] | undefined;
  let url: string | undefined;
  if (transport === 'stdio') {
    command = await vscode.window.showInputBox({
      title: 'Add MCP Server: Command',
      prompt: 'Enter the command that starts the MCP server.',
      placeHolder: 'npx',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? null : 'Enter a command.',
    });
    if (command === undefined) {
      return;
    }
    const rawArgs = await vscode.window.showInputBox({
      title: 'Add MCP Server: Arguments',
      prompt: 'Optional: enter command arguments separated by spaces.',
      placeHolder: '-y @modelcontextprotocol/server-filesystem ${WORKDIR}',
      ignoreFocusOut: true,
    });
    if (rawArgs === undefined) {
      return;
    }
    args = parseMcpArgs(rawArgs);
  } else {
    url = await vscode.window.showInputBox({
      title: 'Add MCP Server: Endpoint',
      prompt: 'Enter the MCP endpoint URL.',
      placeHolder: 'https://example.com/mcp',
      ignoreFocusOut: true,
      validateInput: (value) => isValidMcpUrl(value) ? null : 'Use a valid http:// or https:// URL.',
    });
    if (url === undefined) {
      return;
    }
  }

  const rawEnv = await vscode.window.showInputBox({
    title: 'Add MCP Server: Environment',
    prompt: 'Optional: KEY=${VAR} placeholders only. Separate multiple entries with commas or semicolons.',
    placeHolder: 'GITHUB_TOKEN=${GITHUB_TOKEN}',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const parsed = parseMcpEnvInput(value);
      return parsed.ok ? null : parsed.error;
    },
  });
  if (rawEnv === undefined) {
    return;
  }
  const parsedEnv = parseMcpEnvInput(rawEnv);
  if (!parsedEnv.ok) {
    vscode.window.showErrorMessage(`UnodeAi: ${parsedEnv.error}`);
    return;
  }

  const approvalPick = await vscode.window.showQuickPick(
    [
      { label: 'Yes, require approval', description: 'Recommended for local commands, network, files, and credentials', requiresApproval: true },
      { label: 'No', description: 'Mount without the sensitive-server approval prompt', requiresApproval: false },
    ],
    { title: 'Add MCP Server: Approval', placeHolder: 'Should this server require approval before mounting?' }
  );
  if (!approvalPick) {
    return;
  }

  const entry: McpCatalogEntry = {
    id: userMcpServerId(name),
    name: name.trim(),
    summary: 'User-added MCP server.',
    transport,
    command: command?.trim() || undefined,
    args,
    url: url?.trim() || undefined,
    env: parsedEnv.env,
    requiresApproval: approvalPick.requiresApproval,
  };
  const cfg = toMcpServerConfig(entry);
  mcpRegistry.set(cfg.id, cfg);
  await persistMcpServerToTeamFile(cfg);
  const res = mcpMountMessage(cfg.name, await mountMcpServer(cfg));
  if (res.ok) { vscode.window.showInformationMessage(`UnodeAi: ${res.message}`); }
  else { vscode.window.showWarningMessage(`UnodeAi: ${res.message}`); }
}

function userMcpServerId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
  return `user-${slug}-${Date.now().toString(36)}`;
}

/** Open (creating if needed) the versionable .unode/team.json. */
async function openTeamFile(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('Open a workspace folder to use .unode/team.json.');
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, '.unode', 'team.json');
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    const seed = Buffer.from(JSON.stringify({ version: '1.0', members: [], mcpServers: [] }, null, 2), 'utf8');
    await vscode.workspace.fs.writeFile(uri, seed);
  }
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
}

async function guard<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.error(msg);
    vscode.window.showErrorMessage(`UnodeAi: ${msg}`);
    return undefined;
  }
}

function onboardingDeps(context: vscode.ExtensionContext) {
  return {
    getBaseUrl: getConfiguredRoamBaseUrl,
    saveProvider: async (apiKey: string | undefined, baseUrl: string) => {
      await makeConfigStore().update('baseUrl', baseUrl);
      if (apiKey) {
        await secrets.set(DEFAULT_PROVIDERS.roam.apiKeySecretName, apiKey);
      }
    },
    createQuickStartTeam: async () => {
      // D1: the Team door now offers a preset picker (software crew or a knowledge-work team).
      await vscode.commands.executeCommand('unode.createTeamPreset');
    },
    createSolo: async () => {
      await vscode.commands.executeCommand('unode.startSolo');
    },
    createCustomAgent: async () => {
      await vscode.commands.executeCommand('unode.addAgent');
    },
    runDemoTask,
    complete: async () => {
      await context.workspaceState.update('roam.onboardingComplete', true);
      // When the user finishes the real wizard, offer to enable command execution (F2).
      await vscode.commands.executeCommand('unode.enableCommands');
    },
    openCommand: async (command: string) => {
      await vscode.commands.executeCommand(command);
    },
    openExternal: async (href: string) => {
      await vscode.env.openExternal(vscode.Uri.parse(href));
    },
    demoTasks: DEMO_TASKS,
  };
}

async function runDemoTask(taskId?: string): Promise<void> {
  let task = typeof taskId === 'string' ? DEMO_TASKS.find((t) => t.id === taskId) : undefined;
  if (!task) {
    const pick = await vscode.window.showQuickPick(
      DEMO_TASKS.map((t) => ({
        label: t.title,
        description: t.description,
        detail: t.expectedOutcome,
        id: t.id,
      })),
      { title: 'UnodeAi: Run Demo Task', placeHolder: 'Choose a demo task to send to the Project Manager' }
    );
    if (!pick) {
      return;
    }
    task = DEMO_TASKS.find((t) => t.id === pick.id);
  }
  if (!task) {
    return;
  }

  const sessions = sessionManager.getAll();
  if (sessions.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No agents yet. Run the Setup Wizard first?', 'Run Setup Wizard'
    );
    if (choice === 'Run Setup Wizard') {
      await vscode.commands.executeCommand('unode.onboarding');
    }
    return;
  }

  let pm = sessions.find((s) => s.config.role === 'pm');
  if (!pm) {
    const choice = await vscode.window.showInformationMessage(
      'No Project Manager found. Create a team?', 'Create Team'
    );
    if (choice === 'Create Team') {
      await vscode.commands.executeCommand('unode.createTeamPreset');
      pm = sessionManager.getAll().find((s) => s.config.role === 'pm');
    }
  }
  if (!pm) {
    return;
  }

  messageBus.send('user', pm.config.id, 'task.assign', { instruction: task.prompt, files: [] }, 'normal');
  outputChannel.info(`Demo task sent to ${pm.config.name}: ${task.title}`);
  vscode.window.showInformationMessage(`Sent "${task.title}" to ${pm.config.name}.`);
}

function isOnboardingCompleteRequest(value: unknown): value is { completeImmediately: true } {
  return !!value && typeof value === 'object' && (value as { completeImmediately?: unknown }).completeImmediately === true;
}

// ─── Dialogs ──────────────────────────────────────────────────────────

/** Bundle the singletons the extracted dialog flows need (see dialogs.ts). */
function dialogDeps(): DialogDeps {
  return {
    sessionManager,
    messageBus,
    workflowEngine,
    secrets,
    modelCatalog,
    pricing,
    output: outputChannel,
    commandPolicy, refreshPrices,
    defaultBackendKind,
    onRosterChanged: () => { teamViewProvider?.refresh(); updateStatusBar(); void saveRoster(); notifyPmRosterChange(); },
  };
}

/** Debounce so a bulk team-creation (several agents at once) tells the PM ONCE, not per agent. */
let rosterNotifyTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * #3: when the team gains or loses an agent, tell the Project Manager so it can adjust assignments to the
 * new personnel/resources. The roster itself is already persisted (saveRoster) and queryable via
 * list_agents; this is the PROACTIVE nudge. Debounced; no-op when there's no PM coordinator to tell.
 */
function notifyPmRosterChange(): void {
  if (rosterNotifyTimer) { clearTimeout(rosterNotifyTimer); }
  rosterNotifyTimer = setTimeout(() => {
    const sessions = sessionManager.getAll();
    const pm = sessions.find((s) => s.config.role === 'pm');
    if (!pm) { return; } // no coordinator → nobody to tell (Solo / no-PM team)
    const teammates = sessions
      .filter((s) => s.config.id !== pm.config.id)
      .map((s) => `${s.config.name} (${s.config.role})`);
    const roster = teammates.length ? teammates.join(', ') : '(no teammates)';
    messageBus.send('user', pm.config.id, 'ask.question', {
      instruction:
        `[Team update] Your roster changed — current teammates: ${roster}. ` +
        `If this affects your plan (a new capability is now available, or someone you intended to delegate ` +
        `to is gone), adjust your assignments accordingly. Otherwise just acknowledge briefly — no work needed.`,
      mode: 'act',
    }, 'normal');
  }, 1500);
}

// ─── Marketplace install (M4) ──────────────────────────────────────────

let cachedMarketplaceCatalog: MarketplaceCatalog | undefined;

/** Load + cache the effective marketplace catalog (bundled + optional hosted), matching the panel. */
async function loadMarketplaceCatalog(extensionUri: vscode.Uri): Promise<MarketplaceCatalog> {
  if (cachedMarketplaceCatalog) { return cachedMarketplaceCatalog; }
  const read = async (name: CatalogSourceName): Promise<unknown> => {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'marketplace', `${name}.json`));
      return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      return [];
    }
  };
  const bundled: RawCatalog = { agents: await read('agents'), mcp: await read('mcp'), skills: await read('skills') };
  const cfg = vscode.workspace.getConfiguration('unode');
  const url = cfg.get<string>('marketplace.catalogUrl', '').trim();
  const hosted = cfg.get<boolean>('marketplace.fetchCatalog', false) && url
    ? { url, timeoutMs: 5000, verify: { publicKeyPem: ROAM_CATALOG_PUBLIC_KEY_PEM } }
    : undefined;
  cachedMarketplaceCatalog = await resolveCatalog({ bundled, hosted, warn: (m) => outputChannel.warn(`Marketplace: ${m}`) });
  return cachedMarketplaceCatalog;
}

async function agentBuilderViewModel(extensionUri: vscode.Uri, agentId?: string): Promise<AgentBuilderViewModel> {
  const catalog = await loadMarketplaceCatalog(extensionUri);
  const agent = agentId ? sessionManager.get(agentId)?.config : undefined;
  const tiers = resolveModelTiers(
    vscode.workspace.getConfiguration('unode').get<Partial<Record<ModelTier, Record<string, string>>>>('modelTiers', {})
  );
  const roles = Object.entries(ROLE_TEMPLATES).map(([id, template]) => ({
    id,
    name: template.name,
    role: template.role,
    description: template.description,
    icon: template.icon,
    color: template.color,
    systemPrompt: template.systemPrompt,
    skillIds: template.skills.map((s) => s.id),
    providerId: 'roam',
    model: modelForRole(template, 'roam') ?? modelForTier('standard', 'roam', tiers) ?? 'deepseek-v4-flash',
  }));
  const providers = Object.entries(DEFAULT_PROVIDER_CONFIGS).filter(([id]) => isSupportedProviderId(id)).map(([id, provider]) => ({
    id,
    name: provider.name,
    baseUrl: id === 'roam' ? getConfiguredRoamBaseUrl() : provider.baseUrl,
    models: provider.models.map((model) => ({ id: model.id, name: model.name })),
  }));
  const capabilities = Object.values(SKILL_LIBRARY).map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
  }));
  const mcpServers = [...mcpRegistry.values()].map((cfg) => ({
    id: cfg.id,
    name: cfg.name,
    transport: cfg.transport,
    connected: !!mcpHub.listServers().find((s) => s.id === cfg.id),
    requiresApproval: !!cfg.requiresApproval,
  }));
  return {
    mode: agent ? 'edit' : 'new',
    agent: agent ? {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      roleLabel: agent.role,
      icon: agent.icon,
      color: agent.color,
      providerId: agent.provider.providerId,
      model: agent.model,
      fallbackModel: agent.fallbackModel,
      toolProtocol: agent.toolProtocol ?? 'auto', // undefined (stored) = Auto in the builder UI
      systemPrompt: agent.systemPrompt,
      skillIds: (agent.skills ?? []).map((s) => s.id),
      playbooks: agent.playbooks ?? [],
      mcpServers: agent.mcpServers ?? [],
      modelParams: agent.modelParams,
      contextWindowTokens: agent.contextWindowTokens,
      tier: agent.tier ?? '',
      smartModeEnabled: readSmartMode().enabled,
    } : undefined,
    roles,
    providers,
    capabilities,
    mcpServers,
    catalog,
    skillLibraryUrl: vscode.workspace.getConfiguration('unode').get<string>(
      'marketplace.skillLibraryUrl',
      'https://github.com/weroamxyz/unode-skills'
    ),
  };
}

async function agentBuilderListModels(
  providerId: string,
  baseUrl?: string
): Promise<Array<{ id: string; name: string; price?: string }>> {
  const provider = DEFAULT_PROVIDERS[providerId];
  if (!provider) {
    return [];
  }
  // Don't let a slow /api/pricing (or an extra pricing source) hang the model dropdown: wait briefly
  // for live (discounted) prices, but fall through after 1.5s and return models with whatever prices are
  // already cached. refreshPrices keeps running and the cache is warm for the next provider switch.
  await Promise.race([refreshPrices(), new Promise((resolve) => setTimeout(resolve, 1500))]);
  const configuredBase = baseUrl?.trim() || DEFAULT_PROVIDER_CONFIGS[providerId]?.baseUrl;
  const resolvedBase = resolveModelCatalogBaseUrl(providerId, configuredBase, getConfiguredRoamBaseUrl());
  const apiKey = await secrets.get(provider.apiKeySecretName);
  const models = await modelCatalog.list(providerId, resolvedBase, apiKey);
  // Our price table is the gateway's pricing — it applies to the Roam AND Unode gateways (both fetch
  // /api/pricing into the same table), but NOT to a model served by another provider (e.g. gpt-4o billed by
  // OpenAI directly), so don't show a misleading gateway price there. (modelPriceLabel returns undefined when
  // there's no known price, so unknown gateway models also show no price.)
  const gatewayPriced = providerId === 'roam' || providerId === 'unode';
  return models.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    price: gatewayPriced ? modelPriceLabel(model.id) : undefined,
  }));
}

function modelPriceLabel(modelId: string): string | undefined {
  const p = pricing?.priceFor(modelId);
  return p ? `$${p.input}/$${p.output} per 1M` : undefined;
}

async function pickAgentBuilderIcon(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Images: ['png', 'jpg', 'jpeg', 'webp', 'svg'] },
    title: 'Choose Agent Icon',
  });
  const uri = picked?.[0];
  if (!uri) {
    return undefined;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  if (bytes.byteLength > MAX_AGENT_ICON_BYTES) {
    void vscode.window.showWarningMessage('Use a small icon under 64 KB');
    return undefined;
  }

  const mime = mimeForAgentIcon(uri.fsPath);
  if (!mime) {
    void vscode.window.showWarningMessage('Choose a PNG, JPEG, WebP, or SVG icon.');
    return undefined;
  }
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function mimeForAgentIcon(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    default: return undefined;
  }
}

async function handleAgentBuilderSave(
  payload: AgentBuilderSavePayload,
  extensionUri: vscode.Uri
): Promise<{ ok: boolean; message: string }> {
  const provider = DEFAULT_PROVIDERS[payload.providerId];
  if (!provider) {
    return { ok: false, message: 'Unknown provider.' };
  }
  const template = payload.roleKey === 'custom' ? undefined : ROLE_TEMPLATES[payload.roleKey];
  if (payload.roleKey !== 'custom' && !template) {
    return { ok: false, message: 'Unknown role template.' };
  }
  const catalog = await loadMarketplaceCatalog(extensionUri);
  const roleName = payload.roleKey === 'custom' ? payload.customRole! : template!.role;
  const role = roleName as AgentConfig['role'];
  const skills = payload.skillIds.map((id) => SKILL_LIBRARY[id]).filter(Boolean);
  const systemPrompt = applyPlaybooks(payload.systemPrompt, payload.playbooks, catalog.skills);
  const existing = payload.id ? sessionManager.get(payload.id) : undefined;
  // Capture BEFORE the mutations below (config === existing.config, so these get overwritten).
  const priorSkills = existing?.config.skills ?? [];
  const priorTools = existing?.config.allowedTools ?? [];
  const config = existing?.config ?? new AgentConfigBuilder(role)
    .setName(payload.name)
    .setProviderRef(provider)
    .setModel(payload.model)
    .setSystemPrompt(systemPrompt)
    .setSkills(payload.skillIds)
    .setAutoApprove(false)
    // No setWorkingDirectory: the runtime resolves the root per session (SessionInfo.runtimeWorkingDirectory).
    // Pinning the workspace-at-save went stale when the agent later ran elsewhere ("outside working folder").
    .build();

  config.name = payload.name;
  config.role = role;
  config.skill = payload.skillIds[0] ?? payload.customRole ?? String(role);
  config.skills = skills;
  // Data-loss guard: a legacy/external/hand-written agent may have allowedTools but no skill metadata
  // to render as checkboxes. If so, saving with no skills selected must NOT wipe its tools (which would
  // strip a PM's delegate/message/read/search). Keep the prior tools only for that case; a normal
  // skills-based agent still re-derives (so unchecking skills genuinely reduces it).
  const resolvedTools = skillResolver.resolveAllowedTools(skills);
  const legacyNoSkillMeta = priorSkills.length === 0 && priorTools.length > 0;
  config.allowedTools = (skills.length === 0 && legacyNoSkillMeta) ? priorTools : resolvedTools;
  config.provider = { ...provider };
  config.model = payload.model;
  config.fallbackModel = payload.fallbackModel || undefined;
  // 'auto' (the default) persists as undefined so the backend can start known tool-call leakers
  // (Kimi/Moonshot/GLM/MiniMax) in XML automatically (v0.8.14). Only an explicit Native/XML is stored.
  config.toolProtocol = payload.toolProtocol === 'native' ? 'native' : payload.toolProtocol === 'xml' ? 'xml' : undefined;
  config.systemPrompt = systemPrompt;
  config.icon = payload.icon || template?.icon;
  config.color = payload.color || template?.color;
  config.mcpServers = payload.mcpServers;
  config.playbooks = payload.playbooks;
  // Do NOT pin/persist a workingDirectory here. It used to be set to the workspace-at-save, which went stale
  // when the agent later ran in a different folder ("outside working folder"). The runtime resolves the root
  // each session (worktree path or current workspace) and records it on SessionInfo.runtimeWorkingDirectory —
  // that is the single source of truth. Leaving config.workingDirectory unset keeps team.json portable.
  // Per-agent model fine-tuning: the user's edits from the builder win. If they left every field blank,
  // a brand-new agent falls back to the role template's defaults; an edited agent clears to global defaults.
  config.modelParams = payload.modelParams ?? (!existing && template?.modelParams ? { ...template.modelParams } : undefined);
  // Per-agent context-window override (undefined = the 128k default).
  config.contextWindowTokens = payload.contextWindowTokens;
  // Per-agent Smart Mode tier override (undefined = follow the role/default tier).
  config.tier = payload.tier;
  config.backend = defaultBackendKind(config);

  for (const id of payload.mcpServers) {
    const cfg = mcpRegistry.get(id);
    if (cfg) {
      await mountMcpServer(cfg);
    }
  }

  if (existing) {
    await saveRoster();
    if (shouldRestartAfterAgentConfigEdit(existing.status)) {
      await sessionManager.restart(existing.id);
    }
    teamViewProvider?.refresh();
    chatViewProvider?.refresh();
    return { ok: true, message: `Updated ${config.name}.` };
  }

  sessionManager.create(config);
  notifyPmRosterChange();
  return { ok: true, message: `Added ${config.name} to your team.` };
}

/**
 * M4: perform a marketplace install chosen in the panel. Agents reuse the normal add path
 * (AgentConfigBuilder → sessionManager.create, which auto-persists the roster); MCP servers are
 * written to .unode/team.json + mounted through the existing approval gate. Skills land in Phase 3.
 */
async function handleMarketplaceInstall(
  action: MarketplaceInstallAction,
  extensionUri: vscode.Uri
): Promise<{ ok: boolean; message: string }> {
  const catalog = await loadMarketplaceCatalog(extensionUri);

  if (action.kind === 'agent') {
    const entry = catalog.agents.find((e) => e.id === action.entryId);
    if (!entry) { return { ok: false, message: 'Unknown agent preset.' }; }
    if (action.target === 'new-team') {
      const current = sessionManager.getAll();
      if (current.length > 0) {
        const choice = await vscode.window.showWarningMessage(
          `Start a new team with "${entry.name}"? This removes your current ${current.length} agent(s).`,
          { modal: true }, 'Replace', 'Cancel'
        );
        if (choice !== 'Replace') { return { ok: false, message: 'Cancelled — team unchanged.' }; }
        for (const s of [...current]) { await sessionManager.remove(s.id); }
      }
    }
    // No cwd: the runtime resolves the working root per session — don't pin it onto the installed config.
    const config = toAgentConfig(entry, { name: dialogs.uniqueAgentName(dialogDeps(), entry.name) });
    config.backend = defaultBackendKind(config);
    // B2 "members come equipped": fold the member's skill playbooks (skills.json bodies) into its
    // system prompt so the agent carries them as standing procedure.
    config.systemPrompt = mountSkillPlaybooks(config.systemPrompt, entry.skills, catalog.skills);
    sessionManager.create(config); // fires session.created → roster persisted + team panel refresh
    notifyPmRosterChange();
    return { ok: true, message: `Added ${config.name} to your team.` };
  }

  if (action.kind === 'mcp') {
    const entry = catalog.mcp.find((e) => e.id === action.entryId);
    if (!entry) { return { ok: false, message: 'Unknown MCP server.' }; }
    const cfg = toMcpServerConfig(entry);
    const promptedUrl = await promptMarketplaceMcpUrl(entry);
    if (promptedUrl === undefined && entry.urlPrompt) {
      return { ok: false, message: 'Cancelled — MCP server unchanged.' };
    }
    if (promptedUrl) {
      cfg.url = promptedUrl.trim();
    }
    mcpRegistry.set(cfg.id, cfg);
    await persistMcpServerToTeamFile(cfg);
    // Reflect the REAL mount outcome (declined approval / failed) instead of always claiming success.
    return mcpMountMessage(cfg.name, await mountMcpServer(cfg));
  }

  return { ok: false, message: 'Skill install arrives in Phase 3.' };
}

async function promptMarketplaceMcpUrl(entry: McpCatalogEntry): Promise<string | undefined> {
  if (!entry.urlPrompt) {
    return undefined;
  }
  return vscode.window.showInputBox({
    title: entry.urlPrompt.title,
    prompt: entry.urlPrompt.prompt,
    placeHolder: entry.urlPrompt.placeHolder,
    value: entry.urlPrompt.value,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return 'Enter an MCP endpoint URL.';
      }
      try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
          ? null
          : 'Use an http:// or https:// MCP endpoint.';
      } catch {
        return 'Enter a valid MCP endpoint URL.';
      }
    },
  }).then((value) => value?.trim());
}

/** Read-modify-write the team MCP registry in .unode/team.json (best-effort; in-memory registry already updated). */
async function persistMcpServerToTeamFile(cfg: MCPServerConfig): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return; } // no workspace → in-memory registry only (lost on reload)
  const uri = vscode.Uri.joinPath(folder.uri, '.unode', 'team.json');
  let doc: { version?: string; members?: unknown[]; mcpServers?: MCPServerConfig[] } = {
    version: '1.0', members: [], mcpServers: [],
  };
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (parsed && typeof parsed === 'object') { doc = parsed; }
  } catch { /* file missing/unreadable → seed a fresh one */ }
  const servers = Array.isArray(doc.mcpServers) ? doc.mcpServers : [];
  doc.mcpServers = [...servers.filter((s) => s.id !== cfg.id), cfg];
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(doc, null, 2), 'utf8'));
}

// ─── Status Bar ────────────────────────────────────────────────────────

function updateStatusBar(): void {
  const sessions = sessionManager.getAll();
  const active = sessions.filter((s) => s.status === 'running' || s.status === 'idle').length;
  const total = sessions.length;

  // Keep the version in every state (the always-visible anchor); agent count rides alongside it.
  const v = unodeVersion ? ` v${unodeVersion}` : '';
  if (total === 0) {
    statusBarItem.text = `$(organization) Unode${v}`;
  } else if (active > 0) {
    statusBarItem.text = `$(pulse) Unode${v} · ${active}/${total}`;
  } else {
    statusBarItem.text = `$(circle-slash) Unode${v} · ${total}`;
  }
}
