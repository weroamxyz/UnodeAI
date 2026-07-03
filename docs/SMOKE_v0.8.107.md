# Manual smoke test — living checklist (build 0.8.107)

Single source of truth for the manual GUI smoke run (张, on `c:\AI_Program\BankingAPI`). Update the Status
column as you go so we never lose the thread across versions again. Findings → `SMOKE_FINDINGS.md`.

Legend: ✅ passed · ⏳ pending · 🔁 re-test needed on latest · 🚧 blocked

| Step | What you do | Pass criteria | Status |
|------|-------------|---------------|--------|
| **S1** | Install VSIX, open BankingAPI, create a team | Team panel shows agents; **mode chip** (⚙ Optimistic) visible (0.8.106) | ✅ |
| **S2** | Solo agent: chat one agent, ask it to edit a file | Live streaming, tool cards, file actually edited | ✅ |
| **S3** | PM delegation, simple task | PM delegates → worker does it → PM reports back, no 400s | ✅ |
| **S4** | Mount an MCP server (Sequential Thinking) + approval | Server mounts (no -32000), approval prompt, agent can call it | ✅ (0.8.88) |
| **S5** | **Real project task**: ask PM to add `GET /status` (route + test) to BankingAPI, end-to-end | senior-dev writes both files, reviewer PASS, `run_checks` green, **PM marks plan complete**; no "outside working folder", no `/Users/dev` path | ✅ **passed (0.8.108)** |
| **S6** | Command approval = "Ask each": worker runs a **non-safe** command (`npm test` is whitelisted → won't prompt, by design). Use **`git branch`** or **`node -v`**. | You get an approve/deny prompt; Approve runs it, Deny refuses cleanly | 🔁 **resume here** (use a non-safe command) |
| **S7** | Smart Mode: set tiers per agent/provider, run a turn | Team card shows the **true model** with ⚡ Smart badge; no tab-jump on edits; turn uses the tier model | 🔁 |
| **S8** | Worktree isolation: click mode chip → Worktree (git-init if prompted); run two agents | Each agent works in its own `.roam/worktrees/…`; verify-gate merges only passing work | ⏳ |

## Why S5 stalled before, and what's now fixed (verify these during S5–S8)

- **Gateway 400s** that failed delegation: tool-pairing + assistant-prefill (0.8.77), and the reviewer's
  `reasoning_content … must be passed back` (0.8.104, split-preserve + self-heal). → S3/S5 should run clean.
- **`run_checks` verify deadlock** (0.8.78). → S5 verify gate.
- **"Ask each" command approval never prompting** — live policy hot-reload (0.8.81). → S6.
- **Agent Builder** save/MCP/form-loss (0.8.85) + **Sequential Thinking** wrong package (0.8.88). → S4.
- **Smart Mode** provider-specific models, true-model badge, no tab-jump, no cross-provider fallback
  (0.8.92–0.8.94). → S7.
- **"Outside working folder" / `/Users/dev` hallucination** — one runtime root
  (`SessionInfo.runtimeWorkingDirectory`), grounding + preflight + delegation all use it, no more pinned
  `workingDirectory` (0.8.100–0.8.107). → S5 should no longer get the wrong-folder confusion.
- **Concurrency mode** is now visible + switchable (chip + Dashboard, 0.8.106). → S8.

## Notes
- **"Ask each" does NOT prompt for known-safe commands** (`npm test`, `git status/diff/log`, `npm run build/lint`, etc. — the `roam.allowedCommands` default seeded from `SAFE_COMMAND_TEMPLATES`). That's intentional UX: it only prompts for commands *not* on the safe allowlist (or anything with shell chaining `; && | >`). So S6 must use a non-safe command (`git branch`, `node -v`) to see the prompt. To force a prompt for *everything*, set `roam.allowedCommands` to `[]`.
- Optimistic mode needs no git. Worktree mode needs a git repo — use the title-bar **⎇ icon** / **Initialize Git** if BankingAPI isn't one.
- S5 is the keystone: if it passes clean on 0.8.107, the whole gateway/orchestration/working-dir thread is validated end-to-end.
