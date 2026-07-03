# Design — Interactive command approval ('ask' mode), v0.2.8

> Modeled on Claude Code's permission prompt: **Yes (once) / Yes, allow for this project / No**.
> Goal: agents run commands directly; the first time an unrecognized command appears, the user
> approves it with a one-click "always allow" that whitelists it for next time. Owner: Claude
> (command-execution path is safety-critical). Authority: [STATUS.md](STATUS.md).

## UX (the prompt)
When an agent calls `run_command` and the command is NOT already allowlisted (mode = `ask`):
modal showing the exact command + 3 buttons:
- **Run** — execute once; do not remember.
- **Always allow `<prefix>`** — execute now **and** append the command's first token (e.g. `npm`,
  `pytest`) to `roam.allowedCommands` (workspace) + reload the live policy → future matching commands
  run silently. (This is the "yes, for this project" equivalent.)
- **Deny** — don't run; return a refusal string to the model so it adapts.

Already-allowlisted commands run silently (no prompt). Shell-control chars (`; | & > \` $( )`) stay
**blocked** even in ask mode (single commands only); a chained command can be Run-once but never
"always-allowed".

## Modes (`roam.commandApproval`)
- `none` (default, unchanged) — blocked; the guided "Enable Safe Commands" now switches to **`ask`**.
- `ask` (NEW, recommended) — interactive prompt + remember (this design).
- `allowlist` — silent for listed prefixes, blocked otherwise (current behavior).
- `all` — run anything (unchanged; power users).

## Architecture
- **CommandPolicy** (pure, no vscode): add `'ask'` to `CommandApprovalMode`. `check(command)` returns a
  verdict `'allow' | 'deny' | 'ask'` — `'ask'` when mode is `ask` and the command passes the
  shell-char safety but isn't allowlisted. Keep it pure/unit-tested.
- **WorkspaceTools.runCommand**: accept an injected
  `requestApproval?: (command) => Promise<'once' | 'always' | 'deny'>`. If `check` → `'ask'`, await it;
  `once`/`always` → run, `deny` → refuse. If no approver injected (e.g. tests), `'ask'` falls back to
  deny (safe).
- **extension.ts**: provide `requestApproval` that shows the modal; on **Always allow**, write the
  prefix into `roam.allowedCommands` + `commandPolicy.reload(...)` BEFORE resolving, then resolve.
  (Persistence/policy update lives in the extension; WorkspaceTools just runs.)
- **Chat UX**: while awaiting approval, show "Awaiting command approval…" in the transcript (the
  Thinking indicator pattern); clears on decision.
- **package.json**: add `ask` to the `commandApproval` enum + description.

## Acceptance
- mode `ask`: first `npm test` → prompt; "Always allow npm" → runs + later `npm run build` runs with no
  prompt. "Run" → runs once, next `npm` still prompts. "Deny" → not run, model gets refusal.
- allowlisted commands never prompt; shell-chained commands never auto-allow.
- Unit tests: CommandPolicy verdict table incl. `ask`; the prefix-extraction + allowlist-append helper
  (pure). e2e: a stubbed approver drives once/always/deny.

## Notes
- "Enable Safe Commands" guided prompt should set `commandApproval: "ask"` (not a fixed allowlist) so
  users get the Claude-Code-style incremental approval out of the box.
