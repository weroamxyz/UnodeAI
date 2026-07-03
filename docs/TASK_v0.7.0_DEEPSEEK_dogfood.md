# TASK — v0.7.0 live dogfood: the verifier gate

> **⚠️ This is a HUMAN-run GUI smoke (張 drives it), NOT an in-extension agent task.** A UnodeAi
> agent (DeepSeek/Kimi/etc.) runs *inside* the extension as a headless coding agent — it has
> `run_command`/`write_file`/`read_file` only. It **cannot** install a VSIX, toggle `roam.*` settings,
> create a team, send chat messages, or watch the Output channel — all of which this smoke needs. (An
> agent stalled on exactly this — correct behavior, my mis-routing.) An agent *can* optionally do
> **Step 1 only** (set up the throwaway repo + confirm `npm test`); everything from Step 2 is the user
> at the keyboard, like the prior worktree smokes.
>
> **Reports to:** Claude (turns findings into fixes) · **Plan:** [DEVPLAN_v0.7.0_VERIFIER_GATE.md](DEVPLAN_v0.7.0_VERIFIER_GATE.md)
> Goal: prove **end-to-end, on a weak model**, that a crew only lands work that passes the project's
> checks — and that a failing worker is told why and recovers. Unit tests already pass; this is the
> live extension-host validation tests can't reach.

## Setup (throwaway repo — not a precious one)
1. PowerShell:
   ```powershell
   Remove-Item -Recurse -Force C:\AI_Program\roam-verify -ErrorAction SilentlyContinue
   New-Item -ItemType Directory C:\AI_Program\roam-verify | Out-Null
   cd C:\AI_Program\roam-verify
   git init -b main; git config user.email t@example.com; git config user.name Test
   npm init -y > $null
   ```
2. Add a trivial test so `npm test` means something. `src/math.js`: `module.exports.add = (a,b)=>a+b;`
   `test/math.test.js` (node:test): asserts `add(2,2)===4`. Set `package.json` `"scripts": { "test": "node --test" }`. Commit it all. Confirm `npm test` passes locally.
3. Install the 0.7.0 candidate VSIX (Claude provides) → reload. Open `C:\AI_Program\roam-verify`.
4. Settings: `roam.concurrencyStrategy = worktree`, **`roam.verifyCommand = npm test`**, leave `roam.worktree.verifyBeforeMerge = true` (default), `roam.worktree.autoMerge = off`. Open the **UnodeAi** Output channel.
5. Team: PM + a Developer (a cheap/weak model — that's the point).

## Test A — failing work is BLOCKED from integration
Ask the Developer (or have the PM delegate): *"In src/math.js change add to return a - b."* (deliberately breaks the test).
- **Expect:** Output shows `Verification failed for roam/… (npm test) — not merged.` The Developer gets a chat message with the failing test output and is asked to fix. Verify nothing merged:
  ```powershell
  git show roam/integration:src/math.js   # should FAIL or still show a+b — the bad change must NOT be on integration
  ```
- Review board (**Crew Worktrees**): the Developer's lane shows **✗ failing** (with the output, once Codex's UI lands).

## Test B — the fix merges
Tell the Developer: *"Restore add to return a + b so the test passes, then finish."*
- **Expect:** Output shows verification passed → merged to integration. Lane flips to **✓ verified**.
  ```powershell
  git show roam/integration:src/math.js   # now shows a + b
  ```

## Test C — gate off / no command = unchanged
Set `roam.worktree.verifyBeforeMerge = false` (or clear `verifyCommand`). Repeat a small change → it should merge **without** gating (lane shows ⚠ unverified). Confirms the off-switch and the no-command fallthrough.

## What to report (to Claude)
For each test: ✅/❌ + the exact Output `[worktree]` lines + the `git show` results. Flag especially:
- A failing change that **reached** integration (gate leak — critical).
- The agent NOT receiving the failure feedback, or looping/“env broken” instead of fixing.
- Verify running when it shouldn't (gate off / no command), or not running when it should.
- Any hang (verify command that doesn't exit) — note the command + behavior.

If A+B pass, the gate is validated and Claude promotes worktree → supported and publishes 0.7.0.
