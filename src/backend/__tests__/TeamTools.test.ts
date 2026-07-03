import { describe, it, expect, beforeEach } from 'vitest';
import { TeamTools, TeamView } from '../TeamTools';
import { MessageBus } from '../../bus/MessageBus';
import { Message } from '../../types';
import { CommandPolicy } from '../CommandPolicy';
import { TaskClaimRegistry } from '../TaskClaimRegistry';

const roster = [
  { id: 'pm', role: 'pm', name: 'PM', status: 'running' },
  { id: 'dev', role: 'senior-dev', name: 'Dev', status: 'idle' },
  { id: 'tester', role: 'tester', name: 'Tester', status: 'idle' },
];

const view: TeamView = {
  list: () => roster,
  resolve: (ref) => {
    if (ref === 'dev' || ref === 'senior-dev') { return { id: 'dev' }; }
    if (ref === 'tester') { return { id: 'tester' }; }
    if (ref === 'pm') { return { id: 'pm' }; }
    return undefined;
  },
};

describe('TeamTools (PM coordinator)', () => {
  let bus: MessageBus;
  let team: TeamTools;

  beforeEach(() => {
    bus = new MessageBus();
    team = new TeamTools('pm', view, bus, { timeoutMs: 1000 });
  });

  it('list_agents shows teammates but not self, and does NOT surface a status that reads as "unavailable"', async () => {
    const out = await team.run('list_agents', {});
    expect(out).toContain('dev');
    expect(out).not.toContain('pm (');
    // A coordinator reads "status: stopped" as "can't delegate" and loops; we omit it and tell it to
    // delegate now (teammates auto-start on assignment).
    expect(out).not.toMatch(/status:/i);
    expect(out).toMatch(/assign_task/);
    expect(out).toMatch(/starts automatically/i);
  });

  it('assign_task dispatches to a teammate and returns their result', async () => {
    // Stand in for SessionManager+worker: reply to any task.assign with a task.complete
    // echoing the assign's correlationId (which is what SessionManager does for real).
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') {
        bus.send('dev', m.from, 'task.complete', { instruction: `done: ${m.payload.instruction}` }, 'normal', m.correlationId);
      }
    });

    const out = await team.run('assign_task', { agent: 'senior-dev', instruction: 'build login' });
    expect(out).toBe('done: build login');
  });

  // A worktree-isolated worker has a different root, so a shared-root ABSOLUTE path would land outside its
  // sandbox. The PM's delegation must convert those to workspace-relative before sending.
  it('normalizes shared-root absolute paths in a delegated instruction to workspace-relative', async () => {
    const t = new TeamTools('pm', view, bus, { timeoutMs: 1000, cwd: 'C:\\proj' });
    let received = '';
    bus.onType('task.assign', (m: Message) => {
      received = String(m.payload.instruction);
      bus.send(m.to, m.from, 'task.complete', { instruction: 'ok' }, 'normal', m.correlationId);
    });
    await t.run('assign_task', { agent: 'senior-dev', instruction: 'Edit C:\\proj\\src\\app.js and C:/proj/src/x.ts now' });
    expect(received).toContain('src\\app.js');
    expect(received).toContain('src/x.ts');
    expect(received).not.toContain('C:\\proj\\');
    expect(received).not.toContain('C:/proj/');
  });

  it('Router v1: audits why a delegation went to a teammate (onRoute)', async () => {
    const routes: string[] = [];
    const t = new TeamTools('pm', view, bus, { timeoutMs: 1000, onRoute: (l) => routes.push(l) });
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') { bus.send('dev', m.from, 'task.complete', { instruction: 'ok' }, 'normal', m.correlationId); }
    });
    await t.run('assign_task', { agent: 'senior-dev', instruction: 'x' });
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain('Routed "senior-dev" → dev');
    expect(routes[0]).toMatch(/only 'senior-dev' on the team/);
  });

  it('Router: prefers a FREE teammate (idle or stopped) over a BUSY (running) one', async () => {
    const devs = [
      { id: 'pm', role: 'pm', name: 'PM', status: 'running' },
      { id: 'dev-busy', role: 'senior-dev', name: 'DevA', status: 'running' }, // already working
      { id: 'dev-stopped', role: 'senior-dev', name: 'DevB', status: 'stopped' }, // free — auto-starts on assign
    ];
    const v: TeamView = { list: () => devs, resolve: () => undefined };
    const routes: string[] = [];
    const t = new TeamTools('pm', v, bus, { timeoutMs: 1000, onRoute: (l) => routes.push(l) });
    let routedTo = '';
    bus.onType('task.assign', (m: Message) => {
      routedTo = m.to;
      bus.send(m.to, m.from, 'task.complete', { instruction: 'ok' }, 'normal', m.correlationId);
    });
    await t.run('assign_task', { agent: 'senior-dev', instruction: 'x' });
    expect(routedTo).toBe('dev-stopped'); // a stopped teammate is FREE and beats a busy/running one
    expect(routes[0]).toContain('→ dev-stopped');
  });

  it('Router: only an ERRORED teammate is excluded when a usable one shares the role', async () => {
    const devs = [
      { id: 'pm', role: 'pm', name: 'PM', status: 'running' },
      { id: 'dev-err', role: 'senior-dev', name: 'DevA', status: 'error' },
      { id: 'dev-ok', role: 'senior-dev', name: 'DevB', status: 'idle' },
    ];
    const v: TeamView = { list: () => devs, resolve: () => undefined };
    let routedTo = '';
    const t = new TeamTools('pm', v, bus, { timeoutMs: 1000 });
    bus.onType('task.assign', (m: Message) => {
      routedTo = m.to;
      bus.send(m.to, m.from, 'task.complete', { instruction: 'ok' }, 'normal', m.correlationId);
    });
    await t.run('assign_task', { agent: 'senior-dev', instruction: 'x' });
    expect(routedTo).toBe('dev-ok'); // never the errored one
  });

  it('assign_task surfaces a teammate error', async () => {
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') {
        bus.send('dev', m.from, 'system.error', { instruction: 'compile failed' }, 'normal', m.correlationId);
      }
    });
    const out = await team.run('assign_task', { agent: 'dev', instruction: 'x' });
    expect(out).toMatch(/Error from dev: compile failed/);
  });

  it('assign_task rejects unknown agent and self-assignment', async () => {
    expect(await team.run('assign_task', { agent: 'ghost', instruction: 'x' })).toMatch(/no teammate "ghost"/);
    expect(await team.run('assign_task', { agent: 'pm', instruction: 'x' })).toMatch(/cannot assign a task to yourself/);
  });

  it('assign_task times out if no teammate replies', async () => {
    const out = await team.run('assign_task', { agent: 'dev', instruction: 'silent' });
    expect(out).toMatch(/timed out/);
  });

  it('assign_task can be cancelled instead of waiting for timeout', async () => {
    const pending = team.run('assign_task', { agent: 'dev', instruction: 'silent' });

    const cancelled = team.cancelPending('delegation cancelled by test');
    const out = await pending;

    expect(cancelled).toBeGreaterThan(0);
    expect(out).toBe('Error: delegation cancelled by test.');
  });

  it('assign_task forces one firm retry when the teammate returns nothing, then uses the real result', async () => {
    const instructions: string[] = [];
    let attempt = 0;
    bus.onType('task.assign', (m: Message) => {
      if (m.to !== 'dev') { return; }
      instructions.push(String(m.payload.instruction ?? ''));
      attempt += 1;
      // First turn: empty (refusal). Retry turn: real work.
      const text = attempt === 1 ? '' : 'done for real';
      bus.send('dev', m.from, 'task.complete', { instruction: text }, 'normal', m.correlationId);
    });

    const out = await team.run('assign_task', { agent: 'dev', instruction: 'build login' });
    expect(out).toBe('done for real');
    expect(instructions).toHaveLength(2);
    expect(instructions[1]).toMatch(/did not do the task/i);
    expect(instructions[1]).toContain('build login');
  });

  it('reports no fallback configured when a teammate keeps returning nothing and no escalation is wired', async () => {
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') {
        bus.send('dev', m.from, 'task.complete', { instruction: '' }, 'normal', m.correlationId);
      }
    });
    const out = await team.run('assign_task', { agent: 'dev', instruction: 'build login' });
    expect(out).toMatch(/BLOCKED/);
    expect(out).toMatch(/no fallback model is configured/i);
    expect(out).toMatch(/needs a working model/i);
  });

  it('L3: escalates a stuck teammate to its fallback model and uses the result', async () => {
    let attempt = 0;
    bus.onType('task.assign', (m: Message) => {
      if (m.to !== 'dev') { return; }
      attempt += 1;
      // empty (first), empty (L2 retry), then real work after the L3 model switch.
      const text = attempt < 3 ? '' : 'done after escalation';
      bus.send('dev', m.from, 'task.complete', { instruction: text }, 'normal', m.correlationId);
    });
    const escalated: string[] = [];
    team = new TeamTools('pm', view, bus, {
      timeoutMs: 1000,
      escalate: (id) => { escalated.push(id); return { switched: true, reason: 'switched', from: 'cheap', to: 'strong' }; },
    });
    const out = await team.run('assign_task', { agent: 'dev', instruction: 'build login' });
    expect(escalated).toEqual(['dev']);
    expect(out).toContain('done after escalation');
    expect(out).toMatch(/fallback model strong/i);
  });

  it('L3: reports the model is refusing when even the fallback returns nothing', async () => {
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') { bus.send('dev', m.from, 'task.complete', { instruction: '' }, 'normal', m.correlationId); }
    });
    team = new TeamTools('pm', view, bus, {
      timeoutMs: 1000,
      escalate: () => ({ switched: true, reason: 'switched', from: 'cheap', to: 'strong' }),
    });
    const out = await team.run('assign_task', { agent: 'dev', instruction: 'x' });
    expect(out).toMatch(/even after switching to its fallback model \(strong\)/i);
    expect(out).toMatch(/needs a different, working model/i);
  });

  it('async: an empty first reply is retried, and await_tasks collects the real result', async () => {
    let attempt = 0;
    bus.onType('task.assign', (m: Message) => {
      if (m.to !== 'dev') { return; }
      attempt += 1;
      bus.send('dev', m.from, 'task.complete', { instruction: attempt === 1 ? '' : 'async done' }, 'normal', m.correlationId);
    });
    const disp = await team.run('assign_task_async', { agent: 'dev', instruction: 'work' });
    expect(disp).toMatch(/Handle:/);
    const collected = await team.run('await_tasks', {});
    expect(collected).toContain('async done');
    expect(attempt).toBe(2);
  });

  it('async: escalates to the fallback model when a teammate keeps returning nothing', async () => {
    let attempt = 0;
    bus.onType('task.assign', (m: Message) => {
      if (m.to !== 'dev') { return; }
      attempt += 1;
      bus.send('dev', m.from, 'task.complete', { instruction: attempt < 3 ? '' : 'async after escalation' }, 'normal', m.correlationId);
    });
    team = new TeamTools('pm', view, bus, {
      timeoutMs: 1000,
      escalate: () => ({ switched: true, reason: 'switched', from: 'cheap', to: 'strong' }),
    });
    await team.run('assign_task_async', { agent: 'dev', instruction: 'work' });
    const collected = await team.run('await_tasks', {});
    expect(collected).toContain('async after escalation');
    expect(collected).toMatch(/fallback model strong/i);
  });

  it('async: await_tasks flags the step as failed when even the fallback stays empty', async () => {
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') { bus.send('dev', m.from, 'task.complete', { instruction: '' }, 'normal', m.correlationId); }
    });
    team = new TeamTools('pm', view, bus, {
      timeoutMs: 1000,
      escalate: () => ({ switched: true, reason: 'switched', from: 'cheap', to: 'strong' }),
    });
    await team.run('assign_task_async', { agent: 'dev', instruction: 'work' });
    const collected = await team.run('await_tasks', {});
    expect(collected).toMatch(/\[tasks FAILED\]/);
    expect(collected).toMatch(/even after switching to its fallback model/i);
  });

  it('broadcast sends a broadcast.info to everyone', async () => {
    const seen: Message[] = [];
    bus.onType('broadcast.info', (m) => { seen.push(m); });
    const out = await team.run('broadcast', { message: 'standup at 3' });
    expect(out).toMatch(/Broadcast sent/);
    expect(seen[0].to).toBe('*');
    expect(seen[0].payload.instruction).toBe('standup at 3');
  });

  it('exposes the coordinator tools', () => {
    const names = team.specs().map((s) => s.function.name);
    expect(names).toEqual(['list_agents', 'assign_task', 'assign_task_async', 'await_tasks', 'broadcast', 'run_checks']);
    expect(team.has('run_checks')).toBe(true);
    expect(team.has('assign_task_async')).toBe(true);
    expect(team.has('await_tasks')).toBe(true);
    expect(team.has('read_file')).toBe(false);
  });

  // Option B step 1: scatter/gather parallel delegation.
  it('assign_task_async returns a handle immediately and await_tasks collects all results', async () => {
    bus.onType('task.assign', (m: Message) => {
      bus.send(String(m.to), m.from, 'task.complete', { instruction: `done by ${m.to}: ${m.payload.instruction}` }, 'normal', m.correlationId);
    });

    const a = await team.run('assign_task_async', { agent: 'dev', instruction: 'build api' });
    const b = await team.run('assign_task_async', { agent: 'tester', instruction: 'write tests' });
    expect(a).toMatch(/Dispatched to dev\. Handle:/);
    expect(b).toMatch(/Dispatched to tester\. Handle:/);

    const out = await team.run('await_tasks', {}); // await all pending
    expect(out).toMatch(/=== dev \(/);
    expect(out).toMatch(/done by dev: build api/);
    expect(out).toMatch(/=== tester \(/);
    expect(out).toMatch(/done by tester: write tests/);

    // Pending registry is drained — a second await finds nothing.
    expect(await team.run('await_tasks', {})).toMatch(/No pending tasks to await/);
  });

  it('await_tasks reports a partial failure without losing the other result', async () => {
    bus.onType('task.assign', (m: Message) => {
      if (m.to === 'dev') {
        bus.send('dev', m.from, 'task.complete', { instruction: 'ok' }, 'normal', m.correlationId);
      } else if (m.to === 'tester') {
        bus.send('tester', m.from, 'system.error', { instruction: 'tests crashed' }, 'normal', m.correlationId);
      }
    });
    await team.run('assign_task_async', { agent: 'dev', instruction: 'x' });
    await team.run('assign_task_async', { agent: 'tester', instruction: 'y' });
    const out = await team.run('await_tasks', {});
    expect(out).toMatch(/^\[tasks FAILED\]/); // so the tool card marks the step failed
    expect(out).toMatch(/ok/);
    expect(out).toMatch(/Error from tester: tests crashed/);
  });

  // Option B step 2: file-ownership claims reject overlapping parallel dispatches up front.
  it('rejects an async dispatch whose files overlap an in-flight claim, but allows disjoint files', async () => {
    const claims = new TaskClaimRegistry();
    const t = new TeamTools('pm', view, bus, { timeoutMs: 1000, claims });
    // No responder → tasks stay in flight, holding their claims.
    expect(await t.run('assign_task_async', { agent: 'dev', instruction: 'a', files: ['src/auth/**'] })).toMatch(/Dispatched/);
    // tester wants a file inside dev's claimed subtree → rejected, named holder, not dispatched.
    const conflict = await t.run('assign_task_async', { agent: 'tester', instruction: 'b', files: ['src/auth/login.ts'] });
    expect(conflict).toMatch(/file conflict/);
    expect(conflict).toMatch(/held by dev/);
    // disjoint files are fine.
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'c', files: ['tests/**'] })).toMatch(/Dispatched/);
  });

  it('releases a file claim once the task is collected via await_tasks', async () => {
    const claims = new TaskClaimRegistry();
    const t = new TeamTools('pm', view, bus, { timeoutMs: 1000, claims });
    bus.onType('task.assign', (m: Message) => {
      bus.send(String(m.to), m.from, 'task.complete', { instruction: 'done' }, 'normal', m.correlationId);
    });
    await t.run('assign_task_async', { agent: 'dev', instruction: 'a', files: ['src/auth/**'] });
    await t.run('await_tasks', {});
    // claim freed → a previously-conflicting path can now be claimed.
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'b', files: ['src/auth/x.ts'] })).toMatch(/Dispatched/);
  });

  it('Router v1: does NOT audit a route when the async task is rejected by a file conflict', async () => {
    const claims = new TaskClaimRegistry();
    const routes: string[] = [];
    const t = new TeamTools('pm', view, bus, { timeoutMs: 60_000, claims, onRoute: (l) => routes.push(l) });
    expect(await t.run('assign_task_async', { agent: 'dev', instruction: 'a', files: ['src/auth/**'] })).toMatch(/Dispatched/);
    // Overlaps the claim above → rejected before dispatch; must produce NO route audit line.
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'b', files: ['src/auth/x.ts'] })).toMatch(/file conflict/);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain('→ dev');
    expect(routes[0]).not.toContain('tester');
  });

  it('cancelPending settles an in-flight await_tasks and releases async claims', async () => {
    const claims = new TaskClaimRegistry();
    const t = new TeamTools('pm', view, bus, { timeoutMs: 60_000, claims });

    expect(await t.run('assign_task_async', { agent: 'dev', instruction: 'a', files: ['src/auth/**'] })).toMatch(/Dispatched/);
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'b', files: ['src/auth/x.ts'] })).toMatch(/file conflict/);

    const awaiting = t.run('await_tasks', {});
    const cancelled = t.cancelPending('delegation cancelled by user');
    const out = await awaiting;

    expect(cancelled).toBeGreaterThan(0);
    expect(out).toMatch(/^\[tasks FAILED\]/);
    expect(out).toMatch(/Error: delegation cancelled by user\./);
    expect(claims.activeClaims()).toEqual([]);
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'c', files: ['src/auth/x.ts'] })).toMatch(/Dispatched/);
  });

  it('cancelPending releases async claims even when no await_tasks call is active', async () => {
    const claims = new TaskClaimRegistry();
    const t = new TeamTools('pm', view, bus, { timeoutMs: 60_000, claims });

    expect(await t.run('assign_task_async', { agent: 'dev', instruction: 'a', files: ['src/auth/**'] })).toMatch(/Dispatched/);
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'b', files: ['src/auth/x.ts'] })).toMatch(/file conflict/);

    t.cancelPending('delegation cancelled by user');

    expect(claims.activeClaims()).toEqual([]);
    expect(await t.run('assign_task_async', { agent: 'tester', instruction: 'c', files: ['src/auth/x.ts'] })).toMatch(/Dispatched/);
  });

  it('warns when an async dispatch omits files (conflict protection off), not when files are given', async () => {
    const claims = new TaskClaimRegistry();
    const t = new TeamTools('pm', view, bus, { timeoutMs: 1000, claims });
    const noFiles = await t.run('assign_task_async', { agent: 'dev', instruction: 'a' });
    expect(noFiles).toMatch(/WARNING: no files declared/);
    const withFiles = await t.run('assign_task_async', { agent: 'tester', instruction: 'b', files: ['tests/**'] });
    expect(withFiles).not.toMatch(/WARNING/);
  });

  it('caps parallel delegations and tells the PM to await first', async () => {
    const capped = new TeamTools('pm', view, bus, { timeoutMs: 1000, maxParallelDelegations: 2 });
    // No responder → tasks stay pending, filling the cap.
    expect(await capped.run('assign_task_async', { agent: 'dev', instruction: 'a' })).toMatch(/Dispatched/);
    expect(await capped.run('assign_task_async', { agent: 'tester', instruction: 'b' })).toMatch(/Dispatched/);
    const third = await capped.run('assign_task_async', { agent: 'dev', instruction: 'c' });
    expect(third).toMatch(/too many parallel tasks in flight \(2\/2\)/);
    expect(third).toMatch(/await_tasks/);
  });

  it('assign_task_async rejects unknown agent and self without queueing a task', async () => {
    expect(await team.run('assign_task_async', { agent: 'ghost', instruction: 'x' })).toMatch(/no teammate "ghost"/);
    expect(await team.run('assign_task_async', { agent: 'pm', instruction: 'x' })).toMatch(/cannot assign a task to yourself/);
    expect(await team.run('await_tasks', {})).toMatch(/No pending tasks to await/);
  });

  it('await_tasks can collect a specific handle', async () => {
    bus.onType('task.assign', (m: Message) => {
      bus.send(String(m.to), m.from, 'task.complete', { instruction: `done ${m.payload.instruction}` }, 'normal', m.correlationId);
    });
    const a = await team.run('assign_task_async', { agent: 'dev', instruction: 'A' });
    await team.run('assign_task_async', { agent: 'tester', instruction: 'B' });
    const handle = a.match(/Handle: (\S+?)\./)![1];

    const out = await team.run('await_tasks', { handles: [handle] });
    expect(out).toMatch(/done A/);
    expect(out).not.toMatch(/done B/);
    // The other task is still pending.
    expect(await team.run('await_tasks', {})).toMatch(/done B/);
  });

  it('run_checks reports a passing verification', async () => {
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'tsc',
      runCommand: async () => ({ code: 0, output: 'no errors' }),
    });
    expect(await t.run('run_checks', {})).toMatch(/\[checks passed\]/);
  });

  it('run_checks reports a failing verification with output for the fix loop', async () => {
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'tsc',
      runCommand: async () => ({ code: 2, output: "src/x.ts(3,1): error TS2554: Expected 2 args, got 1." }),
    });
    const out = await t.run('run_checks', {});
    expect(out).toMatch(/\[checks FAILED\]/);
    expect(out).toMatch(/error TS2554/);
  });

  it('run_checks tells the PM when no verify command is configured', async () => {
    const out = await team.run('run_checks', {});
    expect(out).toMatch(/No verification command configured/);
  });

  it('run_checks applies CommandPolicy before running verifyCommand', async () => {
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'node build.js',
      commandPolicy: new CommandPolicy('allowlist', ['npm test']),
      runCommand: async () => ({ code: 0, output: 'should not run' }),
    });
    const out = await t.run('run_checks', {});
    expect(out).toMatch(/blocked by unode.commandApproval/);
  });

  it('run_checks notifies onCommandBlocked when policy blocks (B2)', async () => {
    const blocked: string[] = [];
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'node build.js',
      commandPolicy: new CommandPolicy('none', []),
      onCommandBlocked: (reason) => blocked.push(reason),
    });
    await t.run('run_checks', {});
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatch(/disabled/);
  });

  // The PM-deadlock fix: in 'ask' mode (the DEFAULT), run_checks must PROMPT (like run_command), not
  // dead-end "awaiting user approval" — otherwise the PM can never verify (run_command is delegate-gated).
  it('run_checks prompts in ask mode and runs the verify command when approved', async () => {
    let ran = false;
    let prompted = '';
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'npm test',
      commandPolicy: new CommandPolicy('ask', []), // not allowlisted → { allowed:false, ask:true }
      requestApproval: async (cmd) => { prompted = cmd; return { allow: true }; },
      runCommand: async () => { ran = true; return { code: 0, output: 'ok' }; },
    });
    const out = await t.run('run_checks', {});
    expect(prompted).toBe('npm test');           // the user was actually asked
    expect(ran).toBe(true);                       // and the command ran after approval
    expect(out).toMatch(/\[checks passed\]/);
  });

  it('run_checks reports denial (and does NOT run) when the user declines in ask mode', async () => {
    let ran = false;
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'npm test',
      commandPolicy: new CommandPolicy('ask', []),
      requestApproval: async () => ({ allow: false, note: 'use the dev instead' }),
      runCommand: async () => { ran = true; return { code: 0, output: 'ok' }; },
    });
    const out = await t.run('run_checks', {});
    expect(ran).toBe(false);
    expect(out).toMatch(/not approved/i);
    expect(out).toMatch(/use the dev instead/);
  });

  it('run_checks still hard-blocks in ask mode when no approver is wired (test/headless)', async () => {
    const t = new TeamTools('pm', view, bus, {
      verifyCommand: 'npm test',
      commandPolicy: new CommandPolicy('ask', []),
      runCommand: async () => ({ code: 0, output: 'should not run' }),
    });
    const out = await t.run('run_checks', {});
    expect(out).toMatch(/blocked by unode.commandApproval/);
  });
});

// Regression: two teammates share a role → role delegation must SPREAD across them, not pile both
// tasks onto the first match (the "PM sent both tasks to Developer, none to Backend Developer" bug).
describe('TeamTools role-spread (multiple same-role teammates)', () => {
  const twoDevsRoster = [
    { id: 'pm', role: 'pm', name: 'PM', status: 'running' },
    { id: 'dev1', role: 'senior-dev', name: 'Developer', status: 'idle' },
    { id: 'dev2', role: 'senior-dev', name: 'Backend Developer', status: 'idle' },
  ];
  // A naive view.resolve that always returns the FIRST same-role match — the old behavior. The point
  // of these tests is that TeamTools now spreads regardless of how the extension's resolver behaves.
  const twoDevsView: TeamView = {
    list: () => twoDevsRoster,
    resolve: (ref) => {
      if (ref === 'pm') { return { id: 'pm' }; }
      if (ref === 'dev1' || ref === 'dev2') { return { id: ref }; }
      if (ref === 'senior-dev') { return { id: 'dev1' }; } // first match — the trap
      return undefined;
    },
  };

  let bus: MessageBus;
  let team: TeamTools;
  beforeEach(() => {
    bus = new MessageBus();
    team = new TeamTools('pm', twoDevsView, bus, { timeoutMs: 1000 });
  });

  it('round-robins sequential assign_task("role") across same-role teammates', async () => {
    const targets: string[] = [];
    bus.onType('task.assign', (m: Message) => {
      targets.push(String(m.to));
      bus.send(String(m.to), m.from, 'task.complete', { instruction: `done by ${m.to}` }, 'normal', m.correlationId);
    });
    const a = await team.run('assign_task', { agent: 'senior-dev', instruction: 'task A' });
    const b = await team.run('assign_task', { agent: 'senior-dev', instruction: 'task B' });
    expect(targets).toEqual(['dev1', 'dev2']); // not ['dev1','dev1']
    expect(a).toBe('done by dev1');
    expect(b).toBe('done by dev2');
  });

  it('fans parallel assign_task_async("role") out to different teammates', async () => {
    // No responder → both stay in flight; the second must skip the now-busy first match.
    const a = await team.run('assign_task_async', { agent: 'senior-dev', instruction: 'A' });
    const b = await team.run('assign_task_async', { agent: 'senior-dev', instruction: 'B' });
    expect(a).toMatch(/Dispatched to dev1\./);
    expect(b).toMatch(/Dispatched to dev2\./);
  });

  it('resolves a teammate by display name (not just id/role)', async () => {
    bus.onType('task.assign', (m: Message) => {
      bus.send(String(m.to), m.from, 'task.complete', { instruction: `done by ${m.to}` }, 'normal', m.correlationId);
    });
    expect(await team.run('assign_task', { agent: 'Backend Developer', instruction: 'x' })).toBe('done by dev2');
  });

  it('still honors an exact id and never reinterprets it', async () => {
    bus.onType('task.assign', (m: Message) => {
      bus.send(String(m.to), m.from, 'task.complete', { instruction: `done by ${m.to}` }, 'normal', m.correlationId);
    });
    expect(await team.run('assign_task', { agent: 'dev2', instruction: 'x' })).toBe('done by dev2');
  });

  it('keeps a firm retry on the SAME teammate (does not round-robin the retry away)', async () => {
    const targets: string[] = [];
    const attempts = new Map<string, number>();
    bus.onType('task.assign', (m: Message) => {
      const to = String(m.to);
      targets.push(to);
      const n = (attempts.get(to) ?? 0) + 1;
      attempts.set(to, n);
      // dev1's first reply is empty (triggers a firm retry); its retry returns real work.
      const text = to === 'dev1' && n === 1 ? '' : `done by ${to}`;
      bus.send(to, m.from, 'task.complete', { instruction: text }, 'normal', m.correlationId);
    });
    const out = await team.run('assign_task', { agent: 'senior-dev', instruction: 'task A' });
    expect(out).toBe('done by dev1');
    expect(targets).toEqual(['dev1', 'dev1']); // retry stayed on dev1, did not jump to dev2
  });
});
