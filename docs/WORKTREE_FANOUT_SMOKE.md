# Smoke test — Worktree fan-out (live extension-host)

The git mechanics are already proven by `WorktreeCoordinator.integration.test.ts` (real git). This
script validates the part tests can't reach: the **VS Code extension-host wiring** — config reading,
agent-start → worktree, `turn_complete` → merge, the Finalize command, and conflict feedback in a
real multi-agent run. ~10 minutes.

> ⚠️ Use a **throwaway git repo** (or a branch you don't mind), not a precious working tree. The
> feature creates branches/worktrees and `finalize` runs a clean-tree-only `git reset --hard`.

## Setup
1. Open a **git repo** folder in VS Code with a **clean** working tree (`git status` empty). Note the current branch (e.g. `main`).
2. Run the extension: **F5** (Extension Development Host) on this repo, or install the latest VSIX.
3. Settings → set **`roam.concurrencyStrategy` = `worktree`**. Leave `roam.worktree.autoMerge` off.
4. Open the **UnodeAi Output** channel (to watch `[worktree] …` log lines).

## Test 1 — isolation (agent gets its own worktree)
1. Create a team: PM + 2 workers (e.g. Developer + Backend Developer).
2. Give the PM a task that has the two workers each touch a **different** file (e.g. "Developer: create `featureA.txt` with 'A'; Backend: create `featureB.txt` with 'B'").
3. **Expect:** as each worker starts, the Output shows `Isolated "<name>" in …/.roam/worktrees/<name> (branch roam/<name>)`. Verify on disk:
   ```
   git worktree list          # main + _integration + one per worker
   ls .roam/worktrees         # <worker> dirs (+ _integration)
   ```
   The PM should **not** get a worktree (it stays on the live tree).

## Test 2 — merge to integration on completion
1. Let the workers finish their tasks.
2. **Expect:** Output shows `roam/<name> → roam/integration: merged` per worker. Verify:
   ```
   git show roam/integration:featureA.txt   # 'A'
   git show roam/integration:featureB.txt   # 'B'
   git show main:featureA.txt               # FAILS — base untouched until finalize
   ```

## Test 2b — shared reads (read = shared, write = isolated) — 0.6.11
1. While the workers are running (or after), give the **PM** a task to "read featureA.txt and featureB.txt and report their contents."
2. **Expect:** the PM can now read **both** files even though they're not on its base checkout — they come from the integration overlay (each read is tagged *read-only: from the team's shared integration view*). Before 0.6.11 the PM saw "file not found" and wrongly reported failure.
3. (Optional) Have one worker read the *other* worker's file (e.g. tell Developer to "read featureB.txt"): it should succeed via the overlay. A `write_file` to that path would create a *forked* copy in the worker's own worktree, not change the shared one.

## Test 3 — finalize (land it on your branch)
1. Command Palette → **"UnodeAi: Finalize Worktree Merges to Branch"**.
2. **Expect:** info toast "Merged the team's worktree work into `<base>`." Your editor/working tree now shows `featureA.txt` + `featureB.txt`. Verify:
   ```
   git show <base>:featureA.txt   # 'A'
   git log --oneline -5           # base advanced to include the integration merge
   git status                     # clean (the reset --hard materialized it)
   ```

## Test 4 — conflict feedback
1. New task: have **both** workers edit the **same** line of the **same** file.
2. **Expect:** the first merges clean; the second's chat shows a message like *"Your changes conflict with a teammate's on: `<file>` … reconcile and finish again."* Verify integration is not left broken:
   ```
   git -C .roam/worktrees/_integration status --porcelain   # empty (merge aborted)
   git show roam/integration:<file>                          # the FIRST agent's version
   ```

## Test 5 — guards (graceful fallback)
1. With a **dirty** tree (make an uncommitted edit), start a new agent.
2. **Expect:** Output: `workspace has uncommitted changes — using the shared workspace`; the agent runs normally on the shared root (no worktree). Same expectation in a **non-git** folder: `not a git repository — using the shared workspace`.

## Test 6 — cleanup
1. Remove a worker agent from the team.
2. **Expect:** its `.roam/worktrees/<name>` directory is gone (`git worktree list` no longer shows it).

## What to report back
For each test: ✅/❌ + any Output/error text. Especially flag:
- Worktrees **not** created when expected (or created for the PM).
- A merge that didn't reach `roam/integration`, or a finalize that didn't advance the base.
- A conflict that left `_integration` in a broken state, or no agent feedback.
- Any `reset --hard` that touched uncommitted work (should be guarded — report if not).

If all six pass, the feature is safe to ship as **opt-in experimental**; the default (`optimistic`) is unaffected regardless.
