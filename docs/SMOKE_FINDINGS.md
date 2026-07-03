# Smoke-test findings — to action later

Running log of issues found during manual GUI smoke testing (张). **Recorded, not yet fixed.** Each gets a
quick triage tag so we can batch them; nothing here is actioned until agreed.

Tags: 🐞 bug · ✨ UX polish · ❓ needs-repro/clarify · ✅ fixed (links the version)

---

## Agent setup / edit page (found on 0.8.59)

1a. **Cancel / Save button placement + duplicate Cancel.** 🐞✨
   - There are **two Cancel buttons** on the agent edit page (only one should exist). 🐞
   - **Save + Cancel should sit at the very top** of the page (currently bottom / hard to reach on a long
     form). ✨
   - *Action when we get to it:* dedupe the Cancel control; add a sticky Save/Cancel header bar in
     `AgentBuilderPanel`.

1b. **Model fine-tuning section is inconsistent between the two entry points.** ✅ fixed (0.8.60 + 0.8.61)
   - The Agent edit page now shows the **same fields** as the Settings panel — added **Response format,
     Thinking (+ budget), Tool choice, Stop sequences** (0.8.60) and **Stream + Context window (tokens)**
     (0.8.61). Both entry points route through the same `sanitizeParams` / `sanitizeContextWindow`, so they
     produce identical stored params (single source of truth). +parser tests.

<!-- Add new findings below this line as you test. -->

## SMOKE_v1.0 Phase 5 — release gates (found on 0.9.8, 2026-06-24)

5.1. **`npm test` red: 6 failing real-git worktree tests under an 8.3 short-name temp dir.** ✅ fixed (0.9.8)
   - `MergeOrchestrator.test.ts` + `WorktreeCoordinator.integration.test.ts` failed with
     `fatal: '..._integration' already exists`. Root cause: tests build their repo path from `os.tmpdir()`,
     which under the **Administrator** account is the 8.3 short form `C:\Users\ADMINI~1\...`, while
     `git worktree list --porcelain` returns the resolved long form `C:\Users\Administrator\...`. The old
     `samePath` only lowercased, so `admini~1 ≠ administrator` → `hasIntegrationWorktree()` returned false →
     the second `ensureIntegration()` (finalize-after-merge) re-ran `git worktree add` and git rejected it.
   - *Fix:* `samePath` now canonicalizes both sides via `realpathSync.native()` (fallback to `path.resolve`)
     before the case-insensitive compare, so short/long 8.3 names reconcile. Also hardens worktree handling
     for any short-named workspace path, not just the test temp dir. Gate 5.1 now: build ✅ / lint ✅ /
     **1019/1019 tests ✅**.

5.2. **`smoke:bundle` extraction failed when run from a Git Bash / MSYS shell.** ✅ fixed (0.9.8)
   - `scripts/smoke-bundled-vsix.mjs` ran `tar -xf <vsix>` assuming Windows `tar` is bsdtar. From Git Bash,
     GNU tar 1.35 (MSYS) shadows it on PATH and reads `C:\...` as a remote `host:path`
     (`tar: Cannot connect to C: resolve failed`). Under the documented PowerShell run-env it would have
     passed (system bsdtar), but the harness was fragile to PATH ordering.
   - *Fix:* the win32 branch now calls the Windows bundled bsdtar by absolute path
     (`%SystemRoot%\System32\tar.exe`, fallback to `tar`). Gate 5.2 now passes end-to-end: VSIX packages
     (567 files, 1.47 MB) → extracts → icon + marketplace-catalog assertions ✅ → headless VS Code launch
     activates the extension with **5/5 e2e green** (activate · core commands · Settings · Workflow editor ·
     onboarding).

## SMOKE_v1.0 Phase 2 — S5 keystone, LIVE against the weroam gateway (2026-06-24, 0.9.8)

S5.live. **Real delegate → implement → review → verify loop, automated headless.** ✅ pass (hard criteria)
   - New gated harness: `scripts/live-s5-smoke.mjs` + `test-e2e/suite/live-s5.etest.ts` (runs only when
     `ROAM_LIVE_SMOKE=1` + `ROAM_API_KEY`; skipped under normal `npm run test:e2e`). Spins a throwaway
     git fixture (route-registry app + `node --test`), injects the key into a fresh-profile SecretStorage,
     sends the PM *"add GET /status returning {ok:true}, delegate, review, run_checks, report"*, and polls
     the file on disk.
   - Result (~3.8 min, real tokens): PM delegated to senior-dev → `src/app.js` edited on disk with
     `addRoute('GET', '/status', () => ({ ok: true }))` following the existing pattern → `npm test` green →
     **no wrong-folder / "outside working folder" error**. Hard S5 criterion (file changed on disk, verified,
     correct workspace) **met**.
   - ⚠️ Model-completeness gap (not a product fault): the dev added the route but **did not add a dedicated
     `/status` test** as instructed (test/ kept only health.test.js). Worth a glance at whether the reviewer
     should bounce a missing-test delegation; tracked as model/orchestration polish, non-blocking for 1.0.
