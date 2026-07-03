# TASK — MergeOrchestrator implementation (worktree fan-out, Slice C)

**Owner:** Codex · **Reviewer/Integrator:** Claude · **Type:** isolated git module + unit tests
**Frozen contract:** [`src/backend/MergeOrchestrator.ts`](../src/backend/MergeOrchestrator.ts) · **Design:** [V0.6.0_WORKTREE_FANOUT_DESIGN.md](V0.6.0_WORKTREE_FANOUT_DESIGN.md) §3–4 · **Substrate:** [`src/backend/WorktreeManager.ts`](../src/backend/WorktreeManager.ts)

> **Branch `feat/merge-orchestrator` from current `main`, in your OWN worktree** (`.worktrees/...` or a sibling — but commit there; the sandbox roots itself at the workspace folder, so run it where that folder IS the worktree). **Edit ONLY `src/backend/MergeOrchestrator.ts` + a new `src/backend/__tests__/MergeOrchestrator.test.ts`.** Do NOT change the exported interface/types or touch other files (Claude is wiring the call sites against them in parallel — Slice B). **Commit before pinging.**

---

## Goal
Implement `GitMergeOrchestrator` (the stubbed class) so the worktree fan-out can: commit an agent's worktree → merge it into a shared `roam/integration` staging branch (conflict-aware) → finalize integration → base on approval. Pure git mechanics, fully unit-tested against throwaway repos (mirror `WorktreeManager.test.ts`, which spawns real git).

## The critical mechanic
**Never disturb the user's main checkout.** All merges happen in a **dedicated integration worktree** at `.roam/worktrees/_integration`, checked out to `roam/integration`, driven via `git -C <integrationWorktreePath> ...`. The main checkout stays on the user's branch the whole time.

## Implement each method (signatures are frozen — bodies only)
- **`ensureIntegration(baseRef?)`** — idempotent. If `roam/integration` doesn't exist, create it off `baseRef` (default: the repo's current branch, resolve via `git rev-parse --abbrev-ref HEAD`). If the `.roam/worktrees/_integration` worktree doesn't exist, add it (`git worktree add <path> roam/integration`). Add `.roam/worktrees/` to `.git/info/exclude` (or reuse — note WorktreeManager already does this; safe to repeat idempotently).
- **`commitWorktree(worktree, message)`** — `git -C worktree.path add -A`; if `git -C worktree.path status --porcelain` is empty, return `false` (nothing to commit). Else `git -C worktree.path commit -m message` and return `true`. Set a deterministic identity if needed (`-c user.name=... -c user.email=...`) so tests don't depend on global git config.
- **`mergeToIntegration(worktree)`** — in the integration worktree: `git -C <int> merge --no-ff <worktree.branch>`.
  - Success → `{ status: 'merged', ... , message }`.
  - Nothing to merge (already up to date / no commits) → `{ status: 'nothing', ... }`.
  - Conflict → run `git -C <int> diff --name-only --diff-filter=U` to collect `conflictedFiles`, then `git -C <int> merge --abort` (leave integration clean), return `{ status: 'conflict', conflictedFiles, message }`.
  - Any git error → `{ status: 'error', message }` (don't throw across the boundary).
- **`finalizeToBase(baseRef?)`** — merge `roam/integration` into `baseRef` (default the original base). Prefer fast-forward; fall back to `--no-ff`. Do this **without** checking out base in the main checkout — use a `git -C <int>`-based approach or update the base ref via merge in a way that doesn't disturb the user's HEAD. (If you must, document the approach in a comment.) Return a `MergeResult`. Do NOT remove worktrees — the caller handles cleanup.

## Rules
- Inject the `GitRunner` (`opts.git`) exactly like `WorktreeManager` does; default to a spawn-based runner. This is what makes it testable.
- `integrationBranch` defaults to `roam/integration` (from `opts.integrationBranch`).
- Never throw across a public method for an *expected* git outcome (conflict, nothing-to-merge, error) — return a `MergeResult`. Reserve throws for programmer errors.
- Windows-safe: use `path.join`, tolerate `\r\n` in git output.

## Tests (`src/backend/__tests__/MergeOrchestrator.test.ts`)
Against real temp repos (copy the `tempRepo()` helper from `WorktreeManager.test.ts`):
- clean merge: two worktrees touch **different** files → both `mergeToIntegration` → `status:'merged'`, integration has both changes.
- conflict: two worktrees edit the **same** line → second merge returns `status:'conflict'` with the file listed, and integration is left clean (no conflict markers, `git status` clean).
- nothing-to-commit: `commitWorktree` on a clean worktree returns `false`.
- nothing-to-merge: merging a branch with no new commits → `status:'nothing'`.
- `finalizeToBase`: after a merged integration, base advances to include the change.

## DoD
- [ ] All four methods implemented; `GitMergeOrchestrator` no longer throws "not implemented".
- [ ] `npx vitest run src/backend/__tests__/MergeOrchestrator.test.ts` green (clean-merge + conflict + the edge cases above).
- [ ] No change to the exported interface/types; edits confined to `MergeOrchestrator.ts` + its test.
- [ ] `npm run compile` + `npm run lint` clean. **Commit on `feat/merge-orchestrator`, then ping Claude** — Claude reviews + wires it into the agent lifecycle (Slice B).
