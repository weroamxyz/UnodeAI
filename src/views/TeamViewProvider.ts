/*---------------------------------------------------------------------------------------------
 *  UnodeAi - TeamViewProvider
 *  Sidebar webview showing the agent team with status, controls, and actions
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SessionManager } from '../session/SessionManager';
import { MessageBus } from '../bus/MessageBus';
import { SessionInfo } from '../types';
import { csp, esc, escAttr, nonce } from './webviewSecurity';
import { toConsoleRows } from './parallelConsoleModel';
import { DelegationAgentState } from './orchestrationProgress';
import { renderAgentIcon } from './agentIcon';
import { Checkpoint } from '../backend/Checkpoints';
import { ChangedFileSummary, groupChangedFilesByAgent } from './checkpointSummary';

export class TeamViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'roam.teamPanel';

  private _view?: vscode.WebviewView;
  /** Compact mode: each agent collapses to a small icon chip to free vertical space for Chat/Messages. */
  private _compact = false;
  private delegationStates = new Map<string, DelegationAgentState>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private sessionManager: SessionManager,
    private messageBus: MessageBus,
    /** Extension version, shown in the view title bar so you always know what build you're running. */
    private readonly version = '',
    /** When Smart Mode is on, returns the tier + the model the agent will actually run on (its provider's
     *  tier model, or undefined when the agent keeps its configured model). Undefined = Smart Mode off. */
    private readonly smartModePreview?: (config: { role: string; tier?: string; provider: { providerId: string } }) => { tier: string; model?: string } | undefined,
    /** Recorded file checkpoints — used to show each agent's recently changed files on its card. */
    private getCheckpoints: () => Checkpoint[] = () => []
  ) { }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    // Fold the version into the view title so it's always visible in the Team toolbar row — the
    // greyed `description` slot gets crowded out by the title-bar action icons on a normal sidebar.
    webviewView.title = this.version ? `Team · v${this.version}` : 'Team';

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!isTeamMessage(msg, this.sessionManager.getAll().map((s) => s.config.id))) {
        return;
      }
      const agentId = msg.agentId ?? '';
      switch (msg.command) {
        case 'startAgent':
          this.sessionManager.start(agentId);
          break;
        case 'stopAgent':
          this.sessionManager.stop(agentId);
          break;
        case 'restartAgent':
          this.sessionManager.restart(agentId);
          break;
        case 'removeAgent':
          this.sessionManager.remove(agentId);
          break;
        case 'sendMessage':
          vscode.commands.executeCommand('roam.sendMessage');
          break;
        case 'showOutput':
          vscode.commands.executeCommand('roam.showAgentOutput', agentId);
          break;
        case 'showTerminal':
          vscode.commands.executeCommand('roam.showAgentTerminal', agentId);
          break;
        case 'chatAgent':
          vscode.commands.executeCommand('roam.chatWithAgent', agentId);
          break;
        case 'showCheckpointDiff':
          vscode.commands.executeCommand('roam.showCheckpointDiff', msg.checkpointId);
          break;
        case 'editAgent':
          vscode.commands.executeCommand('roam.openAgentBuilder', agentId);
          break;
        case 'openAgentBuilder':
          vscode.commands.executeCommand('roam.openAgentBuilder');
          break;
        case 'createDefaultTeam':
          // Route the empty-state "Create Team" card through the picker (software or knowledge-work),
          // so every entry point is consistent (menu / onboarding / panel).
          vscode.commands.executeCommand('roam.createTeamPreset');
          break;
        case 'addAgent':
          vscode.commands.executeCommand('roam.addAgent');
          break;
        case 'openMarketplace':
          vscode.commands.executeCommand('roam.openMarketplace');
          break;
        case 'openSettings':
          vscode.commands.executeCommand('roam.openSettings');
          break;
        case 'createTeamPreset':
          vscode.commands.executeCommand('roam.createTeamPreset');
          break;
        case 'editTeamRules':
          vscode.commands.executeCommand('roam.editTeamRules');
          break;
        case 'restoreCheckpoint':
          vscode.commands.executeCommand('roam.restoreCheckpoint');
          break;
        case 'startAllAgents':
          vscode.commands.executeCommand('roam.startAllAgents');
          break;
        case 'stopAllAgents':
          vscode.commands.executeCommand('roam.stopAllAgents');
          break;
        case 'startSolo':
          vscode.commands.executeCommand('roam.startSolo');
          break;
        case 'startSoloActive':
          vscode.commands.executeCommand('roam.startSoloActive');
          break;
        case 'runDemoTask':
          vscode.commands.executeCommand('roam.runDemoTask');
          break;
        case 'openDocumentation':
          void this.openDocumentation();
          break;
      }
    });
  }

  refresh(): void {
    if (this._view) {
      this._view.webview.html = this._getHtml(this._view.webview);
    }
  }

  /** Toggle compact mode (icon-only agent chips) and re-render. */
  setCompact(compact: boolean): void {
    this._compact = compact;
    this.refresh();
  }

  setDelegationProgress(states: DelegationAgentState[]): void {
    this.delegationStates = new Map(states.map((state) => [state.agentId, state]));
    this.refresh();
  }

  isCompact(): boolean {
    return this._compact;
  }

  updateAgentStatus(agentId: string, status: string): void {
    if (this._view) {
      this._view.webview.postMessage({
        command: 'updateStatus',
        agentId,
        status,
      });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const scriptNonce = nonce();
    const sessions = this.sessionManager.getAll();

    const changedFilesByAgent = groupChangedFilesByAgent(this.getCheckpoints());
    const compact = this._compact && sessions.length > 0;
    const agentCards = sessions.length === 0
      ? this._renderEmptyState()
      : sessions.map((s) => compact
        ? this._renderCompactCard(s)
        : this._renderAgentCard(s, changedFilesByAgent.get(s.config.id) ?? [])
      ).join('');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp(webview, scriptNonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UnodeAi Team</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .file-activity { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }
    .file-activity-title { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .file-activity-list { display: flex; flex-direction: column; gap: 2px; }
    .file-activity-item { width: 100%; padding: 2px 0; border: none; background: transparent;
      color: var(--vscode-textLink-foreground); cursor: pointer; font: inherit; font-size: 11px; text-align: left;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .file-activity-item:hover { text-decoration: underline; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      padding: 8px;
    }
    .empty-state {
      text-align: center;
      padding: 32px 16px;
      color: var(--vscode-descriptionForeground);
    }
    .empty-icon { font-size: 48px; display: block; margin-bottom: 12px; }
    .empty-grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 12px; }
    .empty-card {
      width: 100%;
      text-align: left;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      cursor: pointer;
    }
    .empty-card:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
    .empty-title { display: block; font-weight: 700; margin-bottom: 4px; }
    .empty-copy { display: block; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.35; }
    .hint { font-size: 11px; opacity: 0.7; margin-top: 8px; }
    .cta {
      display: inline-block;
      margin-top: 12px;
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .cta:hover { background: var(--vscode-button-hoverBackground); }
    .agent-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 8px;
      transition: border-color 0.2s;
    }
    .agent-card:hover { border-color: var(--vscode-focusBorder); }
    .agent-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .agent-name {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
      font-size: 13px;
    }
    .agent-icon-img {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      object-fit: cover;
      flex: 0 0 auto;
    }
    .agent-role {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-emoji { font-size: 12px; line-height: 1; }
    .status-working { background: #28a74522; color: #28a745; }
    .status-done { background: #28a74522; color: #28a745; }
    .status-blocked { background: #dc354522; color: #dc3545; }
    .status-running { background: #28a74522; color: #28a745; }
    .status-idle { background: #ffc10722; color: #ffc107; }
    .status-stopped { background: #6c757d22; color: #6c757d; }
    .status-error { background: #dc354522; color: #dc3545; }
    .status-starting { background: #17a2b822; color: #17a2b8; }
    .status-stopping { background: #fd7e1422; color: #fd7e14; }
    .status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      display: inline-block;
    }
    .status-working .status-dot { background: #28a745; animation: pulse 1.5s infinite; }
    .status-done .status-dot { background: #28a745; }
    .status-blocked .status-dot { background: #dc3545; }
    .status-stopped .status-dot { background: #6c757d; }
    .status-starting .status-dot,
    .status-stopping .status-dot { background: #17a2b8; }
    .running .status-dot { background: #28a745; animation: pulse 1.5s infinite; }
    .idle .status-dot { background: #ffc107; }
    .error .status-dot { background: #dc3545; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .agent-details {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }
    .model-line { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; min-width: 0; }
    .smart-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: #8957e522; color: #a371f7; font-weight: 600; white-space: nowrap; }
    .smart-badge.warn { background: var(--vscode-inputValidation-warningBackground, #6b5300); color: var(--vscode-editorWarning-foreground, #cca700); }
    .inline-metrics { display: inline-flex; flex-wrap: wrap; gap: 4px; }
    .agent-actions {
      display: flex;
      gap: 4px;
    }
    .btn {
      font-size: 11px;
      padding: 3px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
    }
    .btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .btn-start { background: #28a74533; color: #28a745; border-color: #28a74555; }
    .btn-stop { background: #dc354533; color: #dc3545; border-color: #dc354555; }
    .skills-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }
    .skill-tag {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }
    .agent-task {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin: 4px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agent-task.err { color: #dc3545; }
    .agent-task.done { color: var(--vscode-charts-green, #28a745); }
    /* Live per-agent metrics (folded in from the old Parallel Console): context %, cost, turns. */
    .agent-metrics { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
    /* inline-metrics: the same chips rendered on the model row (v0.8.10 card layout). */
    .inline-metrics { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; vertical-align: middle; }
    .agent-metrics .metric,
    .inline-metrics .metric {
      font-size: 10px;
      line-height: 1.3;
      padding: 1px 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    /* Compact mode: agents collapse to small icon chips (status shown by the corner dot). */
    .compact-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    .compact-card {
      position: relative; width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; line-height: 1;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px; cursor: pointer;
      background: var(--vscode-editor-background);
    }
    .compact-card:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
    .compact-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: 28px;
      max-height: 28px;
      overflow: hidden;
    }
    .compact-card .agent-icon-img {
      width: 28px;
      height: 28px;
    }
    .compact-card .status-dot {
      position: absolute; top: 3px; right: 3px;
      width: 8px; height: 8px; border-radius: 50%;
      border: 1px solid var(--vscode-editor-background);
      background: var(--vscode-descriptionForeground);
    }
    .compact-card.status-running .status-dot { background: #28a745; animation: pulse 1.5s infinite; }
    .compact-card.status-working .status-dot { background: #28a745; animation: pulse 1.5s infinite; }
    .compact-card.status-done .status-dot { background: #28a745; }
    .compact-card.status-blocked .status-dot { background: #dc3545; }
    .compact-card.status-idle .status-dot { background: #ffc107; }
    .compact-card.status-stopped .status-dot { background: #6c757d; }
    .compact-card.status-error .status-dot { background: #dc3545; }
    .compact-card.status-starting .status-dot,
    .compact-card.status-stopping .status-dot { background: #17a2b8; }
  </style>
</head>
<body>
  <div id="team-container" class="${compact ? 'compact-grid' : ''}">
    ${agentCards}
  </div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const emptyState = document.querySelector('.empty-state');
    if (emptyState) {
      const title = document.createElement('p');
      title.textContent = 'No agents in your team yet.';
      const grid = document.createElement('div');
      grid.className = 'empty-grid';
      [
        ['createDefaultTeam', 'Create a Team', 'Pick a software crew or a knowledge-work team (PM + specialists)'],
        ['openAgentBuilder', 'Build an Agent', 'Compose a custom role with model, tools, playbooks, and MCP grants'],
        ['runDemoTask', 'Run Demo Task', 'See UnodeAi in action with a pre-built task'],
        ['openDocumentation', 'Open Documentation', 'Learn about agents, teams, and workflows']
      ].forEach(([command, label, copy]) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'empty-card';
        card.dataset.command = command;
        const cardTitle = document.createElement('span');
        cardTitle.className = 'empty-title';
        cardTitle.textContent = label;
        const cardCopy = document.createElement('span');
        cardCopy.className = 'empty-copy';
        cardCopy.textContent = copy;
        card.append(cardTitle, cardCopy);
        grid.appendChild(card);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn';
      add.style.marginTop = '12px';
      add.dataset.command = 'addAgent';
      add.textContent = 'Add a single agent';
      emptyState.replaceChildren(title, grid, add);
    }

    // Keep in sync with TeamViewProvider._stateEmoji (TS) for live status updates.
    function stateEmoji(status) {
      switch (status) {
        case 'running': return '🏃';
        case 'idle': return '🧍';
        case 'stopped': return '😴';
        case 'error': return '🤕';
        case 'starting': return '🚶';
        case 'stopping': return '🚶';
        default: return '🧍';
      }
    }

    document.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-command]');
      if (!button) return;
      const checkpointId = button.dataset.checkpointId ? Number(button.dataset.checkpointId) : undefined;
      vscode.postMessage({ command: button.dataset.command, agentId: button.dataset.agentId, checkpointId });
    });

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.command === 'updateStatus') {
        const badge = document.getElementById('badge-' + msg.agentId);
        if (badge) {
          badge.className = 'status-badge status-' + msg.status;
          badge.querySelector('.status-text').textContent = msg.status;
          const emoji = badge.querySelector('.status-emoji');
          if (emoji) { emoji.textContent = stateEmoji(msg.status); }
        }
      }
    });
  </script>
</body>
</html>`;
  }

  /** A little person whose pose mirrors the agent's state: running=working, standing=idle, asleep=stopped. */
  private _stateEmoji(status: string): string {
    switch (status) {
      case 'working': return '🏃';
      case 'done': return '✓';
      case 'blocked': return '!';
      case 'running': return '🏃';
      case 'idle': return '🧍';
      case 'stopped': return '😴';
      case 'error': return '🤕';
      case 'starting': return '🚶';
      case 'stopping': return '🚶';
      default: return '🧍';
    }
  }

  private _statusView(session: SessionInfo): { key: string; label: string; detail?: string } {
    const delegated = this.delegationStates.get(session.config.id);
    if (delegated?.status === 'working') {
      return {
        key: 'working',
        label: 'Working',
        detail: `on ${delegated.task || 'delegated task'} for ${delegated.coordinatorName}`,
      };
    }
    if (delegated?.status === 'blocked') {
      return {
        key: 'blocked',
        label: 'Blocked',
        detail: `blocked on ${delegated.task || 'delegated task'} for ${delegated.coordinatorName}`,
      };
    }
    if (delegated?.status === 'done' && isRecent(delegated.updatedAt, 120000)) {
      return {
        key: 'done',
        label: 'Done',
        detail: `finished ${delegated.task || 'delegated task'} for ${delegated.coordinatorName}`,
      };
    }
    if (session.status === 'error') {
      return { key: 'blocked', label: 'Blocked', detail: session.errorMessage };
    }
    if (session.status === 'running') {
      return {
        key: 'working',
        label: 'Working',
        detail: session.currentTask ? `on ${session.currentTask}` : undefined,
      };
    }
    if (session.status === 'idle') {
      return { key: 'idle', label: 'Idle' };
    }
    if (session.status === 'stopped') {
      return { key: 'stopped', label: 'Stopped' };
    }
    if (session.status === 'starting') {
      return { key: 'starting', label: 'Starting' };
    }
    if (session.status === 'stopping') {
      return { key: 'stopping', label: 'Stopping' };
    }
    return { key: session.status, label: titleCase(session.status) };
  }

  /** Compact chip: just the agent's icon + a status-colored dot; click opens its chat. Name/role/status
   *  live in the tooltip. Frees vertical space so Chat/Messages get more room. */
  private _renderCompactCard(session: SessionInfo): string {
    const config = session.config;
    const status = this._statusView(session);
    const id = escAttr(config.id);
    const row = toConsoleRows([session])[0];
    const meta = [row?.contextLabel, row?.costLabel, row?.turnsLabel].filter(Boolean).join(' · ');
    const tip = `${config.name} - ${config.role} - ${status.label}${status.detail ? ` - ${status.detail}` : ''}${meta ? ` - ${meta}` : ''}`;
    return /* html */`
      <button class="compact-card status-${status.key}" data-command="chatAgent" data-agent-id="${id}"
              title="${escAttr(tip)}">
        ${renderAgentIcon(config.icon, 'compact-icon', 'RC')}
        <span class="status-dot"></span>
      </button>`;
  }

  /** Badge shown next to the model when Smart Mode is on: the TRUE model the agent will run (its provider's
   *  tier model), or a warning that it falls back to the configured model when no tier model is set. */
  private _smartBadge(config: { role: string; model: string; tier?: string; provider: { providerId: string } }): string {
    const sm = this.smartModePreview?.(config);
    if (!sm) {
      return ''; // Smart Mode off → just the configured model
    }
    if (sm.model && sm.model !== config.model) {
      return ` <span class="smart-badge" title="Smart Mode on — runs the ${esc(sm.tier)} tier model on ${esc(config.provider.providerId)}">⚡ Smart → ${esc(sm.model)}</span>`;
    }
    if (sm.model) {
      return ` <span class="smart-badge" title="Smart Mode on — ${esc(sm.tier)} tier resolves to the configured model">⚡ Smart</span>`;
    }
    return ` <span class="smart-badge warn" title="Smart Mode on, but no ${esc(sm.tier)} model is set for ${esc(config.provider.providerId)} — runs the configured model">⚡ Smart (configured)</span>`;
  }

  private _renderAgentCard(session: SessionInfo, changedFiles: ChangedFileSummary[] = []): string {
    const config = session.config;
    const status = this._statusView(session);
    const statusClass = `status-${status.key}`;
    const emoji = this._stateEmoji(status.key);

    const skillsHtml = (config.skills ?? [])
      .slice(0, 4)
      .map((s) => `<span class="skill-tag">${esc(s.name)}</span>`)
      .join('');

    const id = escAttr(config.id);

    const actionButtons = session.status === 'running' || session.status === 'idle'
      ? `<button class="btn btn-stop" data-command="stopAgent" data-agent-id="${id}" title="Stop this agent's process (its conversation is kept and restored on next start)">Stop</button>
         <button class="btn" data-command="restartAgent" data-agent-id="${id}" title="Restart the agent to pick up config changes; conversation context is preserved">Restart</button>
         <button class="btn" data-command="chatAgent" data-agent-id="${id}" title="Open a direct chat with this agent">Chat</button>
         <button class="btn" data-command="editAgent" data-agent-id="${id}" title="Edit this agent in the Agent Builder (model, prompt, skills, MCP) — changes apply live">Edit</button>
         <button class="btn" data-command="showTerminal" data-agent-id="${id}" title="Show this agent's command terminal (commands it runs and their output)">Terminal</button>`
      : session.status === 'stopped' || session.status === 'error'
        ? `<button class="btn btn-start" data-command="startAgent" data-agent-id="${id}" title="Start this agent so it can chat and take tasks">Start</button>
           <button class="btn" data-command="chatAgent" data-agent-id="${id}" title="Open a direct chat with this agent">Chat</button>
           <button class="btn" data-command="editAgent" data-agent-id="${id}" title="Edit this agent in the Agent Builder (model, prompt, skills, MCP)">Edit</button>
           <button class="btn" data-command="showTerminal" data-agent-id="${id}" title="Show this agent's command terminal (commands it runs and their output)">Terminal</button>
           <button class="btn" data-command="removeAgent" data-agent-id="${id}" title="Remove this agent from the team (its saved chat history is deleted)">Remove</button>`
        : `<button class="btn" disabled title="This agent is changing state…">...</button>`;

    const taskHtml = status.detail
      ? `<div class="agent-task ${status.key === 'done' ? 'done' : status.key === 'blocked' ? 'err' : ''}" title="${escAttr(status.detail)}">${esc(status.detail)}</div>`
      : session.errorMessage && session.status === 'error'
        ? `<div class="agent-task err">⚠ ${esc(session.errorMessage.slice(0, 140))}</div>`
        : '';

    // Live metrics folded in from the (removed) Parallel Console: context %, cost, turns.
    const row = toConsoleRows([session])[0];
    const metrics = [row?.contextLabel, row?.costLabel, row?.turnsLabel].filter(Boolean) as string[];
    const metricsHtml = metrics.length
      ? `<span class="inline-metrics">${metrics.map((m) => `<span class="metric">${esc(m)}</span>`).join('')}</span>`
      : '';

    return /* html */`
      <div class="agent-card">
        <div class="agent-header">
          <div>
            <span class="agent-name">${renderAgentIcon(config.icon, 'agent-icon', 'RC')}<span>${esc(config.name)}</span></span>
            <span class="agent-role">${esc(config.role)}</span>
          </div>
          <span class="status-badge ${statusClass}" id="badge-${id}">
            <span class="status-emoji">${emoji}</span>
            <span class="status-dot"></span>
            <span class="status-text">${esc(status.label)}</span>
          </span>
        </div>
        <div class="agent-details">
          <span class="model-line">Model: ${esc(config.model)}${this._smartBadge(config)} ${metricsHtml}</span>
          <span>Provider: ${esc(config.provider.providerId)}</span>
        </div>
        ${taskHtml}
        ${skillsHtml ? `<div class="skills-list">${skillsHtml}</div>` : ''}
        ${this._renderFileActivity(changedFiles)}
        <div class="agent-actions" style="margin-top:6px">
          ${actionButtons}
        </div>
      </div>`;
  }

  /** Per-agent "recently changed files" (from checkpoints), each click-through to a read-only diff. */
  private _renderFileActivity(changedFiles: ChangedFileSummary[]): string {
    if (changedFiles.length === 0) {
      return '';
    }
    return /* html */`
      <div class="file-activity">
        <div class="file-activity-title">📝 Changed files</div>
        <div class="file-activity-list">
          ${changedFiles.map((file) => `
            <button class="file-activity-item" data-command="showCheckpointDiff"
                    data-checkpoint-id="${escAttr(String(file.checkpointId))}"
                    title="${escAttr(file.path)}">📝 ${esc(file.path)}</button>
          `).join('')}
        </div>
      </div>`;
  }

  private _renderEmptyState(): string {
    return /* html */`
      <div class="empty-state">
        <p>No agents in your team yet.</p>
        <div class="empty-grid">
          <button class="empty-card" data-command="createDefaultTeam">
            <span class="empty-title">Create a Team</span>
            <span class="empty-copy">Pick a software crew or a knowledge-work team (PM + specialists)</span>
          </button>
          <button class="empty-card" data-command="openAgentBuilder">
            <span class="empty-title">Build an Agent</span>
            <span class="empty-copy">Compose a custom role with model, tools, playbooks, and MCP grants</span>
          </button>
          <button class="empty-card" data-command="runDemoTask">
            <span class="empty-title">Run Demo Task</span>
            <span class="empty-copy">See UnodeAi in action with a pre-built task</span>
          </button>
          <button class="empty-card" data-command="openDocumentation">
            <span class="empty-title">Open Documentation</span>
            <span class="empty-copy">Learn about agents, teams, and workflows</span>
          </button>
        </div>
        <button class="btn" style="margin-top:12px" data-command="addAgent">Add a single agent</button>
      </div>`;
  }

  private async openDocumentation(): Promise<void> {
    const uri = vscode.Uri.joinPath(this._extensionUri, 'USAGE.md');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  }
}

function isTeamMessage(msg: unknown, agentIds: string[]): msg is { command: string; agentId?: string; checkpointId?: number } {
  if (!msg || typeof msg !== 'object') {
    return false;
  }
  const command = (msg as { command?: unknown }).command;
  const agentId = (msg as { agentId?: unknown }).agentId;
  const checkpointId = (msg as { checkpointId?: unknown }).checkpointId;
  const globalCommands = new Set([
    'sendMessage',
    'createDefaultTeam',
    'addAgent',
    'openAgentBuilder',
    'openMarketplace',
    'openSettings',
    'createTeamPreset',
    'editTeamRules',
    'restoreCheckpoint',
    'startAllAgents',
    'stopAllAgents',
    'startSolo',
    'startSoloActive',
    'runDemoTask',
    'openDocumentation',
  ]);
  const agentCommands = new Set(['startAgent', 'stopAgent', 'restartAgent', 'removeAgent', 'showOutput', 'showTerminal', 'editAgent', 'chatAgent']);
  if (typeof command !== 'string') {
    return false;
  }
  if (globalCommands.has(command)) {
    return true;
  }
  if (command === 'showCheckpointDiff') {
    return typeof checkpointId === 'number' && Number.isFinite(checkpointId);
  }
  return agentCommands.has(command) && typeof agentId === 'string' && agentIds.includes(agentId);
}

function isRecent(timestamp: string, maxAgeMs: number): boolean {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
}

function titleCase(value: string): string {
  if (!value) {
    return 'Unknown';
  }
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
