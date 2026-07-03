# TASK v0.8.2 — Kimi (RoamCrew): bug audit of the 0.8.2 change

**Owner:** Kimi (RoamCrew team). **Gatekeeper:** Claude verifies every finding before applying.
**Runs after** Claude has merged all of Phase 1 into one compiling branch (you audit the merged change,
not the half-built pieces — see [DEVPLAN_v0.8.2.md](DEVPLAN_v0.8.2.md) execution order).
**Type:** patch (0.8.2) — quality gate.

## What to audit

0.8.2 has two threads — audit **both**:

**Thread A — review board:** **per-lane changed-files + diffs**, **live refresh** (extension pushes
`WorktreePanel.update()` on coordinator events), and **Re-verify / Hand-back** on held/failing lanes.

**Thread B — member skills:** an agent catalog entry's `skills` are **mounted into the agent on Add**
(skill `body`s injected into the system prompt under `## Playbooks`); the dead Skills tab is removed;
member cards show "Includes: …". Plus newly authored skill **content**.

Source of truth for intended behavior:
- [TASK_v0.8.2_CODEX_review_board_phase2.md](TASK_v0.8.2_CODEX_review_board_phase2.md)
- [TASK_v0.8.2_DEEPSEEK_lane_diff_backend.md](TASK_v0.8.2_DEEPSEEK_lane_diff_backend.md)
- [TASK_v0.8.2_CODEX_member_skills_ui.md](TASK_v0.8.2_CODEX_member_skills_ui.md)
- [TASK_v0.8.2_DEEPSEEK_member_skills_backend.md](TASK_v0.8.2_DEEPSEEK_member_skills_backend.md)
- [DESIGN_member_skills.md](DESIGN_member_skills.md)

## Focus areas (highest-risk first)

1. **Re-verify safety:** does it honor the same command-approval gate as the merge path? An `ask`/
   non-allowed verify command must **skip**, never auto-run. (This exact bug bit us in 0.7.1.)
2. **Hand-back state machine:** lane correctly marked held; agent actually receives the instruction;
   no double-merge or race if the agent finishes while a re-verify is in flight; re-entrancy on the
   serialized merge chain.
3. **Live-refresh correctness:** emitter fires once per real change (no storms / infinite loops);
   debounced; no leaked subscriptions when the panel disposes; `update()` doesn't recreate the panel
   or drop user state (open `<details>`, scroll) egregiously.
4. **Diff extraction edge cases:** empty diff, binary files, renames, very large diffs (truncation),
   paths with spaces/unicode, CRLF. Must degrade gracefully, never throw into the webview.
5. **Webview security:** all lane/file/diff text stays `esc()`/`escAttr()`'d; CSP/nonce intact; no
   way for a filename/diff to inject markup.
6. **Disposal / lifecycle:** opening the panel twice, finalizing, then re-opening; coordinator events
   after panel disposed.

### Thread B — member skills
7. **Mount-on-Add injection:** skill bodies actually land in the agent's system prompt under
   `## Playbooks`; **idempotent** (no duplicate block on re-add/re-resolve); unknown skill id is
   skipped, never throws; injected length is bounded (doesn't blow the prompt).
8. **Schema/wiring:** every `skills` id in agents.json resolves to a real skills.json entry (no
   dangling ids); removing the Skills tab didn't break the catalog loader or MCP tab.
9. **Skill content quality/license:** each new skill maps to ≥1 member; bodies are actionable and
   match the schema; **no proprietary text copied** (must read as our own wording over a public
   standard); ids kebab-case and unique.

## Deliverable

A findings list. For each: **file:line**, what's wrong, why it matters, severity, and a concrete fix.
**Mark your confidence.** We've learned ~40% of audit findings across reviews are false positives —
so prefer fewer, verified findings over a long speculative list. Claude re-checks each against the
code before anything is applied; debunked items get recorded, not silently dropped.

## Constraints
- Code-level review only (no GUI). Don't edit the version/CHANGELOG; report, don't publish.
