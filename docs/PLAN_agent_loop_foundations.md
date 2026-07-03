# Plan — Agent-Loop Foundations (from DeepSeek session handoff, Claude-prioritized)

> Source: `.roam/session-handoff.md` (2026-06-07 PM-agent session). Claude reviewed + prioritized.
> Authority for now/next: [STATUS.md](STATUS.md). Roadmap: [ROADMAP_v0.3_v0.4.md](ROADMAP_v0.3_v0.4.md).

## Key reframing
The handoff's top pains (file truncation, no command execution, no messaging) aren't just multi-agent
problems — **they cripple a single agent too**, so they also block the Solo-mode validation. Fix the
**foundation** first; it unblocks both Team mode and Solo mode (and the SOLO_MODE_VALIDATION runbook).

## Priorities

### P0 — foundation (do first; blocks everything, incl. Solo validation)

**F1. `read_file` truncates at 16 KB → agents can't read/edit real files.** (confirmed)
- Cause: `WorkspaceTools.ts` `MAX_OUTPUT = 16000` is shared by `read_file` AND command output via
  `truncate()`. A 16 KB cap means files like `ChatViewProvider.ts` come back truncated → edits fail.
- Fix:
  1. Give `read_file` its **own** large cap (e.g. 100 KB+), separate from command-output truncation
     (keep command output at ~16 KB).
  2. Add **pagination** to `read_file`: optional `offset`/`limit` (or `startLine`/`endLine`) params so an
     agent can page through very large files deterministically; include a "showing lines X–Y of Z / N
     bytes; call again with offset=…" footer when truncated.
  3. Keep returning a clear truncation notice so the model knows to paginate (don't silently cut).
- Files: `src/backend/WorkspaceTools.ts` (readFile + specs schema for the new params), unit tests.
- Acceptance: a >16 KB file is fully readable via one large read or paged reads; a unit test covers the
  pagination math + truncation notice.

**F2. `run_command` is off by default → agents can't run build/test.** (confirmed; same as Solo finding)
- Cause: `roam.commandApproval` defaults to `"none"`. Agents have the `execute`/`run_command` tool but the
  policy blocks it.
- Fix (UX, not safety-weakening): a **guided enable** — when an agent first needs to run a command (or at
  team/solo creation), prompt "Allow build/test commands for this workspace?" → set
  `commandApproval: "allowlist"` + seed safe prefixes (`npm npx node git python pytest pnpm yarn`). Keep
  `allowlist` (never silently `all`). This is shared with Solo mode's "guided command approval".
- Files: `src/extension.ts` (prompt + write config), maybe a small helper; document in README.
- Acceptance: from a fresh workspace, a few clicks gives an agent working build/test execution; default
  stays safe (no auto-`all`).

### P1 — team collaboration + UX

**F3. Bug #2 — no inter-agent messaging (non-PM agents can't proactively message).**
- DeepSeek's design is sound: add a `send_message` tool wired to `MessageBus.send()`, grant a new
  `message` capability token to all roles. Scope it (an agent messages the PM or a named teammate; not a
  broadcast free-for-all). Keep PM as the coordinator.
- Files: `src/backend/` (new messaging tool or extend TeamTools), `src/roles/RoleConfig.ts` +
  `SkillResolver.ts` (capability token), tests.
- Note: only matters for **Team** mode. If Solo mode is the near-term focus, F3 ranks below F1/F2.

**F4. Bug #3 — chat input freezes while the PM is delegating.** (undiagnosed)
- Investigate: is it the webview `input.disabled = running` logic (input disabled for the whole PM run), or
  the extension host blocking on `assign_task`'s awaited delegation? Likely the former — the composer is
  disabled while the selected agent is "running", which for a long PM orchestration locks the user out.
- Fix direction: don't hard-disable input during a run; allow queueing/interrupt (we have a Stop path).
- Files: `src/views/ChatViewProvider.ts`, `src/backend/TeamTools.ts`.

**F5. Bug #1 — chat layout + render (DeepSeek Fix A/B, uncommitted in working tree).** Claude review:
- **Fix A** (`.msg/.tool-card/.marker { flex-shrink: 0 }`): correct layout fix — keep.
- **Fix B** (incremental DOM via `renderedCount`): compiles, preserves the Thinking indicator, and fixes a
  real issue (a `state` update mid-stream used to `replaceChildren` and clobber the live bubble). BUT the
  `renderedCount` approach assumes **append-only** messages; compaction markers / history-trim can desync
  it (wrong/duplicate render). **Before commit:** add an E2E/manual check covering (a) streaming a reply,
  (b) a tool card mid-turn, (c) a compaction marker, (d) switching agents and back. If desync shows, prefer
  a simpler fix: keep the full rebuild but **preserve the live bubble** across state renders.
- Also: move/remove `tools/*.js` (one-off regex scripts) — do not ship them in the VSIX.

### P2
- **F6. `roam.verifyCommand` unset** → `run_checks` has nothing to run. Document it / prompt to set it
  (e.g. `npm run build` or `npx tsc --noEmit`) as part of F2's guided setup.
- **F7. Parallel dispatch** (PM fans out independent tasks) — already a v0.4 epic in the roadmap; not now.

## Execution order — DECIDED: Team mode first, then Solo (user, 2026-06-07)
0. **F5 Bug #1** — ✅ DONE (`655eae3`): Fix A (flex-shrink) landed; Fix B rejected (renderedCount
   desyncs at the 50-msg history cap); `tools/` git/VSIX-ignored.
1. **F1 read_file pagination/limit** — biggest single unblock; agents currently can't even read a
   >16 KB file (they failed to edit ChatViewProvider.ts). Cripples Team work most.
2. **F2 guided command execution** — agents can run build/test (Team + Solo).
3. **F3 inter-agent messaging** — non-PM agents can report to PM proactively (core to "team works smoothly").
4. **F4 chat input freeze** — user not locked out while the PM orchestrates.
5. **F6 verifyCommand** — `run_checks` actually runs (fold into F2's guided setup).
6. → THEN **Solo**: re-run [SOLO_MODE_VALIDATION.md](SOLO_MODE_VALIDATION.md) (now meaningful with F1/F2),
   then build the minimal Solo mode.

## F8 (observed 2026-06-08) — lazy-start first turn sometimes returns empty 🟡
Symptom: assigning a task to a **stopped** agent (e.g. Reviewer) returned empty output on the 1st (and
sometimes 2nd) attempt, then worked on the 3rd. The design already queues + lazy-starts + flushes the
inbox on `ready` (SessionManager routeInbound + `case 'ready'` → `flushInbox`), so first-try SHOULD work.
Hypothesis: a startup race between `ready` and the first delivered turn (or the very first turn after a
fresh backend start producing empty). Needs a reproduction with the UnodeAi + agent-channel logs to
pin down before fixing. Reviewer itself is healthy now. Priority P1 for Team-mode reliability.
(architect/senior-dev showing `stopped` until first assigned is BY DESIGN — PM lazy-starts them.)

## Process (this cycle)
- **DeepSeek Pro** (running inside the UnodeAi extension) implements, per this plan.
- **Claude** = overall direction + gatekeeping (reviews each fix at the boundary: gates green, sound design,
  no regressions) + final release (bump/CHANGELOG/package:bundle/smoke/publish/tag).
- Same DoD as the C/E tracks: pure-where-possible + unit test; compile/lint/test/e2e green before merge.

> Each fix: pure-where-possible + unit test, `compile`/`lint`/`test`/`e2e` green, Claude reviews the
> boundary before commit/merge (same flow as the C/E tracks).
