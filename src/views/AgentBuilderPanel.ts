/*---------------------------------------------------------------------------------------------
 *  UnodeAi - AgentBuilderPanel
 *  Form webview for composing a custom agent: identity, model, instructions, capability tools,
 *  skill playbooks, and MCP grants. Host-side save wiring lives in extension.ts.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SkillCategory, AgentModelParams, ModelTier } from '../types';
import { MarketplaceCatalog, SkillCatalogEntry } from '../marketplace/catalog';
import { MAX_AGENT_PLAYBOOKS, stripPlaybooks } from '../marketplace/install';
import { csp, esc, escAttr, nonce } from './webviewSecurity';
import { MAX_AGENT_ICON_DATA_URI_LENGTH, sanitizeAgentIcon } from './agentIcon';
import { sanitizeParams, sanitizeContextWindow } from '../params/sanitizeModelParams';

export interface AgentBuilderRoleOption {
  id: string;
  name: string;
  role: string;
  description?: string;
  icon?: string;
  color?: string;
  systemPrompt: string;
  skillIds: string[];
  model: string;
  providerId: string;
}

export interface AgentBuilderProviderOption {
  id: string;
  name: string;
  baseUrl?: string;
  models: AgentBuilderModelOption[];
}

export interface AgentBuilderModelOption {
  id: string;
  name: string;
  price?: string;
}

export interface AgentBuilderCapabilityOption {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface AgentBuilderMcpOption {
  id: string;
  name: string;
  transport: string;
  connected: boolean;
  requiresApproval: boolean;
}

export interface AgentBuilderInitialAgent {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  icon?: string;
  color?: string;
  providerId: string;
  model: string;
  fallbackModel?: string;
  toolProtocol?: 'auto' | 'native' | 'xml';
  systemPrompt: string;
  skillIds: string[];
  playbooks: string[];
  mcpServers: string[];
  /** Per-agent model fine-tuning (sampling/effort), pre-filled into the editable section. */
  modelParams?: AgentModelParams;
  /** Per-agent context-window override (tokens); 0/undefined = the 128k default. */
  contextWindowTokens?: number;
  /** Per-agent Smart Mode tier override ('' = follow the role/default tier). */
  tier?: ModelTier | '';
  /** Whether Smart Mode is enabled globally (read-only context for the tier section). */
  smartModeEnabled?: boolean;
}

export interface AgentBuilderViewModel {
  mode: 'new' | 'edit';
  agent?: AgentBuilderInitialAgent;
  roles: AgentBuilderRoleOption[];
  providers: AgentBuilderProviderOption[];
  capabilities: AgentBuilderCapabilityOption[];
  mcpServers: AgentBuilderMcpOption[];
  catalog: MarketplaceCatalog;
  skillLibraryUrl: string;
}

export interface AgentBuilderSavePayload {
  id?: string;
  name: string;
  roleKey: string;
  customRole?: string;
  icon?: string;
  color?: string;
  providerId: string;
  model: string;
  fallbackModel?: string;
  toolProtocol?: 'auto' | 'native' | 'xml';
  systemPrompt: string;
  skillIds: string[];
  playbooks: string[];
  mcpServers: string[];
  /** Per-agent model fine-tuning, parsed from the editable section. */
  modelParams?: AgentModelParams;
  /** Per-agent context-window override (tokens); undefined = the 128k default. */
  contextWindowTokens?: number;
  /** Per-agent Smart Mode tier override (undefined = follow the role/default tier). */
  tier?: ModelTier;
}

export interface AgentBuilderPanelDeps {
  getViewModel: (agentId?: string) => Promise<AgentBuilderViewModel> | AgentBuilderViewModel;
  listModels: (providerId: string, baseUrl?: string) => Promise<AgentBuilderModelOption[]> | AgentBuilderModelOption[];
  save: (payload: AgentBuilderSavePayload) => Promise<{ ok: boolean; message: string }>;
  pickIcon: () => Promise<string | undefined> | string | undefined;
  openSkillLibrary: () => Promise<void> | void;
  addMcpServer: () => Promise<void> | void;
}

export class AgentBuilderPanel {
  public static current: AgentBuilderPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private viewModel: AgentBuilderViewModel | undefined;

  static createOrShow(extensionUri: vscode.Uri, deps: AgentBuilderPanelDeps, agentId?: string): void {
    if (AgentBuilderPanel.current) {
      AgentBuilderPanel.current.deps = deps;
      AgentBuilderPanel.current.agentId = agentId;
      AgentBuilderPanel.current.panel.reveal();
      void AgentBuilderPanel.current.render();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'roamAgentBuilder',
      agentId ? 'Edit Agent' : 'Build an Agent',
      vscode.ViewColumn.One,
      // Narrowed to the single command the panel links to (the "Manage in Settings →" link), rather than
      // enabling ALL command URIs in a webview that renders dynamic catalog/agent content.
      { enableScripts: true, enableCommandUris: ['roam.openSettings'], retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    AgentBuilderPanel.current = new AgentBuilderPanel(panel, deps, agentId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private deps: AgentBuilderPanelDeps,
    private agentId?: string
  ) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    // When the builder regains focus (e.g. after installing a server in the MCP Marketplace), refresh just
    // the MCP grant list so the new server appears — WITHOUT re-rendering the form (preserves unsaved edits).
    this.panel.onDidChangeViewState(() => { if (this.panel.visible) { void this.refreshMcpServers(); } }, null, this.disposables);
    void this.render();
  }

  /** Re-fetch the registered MCP servers and push them to the webview, preserving current selections. */
  private async refreshMcpServers(): Promise<void> {
    if (!this.viewModel) {
      return;
    }
    try {
      const vm = await this.deps.getViewModel(this.agentId);
      this.viewModel = vm; // keep validation sets (mcpIds) in sync so a newly-installed server saves
      void this.panel.webview.postMessage({ command: 'mcpServers', servers: vm.mcpServers });
    } catch {
      /* best-effort refresh */
    }
  }

  private async onMessage(msg: { command?: unknown; payload?: unknown }): Promise<void> {
    if (!msg || typeof msg.command !== 'string') {
      return;
    }
    try {
      if (msg.command === 'cancel') {
        this.panel.dispose();
        return;
      }
      if (msg.command === 'browseSkillLibrary') {
        await this.deps.openSkillLibrary();
        return;
      }
      if (msg.command === 'addMcpServer') {
        // Open the MCP Marketplace (non-blocking — returns as soon as it opens). Do NOT re-render here: the
        // builder's webview is kept alive (retainContextWhenHidden) so the in-progress form survives the
        // round-trip; when the user returns, onDidChangeViewState refreshes just the MCP grant list.
        await this.deps.addMcpServer();
        return;
      }
      if (msg.command === 'agentBuilderPickIcon') {
        const icon = await this.deps.pickIcon();
        if (icon) {
          void this.panel.webview.postMessage({ command: 'iconPicked', icon });
        }
        return;
      }
      if (msg.command === 'listModels' && this.viewModel) {
        const providerId = typeof (msg as { providerId?: unknown }).providerId === 'string'
          ? (msg as { providerId: string }).providerId
          : '';
        const baseUrl = typeof (msg as { baseUrl?: unknown }).baseUrl === 'string'
          ? (msg as { baseUrl: string }).baseUrl
          : undefined;
        if (!this.viewModel.providers.some((p) => p.id === providerId)) {
          return;
        }
        const models = await this.deps.listModels(providerId, baseUrl);
        void this.panel.webview.postMessage({ command: 'models', providerId, models });
        return;
      }
      if (msg.command === 'save' && this.viewModel) {
        const payload = parseAgentBuilderSavePayload(msg.payload, this.viewModel);
        if (!payload) {
          const reason = describeAgentBuilderSaveProblem(msg.payload, this.viewModel) ?? 'some fields are missing or invalid.';
          void vscode.window.showWarningMessage(`UnodeAi Agent Builder: ${reason}`);
          return;
        }
        const result = await this.deps.save(payload);
        const show = result.ok ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
        void show(`UnodeAi Agent Builder: ${result.message}`);
        if (result.ok) {
          this.panel.dispose();
        }
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`UnodeAi Agent Builder: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async render(): Promise<void> {
    this.viewModel = await this.deps.getViewModel(this.agentId);
    this.panel.title = this.viewModel.mode === 'edit' ? `Edit ${this.viewModel.agent?.name ?? 'Agent'}` : 'Build an Agent';
    this.panel.webview.html = renderAgentBuilderHtml(this.panel.webview, this.viewModel);
  }

  private dispose(): void {
    AgentBuilderPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

export function renderAgentBuilderHtml(webview: vscode.Webview, view: AgentBuilderViewModel): string {
  const scriptNonce = nonce();
  const initial = initialFormState(view);
  const categories = uniqueCategories(view.catalog.skills);
  const roleOptions = view.roles.map((r) =>
    `<option value="${escAttr(r.id)}" ${initial.roleKey === r.id ? 'selected' : ''}>${esc(r.name)}</option>`
  ).join('');
  const providerOptions = view.providers.map((p) =>
    `<option value="${escAttr(p.id)}" ${initial.providerId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`
  ).join('');
  const categoryOptions = categories.map((c) => `<option value="${escAttr(c)}">${esc(labelForCategory(c))}</option>`).join('');
  const iconPresets = ['A', '🧭', '🛠️', '🔍', '📚', '$(robot)', '$(beaker)', '$(shield)'];

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp(webview, scriptNonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${view.mode === 'edit' ? 'Edit Agent' : 'Build an Agent'}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 18px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
    }
    h1 { margin: 0; font-size: 20px; line-height: 1.2; }
    h2 { margin: 0 0 10px; font-size: 14px; }
    .topbar { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
    .subtitle { margin: 4px 0 0; color: var(--vscode-descriptionForeground); line-height: 1.4; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; align-items: start; }
    .main { display: flex; flex-direction: column; gap: 12px; }
    .panel {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-input-background);
      padding: 14px;
    }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .icon-picker { display: flex; flex-direction: column; gap: 6px; }
    .icon-row { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 8px; align-items: start; }
    .icon-preview {
      width: 42px;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editor-background);
      overflow: hidden;
      font-size: 20px;
      line-height: 1;
    }
    .icon-preview img { width: 100%; height: 100%; object-fit: cover; }
    .icon-controls { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .icon-input-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
    .icon-presets { display: flex; flex-wrap: wrap; gap: 4px; }
    .icon-choice {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
      font: inherit;
    }
    .icon-choice:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .icon-choice.codicon { width: auto; min-width: 56px; padding: 0 6px; font-size: 11px; }
    label { color: var(--vscode-descriptionForeground); font-size: 12px; }
    input, select, textarea {
      width: 100%;
      min-height: 28px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 5px 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
    }
    textarea { min-height: 180px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); line-height: 1.45; }
    .help { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4; }
    .toolbar { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(110px, .8fr) minmax(110px, .8fr) minmax(110px, .8fr); gap: 8px; margin-bottom: 10px; }
    .skill-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
    .skill-card {
      min-height: 118px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 10px;
      background: var(--vscode-editor-background);
    }
    .skill-card.selected { border-color: var(--vscode-focusBorder); }
    .skill-head { display: flex; gap: 8px; align-items: flex-start; }
    .skill-title { font-weight: 700; line-height: 1.25; }
    .summary { margin: 0; color: var(--vscode-descriptionForeground); line-height: 1.35; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .tagline { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
    .tag { border: 1px solid var(--vscode-panel-border); border-radius: 999px; padding: 1px 7px; font-size: 11px; color: var(--vscode-descriptionForeground); }
    .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 6px; }
    .check { display: flex; align-items: flex-start; gap: 7px; padding: 6px; border-radius: 6px; }
    .check:hover { background: var(--vscode-list-hoverBackground); }
    .check input { width: auto; min-height: auto; margin-top: 2px; }
    .side { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 12px; }
    .selected-list { display: flex; flex-direction: column; gap: 6px; }
    .selected-item { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 7px; }
    .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
    .status-line { min-height: 17px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
    .btn {
      min-height: 28px;
      padding: 5px 11px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
    }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn:active { transform: translateY(1px); }
    .btn.primary { border-color: transparent; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn.link { width: 100%; text-align: left; color: var(--vscode-textLink-foreground); background: transparent; }
    .count { font-weight: 700; }
    [hidden] { display: none !important; }
    @media (max-width: 860px) {
      .layout { grid-template-columns: 1fr; }
      .side { position: static; }
      .toolbar, .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div>
      <h1>${view.mode === 'edit' ? 'Edit Agent' : 'Build an Agent'}</h1>
      <p class="subtitle">Compose identity, model, instructions, tools, playbooks, and MCP grants in one place.</p>
    </div>
    <button class="btn" type="button" data-command="cancel">Cancel</button>
  </div>

  <div class="layout">
    <main class="main">
      <section class="panel">
        <h2>Identity</h2>
        <div class="grid">
          <div class="field"><label for="name">Name</label><input id="name" value="${escAttr(initial.name)}"></div>
          <div class="field"><label for="role">Role</label><select id="role">${roleOptions}<option value="custom" ${initial.roleKey === 'custom' ? 'selected' : ''}>Custom role</option></select></div>
          <div class="field" id="customRoleWrap"><label for="customRole">Custom Role</label><input id="customRole" value="${escAttr(initial.customRole)}" placeholder="CEO"></div>
          <div class="field icon-picker">
            <label for="icon">Icon</label>
            <div class="icon-row">
              <div class="icon-preview" id="iconPreview" aria-hidden="true"></div>
              <div class="icon-controls">
                <div class="icon-presets">${iconPresets.map((icon) => `<button class="icon-choice ${icon.startsWith('$(') ? 'codicon' : ''}" type="button" data-icon="${escAttr(icon)}">${esc(icon)}</button>`).join('')}</div>
                <div class="icon-input-row">
                  <input id="icon" value="${escAttr(initial.icon)}" maxlength="${MAX_AGENT_ICON_DATA_URI_LENGTH}" placeholder="A or $(robot)">
                  <button class="btn" type="button" data-command="agentBuilderPickIcon">Upload image...</button>
                </div>
              </div>
            </div>
          </div>
          <div class="field"><label for="color">Color</label><input id="color" type="color" value="${escAttr(initial.color)}"></div>
        </div>
      </section>

      <section class="panel">
        <h2>Model</h2>
        <div class="grid">
          <div class="field"><label for="provider">Provider</label><select id="provider">${providerOptions}</select></div>
          <div class="field"><label for="toolProtocol">Tool calling method</label><select id="toolProtocol"><option value="auto" ${!initial.toolProtocol || initial.toolProtocol === 'auto' ? 'selected' : ''}>Auto (recommended)</option><option value="native" ${initial.toolProtocol === 'native' ? 'selected' : ''}>Native</option><option value="xml" ${initial.toolProtocol === 'xml' ? 'selected' : ''}>XML</option></select></div>
          <div class="field">
            <label for="model">Model</label>
            <input id="model" list="modelOptions" autocomplete="off" spellcheck="false" placeholder="Type to filter models…">
            <datalist id="modelOptions"></datalist>
          </div>
          <div class="field">
            <label for="fallbackModel">Backup model</label>
            <input id="fallbackModel" list="fallbackModelOptions" autocomplete="off" spellcheck="false" placeholder="Optional — type to filter…">
            <datalist id="fallbackModelOptions"></datalist>
          </div>
        </div>
        <div class="status-line" id="modelStatus" role="status"></div>
      </section>

      <section class="panel">
        <h2>Model fine-tuning</h2>
        <p class="help">Per-agent sampling &amp; reasoning settings. Leave a field blank to use the global default. These are the same values the Settings panel shows for this agent.</p>
        <div class="grid">
          <div class="field"><label for="mp_temperature">Temperature (0–2)</label><input id="mp_temperature" type="number" step="0.1" min="0" max="2" value="${mpVal(initial.modelParams.temperature)}" placeholder="default"></div>
          <div class="field"><label for="mp_top_p">Top P (0–1)</label><input id="mp_top_p" type="number" step="0.05" min="0" max="1" value="${mpVal(initial.modelParams.top_p)}" placeholder="default"></div>
          <div class="field"><label for="mp_max_tokens">Max output tokens</label><input id="mp_max_tokens" type="number" step="1" min="1" value="${mpVal(initial.modelParams.max_tokens)}" placeholder="default"></div>
          <div class="field"><label for="mp_reasoning_effort">Reasoning effort</label><select id="mp_reasoning_effort">${reasoningEffortOptions(initial.modelParams.reasoning_effort)}</select></div>
          <div class="field"><label for="mp_presence_penalty">Presence penalty (-2–2)</label><input id="mp_presence_penalty" type="number" step="0.1" min="-2" max="2" value="${mpVal(initial.modelParams.presence_penalty)}" placeholder="default"></div>
          <div class="field"><label for="mp_frequency_penalty">Frequency penalty (-2–2)</label><input id="mp_frequency_penalty" type="number" step="0.1" min="-2" max="2" value="${mpVal(initial.modelParams.frequency_penalty)}" placeholder="default"></div>
          <div class="field"><label for="mp_response_format">Response format</label><select id="mp_response_format">${mpSelect([['', 'Default'], ['text', 'Text'], ['json_object', 'JSON object']], initial.modelParams.response_format?.type ?? '')}</select></div>
          <div class="field"><label for="mp_thinking">Thinking</label><select id="mp_thinking">${mpSelect([['', 'Default'], ['enabled', 'Enabled'], ['disabled', 'Disabled']], initial.modelParams.thinking?.type ?? '')}</select></div>
          <div class="field"><label for="mp_thinking_budget">Thinking budget (tokens)</label><input id="mp_thinking_budget" type="number" step="1" min="1" value="${mpVal(initial.modelParams.thinking?.type === 'enabled' ? initial.modelParams.thinking.budget_tokens : undefined)}" placeholder="default"></div>
          <div class="field"><label for="mp_tool_choice">Tool choice</label><input id="mp_tool_choice" type="text" value="${escAttr(initial.modelParams.tool_choice ?? '')}" placeholder="auto / none / …"></div>
          <div class="field"><label for="mp_stream">Stream</label><select id="mp_stream">${mpSelect([['', 'Default'], ['enabled', 'Enabled'], ['disabled', 'Disabled']], initial.modelParams.stream === true ? 'enabled' : initial.modelParams.stream === false ? 'disabled' : '')}</select></div>
          <div class="field"><label for="mp_context_window">Context window (tokens)</label><input id="mp_context_window" type="number" step="1000" min="1" value="${initial.contextWindowTokens || ''}" placeholder="128000"></div>
          <div class="field"><label for="mp_stop">Stop sequences (one per line, max 4)</label><textarea id="mp_stop" rows="2" placeholder="default">${esc(Array.isArray(initial.modelParams.stop) ? initial.modelParams.stop.join('\n') : (initial.modelParams.stop ?? ''))}</textarea></div>
        </div>
      </section>

      <section class="panel">
        <h2>Smart Mode tier</h2>
        <p class="help">Smart Mode is currently <b>${initial.smartModeEnabled ? 'On' : 'Off'}</b> (global). When on, this agent runs on the model mapped to its tier. Pick a tier for <b>this agent</b> — it overrides the role tier, so two same-role agents can differ.</p>
        <div class="grid">
          <div class="field"><label for="mp_tier">Tier for this agent</label><select id="mp_tier">${tierOptions(initial.tier)}</select></div>
        </div>
        <p class="help">The tier → model mapping (and global defaults) live in <a href="command:roam.openSettings">Settings → Smart Mode →</a></p>
      </section>

      <section class="panel">
        <h2>Instructions <span id="instructionsReq" style="color: var(--vscode-errorForeground); font-size: 12px; font-weight: 600;" ${initial.roleKey === 'custom' ? '' : 'hidden'}>— required for a custom role: describe what this agent does, or it can't be created</span></h2>
        <textarea id="systemPrompt">${esc(stripPlaybooks(initial.systemPrompt))}</textarea>
        <p class="help">Playbooks are mounted from the picker on save; this editor stays focused on your base instructions.</p>
      </section>

      <section class="panel">
        <h2>Skill Playbooks</h2>
        <div class="toolbar">
          <input id="skillSearch" type="search" placeholder="Search playbooks" aria-label="Search playbooks">
          <select id="categoryFilter" aria-label="Filter by category"><option value="">All categories</option>${categoryOptions}</select>
          <select id="roleFilter" aria-label="Filter by role"><option value="">All roles</option>${view.roles.map((r) => `<option value="${escAttr(r.id)}">${esc(r.name)}</option>`).join('')}</select>
          <select id="sortMode" aria-label="Sort playbooks"><option value="relevant">Relevant</option><option value="newest">Newest</option><option value="most-used">Most used</option></select>
        </div>
        <div class="skill-grid" id="skillGrid">${skillCards(view.catalog.skills, view.roles, initial.playbooks)}</div>
      </section>

      <section class="panel">
        <h2>Tools</h2>
        <div class="checks" id="capabilityChecks">${capabilityChecks(view.capabilities, initial.skillIds)}</div>
      </section>

      <section class="panel">
        <h2>MCP Grants</h2>
        <div class="checks" id="mcpChecks">${mcpChecks(view.mcpServers, initial.mcpServers)}</div>
        <button class="btn link" type="button" data-command="addMcpServer">Browse MCP Marketplace...</button>
      </section>
    </main>

    <aside class="side">
      <section class="panel">
        <h2>Attached Playbooks <span class="count" id="playbookCount">0/${MAX_AGENT_PLAYBOOKS}</span></h2>
        <div class="selected-list" id="selectedPlaybooks"></div>
      </section>
      <section class="panel">
        <h2>Includes Preview</h2>
        <div class="selected-list" id="includesPreview"></div>
        <button class="btn link" type="button" data-command="browseSkillLibrary">Need more? Browse the full skill library...</button>
      </section>
      <div class="actions">
        <button class="btn" type="button" data-command="cancel">Cancel</button>
        <button class="btn primary" type="button" id="saveButton">Save</button>
      </div>
    </aside>
  </div>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const providers = ${jsonForScript(view.providers)};
    const roles = ${jsonForScript(view.roles)};
    const maxPlaybooks = ${MAX_AGENT_PLAYBOOKS};
    const initialModel = ${jsonForScript(initial.model)};
    const initialFallbackModel = ${jsonForScript(initial.fallbackModel)};
    // Mutable so a provider switch can drop a stale cross-provider selection (otherwise an OpenAI agent
    // could keep a Roam/DeepSeek model as a "custom" option). Updated on manual change; reset on switch.
    let selectedModel = initialModel;
    let selectedFallback = initialFallbackModel;

    const byId = (id) => document.getElementById(id);
    const selectedPlaybooks = new Set(${jsonForScript(initial.playbooks)});
    const selectedSkills = new Set(${jsonForScript(initial.skillIds)});
    const selectedMcp = new Set(${jsonForScript(initial.mcpServers)});
    const modelCatalog = new Map(providers.map((provider) => [provider.id, provider.models || []]));
    const loadedProviders = new Set();
    const loadingProviders = new Set();
    const dataImagePattern = /^data:image\\/(?:png|jpeg|webp|svg\\+xml);base64,/;

    function syncIconPreview() {
      const preview = byId('iconPreview');
      const icon = byId('icon').value.trim();
      preview.replaceChildren();
      if (dataImagePattern.test(icon)) {
        const img = document.createElement('img');
        img.src = icon;
        img.alt = '';
        preview.appendChild(img);
        return;
      }
      const text = document.createElement('span');
      text.textContent = icon || 'A';
      preview.appendChild(text);
    }

    // userInitiated = the user picked a different role → load that role's FULL template (instructions,
    // model, provider, skills, icon, color). On the initial render (userInitiated falsy) we only fill empty
    // fields so EDIT mode doesn't clobber an existing agent's saved values.
    function syncRoleDefaults(userInitiated) {
      const roleKey = byId('role').value;
      const isCustom = roleKey === 'custom';
      byId('customRoleWrap').hidden = !isCustom;
      const reqHint = document.getElementById('instructionsReq');
      if (reqHint) { reqHint.hidden = !isCustom; } // a custom role has no default prompt → make it clearly required
      const role = roles.find((r) => r.id === roleKey);
      if (!role) {
        // Switched TO custom: clear the previous role's prompt so the user writes their own (required).
        if (userInitiated && isCustom) { byId('systemPrompt').value = ''; }
        syncIconPreview();
        return;
      }
      if (userInitiated) {
        // Explicit role pick = adopt the role's template. Preserve a user-typed custom NAME (only replace an
        // empty or auto-filled role name) and a user-uploaded image ICON; everything else follows the role.
        const roleNames = new Set(roles.map((r) => r.name));
        const curName = byId('name').value.trim();
        if (!curName || roleNames.has(curName)) { byId('name').value = role.name; }
        if (!dataImagePattern.test(byId('icon').value.trim()) && role.icon) { byId('icon').value = role.icon; }
        if (role.color) { byId('color').value = role.color; }
        byId('systemPrompt').value = role.systemPrompt || '';
        if (role.providerId) { byId('provider').value = role.providerId; }
        if (role.model) { selectedModel = role.model; byId('model').value = role.model; }
        // Tools: check exactly this role's capability skills.
        const want = new Set(role.skillIds || []);
        selectedSkills.clear();
        want.forEach((id) => selectedSkills.add(id));
        document.querySelectorAll('[data-capability-id]').forEach((box) => { box.checked = want.has(box.dataset.capabilityId); });
        requestModels(); // refresh the model datalist/prices for the (possibly new) provider
      } else {
        if (!byId('name').value.trim()) { byId('name').value = role.name; }
        if (!byId('icon').value.trim() && role.icon) { byId('icon').value = role.icon; }
        if (role.color && (!byId('color').value || byId('color').value === '#000000')) { byId('color').value = role.color; }
      }
      syncIconPreview();
    }

    function modelOptionText(model) {
      const label = model.name && model.name !== model.id ? model.name + ' / ' + model.id : model.id;
      return model.price ? label + ' - ' + model.price : label;
    }

    // Combobox: fill a <datalist> with the provider's models. The bound <input> holds the model id,
    // filters as you type (native), and still accepts a hand-typed custom id. value=id, label=friendly.
    function populateModelDatalist(datalist, models) {
      datalist.replaceChildren();
      for (const model of models) {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.label = modelOptionText(model);
        datalist.appendChild(opt);
      }
    }

    function syncModels() {
      const providerId = byId('provider').value;
      const provider = providers.find((p) => p.id === providerId) || providers[0];
      const models = modelCatalog.get(provider?.id) || [];
      populateModelDatalist(byId('modelOptions'), models);
      populateModelDatalist(byId('fallbackModelOptions'), models);
      // Keep the chosen ids across re-renders (provider switch / live-price refresh).
      if (byId('model').value !== selectedModel) { byId('model').value = selectedModel || ''; }
      if (byId('fallbackModel').value !== selectedFallback) { byId('fallbackModel').value = selectedFallback || ''; }
      if (loadingProviders.has(providerId)) {
        byId('modelStatus').textContent = 'Loading live models and prices...';
      } else if (loadedProviders.has(providerId)) {
        byId('modelStatus').textContent = models.length ? 'Live priced catalog loaded.' : 'No live models returned.';
      } else {
        byId('modelStatus').textContent = models.length ? 'Showing bundled models until live prices load.' : '';
      }
    }

    function requestModels() {
      const providerId = byId('provider').value;
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) return;
      loadingProviders.add(providerId);
      syncModels();
      vscode.postMessage({ command: 'listModels', providerId, baseUrl: provider.baseUrl });
    }

    function skillMatches(card) {
      const q = byId('skillSearch').value.trim().toLowerCase();
      const category = byId('categoryFilter').value;
      const role = byId('roleFilter').value;
      if (q && !card.dataset.search.includes(q)) return false;
      if (category && card.dataset.category !== category) return false;
      if (role && !card.dataset.roles.split(',').includes(role)) return false;
      return true;
    }

    function syncSkillCards() {
      const cards = [...document.querySelectorAll('[data-skill-id]')];
      const sort = byId('sortMode').value;
      cards.sort((a, b) => {
        const aSel = selectedPlaybooks.has(a.dataset.skillId) ? 1 : 0;
        const bSel = selectedPlaybooks.has(b.dataset.skillId) ? 1 : 0;
        if (sort === 'relevant' && aSel !== bSel) return bSel - aSel;
        if (sort === 'newest') return Number(b.dataset.index) - Number(a.dataset.index);
        if (sort === 'most-used') {
          const caps = Number(b.dataset.capabilities) - Number(a.dataset.capabilities);
          if (caps) return caps;
          const body = Number(b.dataset.hasBody) - Number(a.dataset.hasBody);
          if (body) return body;
        }
        return a.dataset.name.localeCompare(b.dataset.name);
      });
      const grid = byId('skillGrid');
      cards.forEach((card) => {
        card.hidden = !skillMatches(card);
        grid.appendChild(card);
        card.classList.toggle('selected', selectedPlaybooks.has(card.dataset.skillId));
        const box = card.querySelector('input[type="checkbox"]');
        box.checked = selectedPlaybooks.has(card.dataset.skillId);
        box.disabled = !box.checked && selectedPlaybooks.size >= maxPlaybooks;
      });
      syncPreview();
    }

    function syncPreview() {
      byId('playbookCount').textContent = selectedPlaybooks.size + '/' + maxPlaybooks;
      const selected = [...document.querySelectorAll('[data-skill-id]')].filter((card) => selectedPlaybooks.has(card.dataset.skillId));
      const renderInto = (target, emptyText, withSummary) => {
        const node = byId(target);
        node.replaceChildren();
        if (!selected.length) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = emptyText;
          node.appendChild(empty);
          return;
        }
        selected.forEach((card) => {
          const item = document.createElement('div');
          item.className = 'selected-item';
          const title = document.createElement('div');
          title.className = 'skill-title';
          title.textContent = card.dataset.label;
          item.appendChild(title);
          if (withSummary) {
            const summary = document.createElement('div');
            summary.className = 'meta';
            summary.textContent = card.dataset.summary;
            item.appendChild(summary);
          }
          node.appendChild(item);
        });
      };
      renderInto('selectedPlaybooks', 'No playbooks attached yet.', false);
      renderInto('includesPreview', 'Includes: no playbooks yet.', true);
    }

    document.addEventListener('click', (event) => {
      const commandButton = event.target.closest('button[data-command]');
      if (commandButton) {
        vscode.postMessage({ command: commandButton.dataset.command });
        return;
      }
      const iconButton = event.target.closest('button[data-icon]');
      if (iconButton) {
        byId('icon').value = iconButton.dataset.icon || '';
        syncIconPreview();
        return;
      }
      if (event.target.closest('#saveButton')) {
        const payload = {
          id: ${jsonForScript(initial.id)},
          name: byId('name').value,
          roleKey: byId('role').value,
          customRole: byId('customRole').value,
          icon: byId('icon').value,
          color: byId('color').value,
          providerId: byId('provider').value,
          model: byId('model').value,
          fallbackModel: byId('fallbackModel').value || undefined,
          toolProtocol: byId('toolProtocol').value,
          systemPrompt: byId('systemPrompt').value,
          modelParams: {
            temperature: byId('mp_temperature').value,
            top_p: byId('mp_top_p').value,
            max_tokens: byId('mp_max_tokens').value,
            reasoning_effort: byId('mp_reasoning_effort').value,
            presence_penalty: byId('mp_presence_penalty').value,
            frequency_penalty: byId('mp_frequency_penalty').value,
            response_format: byId('mp_response_format').value,
            thinking_type: byId('mp_thinking').value,
            thinking_budget_tokens: byId('mp_thinking_budget').value,
            tool_choice: byId('mp_tool_choice').value,
            stream: byId('mp_stream').value,
            stop: byId('mp_stop').value,
          },
          contextWindowTokens: byId('mp_context_window').value,
          tier: byId('mp_tier').value,
          skillIds: [...document.querySelectorAll('[data-capability-id]:checked')].map((el) => el.dataset.capabilityId),
          playbooks: [...selectedPlaybooks],
          mcpServers: [...document.querySelectorAll('[data-mcp-id]:checked')].map((el) => el.dataset.mcpId),
        };
        vscode.postMessage({ command: 'save', payload });
      }
    });

    document.addEventListener('change', (event) => {
      const playbook = event.target.closest('[data-playbook-id]');
      if (playbook) {
        if (playbook.checked && selectedPlaybooks.size >= maxPlaybooks) {
          playbook.checked = false;
          return;
        }
        if (playbook.checked) selectedPlaybooks.add(playbook.dataset.playbookId);
        else selectedPlaybooks.delete(playbook.dataset.playbookId);
        syncSkillCards();
        return;
      }
      if (event.target.id === 'role') syncRoleDefaults(true);
      if (event.target.id === 'provider') {
        // New provider → drop the previous provider's model so it can't be saved against this one.
        selectedModel = '';
        selectedFallback = '';
        byId('model').value = '';
        byId('fallbackModel').value = '';
        requestModels();
      }
      // Remember a manual model choice so re-renders (search/price refresh) keep it.
      if (event.target.id === 'model') selectedModel = byId('model').value;
      if (event.target.id === 'fallbackModel') selectedFallback = byId('fallbackModel').value;
    });
    ['skillSearch', 'categoryFilter', 'roleFilter', 'sortMode'].forEach((id) => byId(id).addEventListener('input', syncSkillCards));
    ['categoryFilter', 'roleFilter', 'sortMode'].forEach((id) => byId(id).addEventListener('change', syncSkillCards));
    // Track the chosen ids as the user types/picks in the model comboboxes (so re-renders keep them).
    byId('model').addEventListener('input', () => { selectedModel = byId('model').value; });
    byId('fallbackModel').addEventListener('input', () => { selectedFallback = byId('fallbackModel').value; });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) {
        return;
      }
      if (msg.command === 'iconPicked' && typeof msg.icon === 'string') {
        byId('icon').value = msg.icon;
        syncIconPreview();
        return;
      }
      if (msg.command === 'mcpServers' && Array.isArray(msg.servers)) {
        const container = document.getElementById('mcpChecks');
        if (!container) { return; }
        const checked = new Set([...container.querySelectorAll('[data-mcp-id]:checked')].map((el) => el.dataset.mcpId));
        container.replaceChildren();
        if (msg.servers.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = 'No MCP servers registered yet.';
          container.appendChild(empty);
          return;
        }
        for (const s of msg.servers) {
          const label = document.createElement('label');
          label.className = 'check';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.mcpId = s.id;
          if (checked.has(s.id)) { cb.checked = true; }
          const span = document.createElement('span');
          const title = document.createElement('span');
          title.className = 'skill-title';
          title.textContent = s.name;
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = ' ' + (s.transport || '') + (s.connected ? ' / connected' : '') + (s.requiresApproval ? ' / approval' : '');
          span.append(title, meta);
          label.append(cb, span);
          container.appendChild(label);
        }
        return;
      }
      if (msg.command !== 'models' || typeof msg.providerId !== 'string' || !Array.isArray(msg.models)) {
        return;
      }
      const activeProvider = byId('provider').value;
      loadingProviders.delete(msg.providerId);
      loadedProviders.add(msg.providerId);
      modelCatalog.set(msg.providerId, msg.models.filter((model) => model && typeof model.id === 'string'));
      if (msg.providerId === activeProvider) {
        syncModels();
      }
    });

    syncRoleDefaults();
    requestModels();
    syncSkillCards();
    byId('icon').addEventListener('input', syncIconPreview);
    syncIconPreview();
  </script>
</body>
</html>`;
}

export function parseAgentBuilderSavePayload(raw: unknown, view: AgentBuilderViewModel): AgentBuilderSavePayload | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && view.mode === 'edit' && r.id === view.agent?.id ? r.id : undefined;
  const name = cleanText(r.name, 80);
  const roleKey = cleanText(r.roleKey, 80);
  const providerId = cleanText(r.providerId, 80);
  const model = cleanText(r.model, 180);
  const fallbackModel = cleanText(r.fallbackModel, 180);
  const toolProtocol = r.toolProtocol === 'xml' ? 'xml' : r.toolProtocol === 'native' ? 'native' : 'auto';
  const systemPrompt = typeof r.systemPrompt === 'string' ? r.systemPrompt.slice(0, 60_000) : '';
  if (!name || !roleKey || !providerId || !model || !systemPrompt.trim()) {
    return undefined;
  }
  const roleIds = new Set([...view.roles.map((role) => role.id), 'custom']);
  const provider = view.providers.find((p) => p.id === providerId);
  if (!roleIds.has(roleKey) || !provider) {
    return undefined;
  }
  const capabilityIds = new Set(view.capabilities.map((s) => s.id));
  const playbookIds = new Set(view.catalog.skills.map((s) => s.id));
  const mcpIds = new Set(view.mcpServers.map((s) => s.id));
  const skillIds = cleanStringArray(r.skillIds, capabilityIds, 12);
  const playbooks = cleanStringArray(r.playbooks, playbookIds, MAX_AGENT_PLAYBOOKS);
  const mcpServers = cleanStringArray(r.mcpServers, mcpIds, 20);
  const customRole = cleanText(r.customRole, 80);
  if (roleKey === 'custom' && !customRole) {
    return undefined;
  }
  const modelParams = parseModelParams(r.modelParams);
  const contextWindowTokens = sanitizeContextWindow(r.contextWindowTokens);
  const tier = r.tier === 'premium' || r.tier === 'standard' || r.tier === 'economy' ? r.tier : undefined;
  return {
    id,
    name,
    roleKey,
    customRole: customRole || undefined,
    icon: sanitizeAgentIcon(r.icon),
    color: /^#[0-9a-fA-F]{6}$/.test(String(r.color ?? '')) ? String(r.color) : undefined,
    providerId,
    model,
    fallbackModel: fallbackModel || undefined,
    toolProtocol,
    systemPrompt,
    modelParams,
    contextWindowTokens,
    tier,
    skillIds,
    playbooks,
    mcpServers,
  };
}

/**
 * Human-readable reason a save payload is rejected — so the Agent Builder tells the user exactly what to
 * fix (e.g. "Please fill in: System prompt") instead of a generic "invalid save payload". Mirrors the
 * required-field checks in parseAgentBuilderSavePayload. Returns undefined when nothing obvious is wrong.
 */
export function describeAgentBuilderSaveProblem(raw: unknown, view: AgentBuilderViewModel): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'the form could not be read — reopen the Agent Builder and try again.';
  }
  const r = raw as Record<string, unknown>;
  const missing: string[] = [];
  if (!cleanText(r.name, 80)) { missing.push('Name'); }
  const roleKey = cleanText(r.roleKey, 80);
  if (!roleKey) { missing.push('Role'); }
  if (roleKey === 'custom' && !cleanText(r.customRole, 80)) { missing.push('Custom role name'); }
  if (!cleanText(r.providerId, 80)) { missing.push('Provider'); }
  if (!cleanText(r.model, 180)) { missing.push('Model'); }
  if (!(typeof r.systemPrompt === 'string' && r.systemPrompt.trim())) { missing.push('System prompt'); }
  if (missing.length > 0) {
    return `please fill in: ${missing.join(', ')}.`;
  }
  // Structural mismatches (shouldn't happen via the UI, but be specific if they do).
  const roleIds = new Set([...view.roles.map((role) => role.id), 'custom']);
  if (roleKey && !roleIds.has(roleKey)) { return `unknown role "${roleKey}".`; }
  const providerId = cleanText(r.providerId, 80);
  if (providerId && !view.providers.some((p) => p.id === providerId)) { return `unknown provider "${providerId}" — pick one from the list.`; }
  return undefined;
}

export function canSelectPlaybook(currentIds: string[], id: string, max = MAX_AGENT_PLAYBOOKS): boolean {
  return currentIds.includes(id) || currentIds.length < max;
}

export function selectVisibleSkills(
  skills: SkillCatalogEntry[],
  controls: { query?: string; category?: string; role?: string; sort?: 'relevant' | 'newest' | 'most-used'; selected?: string[] },
  roles: AgentBuilderRoleOption[] = []
): SkillCatalogEntry[] {
  const q = (controls.query ?? '').trim().toLowerCase();
  const selected = new Set(controls.selected ?? []);
  const visible = skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.summary} ${skill.category}`.toLowerCase();
    if (q && !haystack.includes(q)) {
      return false;
    }
    if (controls.category && skill.category !== controls.category) {
      return false;
    }
    if (controls.role) {
      const role = roles.find((r) => r.id === controls.role);
      if (role && !role.skillIds.includes(skill.id) && !role.skillIds.some((id) => id.includes(skill.category))) {
        return false;
      }
    }
    return true;
  });
  return visible.sort((a, b) => {
    if ((controls.sort ?? 'relevant') === 'newest') {
      return skills.indexOf(b) - skills.indexOf(a);
    }
    if (controls.sort === 'most-used') {
      const caps = b.capabilities.length - a.capabilities.length;
      if (caps) { return caps; }
      const body = Number(!!b.body) - Number(!!a.body);
      if (body) { return body; }
    }
    const selectedDelta = Number(selected.has(b.id)) - Number(selected.has(a.id));
    return selectedDelta || a.name.localeCompare(b.name);
  });
}

function initialFormState(view: AgentBuilderViewModel): Required<AgentBuilderInitialAgent> & { roleKey: string; customRole: string } {
  const firstRole = view.roles[0];
  const firstProvider = view.providers[0];
  const agent = view.agent;
  const roleMatch = agent ? view.roles.find((r) => r.role === agent.role || r.id === agent.role) : firstRole;
  const roleKey = agent ? (roleMatch?.id ?? 'custom') : (firstRole?.id ?? 'custom');
  const providerId = agent?.providerId ?? firstRole?.providerId ?? firstProvider?.id ?? 'roam';
  const model = agent?.model ?? firstRole?.model ?? firstProvider?.models[0]?.id ?? '';
  return {
    id: agent?.id ?? '',
    name: agent?.name ?? firstRole?.name ?? 'Custom Agent',
    role: agent?.role ?? firstRole?.role ?? 'custom',
    roleLabel: agent?.roleLabel ?? firstRole?.name ?? 'Custom Agent',
    roleKey,
    customRole: roleKey === 'custom' ? agent?.roleLabel ?? agent?.role ?? '' : '',
    icon: agent?.icon ?? firstRole?.icon ?? 'A',
    color: agent?.color ?? firstRole?.color ?? '#4f7cac',
    providerId,
    model,
    fallbackModel: agent?.fallbackModel ?? '',
    toolProtocol: agent?.toolProtocol ?? 'auto',
    systemPrompt: agent?.systemPrompt ?? firstRole?.systemPrompt ?? 'You are a helpful specialist on the UnodeAi team.',
    skillIds: agent?.skillIds ?? firstRole?.skillIds ?? [],
    playbooks: agent?.playbooks ?? [],
    mcpServers: agent?.mcpServers ?? [],
    modelParams: agent?.modelParams ?? {},
    contextWindowTokens: agent?.contextWindowTokens ?? 0, // 0 = unset → rendered blank
    tier: agent?.tier ?? '',
    smartModeEnabled: agent?.smartModeEnabled ?? false,
  };
}

function skillCards(skills: SkillCatalogEntry[], roles: AgentBuilderRoleOption[], selected: string[]): string {
  if (skills.length === 0) {
    return '<div class="empty">No playbooks in the active catalog yet.</div>';
  }
  const selectedSet = new Set(selected);
  return skills.map((skill, index) => {
    const roleIds = rolesForSkill(skill, roles).join(',');
    const checked = selectedSet.has(skill.id) ? 'checked' : '';
    return /* html */`
      <article class="skill-card ${checked ? 'selected' : ''}"
        data-skill-id="${escAttr(skill.id)}"
        data-index="${index}"
        data-name="${escAttr(skill.name.toLowerCase())}"
        data-label="${escAttr(skill.name)}"
        data-summary="${escAttr(skill.summary)}"
        data-search="${escAttr(`${skill.name} ${skill.summary} ${skill.category}`.toLowerCase())}"
        data-category="${escAttr(skill.category)}"
        data-roles="${escAttr(roleIds)}"
        data-has-body="${skill.body ? '1' : '0'}"
        data-capabilities="${skill.capabilities.length}">
        <label class="skill-head">
          <input type="checkbox" data-playbook-id="${escAttr(skill.id)}" ${checked}>
          <span>
            <span class="skill-title">${esc(skill.name)}</span>
            <span class="meta">${esc(labelForCategory(skill.category))}</span>
          </span>
        </label>
        <p class="summary">${esc(skill.summary)}</p>
        <div class="tagline">${skill.capabilities.slice(0, 4).map((cap) => `<span class="tag">${esc(cap)}</span>`).join('')}</div>
      </article>`;
  }).join('');
}

function capabilityChecks(capabilities: AgentBuilderCapabilityOption[], selected: string[]): string {
  if (capabilities.length === 0) {
    return '<div class="empty">No tool capabilities available.</div>';
  }
  const selectedSet = new Set(selected);
  return capabilities.map((cap) => /* html */`
    <label class="check">
      <input type="checkbox" data-capability-id="${escAttr(cap.id)}" ${selectedSet.has(cap.id) ? 'checked' : ''}>
      <span><span class="skill-title">${esc(cap.name)}</span><span class="meta"> ${esc(cap.category)}</span><br><span class="meta">${esc(cap.description)}</span></span>
    </label>`
  ).join('');
}

function mcpChecks(servers: AgentBuilderMcpOption[], selected: string[]): string {
  if (servers.length === 0) {
    return '<div class="empty">No MCP servers registered yet.</div>';
  }
  const selectedSet = new Set(selected);
  return servers.map((server) => /* html */`
    <label class="check">
      <input type="checkbox" data-mcp-id="${escAttr(server.id)}" ${selectedSet.has(server.id) ? 'checked' : ''}>
      <span><span class="skill-title">${esc(server.name)}</span><span class="meta"> ${esc(server.transport)}${server.connected ? ' / connected' : ''}${server.requiresApproval ? ' / approval' : ''}</span></span>
    </label>`
  ).join('');
}

function rolesForSkill(skill: SkillCatalogEntry, roles: AgentBuilderRoleOption[]): string[] {
  return roles
    .filter((role) => role.skillIds.includes(skill.id) || role.skillIds.some((id) => id.includes(skill.category)))
    .map((role) => role.id);
}

function uniqueCategories(skills: SkillCatalogEntry[]): SkillCategory[] {
  return [...new Set(skills.map((s) => s.category))].sort();
}

function labelForCategory(category: string): string {
  return category.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Render a model-fine-tuning number input's value (blank when unset, so the placeholder shows). */
function mpVal(v: number | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** <option>s for the reasoning-effort select, with the current value selected. */
function reasoningEffortOptions(current: string | undefined): string {
  const opts: Array<[string, string]> = [
    ['', 'Default'], ['none', 'None'], ['minimal', 'Minimal'], ['low', 'Low'],
    ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'X-High'], ['max', 'Max'],
  ];
  return opts.map(([v, label]) => `<option value="${v}" ${current === v || (!current && v === '') ? 'selected' : ''}>${label}</option>`).join('');
}

/** Generic <option>s helper for the model-tuning selects, with the current value selected. */
function mpSelect(opts: Array<[string, string]>, current: string): string {
  return opts.map(([v, label]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`).join('');
}

/** <option>s for the per-agent tier select ('' = follow the role/default tier). */
function tierOptions(current: ModelTier | ''): string {
  const opts: Array<[string, string]> = [
    ['', 'Use role default'], ['premium', 'Premium'], ['standard', 'Standard'], ['economy', 'Economy'],
  ];
  return opts.map(([v, label]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`).join('');
}

/** Parse the model fine-tuning fields from the (untrusted) webview into AgentModelParams. Reuses the SAME
 *  `sanitizeParams` the Settings panel uses, so both entry points produce IDENTICAL params (the fields stay
 *  in sync). Blank fields are omitted so the agent falls back to global defaults; undefined when nothing set. */
function parseModelParams(raw: unknown): AgentModelParams | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return undefined; }
  const r = raw as Record<string, unknown>;
  const assembled: Record<string, unknown> = {
    temperature: r.temperature,
    top_p: r.top_p,
    max_tokens: r.max_tokens,
    reasoning_effort: r.reasoning_effort,
    presence_penalty: r.presence_penalty,
    frequency_penalty: r.frequency_penalty,
    response_format: r.response_format,
    tool_choice: r.tool_choice,
    stop: typeof r.stop === 'string' ? r.stop.split(/\r?\n/) : r.stop, // one stop sequence per line
    stream: r.stream === 'enabled' ? true : r.stream === 'disabled' ? false : undefined,
  };
  if (r.thinking_type === 'enabled') {
    assembled.thinking = { type: 'enabled', budget_tokens: r.thinking_budget_tokens };
  } else if (r.thinking_type === 'disabled') {
    assembled.thinking = { type: 'disabled' };
  }
  const out = sanitizeParams(assembled);
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanStringArray(value: unknown, known: Set<string>, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw === 'string' && known.has(raw) && !out.includes(raw)) {
      out.push(raw);
      if (out.length >= max) {
        break;
      }
    }
  }
  return out;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
