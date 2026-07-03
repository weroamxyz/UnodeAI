# TASK — v0.5.5 · Proactive workspace context injection (Cline #2) + Solo audit (#4)

**Reviewer**: Claude · **Target**: v0.5.5
**Split**: host-side gather → Codex · backend injection point → DeepSeek/Kimi · token-cost measurement → RoamClaw.
**Goal**: stop agents starting each turn "blind." Inject the active editor file + workspace diagnostics at turn start so the agent doesn't burn tool calls just to orient. This is the biggest net-new UX win of the five Cline-parity points.

> ⚠️ Grounded against real plumbing. There is already a per-turn context channel — **reuse it, don't invent one.**

---

## What already exists (reuse these)

- Per-turn project memory is injected via `TurnAttachments.projectContext` → `refreshProjectContext()` ([OpenAICompatBackend.ts:718](../src/backend/OpenAICompatBackend.ts#L718)). This is the model for "host gathers text, backend folds it into the system message each turn."
- A diagnostics callback already exists (used post-write): `DiagnosticsCollector` / `FileDiagnostic` ([imported at :26](../src/backend/OpenAICompatBackend.ts#L26)). The same VS Code diagnostics API the host uses there gives workspace-wide errors here.

## The one real constraint: token budget

Injecting the whole active file every turn is the obvious failure mode (cost + context bloat + pushes real history out). So:
- **Cap hard**: active file → head/most-relevant slice, capped (e.g. ≤ ~150 lines / a fixed token ceiling); if larger, inject a truncated head + a note "(file truncated — use read_file for the rest)".
- **Diagnostics → errors/warnings only**, capped count, formatted compactly (reuse `formatPostWriteDiagnostics` style).
- **Opt-in setting** `roam.engine.workspaceContext` (default **off** for the first ship; flip on after RoamClaw measures real token delta).
- Don't persist it into history — inject ephemerally each turn (like the XML tool guide via `withSystemGuide`, or like `refreshProjectContext` replacing a block), so stale file content can't accumulate.

---

## Changes

### Host side (Codex) — gather, don't decide
Where turns are dispatched (the path that builds `TurnAttachments` / calls `sendUserTurn`), assemble a bounded "workspace orientation" string when `roam.engine.workspaceContext` is on:
- Active editor: `vscode.window.activeTextEditor` → relative path + capped content slice.
- Diagnostics: `vscode.languages.getDiagnostics()` → filter Error/Warning, cap, compact-format.
- (Optional, phase 2) last N checkpoint entries if cheap to read.
Pass it on `TurnAttachments` as a new field, e.g. `workspaceContext?: string` — mirror how `projectContext` is plumbed (grep `projectContext` in [SessionManager.ts](../src/session/SessionManager.ts) and [AgentBackend.ts:115-124](../src/backend/AgentBackend.ts#L115-L124)).

### Backend side (DeepSeek) — inject at turn start
- Add `workspaceContext?: string` to `TurnAttachments` ([AgentBackend.ts:115](../src/backend/AgentBackend.ts#L115)).
- In `runTurn` setup (alongside `refreshProjectContext(attachments?.projectContext ?? '')` at [line 341](../src/backend/OpenAICompatBackend.ts#L341)), fold the workspace context into the system message **ephemerally** under a clearly delimited block, e.g. `[Workspace state — current file & diagnostics, may be stale]`. Empty/absent → inject nothing (no behavior change when off).
- Token-cap enforced backend-side too as a backstop (don't trust the host to have capped).

### Solo audit (#4) — confirm, likely no-op
Per the落地评估 table, Solo already has `team=undefined`, `NoopFileCoordinator`, a solo-only prompt. Just verify nothing team-shaped leaks into a Solo turn's tool list or system prompt. If clean (expected), close with a one-line note in the PR. If something leaks, strip it. **Do not** build a new "lightweight Solo backend" — the lightweight path already exists.

---

## Tests
1. **Off by default** → turn body identical to today (no workspace block injected).
2. **On, with active file + diagnostics** → system message contains the capped file slice and the error/warning summary; large file is truncated with the read_file note.
3. **Cap enforced backend-side** → an over-budget host string is still truncated by the backend backstop.
4. **Solo audit** → a Solo turn's advertised tools contain no `assign_task`/`broadcast`/team tools (assertion guard, cheap regression).

## RoamClaw measurement (gate the default-on flip)
Run a few real `ux-scratch` tasks with the flag on vs off; report median extra input tokens/turn and whether "orientation" tool calls (read_file just to look) dropped. The flag flips to default-on only if the token cost is worth the saved turns. Write to `docs/R3_CONTEXT_INJECTION.md`.

## Definition of Done
- [ ] `workspaceContext` plumbed host→attachments→backend, mirroring `projectContext`.
- [ ] Bounded (host + backend backstop), ephemeral (not persisted to history), opt-in (default off).
- [ ] Solo audit done (note or fix).
- [ ] 4 tests + `npm test` + `npm run build` green.
- [ ] RoamClaw token-cost report decides the default-on flip.
