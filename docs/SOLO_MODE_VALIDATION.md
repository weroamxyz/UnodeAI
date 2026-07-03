# Solo Mode — Validation Runbook (run before building the feature)

> Goal: decide whether UnodeAi's **single-agent** loop (read → edit → run → fix) is good enough to
> productize as a one-click "Solo / Fast" mode (the v0.3 headline). This is a *validation*, not the
> feature — run it, fill in the report, and the result drives what we build.
> Owner of the run: DeepSeek (Claude is out of quota). Authority for plan: [ROADMAP_v0.3_v0.4.md](ROADMAP_v0.3_v0.4.md).

## Hypothesis
A single capable agent with read/write/execute tools + Plan/Act, **without** PM orchestration, gives a
Cline-class solo coding experience. If true → productizing is cheap (one-click template + guided command
approval). If false → we learn the real gap (diff approval? weak model? command friction?) first.

## Why command execution is the linchpin
The tool loop already exists (`read_file`, `write_file`, `list_dir`, `run_command`, ≤12 iters). But
`run_command` is blocked unless `roam.commandApproval` is enabled. Without it the agent can edit files but
**cannot run build/test to "get to green"** — so the test MUST enable command execution or it isn't a real
Solo test.

---

## Setup

### 1. Prereqs
- UnodeAi **v0.2.6** installed; `ROAM_API_KEY` set (`UnodeAi: Set Provider API Key`).
- A **scratch project folder** — NOT the RoamCrew repo (the agent will write files and run commands; keep it
  contained). E.g. an empty folder `solo-test/` with `git init`.

### 2. Enable command execution (Settings → native settings, or settings.json)
```jsonc
// .vscode/settings.json in the scratch folder (or user settings)
"roam.commandApproval": "allowlist",
"roam.commandAllowlist": ["npm", "npx", "node", "git", "python", "pytest", "pnpm", "yarn"]
```
(Use `allowlist`, not `all`, for safety. Add prefixes the task needs.)

### 3. Create the solo agent — `<scratch>/.roam/team.json`
> ⚠️ `allowedTools` are **capability tokens** (`read`/`write`/`search`/`execute`), NOT tool names. With
> these four, the agent gets `read_file`, `list_dir`, `write_file`, and `run_command`.
```json
{
  "version": "1.0",
  "members": [
    {
      "id": "solo-1",
      "name": "Full-Stack",
      "role": "senior-dev",
      "skill": "fullstack",
      "backend": "openai-compat",
      "model": "deepseek-v4-pro",
      "baseUrl": "https://www.unodetech.xyz/v1",
      "provider": { "providerId": "roam", "apiKeySecretName": "ROAM_API_KEY" },
      "systemPrompt": "You are a full-stack engineer working solo. Read the project, make the change, run the tests/build, read the output, and iterate until it passes. Be concise.",
      "allowedTools": ["read", "write", "search", "execute"]
    }
  ],
  "mcpServers": []
}
```
Then **Developer: Reload Window**. The Team panel should show one **Full-Stack** agent (no PM/Arch/Reviewer).
> Optional second run: repeat with `"model": "claude-..."` + `"backend": "claude"` to compare a stronger
> model (Claude uses its own auth; no key needed).

---

## Test tasks (run in the scratch folder, via Chat → Full-Stack)
Run at least T1 and T2.

- **T1 — greenfield + tests:** *"Create a TypeScript function `slugify(s)` in `src/slugify.ts` with a vitest
  test in `src/slugify.test.ts` covering spaces, punctuation, and unicode. Install vitest, run the tests,
  and fix until they pass."*
- **T2 — fix a failing build:** seed a file with a deliberate type error, then *"`npm run build` is failing.
  Find the error, fix it, and re-run until the build is clean."*
- **T3 (optional) — multi-file change:** *"Add an Express route `/health` returning `{status:'ok'}` and a
  test for it; run the test suite to green."*

---

## What to observe (fill the report)
For each task, note:
1. **Edits** — did it write the right files smoothly? (tool cards + diffs visible in chat?)
2. **Run loop** — did it actually run `npm/npx/...` and **react to the output** (errors → fix → re-run)? How
   many iterations? Did it reach green on its own?
3. **Speed/feel** — time to first action (is the "Thinking…" indicator working?), total time, did it stall?
4. **Trust/safety** — with no per-edit accept/reject, did it ever do something you'd have wanted to stop?
   Did the command allowlist block anything needed?
5. **Failures** — any 401/tool errors/refusals/hangs? Paste them.

## Report template (paste back)
```
Model used: __
Task T1: pass / partial / fail — iterations: __ — notes: __
Task T2: pass / partial / fail — iterations: __ — notes: __
Task T3 (opt): __
Edits smooth? __    Ran commands & self-fixed? __    Reached green unaided? __
Time-to-first-action / total: __
Missed a per-edit diff-approval? (yes/no + how badly) __
Allowlist friction (commands blocked that were needed)? __
Errors/logs: __
Overall: does a 1-agent team already feel "Cline-class"? (1–5) __
```

## Decision criteria → what we build next
- **If solo loop is strong (T1/T2 reach green unaided, edits smooth):** productize **minimal Solo mode** —
  one-click "Solo / Full-Stack" template + a guided "allow build/test commands?" prompt that sets
  `commandApproval`. Ship fast; defer @-context/checkpoints.
- **If "no diff approval" felt unsafe:** add **per-edit diff accept/reject** to Solo mode before promoting it.
- **If command friction dominated:** improve the command-approval UX (smart defaults / per-command prompt).
- **If the model flailed:** Solo mode should default to a stronger model tier; revisit the loop/prompts.

## Safety notes
- Run only in the scratch folder. Keep `commandApproval: "allowlist"` (not `all`).
- Review the allowlist; never allow shell-control chars (the policy already blocks `; & | > \` $()`).
