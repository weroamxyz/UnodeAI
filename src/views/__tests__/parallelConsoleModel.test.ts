import { describe, expect, it } from 'vitest';
import { AgentConfig, SessionInfo, SessionStatus } from '../../types';
import { toConsoleRows } from '../parallelConsoleModel';

function session(overrides: Partial<SessionInfo> = {}, configOverrides: Partial<AgentConfig> = {}): SessionInfo {
  const config: AgentConfig = {
    id: 'dev',
    name: 'Dev',
    role: 'developer',
    skill: 'development',
    provider: { providerId: 'roam', apiKeySecretName: 'ROAM_API_KEY' },
    model: 'test-model',
    systemPrompt: 'Build things.',
    autoApprove: false,
    allowedTools: [],
    ...configOverrides,
  };

  return {
    id: config.id,
    config,
    status: 'idle' as SessionStatus,
    restartCount: 0,
    ...overrides,
  };
}

describe('parallelConsoleModel', () => {
  it('returns no rows for an empty team', () => {
    expect(toConsoleRows([])).toEqual([]);
  });

  it('projects task, context, usage, cost, tokens, and turns', () => {
    expect(toConsoleRows([
      session({
        status: 'running',
        currentTask: 'Implement the console',
        contextUsage: { tokens: 42_000, window: 100_000, ratio: 0.42 },
        usage: { inputTokens: 1_500, outputTokens: 500, costUsd: 0.01234, turns: 7 },
      }, { name: 'Builder', role: 'senior-dev' }),
    ])).toEqual([
      expect.objectContaining({
        id: 'dev',
        name: 'Builder',
        role: 'senior-dev',
        status: 'running',
        statusLabel: 'Running',
        currentTask: 'Implement the console',
        contextPercent: 42,
        contextLabel: 'ctx 42%',
        costLabel: '$0.0123',
        turnsLabel: '7 turns',
        tokenLabel: '2.0k tok',
      }),
    ]);
  });

  it('uses idle and omits optional metrics without usage or context data', () => {
    const [row] = toConsoleRows([session()]);

    expect(row.currentTask).toBe('idle');
    expect(row.contextLabel).toBeUndefined();
    expect(row.costLabel).toBeUndefined();
    expect(row.turnsLabel).toBeUndefined();
    expect(row.tokenLabel).toBeUndefined();
  });

  it('exposes truncated errors for display while keeping the full title', () => {
    const message = `failed ${'x'.repeat(180)}`;
    const [row] = toConsoleRows([
      session({ status: 'error', errorMessage: message }),
    ]);

    expect(row.errorMessage).toHaveLength(140);
    expect(row.errorMessage?.endsWith('…')).toBe(true);
    expect(row.errorTitle).toBe(message);
  });
});
