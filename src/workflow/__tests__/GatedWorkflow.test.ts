import { describe, it, expect } from 'vitest';
import { decideGate, resolveBranch, WorkflowGate } from '../GatedWorkflow';

describe('resolveBranch (P2 conditional routing)', () => {
  it('returns undefined when there are no branches', () => {
    expect(resolveBranch(undefined, 'anything')).toBeUndefined();
    expect(resolveBranch([], 'anything')).toBeUndefined();
  });

  it('matches the first branch whose substring is present (case-insensitive)', () => {
    const branches = [
      { whenResultContains: 'FAIL', goto: 'fix' },
      { whenResultContains: 'pass', goto: 'ship' },
    ];
    expect(resolveBranch(branches, 'tests fail here')).toBe('fix');
    expect(resolveBranch(branches, 'all PASS')).toBe('ship');
  });

  it('treats a branch without a condition as an else (always matches)', () => {
    const branches = [
      { whenResultContains: 'fail', goto: 'fix' },
      { goto: 'default' },
    ];
    expect(resolveBranch(branches, 'looks good')).toBe('default');
  });

  it('returns undefined when nothing matches and there is no else branch', () => {
    expect(resolveBranch([{ whenResultContains: 'x', goto: 'a' }], 'no match')).toBeUndefined();
  });
});

const gate: WorkflowGate = {
  after: 'code',
  objective: true,
  onPass: { 'senior-dev': 'economy' },
  onFail: { setTier: { 'senior-dev': 'premium' }, maxRetries: 2, onExhaust: 'human' },
};

describe('decideGate (P2 gated workflow)', () => {
  it('proceeds and applies onPass tiers when the check passes', () => {
    const d = decideGate(gate, true, 1);
    expect(d.proceed).toBe(true);
    expect(d.applyTiers).toEqual({ 'senior-dev': 'economy' });
    expect(d.retry).toBe(false);
  });

  it('retries with escalated tier on the first failure', () => {
    const d = decideGate(gate, false, 1);
    expect(d.proceed).toBe(false);
    expect(d.retry).toBe(true);
    expect(d.applyTiers).toEqual({ 'senior-dev': 'premium' });
    expect(d.escalate).toBe('none');
  });

  it('keeps retrying up to maxRetries', () => {
    expect(decideGate(gate, false, 2).retry).toBe(true); // 2 <= 2
    expect(decideGate(gate, false, 3).retry).toBe(false); // exhausted
  });

  it('escalates to human once retries are exhausted', () => {
    const d = decideGate(gate, false, 3);
    expect(d.escalate).toBe('human');
    expect(d.proceed).toBe(false);
  });

  it('defaults maxRetries=1 and onExhaust=human when onFail omitted', () => {
    const bare: WorkflowGate = { after: 'x', objective: true };
    expect(decideGate(bare, false, 1).retry).toBe(true);
    expect(decideGate(bare, false, 2).escalate).toBe('human');
  });

  it('supports re-routing the retry to another role', () => {
    const routed: WorkflowGate = { after: 'x', onFail: { route: 'architect', maxRetries: 1 } };
    expect(decideGate(routed, false, 1).route).toBe('architect');
  });
});
