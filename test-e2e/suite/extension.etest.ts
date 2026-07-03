/*---------------------------------------------------------------------------------------------
 *  UnodeAi - E2E smoke test (P1#7)
 *  Runs inside a real VS Code instance (via @vscode/test-cli). This is the scaffold the project
 *  reviews flagged as missing (E2E=0): it activates the extension and asserts the core user-journey
 *  entry points exist. Extend with: add agent -> start -> send message -> observe activity feed.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'roamai.roam-crew';

const EXPECTED_COMMANDS = [
  'roam.showTeamPanel',
  'roam.showDashboard',
  'roam.addAgent',
  'roam.createDefaultTeam',
  'roam.createTeamPreset',
  'roam.startSolo',
  'roam.showAgentTerminal',
  'roam.restoreCheckpoint',
  'roam.sendMessage',
  'roam.openChat',
  'roam.chatWithAgent',
  'roam.runWorkflow',
  'roam.editWorkflow',
  'roam.onboarding',
  'roam.runDemoTask',
  'roam.setApiKey',
  'roam.openSettings',
  'roam.resetWorkspaceState',
];

describe('UnodeAi activation', () => {
  it('activates the extension', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} should be present`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('registers all core commands', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(all.includes(cmd), `command ${cmd} should be registered`);
    }
  });

  it('opens the Settings panel without throwing', async () => {
    await vscode.commands.executeCommand('roam.openSettings');
  });

  it('opens the Workflow Editor without throwing', async () => {
    await vscode.commands.executeCommand('roam.editWorkflow');
  });

  it('completes onboarding and sets the workspace flag', async () => {
    const result = await vscode.commands.executeCommand('roam.onboarding', { completeImmediately: true });
    assert.strictEqual(result, true);
  });

  it('sends a demo task to the Project Manager through the normal turn entrypoint', async () => {
    const originalInfo = vscode.window.showInformationMessage;
    const originalWarning = vscode.window.showWarningMessage;
    try {
      (vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
        async () => undefined;
      (vscode.window as any).showWarningMessage = async (_message: string, ...args: unknown[]) => {
        const items = args.filter((item): item is string => typeof item === 'string');
        return items.includes('Add') ? 'Add' : undefined;
      };
      await vscode.commands.executeCommand('roam.createDefaultTeam');
      await vscode.commands.executeCommand('roam.runDemoTask', 'hello-world-http-server');
    } finally {
      (vscode.window as unknown as { showInformationMessage: typeof vscode.window.showInformationMessage }).showInformationMessage =
        originalInfo;
      (vscode.window as any).showWarningMessage = originalWarning;
    }
  });
});
