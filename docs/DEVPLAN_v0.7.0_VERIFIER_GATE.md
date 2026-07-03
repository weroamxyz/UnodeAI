# DevPlan — v0.7.0 Verifier-as-Gate

> **Author:** Claude · **Date:** 2026-06-15 · **Authoritative plan for 0.7.0.** Implements P1 of
> [ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md](ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md). Three-team build:
> **Claude** (core gate + review-board data + gate/merge/publish), **Codex** (review-board UI), **DeepSeek/Kimi** (live dogfood + smoke).

## The thesis
Today verification only *nudges* (`roam.engine.verifyObligation` → "⚠ Changes not verified"). 0.7.0 makes it a **merge/completion condition**, composed with worktree fan-out: **a worker's branch does not reach `roam/integration` unless it passes the project's own checks.** Neither Kilo nor Cline gate the *team* merge on verification — this is the moat made concrete: *a Roam crew only lands work that passes your build/lint/test.*

## Design

**Verifier** (`src/backend/Verifier.ts`) — pure, injectable. Runs `roam.verifyCommand` in a directory and returns `passed` / `failed` / `skipped` (skipped = no command, or CommandPolicy blocked it → can't gate, so caller falls through). Shares `CommandPolicy`. Output tail bounded for feedback/UI.

**The gate** (`WorktreeCoordinator.mergeAgent`) — after a worker commits NEW work, run `verify(worktreePath)` **before** `mergeToIntegration`:
- `failed` → **do not merge**; keep work on the agent's own branch; hand the failing output back to the agent via the message bus ("fix and finish again — your work is safe, it'll merge once it passes"); record the lane status. Auto-finalize is consequently blocked too.
- `passed` / `skipped` → fall through to the existing merge.
- Only newly-committed turns are (re-)verified; no command / gate-off → `skipped` (merges, pre-0.7.0 behavior).

**Config:** `roam.worktree.verifyBeforeMerge` (default **true**). Effective only in worktree mode with a `roam.verifyCommand` set — otherwise nothing to gate on. Pre-0.7.0 behavior is unchanged when off or no command.

**Review board data:** `WorktreeCoordinator.verification(agentId)` exposes the last result; `gatherWorktreeReview` attaches it per lane (`{status, command, output}`) → `WorktreeReview.lanes[].verification`.

## Status — Phase 1 (Claude core) ✅ DONE (this commit)
- `src/backend/Verifier.ts` + `Verifier.test.ts` (5 tests).
- `WorktreeCoordinator`: `verify?` dep + gate in `mergeAgent` + `verifyStatus` map + `verification()` accessor + cleared on release. `WorktreeCoordinator.test.ts` +7 gate tests (pass/fail-blocks/skipped/no-commit/no-dep/blocks-autofinalize).
- `extension.ts`: `verify` wired into `makeWorktreeCoordinator` (honors `concurrencyStrategy===worktree` + `worktree.verifyBeforeMerge` + `verifyCommand`, returns `skipped` when off) + `verifyCommandRunner` (spawn in cwd, sanitized env) + per-lane `verification` in `gatherWorktreeReview`.
- `package.json`: `roam.worktree.verifyBeforeMerge` setting.
- `WorktreePanel`: `LaneVerification` type + a **minimal** badge (✓ verified / ✗ failing / ⚠ unverified) — Codex owns the richer rendering.
- Fixed real-git integration test flakiness (30s timeout). Full suite **729 green**, tsc clean.

## Remaining for 0.7.0
- **Codex — review-board Phase 2 UI** → [TASK_v0.7.0_CODEX_review_board.md](TASK_v0.7.0_CODEX_review_board.md). Render per-lane verification prominently: ✗ failing lanes expandable to the failing output, colors, and a "Re-verify" affordance; make clear a failing lane is *held off* integration.
- **DeepSeek/Kimi — live dogfood + smoke** → [TASK_v0.7.0_DEEPSEEK_dogfood.md](TASK_v0.7.0_DEEPSEEK_dogfood.md). Prove the gate end-to-end: a worker that writes failing code is blocked from integration and gets the failure back; once fixed, it merges.
- **Claude — promote + publish.** When Codex's UI + DeepSeek's smoke pass: flip worktree from "experimental" → supported **as the 0.7.0 story** ("verified worktree fan-out"), CHANGELOG, publish 0.7.0.

## Out of scope for 0.7.0 (later)
- **Shared-mode gate** (non-worktree): when a delegated worker writes files and fails verification, mark the `assign_task` result *blocked* to the PM. More invasive (delegation result path) — Phase 2 after the worktree gate proves out.

## Definition of Done
Worktree mode + a `verifyCommand`: a worker's failing turn is **not** merged, the agent is told why and retries, a passing retry merges; the review board shows ✓/✗/⚠ per lane; gate is off by config or absent command ⇒ unchanged behavior; full suite green; live dogfood confirms it on a weak model.
