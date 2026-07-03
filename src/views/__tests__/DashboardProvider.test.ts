import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { renderMissionControlLanes } from '../DashboardProvider';
import { SessionInfo } from '../../types';
import { WorktreeReview } from '../WorktreePanel';

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'dev-1',
    status: 'running',
    restartCount: 0,
    currentTask: 'Implement the checkout flow and update tests',
    config: {
      id: 'dev-1',
      name: 'Senior Dev',
      role: 'senior-dev',
      skill: 'code-generation',
      provider: { providerId: 'roam', apiKeySecretName: 'ROAM_API_KEY' },
      model: 'deepseek-v4-pro',
      systemPrompt: 'Write code.',
      autoApprove: false,
      allowedTools: ['message'],
    },
    usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.42, turns: 1 },
    contextUsage: { tokens: 2048, window: 8192, ratio: 0.25 },
    ...overrides,
  };
}

describe('Dashboard Mission Control lanes', () => {
  it('renders status, task, files, cost, context, and command actions', () => {
    const html = renderMissionControlLanes([session()], {
      filesByAgent: new Map([['dev-1', ['src/cart.ts', 'test/cart.test.ts']]]),
    });

    expect(html).toContain('Senior Dev');
    expect(html).toContain('working');
    expect(html).toContain('Implement the checkout flow');
    expect(html).toContain('src/cart.ts, test/cart.test.ts');
    expect(html).toContain('$0.42');
    expect(html).toContain('25%');
    expect(html).toContain('command:roam.chatWithAgent?%5B%22dev-1%22%5D');
    expect(html).toContain('command:roam.showAgentTerminal?%5B%22dev-1%22%5D');
  });

  it('uses delegation progress as the current lane task and escapes it', () => {
    const html = renderMissionControlLanes([session()], {
      agentStates: [{
        agentId: 'dev-1',
        status: 'blocked',
        task: 'Fix <script>alert(1)</script>',
        coordinatorName: 'PM',
        updatedAt: new Date().toISOString(),
      }],
    });

    expect(html).toContain('blocked');
    expect(html).toContain('Fix &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('shows worktree verification only when a worktree review is supplied', () => {
    const review: WorktreeReview = {
      base: 'main',
      integrationBranch: 'roam/integration',
      hasIntegration: true,
      lanes: [{
        agentId: 'dev-1',
        agent: 'Senior Dev',
        branch: 'roam/dev',
        path: 'C:/repo/.roam/worktrees/dev',
        verification: { status: 'passed', command: 'npm test', output: 'ok' },
        changedFiles: ['src/worktree-only.ts'],
      }],
      integrationFiles: ['src/worktree-only.ts'],
    };

    const withWorktree = renderMissionControlLanes([session()], { worktreeReview: review });
    expect(withWorktree).toContain('Verified / mergeable');
    expect(withWorktree).toContain('src/worktree-only.ts');

    const withoutWorktree = renderMissionControlLanes([session()]);
    expect(withoutWorktree).not.toContain('Verified / mergeable');
    expect(withoutWorktree).not.toContain('<div>Verified</div>');
  });

  it('associates worktree files and verification by agent id when display names match', () => {
    const base = session();
    const devA = session({
      id: 'dev-a',
      config: { ...base.config, id: 'dev-a', name: 'Developer' },
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.1, turns: 1 },
    });
    const devB = session({
      id: 'dev-b',
      config: { ...base.config, id: 'dev-b', name: 'Developer' },
      usage: { inputTokens: 20, outputTokens: 5, costUsd: 0.2, turns: 1 },
    });
    const review: WorktreeReview = {
      base: 'main',
      integrationBranch: 'roam/integration',
      hasIntegration: true,
      lanes: [
        {
          agentId: 'dev-a',
          agent: 'Developer',
          branch: 'roam/dev-a',
          path: 'C:/repo/.roam/worktrees/dev-a',
          verification: { status: 'passed', command: 'npm test', output: 'ok' },
          changedFiles: ['src/dev-a.ts'],
        },
        {
          agentId: 'dev-b',
          agent: 'Developer',
          branch: 'roam/dev-b',
          path: 'C:/repo/.roam/worktrees/dev-b',
          verification: { status: 'failed', command: 'npm test', output: 'nope' },
          changedFiles: ['src/dev-b.ts'],
        },
      ],
      integrationFiles: ['src/dev-a.ts', 'src/dev-b.ts'],
    };

    const html = renderMissionControlLanes([devA, devB], { worktreeReview: review });
    const aIndex = html.indexOf('src/dev-a.ts');
    const bIndex = html.indexOf('src/dev-b.ts');

    expect(aIndex).toBeGreaterThan(-1);
    expect(bIndex).toBeGreaterThan(-1);
    expect(html.indexOf('Verified / mergeable')).toBeGreaterThan(aIndex);
    expect(html.indexOf('Verified / mergeable')).toBeLessThan(bIndex);
    expect(html.indexOf('Failed / held')).toBeGreaterThan(bIndex);
  });

  it('renders a clean empty state', () => {
    const html = renderMissionControlLanes([]);
    expect(html).toContain('No agents configured yet.');
    expect(html).toContain('command:roam.createTeamPreset');
  });
});
