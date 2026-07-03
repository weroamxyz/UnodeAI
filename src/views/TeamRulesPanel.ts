/*---------------------------------------------------------------------------------------------
 *  UnodeAi - TeamRulesPanel  (#4b Team Rules)
 *  A small editor for the team's rules, persisted to `.unode/rules.md`. Those rules are already
 *  injected into every agent's system prompt and refreshed each turn (see RulesFile / SessionManager),
 *  so anything written here governs how the crew works — e.g. "Developers must have the architect
 *  review their work before it's done." This panel is just a friendly front door to that file.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { nonce, csp, esc } from './webviewSecurity';

export interface TeamRulesPanelDeps {
  rulesFilePath: string;
  /** Called after a successful save so the live RulesFile cache can reload. */
  onSaved?: () => void;
}

let currentPanel: vscode.WebviewPanel | undefined;

/** Open (or reveal) the Team Rules editor. */
export async function openTeamRulesPanel(deps: TeamRulesPanelDeps): Promise<void> {
  if (currentPanel) {
    currentPanel.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'roam.teamRules',
    'Team Rules',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  currentPanel = panel;
  panel.onDidDispose(() => { currentPanel = undefined; });

  const saved = await readRules(deps.rulesFilePath);
  // When there are no saved rules yet, seed the editor with the default template as *real* editable
  // text (not a placeholder that vanishes on first keystroke), so the user can tweak it and save it.
  const content = saved.trim() ? saved : PLACEHOLDER;
  const scriptNonce = nonce();
  panel.webview.html = getHtml(panel.webview, scriptNonce, content);

  panel.webview.onDidReceiveMessage(async (msg: { command?: string; text?: unknown }) => {
    if (msg?.command === 'save' && typeof msg.text === 'string') {
      try {
        await writeRules(deps.rulesFilePath, msg.text);
        deps.onSaved?.();
        panel.webview.postMessage({ command: 'saved' });
        vscode.window.showInformationMessage('Team rules saved. Agents pick them up on their next turn.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not save team rules: ${message}`);
      }
    }
  });
}

async function readRules(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function writeRules(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

const PLACEHOLDER = `# Team rules

Write rules your whole crew must follow. They're added to every agent's instructions.

Examples:
- Developers must have the architect review their work before it's considered done.
- Never edit files outside the set you were assigned; if you must, stop and report.
- Always run the tests before reporting a task complete.
- Follow the existing code style; do not add new dependencies without asking.`;

function getHtml(webview: vscode.Webview, scriptNonce: string, content: string): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp(webview, scriptNonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Rules</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      display: flex; flex-direction: column; gap: 10px; padding: 14px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background);
    }
    h2 { margin: 0; font-size: 15px; }
    p.hint { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.4; }
    textarea {
      flex: 1 1 auto; min-height: 280px; resize: vertical;
      padding: 10px; border-radius: 6px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px; line-height: 1.5;
    }
    .row { display: flex; align-items: center; gap: 10px; }
    button {
      padding: 5px 14px; border-radius: 4px; cursor: pointer;
      color: var(--vscode-button-foreground); background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-background);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .saved { color: var(--vscode-charts-green, #3fb950); font-size: 12px; opacity: 0; transition: opacity 0.15s; }
    .saved.show { opacity: 1; }
  </style>
</head>
<body>
  <h2>Team Rules</h2>
  <p class="hint">Rules every agent in this team must follow. They're injected into each agent's instructions and refreshed every turn — so changes take effect on the next turn. Saved to <code>.unode/rules.md</code>.</p>
  <textarea id="rules" placeholder="${esc(PLACEHOLDER)}" spellcheck="false">${esc(content)}</textarea>
  <div class="row">
    <button id="save" type="button">Save Rules</button>
    <span id="saved" class="saved">Saved ✓</span>
  </div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const ta = document.getElementById('rules');
    const saveBtn = document.getElementById('save');
    const savedLabel = document.getElementById('saved');
    saveBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'save', text: ta.value });
    });
    window.addEventListener('message', (event) => {
      if (event.data && event.data.command === 'saved') {
        savedLabel.classList.add('show');
        setTimeout(() => savedLabel.classList.remove('show'), 1500);
      }
    });
  </script>
</body>
</html>`;
}
