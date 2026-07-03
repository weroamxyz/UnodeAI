# Codex Task Card — C4: Plan/Act mode (hard tool gating)

> Chat-Parity track, after C3 — the final C-task. Spec: [FeatureSpec_Chat_PlanAct_Mode.md](FeatureSpec_Chat_PlanAct_Mode.md) §C4.
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1.
> **Scope = C4 only.**

## Goal
A Plan/Act toggle in the sidebar chat. **Plan mode genuinely cannot write files or run commands** — enforced
at the tool layer, not by a prompt. Act mode = normal. Default Act.

## Why hard gating (not a prompt)
Weak models ignore "please don't edit" instructions. So Plan mode must **remove write/execute tools from
what the model is offered AND refuse them at execution** — the `[PLAN MODE]` prompt note is only
defense-in-depth. This makes a planning turn truly safe.

## Current-state anchors (verified)
- `WorkspaceTools.specs()` emits tools by capability: `read`→`read_file`/`list_dir`, `write`→`write_file`,
  `execute`→`run_command` (`WorkspaceTools.ts` ~line 37-64). Execution dispatch in `execute()` ~line 79-90.
- `OpenAICompatBackend.runTurn` assembles `toolSpecs` = WorkspaceTools + TeamTools (`list_agents`,
  `assign_task`, `broadcast`, `run_checks`) + MCP; `routeToolCall` dispatches (MCP → TeamTools → WorkspaceTools).
- `TurnAttachments` already carries `modelParams`/`projectContext` — add `mode` the same way.
- Chat send path: `ChatViewProvider` → `ChatViewDeps.send(agentId, text)` → `messageBus.send('user', agentId,
  'ask.question', {instruction})` → `SessionManager.deliverTurn` → `backend.sendUserTurn(text, attachments)`.
- Claude permission mode is a SPAWN arg (`--permission-mode`, `ClaudeHeadlessBackend.buildArgs` ~line 200).

## Subtasks

### C4.1 — Mode plumbing `[C]`
- `types.ts`: `export type ChatMode = 'plan' | 'act';` add `mode?: ChatMode` to `MessagePayload`.
- `AgentBackend.TurnAttachments`: add `mode?: ChatMode`.
- Chat send carries mode: `ChatViewDeps.send(agentId, text, mode)` → extension `messageBus.send('user',
  agentId, 'ask.question', { instruction: text, mode })`.
- `SessionManager.deliverTurn`: read `msg.payload.mode` → pass `attachments.mode` (default `'act'`).
- **Trust boundary:** enforcement is tool-layer (below), so even a forged `mode` can't bypass it; the webview
  just requests a mode.

### C4.2 — Hard gating in OpenAICompatBackend `[C]`
- New **pure** helper (e.g. `src/backend/planMode.ts`): `isToolAllowedInPlan(name: string): boolean` —
  allow read-only/inspection tools (`read_file`, `list_dir`, `list_agents`, and MCP read-ish? **no — can't
  classify MCP safely → deny MCP in plan**); deny `write_file`, `run_command`, `assign_task`, `broadcast`,
  `run_checks`. Unit-test the allow/deny table.
- `runTurn`: when `mode === 'plan'`, **filter `toolSpecs`** to the allowed set before calling chat/chatStream.
- `routeToolCall`: when `mode === 'plan'` and the tool is not allowed → **return a refusal string** (don't
  execute) e.g. `"[Plan mode] '<name>' is disabled — switch to Act mode to make changes."`. (Belt-and-
  suspenders: even if a spec leaks or the model hallucinates a call.)
- Track the current turn's mode on the backend (set in `runTurn` from attachments) so `routeToolCall` sees it.

### C4.3 — Plan system note (defense-in-depth) `[C]`
- When `mode === 'plan'`, prepend a short `[PLAN MODE] Discuss/analyze/plan only; do not edit files or run
  commands.` note to the turn text (in `composeUserText`/turn assembly). Secondary to C4.2 — not the mechanism.

### C4.4 — Claude backend (documented best-effort) `[C]`
- Claude's tools are native and its permission mode is a spawn arg, so per-turn Plan/Act can't be enforced on
  a running claude process. For v0.2.0: apply the C4.3 `[PLAN MODE]` note for claude turns and **document the
  limitation** (true claude plan mode = `--permission-mode plan` would require restart-on-mode-change; out of
  scope). Do NOT pretend it's hard-gated for claude.

### C4.5 — Plan/Act toggle UI `[C]`
- `ChatViewProvider`: a top-bar toggle (Plan = blue, Act = green); **default Act**; remember per-agent.
- Input placeholder reflects mode (`[PLAN] Discuss & plan…` / normal). Send includes the current mode.
- Pure mode-state handling where possible; UI via DOM (no innerHTML), CSP nonce.

## Constraints (non-negotiable)
- **Plan mode safety is the point** — verify by a tool-layer test (filtered specs + routeToolCall refusal),
  not just the prompt. Don't weaken existing CommandPolicy/sandbox/MCP gating; this is *additive*.
- English-only; DOM/escaping (no innerHTML); pure cores (`planMode.ts`) unit-tested.
- One branch for C4; `build`/`lint`/`test` green before merge; update `docs/CODEX_V0.2.0_COMPLETION_LOG.md`.

## Out of scope
Diff approval; claude native plan via restart; auto-switching modes.

## Acceptance
- Toggle Plan → the model is offered only read/inspection tools; a forced `write_file`/`run_command` is
  refused at `routeToolCall` (proven by a unit test), not merely discouraged.
- Toggle Act → write/run available again; normal behavior.
- `[PLAN MODE]` note present on plan turns; claude limitation documented.
- `planMode.ts` allow/deny table unit-tested; gates green; UI toggle works (blue/green, per-agent, placeholder).

## Review
Bring C4 to Claude at the boundary: build/lint/test counts + e2e, and a note confirming the tool-layer test
proves write/run are blocked in Plan mode (not just the prompt). This completes the Chat-Parity track (C1–C4).
