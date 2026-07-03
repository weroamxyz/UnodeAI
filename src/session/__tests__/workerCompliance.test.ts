import { describe, it, expect } from 'vitest';
import { workerComplianceProtocol } from '../SessionManager';
import { AgentConfig } from '../../types';

const cfg = (over: Partial<AgentConfig>): AgentConfig => ({
  id: 'a', role: 'senior-dev', name: 'Dev', skill: '', skills: [],
  provider: { providerId: 'roam', apiKeySecretName: 'ROAM_API_KEY' },
  model: 'deepseek-v4-flash', systemPrompt: '', autoApprove: false,
  allowedTools: ['read', 'write', 'execute'],
  ...over,
});

describe('workerComplianceProtocol', () => {
  it('injects the protocol for worker agents (incl. the shared fresh-read rule)', () => {
    const out = workerComplianceProtocol(cfg({}));
    expect(out).toMatch(/Cite from a fresh read, never from memory/i); // shared by every agent
    expect(out).toContain('Carrying out an assigned task');
    expect(out).toMatch(/do not reply with only a plan/i);
    expect(out).toMatch(/Do NOT tell the requester to run a command/i);
  });

  it('includes the P2 worker-protocol rules (from dogfood findings)', () => {
    const out = workerComplianceProtocol(cfg({}));
    // Re-read before claiming "already done" (caught: agent claimed a change from stale memory).
    expect(out).toMatch(/READ the relevant file\(s\).*current contents/is);
    expect(out).toMatch(/never rely on\s+your memory/i);
    // Don't weaken tests to pass (caught: agent changed an assertion to match buggy output).
    expect(out).toMatch(/fixing the CODE, never by weakening the tests/i);
    // Small, verifiable steps.
    expect(out).toMatch(/small, verifiable steps/i);
    // Todo hygiene: mark the final step completed before reporting done.
    expect(out).toMatch(/todo list honest/i);
    expect(out).toMatch(/mark the FINAL step completed/i);
  });

  it('makes workers ground the task in the real code before acting (weak-model failure mode)', () => {
    const out = workerComplianceProtocol(cfg({}));
    expect(out).toMatch(/Ground the task in the REAL code before you act/i);
    expect(out).toMatch(/instruction tells you the INTENT/i);
    expect(out).toMatch(/RECONCILE the instruction with what you found/i);
    expect(out).toMatch(/do not invent a function, file, import, or pattern/i);
    expect(out).toMatch(/instruction CONFLICTS with reality/i);
  });

  it('does NOT give the coordinator the worker-only ground-first / task protocol', () => {
    const out = workerComplianceProtocol(cfg({ role: 'pm', allowedTools: ['read', 'search', 'delegate', 'message'] }));
    expect(out).toMatch(/Cite from a fresh read, never from memory/i);
    expect(out).toMatch(/read it this turn/i);
    expect(out).not.toContain('Carrying out an assigned task'); // not the worker protocol
    expect(out).not.toMatch(/Ground the task in the REAL code/i);
  });

  it('gives any delegate-holding agent the same fresh-read rule', () => {
    const out = workerComplianceProtocol(cfg({ role: 'custom', allowedTools: ['read', 'delegate'] }));
    expect(out).toMatch(/Cite from a fresh read, never from memory/i);
  });

  it('still applies to read-only workers like the reviewer', () => {
    expect(workerComplianceProtocol(cfg({ role: 'reviewer', allowedTools: ['read', 'search', 'message'] }))).toContain('deliverable');
  });
});
