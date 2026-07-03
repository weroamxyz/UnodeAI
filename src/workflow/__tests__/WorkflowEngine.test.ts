import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../WorkflowEngine';
import { MessageBus } from '../../bus/MessageBus';
import { SessionManager } from '../../session/SessionManager';
import { TierController } from '../TierController';
import { Message, SessionInfo, WorkflowConfig } from '../../types';

/** Minimal SessionManager stub: every role/id resolves to an agent whose id == the ref. */
function stubSessionManager(): SessionManager {
  return {
    resolveByRoleOrId: (ref: string) => ({ id: ref, config: { role: ref } } as unknown as SessionInfo),
  } as unknown as SessionManager;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function authoringStore(initial: WorkflowConfig[] = []) {
  let workflows = [...initial];
  return {
    store: {
      loadTeamConfig: async () => ({ workflows }),
      saveCustomWorkflows: async (next: WorkflowConfig[]) => { workflows = [...next]; },
    },
    workflows: () => workflows,
  };
}

describe('WorkflowEngine L3 recovery (P1#5)', () => {
  it('runs a template, advances on task.complete, and notifies onChange', async () => {
    const bus = new MessageBus();
    const changes: number[] = [];
    const engine = new WorkflowEngine(stubSessionManager(), bus, () => changes.push(1));

    const assigns: Message[] = [];
    bus.onType('task.assign', (m) => assigns.push(m));

    const instance = await engine.run('bug-fix', { request: 'fix it' });
    expect(instance.status).toBe('running');
    expect(assigns).toHaveLength(1); // first step dispatched

    // Complete step 1 for THIS instance (correlationId = instance.id) -> step 2 dispatched.
    bus.send('senior-dev', 'pm', 'task.complete', { instruction: 'fixed' }, 'normal', instance.id);
    expect(assigns).toHaveLength(2);
    expect(changes.length).toBeGreaterThan(0);
  });

  it('exportState returns only running instances and restore re-issues the current step', async () => {
    const busA = new MessageBus();
    const engineA = new WorkflowEngine(stubSessionManager(), busA);
    const instance = await engineA.run('feature-implement', { request: 'feature' });

    const persisted = engineA.exportState();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('running');
    expect(persisted[0].id).toBe(instance.id);

    // Simulate a reload: a fresh engine restores the persisted instance and resumes its step.
    const busB = new MessageBus();
    const engineB = new WorkflowEngine(stubSessionManager(), busB);
    const reissued: Message[] = [];
    busB.onType('task.assign', (m) => reissued.push(m));

    engineB.restore(persisted);
    expect(reissued).toHaveLength(1);
    expect(reissued[0].correlationId).toBe(instance.id);
    // And it can still advance to completion on the restored engine.
    busB.send('architect', 'pm', 'task.complete', { instruction: 'designed' }, 'normal', instance.id);
    expect(reissued.length).toBe(2);
  });

  it('does not restore finished or already-active instances', async () => {
    const bus = new MessageBus();
    const engine = new WorkflowEngine(stubSessionManager(), bus);
    const reissued: Message[] = [];
    bus.onType('task.assign', (m) => reissued.push(m));

    engine.restore([
      { id: 'done', status: 'completed', config: { id: 'x', name: 'x', steps: [] }, startedAt: '', context: {} },
    ]);
    expect(reissued).toHaveLength(0);
  });
});

describe('WorkflowEngine gated workflow (P2)', () => {
  it('on gate fail escalates the dev tier and retries; on pass drops to economy and advances', async () => {
    const bus = new MessageBus();
    const models = new Map<string, string>([['senior-dev', 'deepseek-v4-pro']]);
    const tier = new TierController(
      {
        listAgents: () => [{ id: 'senior-dev', role: 'senior-dev', providerId: 'roam' }],
        setModel: (id, m) => { if (models.get(id) === m) { return false; } models.set(id, m); return true; },
      }
    );

    let checkCalls = 0;
    const runChecks = async () => ({ ok: ++checkCalls >= 2 }); // fail first, pass second

    const engine = new WorkflowEngine(stubSessionManager(), bus, () => {}, { tierController: tier, runChecks });

    const assigns: Message[] = [];
    bus.onType('task.assign', (m) => assigns.push(m));

    const inst = await engine.run('feature-gated', { request: 'feature' });
    // design dispatched
    expect(assigns.at(-1)!.to).toBe('architect');
    bus.send('architect', 'pm', 'task.complete', { instruction: 'designed' }, 'normal', inst.id);
    // code dispatched
    expect(assigns.at(-1)!.to).toBe('senior-dev');

    // complete code -> gate runs runChecks (#1 fail) -> escalate to premium + retry code
    bus.send('senior-dev', 'architect', 'task.complete', { instruction: 'v1' }, 'normal', inst.id);
    await flush();
    expect(models.get('senior-dev')).toBe('claude-opus-4-8'); // escalated
    expect(assigns.at(-1)!.to).toBe('senior-dev'); // retried the code step

    // complete code again -> runChecks (#2 pass) -> drop to economy + advance to qa
    bus.send('senior-dev', 'architect', 'task.complete', { instruction: 'v2' }, 'normal', inst.id);
    await flush();
    expect(models.get('senior-dev')).toBe('deepseek-v4-flash'); // onPass economy
    expect(assigns.at(-1)!.to).toBe('tester'); // advanced to qa step

    // finish qa
    bus.send('tester', 'senior-dev', 'task.complete', { instruction: 'qa ok' }, 'normal', inst.id);
    await flush();
    expect(engine.getWorkflow(inst.id)!.status).toBe('completed');
  });

  it('routes via a matching branch (loop) then exits via the else branch', async () => {
    const bus = new MessageBus();
    const engine = new WorkflowEngine(stubSessionManager(), bus);
    const assigns: Message[] = [];
    bus.onType('task.assign', (m) => assigns.push(m));

    // code -> review; review loops back to code while result says "fail", else proceeds to done.
    const template = {
      id: 'loop-demo', name: 'Loop', description: '',
      steps: [
        { id: 'code', from: 'pm', to: 'senior-dev', action: 'implement', autoTransition: true },
        {
          id: 'review', from: 'senior-dev', to: 'reviewer', action: 'review', autoTransition: true,
          branches: [{ whenResultContains: 'fail', goto: 'code' }, { goto: 'done' }],
        },
        { id: 'done', from: 'reviewer', to: 'tester', action: 'ship', autoTransition: true },
      ],
    };

    const inst = await engine.run(template, {});
    bus.send('senior-dev', 'pm', 'task.complete', { instruction: 'v1' }, 'normal', inst.id); // code done -> review
    expect(assigns.at(-1)!.to).toBe('reviewer');
    bus.send('reviewer', 'senior-dev', 'task.complete', { instruction: 'FAIL: bug' }, 'normal', inst.id); // loop back to code
    expect(assigns.at(-1)!.to).toBe('senior-dev');
    bus.send('senior-dev', 'pm', 'task.complete', { instruction: 'v2' }, 'normal', inst.id); // code -> review again
    expect(assigns.at(-1)!.to).toBe('reviewer');
    bus.send('reviewer', 'senior-dev', 'task.complete', { instruction: 'looks good' }, 'normal', inst.id); // else -> done
    expect(assigns.at(-1)!.to).toBe('tester');
    bus.send('tester', 'reviewer', 'task.complete', { instruction: 'shipped' }, 'normal', inst.id);
    expect(engine.getWorkflow(inst.id)!.status).toBe('completed');
  });

  it('pauses with guidance (no tier escalation/retry) when the gate check is blocked by policy', async () => {
    const bus = new MessageBus();
    const models = new Map<string, string>([['senior-dev', 'deepseek-v4-pro']]);
    const tier = new TierController({
      listAgents: () => [{ id: 'senior-dev', role: 'senior-dev', providerId: 'roam' }],
      setModel: (id, m) => { if (models.get(id) === m) { return false; } models.set(id, m); return true; },
    });
    // run_checks can't run (e.g. command execution disabled) -> blocked, not a quality failure.
    const runChecks = async () => ({ ok: false, blocked: true });
    const engine = new WorkflowEngine(stubSessionManager(), bus, () => {}, { tierController: tier, runChecks });

    const inst = await engine.run('feature-gated', {});
    bus.send('architect', 'pm', 'task.complete', { instruction: 'd' }, 'normal', inst.id);
    bus.send('senior-dev', 'architect', 'task.complete', { instruction: 'v1' }, 'normal', inst.id);
    await flush();

    const wf = engine.getWorkflow(inst.id)!;
    expect(wf.status).toBe('paused');
    expect(String(wf.context.__blockedReason)).toContain('roam.commandApproval');
    expect(models.get('senior-dev')).toBe('deepseek-v4-pro'); // no escalation — it wasn't a failure
  });

  it('pauses for a human once gate retries are exhausted', async () => {
    const bus = new MessageBus();
    const runChecks = async () => ({ ok: false }); // always fails
    const engine = new WorkflowEngine(stubSessionManager(), bus, () => {}, { runChecks });

    const inst = await engine.run('feature-gated', { request: 'x' });
    bus.send('architect', 'pm', 'task.complete', { instruction: 'd' }, 'normal', inst.id);
    // code fails maxRetries(2)+1 times -> paused
    for (let i = 0; i < 3; i++) {
      bus.send('senior-dev', 'architect', 'task.complete', { instruction: `v${i}` }, 'normal', inst.id);
      await flush();
    }
    expect(engine.getWorkflow(inst.id)!.status).toBe('paused');
  });
});

describe('WorkflowEngine authoring API (E4)', () => {
  const custom: WorkflowConfig = {
    id: 'custom-branch',
    name: 'Custom Branch',
    description: 'Custom workflow',
    steps: [
      { id: 'code', from: 'pm', to: 'senior-dev', action: 'Code', autoTransition: true },
      {
        id: 'review',
        from: 'senior-dev',
        to: 'reviewer',
        action: 'Review',
        autoTransition: true,
        branches: [{ whenResultContains: 'fail', goto: 'code' }, { goto: 'done' }],
      },
      { id: 'done', from: 'reviewer', to: 'tester', action: 'Done', autoTransition: true },
    ],
  };

  it('rejects workflows with branch gotos outside the same workflow', async () => {
    const fake = authoringStore();
    const engine = new WorkflowEngine(stubSessionManager(), new MessageBus(), () => {}, {}, fake.store);

    const result = await engine.saveWorkflow({
      ...custom,
      id: 'bad-goto',
      steps: [{ id: 'only', from: 'pm', to: 'dev', action: 'x', autoTransition: true, branches: [{ goto: 'missing' }] }],
    });

    expect(result).toEqual({ ok: false, error: 'Branch on step "only" points to unknown step "missing".' });
    expect(fake.workflows()).toEqual([]);
  });

  it('persists valid branch workflows and returns them from listWorkflows', async () => {
    const fake = authoringStore();
    const engine = new WorkflowEngine(stubSessionManager(), new MessageBus(), () => {}, {}, fake.store);

    await expect(engine.saveWorkflow(custom)).resolves.toEqual({ ok: true });

    expect(fake.workflows()).toEqual([custom]);
    const listed = await engine.listWorkflows();
    expect(listed.find((w) => w.id === 'custom-branch')).toMatchObject({
      name: 'Custom Branch',
      builtin: false,
    });
    expect(listed.find((w) => w.id === 'feature-implement')).toMatchObject({ builtin: true });
  });

  it('deletes custom workflows from the authored list', async () => {
    const fake = authoringStore([custom]);
    const engine = new WorkflowEngine(stubSessionManager(), new MessageBus(), () => {}, {}, fake.store);

    await engine.deleteWorkflow('custom-branch');

    expect(fake.workflows()).toEqual([]);
  });

  it('refuses to overwrite built-in workflow ids', async () => {
    const fake = authoringStore();
    const engine = new WorkflowEngine(stubSessionManager(), new MessageBus(), () => {}, {}, fake.store);

    const result = await engine.saveWorkflow({ ...custom, id: 'feature-implement' });

    expect(result.ok).toBe(false);
    expect((result as any).error).toContain('built-in');
    expect(fake.workflows()).toEqual([]);
  });
});
