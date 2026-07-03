import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  QuickPickItemKind: { Separator: -1 },
  ConfigurationTarget: { Workspace: 2 },
  workspace: {
    getConfiguration: () => ({ get: () => '', update: vi.fn() }),
    workspaceFolders: [{ uri: { fsPath: '/some/workspace' } }],
  },
  window: { showInformationMessage: vi.fn().mockResolvedValue(undefined) },
}));
// The command-approval nudge is interactive; stub it so team/solo creation runs headless.
vi.mock('./backend/CommandApprovalPrompter', () => ({ promptCommandApproval: vi.fn().mockResolvedValue(false) }));

import { teamPresetItems, createDefaultTeam, createSoloAgent } from './dialogs';

// Runtime invariant (Codex follow-up): NO creation path may pin config.workingDirectory — the runtime
// resolves the root per session. Even with a workspace folder open, created configs must leave it unset.
function makeDeps(created: { workingDirectory?: string }[]) {
  return {
    sessionManager: { getAll: () => [], create: (c: any) => { created.push(c); } },
    secrets: { has: async () => true, promptAndStore: async () => {} },
    output: { info: () => {} },
    commandPolicy: { approvalMode: 'none', reload: () => {} },
    defaultBackendKind: () => 'openai-compat',
  } as any;
}

describe('creation paths never pin workingDirectory', () => {
  it('createDefaultTeam (the createTeamPreset path) leaves workingDirectory unset', async () => {
    const created: { workingDirectory?: string }[] = [];
    await createDefaultTeam(makeDeps(created));
    expect(created.length).toBeGreaterThan(0);
    for (const c of created) { expect(c.workingDirectory).toBeUndefined(); }
  });

  it('createSoloAgent leaves workingDirectory unset', async () => {
    const created: { workingDirectory?: string }[] = [];
    const cfg = await createSoloAgent(makeDeps(created));
    expect(cfg?.workingDirectory).toBeUndefined();
  });
});

describe('team preset picker items', () => {
  it('groups task packs and includes their descriptions', () => {
    const items = teamPresetItems();
    expect(items.filter((i) => i.kind === -1).map((i) => i.label)).toEqual([
      'Software',
      'Task Packs',
      'Knowledge Work',
    ]);

    for (const label of ['Bugfix Crew', 'Refactor Crew', 'Test Writer Crew', 'Release Crew', 'Security Review Crew']) {
      const item = items.find((i) => i.label.includes(label));
      expect(item, label).toBeDefined();
      expect(item?.description, label).toBeTruthy();
      expect(item?.detail, label).toContain('Verify:');
    }
  });
});
