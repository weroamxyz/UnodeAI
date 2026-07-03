# TASK (Codex) — v0.7.0 Review-Board Phase 2: verification status per lane

> **Owner:** Codex · **Reviewer/merge:** Claude · **Plan:** [DEVPLAN_v0.7.0_VERIFIER_GATE.md](DEVPLAN_v0.7.0_VERIFIER_GATE.md)
> Claude has shipped the gate core + the data. Your job is the **UI** that makes the gate legible in the
> Crew Worktrees review board.

## Context (already built by Claude — don't re-do)
- The gate runs the project's verify command in each worker's worktree before merging; a **failing** lane is held off `roam/integration` and the failure is handed back to the agent.
- The data is already plumbed to the panel: `WorktreeReview.lanes[].verification?: { status: 'passed'|'failed'|'skipped'; command: string; output: string }` (see `src/views/WorktreePanel.ts`, `LaneVerification`). A **minimal** badge already renders (`verifyBadge`).

## What to build
Make verification a first-class part of the review board:
1. **Per-lane status, prominent:** ✓ verified (green) / ✗ failing (red) / ⚠ unverified (muted) — keep the existing vocabulary. A ✗ lane should read clearly as **"held off integration until it passes."**
2. **Expandable failing output:** a ✗ lane expands to show `verification.output` (the tail of the verify run) in a monospace block, like the chat tool-card diff/output style. Collapsed by default; one click to read why it failed.
3. **Show the command** (`verification.command`, e.g. `npm test`) so the user knows what ran.
4. **Optional (nice-to-have): a "Re-verify" button per lane** that re-runs the gate for that agent. If you do this, add a `reverify(agentId)` message handled by the panel → a new `onReverify?` handler prop wired in `extension.ts` to `worktreeCoordinator` (Claude will add the coordinator method if you specify the signature you want — coordinate, don't guess).

## Allowed files (do not touch others)
- `src/views/WorktreePanel.ts` (rendering — primary).
- `src/views/__tests__/WorktreePanel.test.ts` (add/extend rendering tests; create if absent).
- **Only if doing Re-verify:** a small, additive change to `src/extension.ts` (wire the handler) — flag it in your report so Claude reviews that path specifically.

Do **not** change `WorktreeCoordinator.ts`, `Verifier.ts`, the gate logic, or the `LaneVerification` shape (coordinate with Claude if you need a field added).

## Constraints
- Webview security: no `innerHTML` with untrusted data — build DOM or use the existing `esc()`/`csp`/`nonce` helpers already in the file. `verification.output` is command output → **must be escaped**.
- Keep it renderer-only and pure where possible; the panel already has a `render()`/`load()` pattern.
- Match the existing panel styles (CSS vars).

## DoD
- A failing lane shows red ✗, the command, and expandable escaped output; passing shows green ✓; unverified shows ⚠.
- `npm run build` + `npm run lint` clean; a rendering unit test covers the three states (and the escape).
- Commit on your own branch/worktree; **commit before pinging** Claude to review + merge.
