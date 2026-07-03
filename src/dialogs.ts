/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Dialogs (extracted from extension.ts, P1#8)
 *  All the QuickPick/InputBox flows (add agent, default team, send message, run workflow, set key)
 *  plus the model picker. Pulled out of extension.ts to keep the entry point a thin orchestrator.
 *  Dependencies are passed in via DialogDeps rather than reaching for module globals.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentConfig, AgentBackendKind, Message } from './types';
import { SessionManager } from './session/SessionManager';
import { MessageBus } from './bus/MessageBus';
import { WorkflowEngine } from './workflow/WorkflowEngine';
import { SecretsManager } from './secrets/SecretsManager';
import { ModelCatalog, ModelInfo } from './models/ModelCatalog';
import { ModelPricing } from './models/ModelPricing';
import { resolveModelCatalogBaseUrl } from './models/modelCatalogBaseUrl';
import { CommandPolicy } from './backend/CommandPolicy';
import { promptCommandApproval } from './backend/CommandApprovalPrompter';
import { isSupportedProviderId } from './backend/backendKind';
import { canonicalRoamBaseUrl } from './backend/openAICompatBaseUrl';
import {
  AgentConfigBuilder,
  ROLE_TEMPLATES,
  TEAM_PRESETS,
  TeamPreset,
  DEFAULT_PROVIDERS,
  DEFAULT_PROVIDER_CONFIGS,
  modelForRole,
} from './roles/RoleConfig';

export interface DialogDeps {
  sessionManager: SessionManager;
  messageBus: MessageBus;
  workflowEngine: WorkflowEngine;
  secrets: SecretsManager;
  modelCatalog: ModelCatalog;
  pricing: ModelPricing;
  commandPolicy: CommandPolicy;
  output: vscode.LogOutputChannel;
  refreshPrices: () => Promise<void> | void;
  defaultBackendKind: (c: AgentConfig) => AgentBackendKind;
  /** Persist the roster + refresh the team view after an in-place edit (P2#14). */
  onRosterChanged?: () => void;
}

/** A team-unique agent name: returns `base`, or `base 2`, `base 3`… if already taken. */
export function uniqueAgentName(d: DialogDeps, base: string): string {
  const existing = new Set(d.sessionManager.getAll().map((s) => s.config.name));
  if (!existing.has(base)) { return base; }
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!existing.has(candidate)) { return candidate; }
  }
}

/** Pre-filled endpoint + model for the add-agent dialog, per provider. */
function endpointDefaults(providerKey: string): { baseUrl: string; model: string } {
  switch (providerKey) {
    case 'roam':
      return {
        baseUrl: configuredRoamBaseUrl(),
        model: 'deepseek-v4-flash',
      };
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' };
    default: {
      // Any other OpenAI-compatible provider (e.g. openrouter): use its built-in config defaults.
      const cfg = DEFAULT_PROVIDER_CONFIGS[providerKey];
      return { baseUrl: cfg?.baseUrl ?? '', model: cfg?.models?.[0]?.id ?? '' };
    }
  }
}

function configuredRoamBaseUrl(): string {
  // Never let a stale persisted unode/OpenAI roam.baseUrl win — collapse it to the weroam gateway.
  return canonicalRoamBaseUrl(vscode.workspace.getConfiguration('roam').get<string>('baseUrl', DEFAULT_PROVIDER_CONFIGS.roam.baseUrl));
}

function modelCatalogBaseUrl(providerKey: string, baseUrl?: string): string | undefined {
  return resolveModelCatalogBaseUrl(providerKey, baseUrl, configuredRoamBaseUrl());
}

/**
 * Model picker for the add-agent dialog. Opens immediately with the static list, then asynchronously
 * fills in the live catalog (gateway /v1/models + optional Roam-hosted catalog) via ModelCatalog.
 * Always accepts a free-typed model id too, so an empty/slow catalog never blocks the user.
 */
async function pickModel(
  d: DialogDeps,
  providerKey: string,
  defaultModel: string,
  baseUrl?: string,
  apiKey?: string
): Promise<string | undefined> {
  void d.refreshPrices(); // selecting a model is a good moment to make sure prices are current

  const priceLabel = (id: string): string => {
    const p = d.pricing?.priceFor(id);
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
    ].filter(Boolean).join(' · '),
  });

  return new Promise<string | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick();
    qp.title = 'UnodeAi — Model  ·  browse models & pricing: https://ai.weroam.xyz/pricing?lang=en';
    qp.placeholder = 'Pick a model or type a custom model id (e.g. deepseek-v4-flash, gpt-4o)';
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;

    let catalogItems: vscode.QuickPickItem[] = [];
    let done = false;

    const rebuild = (): void => {
      const typed = qp.value.trim();
      const exists = catalogItems.some((i) => i.label === typed);
      qp.items = typed && !exists ? [{ label: typed, description: 'custom model id' }, ...catalogItems] : catalogItems;
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

    d.modelCatalog
      .list(providerKey, modelCatalogBaseUrl(providerKey, baseUrl), apiKey)
      .then((models) => {
        if (done) { return; }
        // If nothing came from a live source (curated catalog or the gateway /models endpoint), the
        // list is the built-in static fallback — surface that non-blockingly instead of silently
        // showing only a handful of models (looks like a regression; usually a missing key/base URL).
        const liveOk = models.some((m) => m.source !== 'static');
        const notice: vscode.QuickPickItem[] = liveOk ? [] : [{
          label: 'Live model list unavailable — showing built-in defaults (check API key / base URL)',
          kind: vscode.QuickPickItemKind.Separator,
        }];
        catalogItems = [...notice, ...models.map(toItem)];
        rebuild();
        const recommended = catalogItems.find((i) => i.label === defaultModel);
        if (recommended) {
          qp.activeItems = [recommended];
        } else if (defaultModel && !qp.value) {
          qp.value = defaultModel;
          rebuild();
        }
      })
      .catch((err) => d.output.warn(`Model catalog fetch failed: ${String(err)}`))
      .finally(() => {
        if (!done) { qp.busy = false; }
      });
  });
}

/**
 * One-click onboarding: stand up a ready-to-run PM + Architect + Senior Developer + Reviewer team
 * on Roam, so a new user sees the core "PM orchestrates a crew" value in seconds.
 */
/** Shared: instantiate a team of the given roles on Roam, then prompt for API key + command enablement. */
async function instantiateTeam(
  d: DialogDeps,
  roleKeys: (keyof typeof ROLE_TEMPLATES)[],
  label: string
): Promise<AgentConfig[]> {
  const created: AgentConfig[] = [];
  for (const roleKey of roleKeys) {
    const template = ROLE_TEMPLATES[roleKey];
    // No setWorkingDirectory: the runtime resolves the root per session (SessionInfo.runtimeWorkingDirectory).
    const config = new AgentConfigBuilder(template.role)
      .fromTemplate(roleKey)
      .setName(uniqueAgentName(d, template.name))
      .setProviderById('roam')
      .setModel(modelForRole(template, 'roam'))
      .setAutoApprove(false)
      .build();
    config.backend = d.defaultBackendKind(config); // roam -> openai-compat
    d.sessionManager.create(config);
    created.push(config);
  }
  d.output.info(`Created team: ${label} (Roam).`);

  if (!(await d.secrets.has('ROAM_API_KEY'))) {
    const choice = await vscode.window.showInformationMessage(
      `Team created (${label}). Set your Roam API key to start working.`, 'Set API Key'
    );
    if (choice === 'Set API Key') {
      await d.secrets.promptAndStore('ROAM_API_KEY', 'ROAM_API_KEY');
    }
  } else {
    vscode.window.showInformationMessage(`Team created: ${label}. Send the PM a task to begin.`);
  }
  // F2: after creating a team, proactively suggest enabling commands
  const accepted = await promptCommandApproval(d.commandPolicy.approvalMode);
  if (accepted) {
    const cfg = vscode.workspace.getConfiguration('roam');
    d.commandPolicy.reload(
      cfg.get<'none' | 'allowlist' | 'all'>('commandApproval', 'none') as any,
      cfg.get<string[]>('allowedCommands', [])
    );
  }
  return created;
}

export async function createDefaultTeam(d: DialogDeps): Promise<AgentConfig[]> {
  if (d.sessionManager.getAll().length > 0) {
    const choice = await vscode.window.showWarningMessage(
      'You already have agents. Add the default PM + Architect + Developer + Reviewer team anyway?', 'Add', 'Cancel'
    );
    if (choice !== 'Add') { return []; }
  }
  return instantiateTeam(d, ['pm', 'architect', 'senior-dev', 'reviewer'], 'PM + Architect + Developer + Reviewer');
}

/**
 * D1 UI: create a new team from a preset, or switch by replacing the current one.
 * Persistence model note: UnodeAi currently stores ONE active roster in workspaceState,
 * optionally mirrored/seeded by one `.roam/team.json`; there is no multi-team profile store.
 */
export type TeamPresetItem = vscode.QuickPickItem & {
  roles: (keyof typeof ROLE_TEMPLATES)[];
  teamLabel: string;
  presetKind: NonNullable<TeamPreset['kind']>;
  verifyCommand?: string;
};

function isTeamPresetItem(item: vscode.QuickPickItem): item is TeamPresetItem {
  return Array.isArray((item as TeamPresetItem).roles);
}

export function teamPresetItems(): vscode.QuickPickItem[] {
  const specialists = (roles: (keyof typeof ROLE_TEMPLATES)[]) =>
    roles.filter((r) => r !== 'pm').map((r) => ROLE_TEMPLATES[r]?.name ?? r).join(', ');
  const software: TeamPresetItem = {
    label: '$(organization) Software Team',
    description: 'PM + Architect + Developer + Reviewer',
    detail: 'Full coding crew with an independent review gate.',
    roles: ['pm', 'architect', 'senior-dev', 'reviewer'],
    teamLabel: 'Software Team (PM + Architect + Developer + Reviewer)',
    presetKind: 'software',
  };
  const fromPreset = (p: TeamPreset): TeamPresetItem => ({
    label: `${p.kind === 'pack' ? '$(tools)' : '$(briefcase)'} ${p.label}`,
    description: p.description ?? `PM + ${specialists(p.roles)}`,
    detail: `Roles: PM + ${specialists(p.roles)}${p.verifyCommand ? ` | Verify: ${p.verifyCommand}` : ''}`,
    roles: p.roles,
    teamLabel: p.label,
    presetKind: p.kind ?? 'knowledge',
    verifyCommand: p.verifyCommand,
  });
  const presets = Object.values(TEAM_PRESETS);
  return [
    { label: 'Software', kind: vscode.QuickPickItemKind.Separator },
    software,
    { label: 'Task Packs', kind: vscode.QuickPickItemKind.Separator },
    ...presets.filter((p) => p.kind === 'pack').map(fromPreset),
    { label: 'Knowledge Work', kind: vscode.QuickPickItemKind.Separator },
    ...presets.filter((p) => (p.kind ?? 'knowledge') === 'knowledge').map(fromPreset),
  ];
}

async function pickTeamPreset(title: string, placeHolder: string): Promise<TeamPresetItem | undefined> {
  const pick = await vscode.window.showQuickPick(teamPresetItems(), { title, placeHolder, matchOnDetail: true });
  return pick && isTeamPresetItem(pick) ? pick : undefined;
}

async function createPickedTeam(d: DialogDeps, pick: TeamPresetItem): Promise<AgentConfig[]> {
  const created = await instantiateTeam(d, pick.roles, pick.teamLabel);
  if (created.length > 0) {
    await maybeOfferVerifyCommand(pick);
  }
  return created;
}

async function maybeOfferVerifyCommand(pick: TeamPresetItem): Promise<void> {
  const command = pick.verifyCommand?.trim();
  if (!command) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration('roam');
  const current = cfg.get<string>('verifyCommand', '').trim();
  if (current === command) {
    // Already configured — confirm it so the user knows the gate is wired for this crew (no silent no-op).
    void vscode.window.showInformationMessage(`${pick.teamLabel}: verification gate is set to "${command}". ✓`);
    return;
  }
  // Modal so it can't be missed in the notification corner — configuring the verify gate is the point of
  // a Team Pack, and it changes how the PM reports "done" (verified-only). The user still decides.
  if (!current) {
    const choice = await vscode.window.showInformationMessage(
      `${pick.teamLabel} works best with a verification command so "only verified work lands". Set roam.verifyCommand to "${command}"?`,
      { modal: true },
      'Use Verify Command',
      'Skip'
    );
    if (choice === 'Use Verify Command') {
      await cfg.update('verifyCommand', command, vscode.ConfigurationTarget.Workspace);
      void vscode.window.showInformationMessage(`roam.verifyCommand set to "${command}" for ${pick.teamLabel}.`);
    }
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `roam.verifyCommand is already "${current}". Replace it with "${command}" for ${pick.teamLabel}?`,
    { modal: true },
    'Replace',
    'Keep Existing'
  );
  if (choice === 'Replace') {
    await cfg.update('verifyCommand', command, vscode.ConfigurationTarget.Workspace);
  }
}

export async function createTeamFromPreset(d: DialogDeps): Promise<AgentConfig[]> {
  type ActionItem = vscode.QuickPickItem & ({ action: 'create' } | { action: 'switch'; preset: TeamPresetItem });
  const currentCount = d.sessionManager.getAll().length;
  const actions: ActionItem[] = [
    {
      label: '$(plus) Create a new team...',
      description: 'Pick a preset and add it to the current roster',
      detail: 'Keeps existing agents unless you cancel at the add confirmation.',
      action: 'create',
    },
    ...teamPresetItems().filter(isTeamPresetItem).map((preset): ActionItem => ({
      ...preset,
      description: currentCount > 0 ? `Switch - replace ${currentCount} current agent(s)` : 'Switch to this preset',
      detail: currentCount > 0 ? `Replaces your active roster with ${preset.teamLabel}.` : `Creates ${preset.teamLabel}.`,
      action: 'switch',
      preset,
    })),
  ];
  const action = await vscode.window.showQuickPick(actions, {
    title: 'Create or Switch Team',
    placeHolder: 'Create a new team, or switch by replacing the current active roster',
  });
  if (!action) { return []; }

  if (action.action === 'create') {
    const pick = await pickTeamPreset('Create a Team', 'Pick a team to create (on Roam)');
    if (!pick) { return []; }
    if (currentCount > 0) {
      const choice = await vscode.window.showWarningMessage(
        `You already have agents. Add the "${pick.teamLabel}" team anyway?`,
        'Add',
        'Cancel'
      );
      if (choice !== 'Add') { return []; }
    }
    return createPickedTeam(d, pick);
  }

  if (currentCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      `This replaces your current ${currentCount} agent(s) with "${action.preset.teamLabel}". Continue?`,
      { modal: true },
      'Continue',
      'Cancel'
    );
    if (choice !== 'Continue') { return []; }
    for (const session of [...d.sessionManager.getAll()]) {
      await d.sessionManager.remove(session.id);
    }
  }
  return createPickedTeam(d, action.preset);
}
/**
 * Solo / Fast mode (v0.3.0): create the single generalist "Solo" agent on Roam. One agent that does
 * the whole task itself (no delegation, no review gate) — the fast path for simple/everyday work.
 * Returns the existing solo agent if there already is one (idempotent).
 */
/**
 * Pick the folder a Solo agent will read/write/run inside (G-003c). Defaults to the open workspace
 * folder(s) but lets the user choose any folder on disk — so you can point the agent at a project
 * without having to open it as the VS Code workspace. Returns undefined if the user cancels.
 */
export async function resolveSoloWorkingDirectory(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const CHOOSE = 'choose';
  const items: (vscode.QuickPickItem & { value: string })[] = folders.map((f) => ({
    label: `$(folder) ${f.name}`,
    description: f.uri.fsPath,
    value: f.uri.fsPath,
  }));
  items.push({
    label: '$(folder-opened) Choose another folder…',
    description: 'Pick any folder on disk for this agent to work in',
    value: CHOOSE,
  });

  let chosen: string;
  if (folders.length === 0) {
    chosen = CHOOSE; // no workspace open → go straight to the folder picker
  } else {
    const pick = await vscode.window.showQuickPick(items, {
      title: 'Solo agent — working folder',
      placeHolder: 'Where should this agent read, write, and run commands?',
    });
    if (!pick) { return undefined; }
    chosen = pick.value;
  }

  if (chosen === CHOOSE) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: "Choose the Solo agent's working folder",
      openLabel: 'Work here',
      defaultUri: folders[0]?.uri,
    });
    if (!picked || picked.length === 0) { return undefined; }
    return picked[0].fsPath;
  }
  return chosen;
}

export async function createSoloAgent(d: DialogDeps): Promise<AgentConfig | undefined> {
  const existing = d.sessionManager.getAll().find((s) => s.config.role === 'solo');
  if (existing) { return existing.config; }

  // No working dir is pinned: the runtime resolves the root per session (the agent works in the open
  // workspace, or its worktree). If a task references a file outside that root, the out-of-root handler in
  // extension.ts asks the user (in context) to switch.
  const template = ROLE_TEMPLATES['solo'];
  const config = new AgentConfigBuilder(template.role)
    .fromTemplate('solo')
    .setName(uniqueAgentName(d, template.name))
    .setProviderById('roam')
    .setModel(modelForRole(template, 'roam'))
    .setAutoApprove(false)
    .build();
  config.backend = d.defaultBackendKind(config); // roam -> openai-compat
  d.sessionManager.create(config);
  d.output.info(`Solo agent created: ${config.name} (model ${config.model}).`);

  if (!(await d.secrets.has('ROAM_API_KEY'))) {
    const choice = await vscode.window.showInformationMessage(
      'Solo agent created. Set your Roam API key to start working.', 'Set API Key'
    );
    if (choice === 'Set API Key') {
      await d.secrets.promptAndStore('ROAM_API_KEY', 'ROAM_API_KEY');
    }
  }
  return config;
}

export async function showAddAgentDialog(d: DialogDeps): Promise<AgentConfig | undefined> {
  const roleKeys = Object.keys(ROLE_TEMPLATES) as (keyof typeof ROLE_TEMPLATES)[];

  const rolePick = await vscode.window.showQuickPick(
    roleKeys.map((key) => ({
      label: `${ROLE_TEMPLATES[key].icon ?? '🤖'} ${ROLE_TEMPLATES[key].name}`,
      description: ROLE_TEMPLATES[key].description ?? '',
      detail: `Skills: ${ROLE_TEMPLATES[key].skills.map((s) => s.name).join(', ')}`,
      roleKey: key,
    })),
    { placeHolder: 'Select agent role', title: 'Add UnodeAi Agent — Choose Role' }
  );
  if (!rolePick) { return undefined; }

  const providerPick = await vscode.window.showQuickPick(
    Object.keys(DEFAULT_PROVIDERS).filter(isSupportedProviderId).map((key) => ({
      label: key === 'roam' ? '🏠 Roam (Recommended)' : key === 'unode' ? 'Unode' : key.charAt(0).toUpperCase() + key.slice(1),
      description: key === 'roam' ? 'Multi-model gateway (weroam), best cost/performance'
        : key === 'unode' ? 'Alternate multi-model gateway (unodetech)' : key,
      providerKey: key,
    })),
    { placeHolder: 'Select LLM provider (Roam recommended)', title: 'UnodeAi — Choose Provider' }
  );
  const providerKey = (providerPick?.providerKey ?? 'roam') as keyof typeof DEFAULT_PROVIDERS;

  const template = ROLE_TEMPLATES[rolePick.roleKey];

  const nameInput = await vscode.window.showInputBox({
    title: 'UnodeAi — Agent Name',
    prompt: 'Name for this agent (shown in the team panel and message log).',
    value: uniqueAgentName(d, template.name),
    ignoreFocusOut: true,
  });
  if (nameInput === undefined) { return undefined; }
  const agentName = uniqueAgentName(d, nameInput.trim() || template.name);

  // No setWorkingDirectory: the runtime resolves the root per session (SessionInfo.runtimeWorkingDirectory).
  const builder = new AgentConfigBuilder(template.role)
    .fromTemplate(rolePick.roleKey)
    .setName(agentName)
    .setProviderById(providerKey)
    .setAutoApprove(false);

  if (providerKey === 'roam' || providerKey === 'unode' || providerKey === 'openai' || providerKey === 'openrouter') {
    builder.setModel(modelForRole(template, providerKey));
  }

  const config = builder.build();
  config.backend = d.defaultBackendKind(config);

  if (config.backend === 'openai-compat') {
    const defaults = endpointDefaults(providerKey);
    const baseUrl = await vscode.window.showInputBox({
      title: 'UnodeAi — Endpoint Base URL',
      prompt: 'OpenAI-compatible base URL, e.g. https://ai.weroam.xyz/v1',
      value: defaults.baseUrl,
      ignoreFocusOut: true,
    });
    if (!baseUrl) { return undefined; }
    config.baseUrl = baseUrl.trim();

    if (template.modelRationale) {
      d.output.info(`Recommended model for ${template.role}: ${config.model} — ${template.modelRationale}`);
    }
    const apiKey = await d.secrets.get(config.provider.apiKeySecretName);
    const model = await pickModel(d, providerKey, config.model, config.baseUrl, apiKey);
    if (!model) { return undefined; }
    config.model = model;
  }

  d.sessionManager.create(config);
  d.output.info(`Agent added: ${config.name} (${config.role})`);

  if (!(await d.secrets.has(config.provider.apiKeySecretName))) {
    const choice = await vscode.window.showInformationMessage(
      `Agent "${config.name}" added. No API key stored for ${config.provider.apiKeySecretName}.`,
      'Set API Key'
    );
    if (choice === 'Set API Key') {
      await d.secrets.promptAndStore(config.provider.apiKeySecretName, config.provider.apiKeySecretName);
    }
  } else {
    vscode.window.showInformationMessage(`Agent "${config.name}" added to your team`);
  }
  return config;
}

/**
 * Edit an existing agent in place (P2#14) — previously you had to delete & re-create. Lets the user
 * rename, change the model (takes effect next turn for in-process agents), or set a fallback model.
 */
export async function showEditAgentDialog(d: DialogDeps, agentId: string): Promise<void> {
  const info = d.sessionManager.get(agentId);
  if (!info) {
    vscode.window.showWarningMessage('Agent not found.');
    return;
  }
  const cfg = info.config;

  const field = await vscode.window.showQuickPick(
    [
      { label: '✏ Rename', detail: `Current: ${cfg.name}`, key: 'name' },
      { label: '🤖 Change model', detail: `Current: ${cfg.model}`, key: 'model' },
      { label: '↪ Set fallback model', detail: cfg.fallbackModel ? `Current: ${cfg.fallbackModel}` : 'none', key: 'fallback' },
      { label: '🔧 Tool calling', detail: `Current: ${cfg.toolProtocol ?? 'native'} (OpenAI-compatible agents)`, key: 'toolProtocol' },
    ],
    { title: `Edit ${cfg.name}`, placeHolder: 'What do you want to change?' }
  );
  if (!field) { return; }

  if (field.key === 'name') {
    const name = await vscode.window.showInputBox({
      title: 'UnodeAi — Rename Agent', value: cfg.name, ignoreFocusOut: true,
    });
    if (name === undefined) { return; }
    cfg.name = uniqueAgentName(d, name.trim() || cfg.name);
  } else if (field.key === 'toolProtocol') {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Native function calling', detail: 'Default — best for strong models (Claude, GPT, …).', value: 'native' as const },
        { label: 'XML tool calling', detail: 'For weaker models (e.g. DeepSeek) that misuse native calls — Cline-style.', value: 'xml' as const },
      ],
      { title: 'Tool calling protocol', placeHolder: 'How should this OpenAI-compatible agent call tools?' }
    );
    if (!pick) { return; }
    cfg.toolProtocol = pick.value;
  } else {
    // Resolve provider key for the model picker; fall back to the agent's provider id.
    const providerKey = cfg.provider.providerId;
    const apiKey = await d.secrets.get(cfg.provider.apiKeySecretName);
    const picked = await pickModel(d, providerKey, cfg.model, cfg.baseUrl, apiKey);
    if (!picked) { return; }
    if (field.key === 'model') {
      // setModel updates the live config so the change applies on the next turn (in-process).
      if (!d.sessionManager.setModel(agentId, picked)) { cfg.model = picked; }
    } else {
      cfg.fallbackModel = picked;
    }
  }

  d.onRosterChanged?.();
  d.output.info(`Edited agent ${cfg.name} (${field.key}).`);
  vscode.window.showInformationMessage(`Updated ${cfg.name}.`);
}

export async function showSendMessageDialog(
  d: DialogDeps,
  targets: AgentConfig[],
  request?: unknown
): Promise<Message | undefined> {
  const direct = parseDirectSendRequest(request, targets);
  if (direct) {
    const message = d.messageBus.send(
      'user',
      direct.targetId,
      'task.assign',
      { instruction: direct.instruction, files: direct.files },
      'normal'
    );
    d.output.info(`Message sent to ${direct.targetId}: ${direct.instruction.slice(0, 80)}`);
    return message;
  }

  const targetPick = await vscode.window.showQuickPick(
    [
      { label: 'Broadcast to All', description: 'Send to every agent', targetId: '*' },
      ...targets.map((a) => ({ label: a.name, description: a.role, detail: `Model: ${a.model}`, targetId: a.id })),
    ],
    { placeHolder: 'Select target agent', title: 'Send Message to Agent' }
  );
  if (!targetPick) { return undefined; }

  const message = await vscode.window.showInputBox({
    prompt: 'Enter your task instruction',
    placeHolder: 'e.g., Implement the authentication middleware for Express',
  });
  if (!message) { return undefined; }

  const files = vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri.fsPath] : [];
  const sent = d.messageBus.send('user', targetPick.targetId, 'task.assign', { instruction: message, files }, 'normal');
  d.output.info(`Message sent to ${targetPick.targetId}: ${message.slice(0, 80)}`);
  return sent;
}

function parseDirectSendRequest(
  request: unknown,
  targets: AgentConfig[]
): { targetId: string | '*'; instruction: string; files: string[] } | undefined {
  if (!request || typeof request !== 'object') {
    return undefined;
  }
  const raw = request as { targetId?: unknown; instruction?: unknown; files?: unknown };
  if (typeof raw.targetId !== 'string' || typeof raw.instruction !== 'string' || !raw.instruction.trim()) {
    return undefined;
  }
  const targetIds = new Set(['*', ...targets.map((a) => a.id)]);
  if (!targetIds.has(raw.targetId)) {
    return undefined;
  }
  const files = Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === 'string') : [];
  return { targetId: raw.targetId, instruction: raw.instruction, files };
}

export async function showRunWorkflowDialog(d: DialogDeps): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    d.workflowEngine.getWorkflowTemplates().map((w) => ({
      label: w.name,
      description: w.description,
      detail: `${w.steps.length} steps`,
      id: w.id,
    })),
    { placeHolder: 'Select workflow to run' }
  );
  if (!pick) { return; }

  const seed = await vscode.window.showInputBox({
    prompt: 'Describe the task to seed this workflow',
    placeHolder: 'e.g., Add rate limiting to the public API',
  });
  if (seed === undefined) { return; }

  await d.workflowEngine.run(pick.id, { request: seed });
  d.output.info(`Workflow "${pick.label}" started`);
  vscode.window.showInformationMessage(`Workflow "${pick.label}" is running`);
}

type SecretPick = vscode.QuickPickItem & { custom?: boolean; secretName?: string };

export async function showSetApiKeyDialog(d: DialogDeps): Promise<void> {
  const secretNames = Array.from(new Set(Object.values(DEFAULT_PROVIDERS).map((p) => p.apiKeySecretName)));
  // QuickPickItem objects with an explicit `custom` flag — more robust than comparing the returned
  // label against an emoji string constant (that equality silently failed for some users, skipping the
  // name step and dropping them straight into the value box).
  const items: SecretPick[] = [
    ...secretNames.map((n) => ({ label: n, secretName: n })),
    { label: '➕ Custom secret name…', detail: 'e.g. GITHUB_TOKEN for an MCP server', custom: true },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Which key/secret do you want to set?',
    title: 'UnodeAi — Set Provider API Key',
  });
  if (!pick) { return; }

  // Custom path: store an arbitrary-named secret (e.g. GITHUB_TOKEN), not just the built-in provider
  // keys. Resolved by name from SecretStorage (incl. MCP ${VAR}).
  let secretName: string;
  if (pick.custom) {
    const name = await vscode.window.showInputBox({
      title: 'UnodeAi — Set Provider API Key (Step 1 of 2: secret NAME)',
      prompt: 'Name to store the secret under (e.g. GITHUB_TOKEN). Referenced as ${NAME} by MCP servers.',
      placeHolder: 'GITHUB_TOKEN',
      ignoreFocusOut: true,
      validateInput: (v) => (/^\w+$/.test(v.trim()) ? undefined : 'Use letters, digits, and underscores only.'),
    });
    if (!name) { return; }
    secretName = name.trim();
    // The name box and the value box open back-to-back; a short gap lets the Enter that confirmed the
    // name fully dismiss the first box so it doesn't "bleed" through and auto-accept the value box.
    await new Promise((resolve) => setTimeout(resolve, 150));
  } else {
    secretName = pick.secretName!;
  }

  const value = await vscode.window.showInputBox({
    title: `UnodeAi — Set Provider API Key (Step 2 of 2: value for ${secretName})`,
    prompt: `Paste the value for ${secretName}. Stored encrypted in VS Code SecretStorage.`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : 'Paste a non-empty value, or press Esc to cancel.'),
  });
  if (!value || !value.trim()) { return; }
  await d.secrets.set(secretName, value.trim());
  vscode.window.showInformationMessage(`Stored ${secretName} in SecretStorage.`);
}
