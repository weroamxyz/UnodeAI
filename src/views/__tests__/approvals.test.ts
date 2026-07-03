import { describe, it, expect, vi } from 'vitest';
import { ApprovalQueue } from '../approvals';

describe('ApprovalQueue', () => {
  it('resolves a request with the user decision and removes it from the queue', async () => {
    const q = new ApprovalQueue();
    const p = q.request({ kind: 'command', agentName: 'Dev', command: 'npm test' });
    expect(q.list()).toHaveLength(1);
    expect(q.pendingCount()).toBe(1);

    const id = q.list()[0].id;
    expect(q.resolve(id, { action: 'session' })).toBe(true);
    await expect(p).resolves.toEqual({ action: 'session' });
    expect(q.list()).toHaveLength(0);
    expect(q.pendingCount()).toBe(0);
  });

  it('carries a deny note through to the awaiter', async () => {
    const q = new ApprovalQueue();
    const p = q.request({ kind: 'command', agentName: 'Dev', command: 'rm -rf /' });
    q.resolve(q.list()[0].id, { action: 'deny', note: 'use npm run clean' });
    await expect(p).resolves.toEqual({ action: 'deny', note: 'use npm run clean' });
  });

  it('keeps multiple requests independent and resolvable out of order', async () => {
    const q = new ApprovalQueue();
    const a = q.request({ kind: 'write', agentName: 'A', path: 'a.ts', verb: 'create', diff: '+1' });
    const b = q.request({ kind: 'write', agentName: 'B', path: 'b.ts', verb: 'overwrite', diff: '+2' });
    expect(q.list()).toHaveLength(2);
    const [idA, idB] = q.list().map((r) => r.id);

    q.resolve(idB, { action: 'always' });
    await expect(b).resolves.toEqual({ action: 'always' });
    expect(q.list().map((r) => r.id)).toEqual([idA]);

    q.resolve(idA, { action: 'once' });
    await expect(a).resolves.toEqual({ action: 'once' });
    expect(q.list()).toHaveLength(0);
  });

  it('resolve() returns false for an unknown or already-resolved id', () => {
    const q = new ApprovalQueue();
    q.request({ kind: 'command', agentName: 'Dev', command: 'ls' });
    const id = q.list()[0].id;
    expect(q.resolve(id, { action: 'once' })).toBe(true);
    expect(q.resolve(id, { action: 'once' })).toBe(false);
    expect(q.resolve('nope', { action: 'once' })).toBe(false);
  });

  it('denyAll() resolves everything pending as a deny (so a torn-down panel never hangs)', async () => {
    const q = new ApprovalQueue();
    const a = q.request({ kind: 'command', agentName: 'A', command: 'x' });
    const b = q.request({ kind: 'write', agentName: 'B', path: 'b', verb: 'create', diff: '' });
    q.denyAll();
    await expect(a).resolves.toEqual({ action: 'deny' });
    await expect(b).resolves.toEqual({ action: 'deny' });
    expect(q.list()).toHaveLength(0);
    expect(q.pendingCount()).toBe(0);
  });

  it('fires onChange when the queue changes', () => {
    const onChange = vi.fn();
    const q = new ApprovalQueue(onChange);
    q.request({ kind: 'command', agentName: 'Dev', command: 'ls' });
    expect(onChange).toHaveBeenCalledTimes(1);
    q.resolve(q.list()[0].id, { action: 'once' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
