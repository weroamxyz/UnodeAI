import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../SessionManager';
import { MessageBus } from '../../bus/MessageBus';
import {
  AgentBackend,
  BackendEvent,
  BackendEventHandler,
  ConversationSnapshot,
  TurnAttachments,
} from '../../backend/AgentBackend';
import { AgentConfig, Message } from '../../types';

/** A backend that records the turns it receives and lets the test drive its events. */
class FakeBackend implements AgentBackend {
  readonly agentId: string;
  pid = 1234;
  turns: string[] = [];
  attachments: Array<TurnAttachments | undefined> = [];
  restored?: ConversationSnapshot;
  aborts = 0;
  private handler?: BackendEventHandler;
  private alive = false;

  constructor(config: AgentConfig) {
    this.agentId = config.id;
  }
  onEvent(h: BackendEventHandler): () => void {
    this.handler = h;
    return () => (this.handler = undefined);
  }
  async start(): Promise<void> {
    this.alive = true;
  }
  sendUserTurn(instruction: string, attachments?: TurnAttachments): void {
    this.turns.push(instruction);
    this.attachments.push(attachments);
  }
  async stop(): Promise<void> {
    this.alive = false;
    this.emit({ kind: 'exit', code: 0 });
  }
  abort(): void {
    this.aborts++;
  }
  interjects: string[] = [];
  interject(text: string): void {
    this.interjects.push(text);
  }
  models: string[] = [];
  setModel(model: string): void {
    this.models.push(model);
  }
  isAlive(): boolean {
    return this.alive;
  }
  snapshot(): ConversationSnapshot {
    return { version: 1, messages: [`history of ${this.agentId}`] };
  }
  restore(snap: ConversationSnapshot): void {
    this.restored = snap;
  }
  emit(e: BackendEvent): void {
    this.handler?.(e);
  }
}

class DeferredStartBackend extends FakeBackend {
  resolveStart!: () => void;
  rejectStart!: (err: Error) => void;

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }
}

class CompactingBackend extends FakeBackend {
  compactCalls: string[] = [];

  async compactHistory(_summarizer: any, _io: any, economyModel: string): Promise<void> {
    this.compactCalls.push(economyModel);
  }
}

function makeConfig(id: string, role: string): AgentConfig {
  return {
    id,
    name: id,
    role: role as AgentConfig['role'],
    skill: '',
    provider: { providerId: 'anthropic', apiKeySecretName: 'ANTHROPIC_API_KEY' },
    model: 'claude-sonnet-4-20250514',
    systemPrompt: '',
    autoApprove: true,
    allowedTools: [],
  };
}

describe('SessionManager <-> MessageBus routing', () => {
  let bus: MessageBus;
  let mgr: SessionManager;
  let backends: Map<string, FakeBackend>;

  beforeEach(() => {
    bus = new MessageBus();
    backends = new Map();
    mgr = new SessionManager(5, bus, {
      createBackend: (config) => {
        const b = new FakeBackend(config);
        backends.set(config.id, b);
        return b;
      },
      resolveEnv: async () => ({}),
    });
  });

  it('delivers a task.assign addressed to an agent as a backend turn', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.send('user', 'dev', 'task.assign', { instruction: 'build X' });

    expect(backends.get('dev')!.turns).toEqual(['build X']);
    expect(mgr.get('dev')!.status).toBe('running');
  });

  it('delivers a DIRECTED agent.message (send_message) as a backend turn, framed by sender', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.send('architect', 'dev', 'agent.message', { message: 'heads up: API shape changed' });

    expect(backends.get('dev')!.turns).toEqual(['Message from architect: heads up: API shape changed']);
  });

  it('does NOT start a turn for a broadcast agent.message (to *) — informational only', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.broadcast('architect', 'agent.message', { message: 'standup in 5' });

    expect(backends.get('dev')!.turns).toEqual([]);
    expect(mgr.get('dev')!.status).toBe('idle');
  });

  it('republishes a turn_complete as task.complete back to the original sender', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    const completions: Message[] = [];
    bus.onType('task.complete', (m) => { completions.push(m); });

    const assign = bus.send('architect', 'dev', 'task.assign', { instruction: 'do it' });
    backends.get('dev')!.emit({
      kind: 'turn_complete',
      result: { text: 'done', isError: false, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } },
    });

    expect(completions).toHaveLength(1);
    expect(completions[0].from).toBe('dev');
    expect(completions[0].to).toBe('architect');
    expect(completions[0].correlationId).toBe(assign.id);
    expect(mgr.get('dev')!.status).toBe('idle');
    expect(mgr.get('dev')!.usage!.costUsd).toBeCloseTo(0.01);
  });

  it('forwards assistant deltas as session.stream events', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    const deltas: string[] = [];
    mgr.on('session.stream', (e) => deltas.push(e.data.delta));

    bus.send('user', 'dev', 'task.assign', { instruction: 'stream' });
    backends.get('dev')!.emit({ kind: 'assistant_delta', delta: 'hel' });
    backends.get('dev')!.emit({ kind: 'assistant_delta', delta: 'lo' });

    expect(deltas).toEqual(['hel', 'lo']);
  });

  it('forwards tool activity and compaction markers to session events', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    const tools: unknown[] = [];
    const compacted: unknown[] = [];
    mgr.on('session.tool', (e) => tools.push(e.data));
    mgr.on('session.compacted', (e) => compacted.push(e.data));

    backends.get('dev')!.emit({ kind: 'tool_use', name: 'read_file', input: { path: 'a.ts' } });
    backends.get('dev')!.emit({ kind: 'tool_result', name: 'read_file', ok: true, summary: 'read_file a.ts', detail: 'content' });
    backends.get('dev')!.emit({ kind: 'compacted', dropped: 3, model: 'economy' });

    expect(tools).toEqual([
      { phase: 'use', name: 'read_file', input: { path: 'a.ts' } },
      { phase: 'result', name: 'read_file', ok: true, summary: 'read_file a.ts', detail: 'content', diff: undefined },
    ]);
    expect(compacted).toEqual([{ dropped: 3, model: 'economy' }]);
  });

  it('forwards turn context after completion', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    const contexts: unknown[] = [];
    mgr.on('session.context', (e) => contexts.push(e.data));

    bus.send('user', 'dev', 'task.assign', { instruction: 'measure' });
    backends.get('dev')!.emit({
      kind: 'turn_complete',
      result: {
        text: 'done',
        isError: false,
        context: { tokens: 50, window: 100, ratio: 0.5 },
      },
    });

    expect(contexts).toEqual([{ tokens: 50, window: 100, ratio: 0.5 }]);
  });

  it('interrupts the backend for the selected agent', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.send('user', 'dev', 'task.assign', { instruction: 'long turn' });
    mgr.interrupt('dev');

    expect(backends.get('dev')!.aborts).toBe(1);
  });

  it('routes interjectAgent to the selected backend (G-001)', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    mgr.interjectAgent('dev', 'use read_file instead');

    expect(backends.get('dev')!.interjects).toEqual(['use read_file instead']);
  });

  it('serializes two tasks to a busy agent and routes each completion to its own sender', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' }); // -> idle

    const completes: Message[] = [];
    bus.onType('task.complete', (m) => completes.push(m));

    // A from alice; while it runs, B from bob arrives — B must queue, not overwrite A's origin.
    const a = bus.send('alice', 'dev', 'task.assign', { instruction: 'A' });
    const b = bus.send('bob', 'dev', 'task.assign', { instruction: 'B' });
    expect(backends.get('dev')!.turns).toEqual(['A']); // one at a time

    backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'doneA', isError: false } });
    expect(backends.get('dev')!.turns).toEqual(['A', 'B']); // B delivered after A completes

    backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'doneB', isError: false } });

    // Each completion goes to the right original sender — no cross-talk, no broadcast.
    expect(completes.map((m) => [m.to, m.payload.instruction])).toEqual([
      ['alice', 'doneA'],
      ['bob', 'doneB'],
    ]);
    expect(completes.map((m) => m.correlationId)).toEqual([a.id, b.id]);
  });

  it('lazily starts a stopped agent when a message is routed to it', async () => {
    mgr.create(makeConfig('rev', 'reviewer'));
    expect(mgr.get('rev')!.status).toBe('stopped');

    bus.send('user', 'rev', 'review.request', { instruction: 'review this' });
    // start() is async; give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 0));
    backends.get('rev')!.emit({ kind: 'ready' });

    expect(backends.get('rev')!.turns).toEqual(['review this']);
  });

  it('ignores an agent reacting to its own outgoing messages', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.send('dev', 'dev', 'task.assign', { instruction: 'self' });
    expect(backends.get('dev')!.turns).toEqual([]);
  });

  it('passes resolveTaskModel as a per-turn Smart Mode model without mutating configured model', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    const localMgr = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      resolveTaskModel: (_config, msg) =>
        (msg.payload?.metadata as { tier?: string } | undefined)?.tier === 'premium' ? 'opus-x' : 'flash-y',
    });
    localMgr.create(makeConfig('rev', 'reviewer'));
    await localMgr.start('rev');
    localBackends.get('rev')!.emit({ kind: 'ready' });

    localBus.send('user', 'rev', 'review.request', { instruction: 'r1' });
    expect(localBackends.get('rev')!.attachments[0]?.model).toBe('flash-y');
    expect(localMgr.get('rev')!.config.model).toBe('claude-sonnet-4-20250514');

    // Complete the first turn so the agent is idle before the next task is delivered (turns serialize).
    localBackends.get('rev')!.emit({ kind: 'turn_complete', result: { text: 'ok', isError: false } });
    localBus.send('user', 'rev', 'task.assign', { instruction: 'big', metadata: { tier: 'premium' } });
    expect(localBackends.get('rev')!.attachments[1]?.model).toBe('opus-x');
    expect(localMgr.get('rev')!.config.model).toBe('claude-sonnet-4-20250514');
  });

  it('passes selected Smart Mode tier params through the model-param resolver', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    const localMgr = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      resolveTaskModelParams: (_config, msg) =>
        (msg.payload?.metadata as { tier?: string } | undefined)?.tier === 'premium'
          ? { reasoning_effort: 'high', temperature: 0.9 }
          : undefined,
      resolveModelParams: (config, tierParams) => ({
        ...tierParams,
        ...config.modelParams,
      }),
    });
    const cfg = makeConfig('rev', 'reviewer');
    cfg.modelParams = { temperature: 0.2 };
    localMgr.create(cfg);
    await localMgr.start('rev');
    localBackends.get('rev')!.emit({ kind: 'ready' });

    localBus.send('user', 'rev', 'task.assign', { instruction: 'big', metadata: { tier: 'premium' } });

    expect(localBackends.get('rev')!.attachments[0]?.modelParams).toEqual({
      reasoning_effort: 'high',
      temperature: 0.2,
    });
  });

  it('estimates Smart Mode turn cost against the per-turn model, not the configured model', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    const pricedModels: string[] = [];
    const localMgr = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      resolveTaskModel: () => 'smart-priced-model',
      estimateCost: (model, input, output) => {
        pricedModels.push(model);
        return model === 'smart-priced-model' ? input + output : 0;
      },
    });
    localMgr.create(makeConfig('rev', 'reviewer'));
    await localMgr.start('rev');
    localBackends.get('rev')!.emit({ kind: 'ready' });

    localBus.send('user', 'rev', 'task.assign', { instruction: 'priced' });
    localBackends.get('rev')!.emit({
      kind: 'turn_complete',
      result: { text: 'ok', isError: false, usage: { inputTokens: 2, outputTokens: 3 } },
    });

    expect(pricedModels).toEqual(['smart-priced-model']);
    expect(localMgr.get('rev')!.config.model).toBe('claude-sonnet-4-20250514');
    expect(localMgr.get('rev')!.usage?.costUsd).toBe(5);
  });

  it('passes chat mode to backend attachments and normalizes invalid values to act', async () => {
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.send('user', 'dev', 'ask.question', { instruction: 'plan this', mode: 'plan' });
    backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'planned', isError: false } });
    bus.send('user', 'dev', 'ask.question', { instruction: 'act fallback', mode: 'oops' as any });

    expect(backends.get('dev')!.attachments.map((a) => a?.mode)).toEqual(['plan', 'act']);
  });

  it('appends .unode/rules.md project context to the system prompt at start, without mutating config (F4)', async () => {
    const localBus = new MessageBus();
    let seenPrompt = '';
    const mgr2 = new SessionManager(5, localBus, {
      createBackend: (c) => { seenPrompt = c.systemPrompt; return new FakeBackend(c); },
      resolveEnv: async () => ({}),
      getProjectContext: () => 'Use strict TypeScript',
    });
    const cfg = makeConfig('dev', 'senior-dev');
    cfg.systemPrompt = 'You are a dev.';
    mgr2.create(cfg);
    await mgr2.start('dev');

    expect(seenPrompt).toContain('You are a dev.');
    expect(seenPrompt).toContain('<project_context>\nUse strict TypeScript\n</project_context>');
    // The stored config must stay clean so a restart re-derives from the current rules.
    expect(mgr2.get('dev')!.config.systemPrompt).toBe('You are a dev.');
  });

  it('passes the latest project context to every delivered turn (F4)', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    let projectContext = 'v1';
    const mgr2 = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      getProjectContext: () => projectContext,
    });
    mgr2.create(makeConfig('dev', 'senior-dev'));
    await mgr2.start('dev');
    localBackends.get('dev')!.emit({ kind: 'ready' });

    localBus.send('user', 'dev', 'task.assign', { instruction: 'one' });
    projectContext = 'v2';
    localBackends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'done', isError: false } });
    localBus.send('user', 'dev', 'task.assign', { instruction: 'two' });

    expect(localBackends.get('dev')!.attachments.map((a) => a?.projectContext)).toEqual(['v1', 'v2']);
  });

  it('does not attach workspaceContext when the host gatherer returns nothing', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    const mgr2 = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      getWorkspaceContext: () => undefined,
    });
    mgr2.create(makeConfig('dev', 'senior-dev'));
    await mgr2.start('dev');
    localBackends.get('dev')!.emit({ kind: 'ready' });

    localBus.send('user', 'dev', 'task.assign', { instruction: 'one' });
    await new Promise((r) => setTimeout(r, 0));

    expect(localBackends.get('dev')!.attachments[0]?.workspaceContext).toBeUndefined();
  });

  it('attaches formatted workspaceContext returned by the host gatherer', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    const workspaceContext = [
      'Active file: src/app.ts',
      '--- Active editor snippet ---',
      'export const value = 1;',
      '(truncated - use read_file for the rest)',
      '--- Diagnostics ---',
      'src/app.ts:2:5 [error] Cannot find name value',
    ].join('\n');
    const mgr2 = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      getWorkspaceContext: () => workspaceContext,
    });
    mgr2.create(makeConfig('dev', 'senior-dev'));
    await mgr2.start('dev');
    localBackends.get('dev')!.emit({ kind: 'ready' });

    localBus.send('user', 'dev', 'task.assign', { instruction: 'one' });
    await new Promise((r) => setTimeout(r, 0));

    expect(localBackends.get('dev')!.attachments[0]?.workspaceContext).toBe(workspaceContext);
  });

  it('gathers workspaceContext fresh for each turn', async () => {
    const localBus = new MessageBus();
    const localBackends = new Map<string, FakeBackend>();
    let workspaceContext: string | undefined = 'Active file: src/one.ts';
    const mgr2 = new SessionManager(5, localBus, {
      createBackend: (c) => { const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      getWorkspaceContext: () => workspaceContext,
    });
    mgr2.create(makeConfig('dev', 'senior-dev'));
    await mgr2.start('dev');
    localBackends.get('dev')!.emit({ kind: 'ready' });

    localBus.send('user', 'dev', 'task.assign', { instruction: 'one' });
    await new Promise((r) => setTimeout(r, 0));
    workspaceContext = undefined;
    localBackends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'done', isError: false } });
    localBus.send('user', 'dev', 'task.assign', { instruction: 'two' });
    await new Promise((r) => setTimeout(r, 0));

    expect(localBackends.get('dev')!.attachments.map((a) => a?.workspaceContext)).toEqual(['Active file: src/one.ts', undefined]);
  });

  it('resolves workflow refs by role or id', async () => {
    mgr.create(makeConfig('uuid-1', 'tester'));
    expect(mgr.resolveByRoleOrId('tester')!.id).toBe('uuid-1');
    expect(mgr.resolveByRoleOrId('uuid-1')!.config.role).toBe('tester');
    expect(mgr.resolveByRoleOrId('nope')).toBeUndefined();
  });
});

describe('SessionManager cost estimation', () => {
  it('estimates costUsd from tokens when the backend reports none, and prefers a real cost', async () => {
    const bus = new MessageBus();
    const backends = new Map<string, FakeBackend>();
    const mgr = new SessionManager(5, bus, {
      createBackend: (config) => { const b = new FakeBackend(config); backends.set(config.id, b); return b; },
      resolveEnv: async () => ({}),
      estimateCost: (_model, i, o) => i * 1e-6 + o * 2e-6,
    });

    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    // Turn 1: tokens only, no costUsd -> estimated (1M*1e-6 + 1M*2e-6 = 3.0).
    bus.send('user', 'dev', 'task.assign', { instruction: 'go' });
    backends.get('dev')!.emit({
      kind: 'turn_complete',
      result: { text: '', isError: false, usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } },
    });
    expect(mgr.get('dev')!.usage!.costUsd).toBeCloseTo(3.0, 6);

    // Turn 2: backend reports a real cost -> used verbatim, not estimated (3.0 + 0.5).
    bus.send('user', 'dev', 'task.assign', { instruction: 'go2' });
    backends.get('dev')!.emit({
      kind: 'turn_complete',
      result: { text: '', isError: false, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0.5 } },
    });
    expect(mgr.get('dev')!.usage!.costUsd).toBeCloseTo(3.5, 6);
  });
});

describe('SessionManager history summarization hook', () => {
  it('runs compactHistory before delivering to a backend that supports it', async () => {
    const bus = new MessageBus();
    const backends = new Map<string, CompactingBackend>();
    const mgr = new SessionManager(5, bus, {
      createBackend: (config) => {
        const b = new CompactingBackend(config);
        backends.set(config.id, b);
        return b;
      },
      resolveEnv: async () => ({}),
      summarizer: { summarize: async () => 'summary' },
      summarizerIO: () => ({ chatCompletion: async () => 'summary' }),
      summarizerModel: () => 'economy-model',
    });

    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    bus.send('user', 'dev', 'task.assign', { instruction: 'go' });
    expect(backends.get('dev')!.turns).toEqual([]);

    await new Promise((r) => setTimeout(r, 0));

    expect(backends.get('dev')!.compactCalls).toEqual(['economy-model']);
    expect(backends.get('dev')!.turns).toEqual(['go']);
  });

  it('does not summarize backends without the optional compactHistory capability', async () => {
    const bus = new MessageBus();
    const backends = new Map<string, FakeBackend>();
    const mgr = new SessionManager(5, bus, {
      createBackend: (config) => {
        const b = new FakeBackend(config);
        backends.set(config.id, b);
        return b;
      },
      resolveEnv: async () => ({}),
      summarizer: { summarize: async () => 'summary' },
      summarizerIO: () => ({ chatCompletion: async () => 'summary' }),
      summarizerModel: () => 'economy-model',
    });

    mgr.create(makeConfig('claude-dev', 'senior-dev'));
    await mgr.start('claude-dev');
    backends.get('claude-dev')!.emit({ kind: 'ready' });

    bus.send('user', 'claude-dev', 'task.assign', { instruction: 'go' });

    expect(backends.get('claude-dev')!.turns).toEqual(['go']);
  });
});

describe('SessionManager model fallback (P1#6)', () => {
  function setup() {
    const bus = new MessageBus();
    const backends = new Map<string, FakeBackend>();
    const mgr = new SessionManager(5, bus, {
      createBackend: (config) => { const b = new FakeBackend(config); backends.set(config.id, b); return b; },
      resolveEnv: async () => ({}),
    });
    return { bus, backends, mgr };
  }

  it('switches to fallbackModel after consecutive failures and emits session.modelSwitched', async () => {
    const { bus, backends, mgr } = setup();
    const cfg = makeConfig('dev', 'senior-dev');
    cfg.model = 'primary-x';
    cfg.fallbackModel = 'backup-y';
    mgr.create(cfg);
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    const switches: Array<{ from: string; to: string }> = [];
    mgr.on('session.modelSwitched', (e) => switches.push({ from: e.data.from, to: e.data.to }));

    const fail = () => {
      bus.send('user', 'dev', 'task.assign', { instruction: 'go' });
      backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'boom', isError: true } });
    };

    fail(); // 1st failure — still on primary
    expect(mgr.get('dev')!.config.model).toBe('primary-x');
    fail(); // 2nd failure — switch to fallback
    expect(mgr.get('dev')!.config.model).toBe('backup-y');
    expect(switches).toEqual([{ from: 'primary-x', to: 'backup-y' }]);
  });

  it('resets the failure counter on a successful turn', async () => {
    const { bus, backends, mgr } = setup();
    const cfg = makeConfig('dev', 'senior-dev');
    cfg.model = 'primary-x';
    cfg.fallbackModel = 'backup-y';
    mgr.create(cfg);
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    const turn = (isError: boolean) => {
      bus.send('user', 'dev', 'task.assign', { instruction: 'go' });
      backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: '', isError } });
    };
    turn(true);   // fail 1
    turn(false);  // success resets
    turn(true);   // fail 1 again — not enough to switch
    expect(mgr.get('dev')!.config.model).toBe('primary-x');
  });

  it('setModel changes the model and records a cost timeline sample per turn', async () => {
    const { bus, backends, mgr } = setup();
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    expect(mgr.setModel('dev', 'new-model')).toBe(true);
    expect(mgr.setModel('dev', 'new-model')).toBe(false); // no-op when unchanged
    expect(mgr.get('dev')!.config.model).toBe('new-model');

    bus.send('user', 'dev', 'task.assign', { instruction: 'go' });
    backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: '', isError: false, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 } } });
    const timeline = mgr.getCostTimeline();
    expect(timeline.length).toBe(1);
    expect(timeline[0].cost).toBeCloseTo(0.5, 6);
  });
});

describe('SessionManager concurrency cap (B1)', () => {
  function setup(maxConcurrent: number) {
    const bus = new MessageBus();
    const backends = new Map<string, FakeBackend>();
    const mgr = new SessionManager(maxConcurrent, bus, {
      createBackend: (config) => { const b = new FakeBackend(config); backends.set(config.id, b); return b; },
      resolveEnv: async () => ({}),
    });
    return { bus, backends, mgr };
  }

  it('queues a start beyond the cap and auto-starts it when a slot frees', async () => {
    const { backends, mgr } = setup(1);
    mgr.create(makeConfig('a1', 'developer'));
    mgr.create(makeConfig('a2', 'reviewer'));

    const queued: string[] = [];
    mgr.on('session.queued', (e) => queued.push(e.sessionId));

    await mgr.start('a1'); // takes the only slot
    backends.get('a1')!.emit({ kind: 'ready' });
    expect(mgr.getRunningCount()).toBe(1);

    await mgr.start('a2'); // over cap -> queued, not started (no backend, no throw)
    expect(queued).toEqual(['a2']);
    expect(backends.has('a2')).toBe(false);
    expect(mgr.get('a2')!.status).toBe('stopped');

    await mgr.stop('a1'); // frees the slot -> a2 drains and starts
    expect(backends.has('a2')).toBe(true);
    expect(mgr.get('a2')!.status).toBe('starting');
  });

  it('startAll does not throw when more agents than slots are configured', async () => {
    const { backends, mgr } = setup(1);
    mgr.create(makeConfig('a1', 'developer'));
    mgr.create(makeConfig('a2', 'reviewer'));

    await expect(mgr.startAll()).resolves.toBeDefined();
    expect(backends.has('a1')).toBe(true);
    expect(mgr.get('a2')!.status).toBe('stopped'); // queued, not failed
  });

  it('a turn-level error (backend still alive) does NOT free a slot for a queued agent', async () => {
    const { bus, backends, mgr } = setup(1);
    mgr.create(makeConfig('a1', 'developer'));
    mgr.create(makeConfig('a2', 'reviewer'));
    await mgr.start('a1');
    backends.get('a1')!.emit({ kind: 'ready' }); // a1 takes the only slot

    await mgr.start('a2'); // queued (over cap)
    expect(backends.has('a2')).toBe(false);

    // a1 hits a turn error but stays alive (error then turn_complete) — must not start a2.
    bus.send('user', 'a1', 'task.assign', { instruction: 'go' });
    backends.get('a1')!.emit({ kind: 'error', message: 'transient boom' });
    expect(backends.has('a2')).toBe(false); // slot NOT freed
    expect(mgr.getRunningCount()).toBe(1);

    backends.get('a1')!.emit({ kind: 'turn_complete', result: { text: 'recovered', isError: true } });
    expect(mgr.get('a1')!.status).toBe('idle'); // restored, not stuck in error
    expect(backends.has('a2')).toBe(false); // still queued — cap respected
  });

  it('stopAll cancels queued starts instead of starting them when a slot frees', async () => {
    const { backends, mgr } = setup(1);
    mgr.create(makeConfig('a1', 'developer'));
    mgr.create(makeConfig('a2', 'reviewer'));

    await mgr.start('a1');
    backends.get('a1')!.emit({ kind: 'ready' });
    await mgr.start('a2');
    expect(backends.has('a2')).toBe(false);

    await mgr.stopAll();
    expect(backends.has('a2')).toBe(false);
    expect(mgr.get('a2')!.status).toBe('stopped');
  });

  it('drains a queued start when backend.start fails after consuming a slot', async () => {
    const bus = new MessageBus();
    const backends = new Map<string, DeferredStartBackend | FakeBackend>();
    const mgr = new SessionManager(1, bus, {
      createBackend: (config) => {
        const b = config.id === 'a1' ? new DeferredStartBackend(config) : new FakeBackend(config);
        backends.set(config.id, b);
        return b;
      },
      resolveEnv: async () => ({}),
    });
    mgr.create(makeConfig('a1', 'developer'));
    mgr.create(makeConfig('a2', 'reviewer'));

    const startA1 = mgr.start('a1');
    await new Promise((r) => setTimeout(r, 0));
    await mgr.start('a2');
    expect(backends.has('a2')).toBe(false);

    (backends.get('a1') as DeferredStartBackend).rejectStart(new Error('spawn failed'));
    await expect(startA1).rejects.toThrow('spawn failed');

    expect(backends.has('a2')).toBe(true);
    expect(mgr.get('a2')!.status).toBe('starting');
  });
});

describe('SessionManager conversation persistence (L2 recovery)', () => {
  it('saves a snapshot after each turn, restores it on restart, and clears it on remove', async () => {
    const bus = new MessageBus();
    const backends = new Map<string, FakeBackend>();
    const store = new Map<string, ConversationSnapshot>();

    const mgr = new SessionManager(5, bus, {
      createBackend: (config) => {
        const b = new FakeBackend(config);
        backends.set(config.id, b);
        return b;
      },
      resolveEnv: async () => ({}),
      loadSnapshot: (id) => store.get(id),
      saveSnapshot: (id, snap) => { store.set(id, snap); },
      clearSnapshot: (id) => { store.delete(id); },
    });

    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    backends.get('dev')!.emit({ kind: 'ready' });

    // A completed turn persists the backend's snapshot.
    bus.send('user', 'dev', 'task.assign', { instruction: 'do work' });
    backends.get('dev')!.emit({ kind: 'turn_complete', result: { text: 'done', isError: false } });
    expect(store.get('dev')).toEqual({ version: 1, messages: ['history of dev'] });

    // Restarting creates a NEW backend; SessionManager must restore the saved snapshot into it.
    await mgr.stop('dev');
    backends.get('dev')!.emit({ kind: 'exit', code: 0 });
    await mgr.start('dev');
    expect(backends.get('dev')!.restored).toEqual({ version: 1, messages: ['history of dev'] });

    // Removing the agent clears its persisted snapshot.
    await mgr.remove('dev');
    expect(store.has('dev')).toBe(false);
  });
});

describe('SessionManager resolveWorkingDirectory (worktree fan-out)', () => {
  it('roots the agent at the resolved worktree path before building the backend', async () => {
    const bus = new MessageBus();
    let captured: AgentConfig | undefined;
    const mgr = new SessionManager(5, bus, {
      createBackend: (c) => { captured = c; return new FakeBackend(c); },
      resolveEnv: async () => ({}),
      resolveWorkingDirectory: async (c) => `/wt/${c.id}`,
    });
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    expect(captured?.workingDirectory).toBe('/wt/dev');
    // The resolved root is also recorded as the session's runtime truth (not just on the backend) so
    // grounding/preflight read a consistent value — and it is NOT written back to the persisted config.
    const info = mgr.getAll().find((s) => s.config.id === 'dev');
    expect(info?.runtimeWorkingDirectory).toBe('/wt/dev');
    expect(info?.config.workingDirectory).toBeUndefined(); // persisted config stays clean (no worktree path)
  });

  // Runtime invariant (Codex): Smart Mode's per-turn setModel only swaps the model — it must NOT restart the
  // session, recreate the backend, or touch the working directory (root/session state stays put).
  it('setModel swaps the model in place — no restart/recreate, no working-dir mutation', async () => {
    let creates = 0;
    const localBackends = new Map<string, FakeBackend>();
    const mgr = new SessionManager(5, new MessageBus(), {
      createBackend: (c) => { creates++; const b = new FakeBackend(c); localBackends.set(c.id, b); return b; },
      resolveEnv: async () => ({}),
      resolveWorkingDirectory: async () => '/runtime/root',
    });
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    expect(creates).toBe(1);
    const info = mgr.getAll().find((s) => s.config.id === 'dev')!;

    mgr.setModel('dev', 'tier-model-x'); // exactly what Smart Mode does per turn

    expect(creates).toBe(1);                                    // no restart / recreate
    expect(localBackends.get('dev')!.models).toEqual(['tier-model-x']); // applied in place
    expect(info.runtimeWorkingDirectory).toBe('/runtime/root'); // root unchanged
    expect(info.config.workingDirectory).toBeUndefined();       // persisted config untouched
  });

  it('falls back to the normal root when resolveWorkingDirectory returns undefined or throws', async () => {
    const bus = new MessageBus();
    let captured: AgentConfig | undefined;
    const mgr = new SessionManager(5, bus, {
      createBackend: (c) => { captured = c; return new FakeBackend(c); },
      resolveEnv: async () => ({}),
      resolveWorkingDirectory: async () => { throw new Error('no git'); },
    });
    mgr.create(makeConfig('dev', 'senior-dev'));
    await mgr.start('dev');
    expect(captured?.workingDirectory).toBeUndefined(); // unchanged; backend uses its default root
  });
});
