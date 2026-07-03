# Codex Task Card — Verifier-as-Gate on the default PM-completion path

> The moat's last gap. Two gate surfaces already exist (**Workflows** `GatedWorkflow`; **worktree-merge**
> `Verifier`, extension.ts:973). The missing one: a PM crew in **normal optimistic/shared-tree mode** can
> report a goal **done with RED checks** — today only a soft `verifyObligation` nudge fires. Wire the
> already-built, deadlock-proof decision core into the coordinator's completion so it becomes a real gate
> with a human-handoff ladder. **张's hard requirement: never deadlock — bounded retries, then escalate to
> the human (suggest help / reassign), never an endless loop.**

## Use the core that's already built + tested (do NOT reimplement the ladder)
`src/backend/completionGate.ts` (committed, 9 tests green incl. the "forever-red → terminates in handoff"
proof):
- `decideCompletionGate(checksPassed, attempts, cfg)` → `{kind:'pass'}` | `{kind:'retry',attempt,escalate}` |
  `{kind:'handoff',attempts}`. Ladder: self-fix retries → escalated/redelegated retries → **terminal handoff**.
- `buildGateRetryMessage(cmd, output, escalate)` — the fix obligation injected back to the PM.
- `buildGateHandoffMessage(cmd, attempts, output)` — the terminal "🚧 Blocked — needs a human" message
  (offers: retry stronger / reassign / take over).
- `DEFAULT_COMPLETION_GATE_CONFIG = { maxSelfRetries: 2, maxRedelegations: 1 }`, `maxGateAttempts(cfg)`.

## Reuse the existing check runner (do NOT write a new one)
`runVerifyChecks()` (extension.ts:1330) already runs `roam.verifyCommand` and returns
`{ ok: boolean; output?: string; blocked?: boolean }` — exactly the shape the gate needs.

## Verified anchors
- `EngineOptions` — src/backend/Diagnostics.ts:33 (currently `diagnostics` / `verifyObligation` /
  `sharedReadRoot`). Add `completionGate?` here.
- `createBackend` builds `EngineOptions` — extension.ts:261. Coordinator test = `canDelegate(runtimeConfig)`;
  worktree mode = `worktreeMode` (already computed nearby, ~256).
- Backend turn-end nudges — OpenAICompatBackend.ts ~545-595 (the `verifyObligation` + noop-completion
  `continue`-loop pattern to mirror); state fields `wroteAnything`/`verifyNudges` at ~432-437.
- **Worktree gate already exists** (extension.ts:973 `verify`, `Verifier`). Do **NOT** duplicate or gate
  worktree mode here — this card is the **shared-tree coordinator** gap only.

## Subtasks
- **G1 — EngineOptions:** add
  `completionGate?: { run: () => Promise<{ ok: boolean; output?: string; blocked?: boolean }>; cfg: CompletionGateConfig }`.
- **G2 — package.json config:** `roam.gate.enabled` (boolean, default **true**),
  `roam.gate.maxSelfRetries` (default 2), `roam.gate.maxRedelegations` (default 1). Document briefly.
- **G3 — createBackend wiring:** set `completionGate` **only when ALL of**: `canDelegate(runtimeConfig)`
  (coordinator/PM) **and** `!worktreeMode` (worktree already gates per-lane) **and** `roam.gate.enabled`
  **and** a non-empty `roam.verifyCommand`. Then `{ run: runVerifyChecks, cfg: {maxSelfRetries, maxRedelegations} }`.
  Otherwise leave it undefined (gate off — never trap a user who hasn't configured a verify command).
- **G4 — OpenAICompatBackend turn-end gate:** add instance field `private gateAttempts = 0;`, **reset to 0
  at the start of each user-initiated turn** (new goal starts fresh). At the point the coordinator is about
  to finish the turn (act mode, no tool calls, about to `break`), if `engine.completionGate` is set:
  1. `const r = await completionGate.run();`
  2. **`r.blocked` → do NOT gate** (append a one-line "checks couldn't run" note, treat as pass). Never deadlock on an un-runnable check.
  3. `const out = decideCompletionGate(!!r.ok, this.gateAttempts, cfg);`
     - `pass` → proceed (`break` as today).
     - `retry` → `this.history.push({ role:'user', content: buildGateRetryMessage(cmd, r.output ?? '', out.escalate) })`;
       `this.gateAttempts++`; `continue;` (PM delegates a fix; `escalate` tells it to reassign/use a stronger teammate).
     - `handoff` → `finalText += buildGateHandoffMessage(cmd, this.gateAttempts, r.output ?? '')`; emit it;
       reset `this.gateAttempts = 0`; `break;` (**terminal — paused, no further auto-loop**).
  - Keep the existing `verifyObligation`/noop nudges working; the gate is coordinator-scoped and runs the
    real checks (the PM usually didn't write files itself, so `verifyObligation`'s `wroteAnything` won't fire
    for it — the gate is what covers the PM). Don't double-emit.
- **G5 — tests:** backend test — a coordinator whose checks stay RED loops **exactly `maxGateAttempts`**
  times (each pushing a retry obligation) then emits the handoff text and **stops** (assert no further
  iteration); a coordinator whose checks pass completes normally; `gateAttempts` resets between turns;
  `blocked` result does not gate.

## Invariants (non-negotiable)
- **No infinite loop, ever.** `gateAttempts` strictly increments each red cycle; once `decideCompletionGate`
  returns `handoff`, `break`. (The core already proves termination — don't add a path that bypasses it.)
- Coordinators on the **shared tree only**; never gate solo or worker agents; never double-gate worktree mode.
- A missing/blocked verify command ⇒ **gate off**, not a trap.
- English-only; no security-model change; CSP/webview untouched (no UI here). `build`/`lint`/`test` green.

## Out of scope (note for later, don't build now)
- Integration-level re-check at PM completion in worktree mode (lanes are already gated pre-merge; cross-lane
  semantic breakage is a v2 add).
- Deterministic forced tier-bump on `escalate` (v1 instructs escalation via the message; a hard tier swap is v2).

## Review
Bring it to Claude at the boundary: build/lint/test counts + a note on the turn-end integration, flagging any
spot the code had to diverge from this card.
