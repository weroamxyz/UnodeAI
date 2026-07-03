/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Gated workflow types + decision logic (P2 / Team Workflow design §3, §8)
 *  A "gate" sits after a step: an OBJECTIVE machine check (run_checks: build/type-check/test) and,
 *  on pass/fail, a deterministic tier switch (cheaper model when things go well, stronger model on
 *  the retry). This is the "machine vs judgment" split from the design: the runtime owns the gate
 *  (reliable), the PM owns subjective quality (probabilistic, separate).
 *
 *  The decision logic here is pure so it's unit-testable; WorkflowEngine wires the async run_checks
 *  + TierController + step re-issue around it.
 *--------------------------------------------------------------------------------------------*/

import { ModelTier } from '../roles/RoleConfig';

/** A gate evaluated after `after` (a step id). */
export interface WorkflowGate {
  after: string;
  /** Run the objective check (run_checks) at this gate. */
  objective?: boolean;
  /** Tier changes to apply when the gate PASSES (e.g. drop back to economy to save cost). */
  onPass?: Record<string, ModelTier>;
  onFail?: {
    /** Tier changes on failure (e.g. escalate the implementer to premium for the retry). */
    setTier?: Record<string, ModelTier>;
    /** Max retries of the failed step before escalating out. Default 1. */
    maxRetries?: number;
    /** Reassign the retry to a different role instead of the original step's target. */
    route?: string;
    /** What to do once retries are exhausted. Default 'human' (pause for a person). */
    onExhaust?: 'human' | 'fail';
  };
}

export interface GateDecision {
  /** Gate passed → proceed to the next step. */
  proceed: boolean;
  /** Tier directive to apply now (onPass on success, setTier on a retry). */
  applyTiers?: Record<string, ModelTier>;
  /** Re-run the failed step (gate failed but retries remain). */
  retry: boolean;
  /** If retrying, optionally reassign to this role. */
  route?: string;
  /** Terminal outcome when retries are exhausted. */
  escalate: 'none' | 'human' | 'fail';
}

/**
 * P2 conditional routing: given a step's branches and the result text, return the `goto` step id of
 * the first matching branch (substring match, case-insensitive; a branch without a condition always
 * matches). Returns undefined when no branch matches (caller falls back to the linear next step).
 */
export function resolveBranch(
  branches: import('../types').WorkflowBranch[] | undefined,
  resultText: string
): string | undefined {
  if (!branches || branches.length === 0) {
    return undefined;
  }
  const hay = (resultText ?? '').toLowerCase();
  for (const b of branches) {
    if (b.whenResultContains === undefined || hay.includes(b.whenResultContains.toLowerCase())) {
      return b.goto;
    }
  }
  return undefined;
}

/**
 * Decide what to do at a gate given whether the objective check passed and how many attempts of the
 * gated step have already been made (1 = first run just completed).
 */
export function decideGate(gate: WorkflowGate, passed: boolean, attempt: number): GateDecision {
  if (passed) {
    return { proceed: true, applyTiers: gate.onPass, retry: false, escalate: 'none' };
  }
  const f = gate.onFail ?? {};
  const maxRetries = f.maxRetries ?? 1;
  if (attempt <= maxRetries) {
    return { proceed: false, applyTiers: f.setTier, retry: true, route: f.route, escalate: 'none' };
  }
  return { proceed: false, retry: false, escalate: f.onExhaust ?? 'human' };
}
