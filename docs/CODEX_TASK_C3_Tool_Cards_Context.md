# Codex Task Card — C3: Tool/Action Cards + C3b: Context bar & Compaction marker

> Chat-Parity track, after C2. Spec: [FeatureSpec_Chat_PlanAct_Mode.md](FeatureSpec_Chat_PlanAct_Mode.md) §C3 + §C3b.
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1.
> **Scope = C3 + C3b only.** No Plan/Act (C4), no diff **approval** (visibility only).

## Goal
Make the sidebar chat show *what the agent is doing*, Cline-style: inline **tool/action cards** (Read /
Edit+diff / Run+output / MCP) and a header **context-usage bar** + a **🗜 compacted** marker. Visibility
only — keep the existing CommandPolicy/sandbox/MCP gating underneath.

## Current-state anchors (verified)
- Tool calls: `runTurn` emits `{kind:'tool_use', name, input}` (~line 275) then `routeToolCall` returns the
  output string and pushes it to history — **the result is NOT emitted as an event** (only goes to the
  OutputChannel via SessionManager's `session.output "[tool: name]"`).
- `WorkspaceTools` tools: `read_file`, `list_dir`, `write_file` (create/overwrite — **no diff today**),
  `run_command` (`src/backend/WorkspaceTools.ts`). MCP tools route via `this.mcp.hub` with `server__tool` names.
- `TurnResult` = `{ text, isError, usage? }` (`AgentBackend.ts`). E1 `compactHistory` currently emits a
  `{kind:'log'}` line when it compacts (`OpenAICompatBackend.compactHistory`).
- Chat view is C1's `ChatViewProvider` (token-model→DOM, no innerHTML); C2 added live `assistant_delta`
  streaming + the `session.stream` channel — follow the same plumbing pattern.

## C3 — Tool/action cards

### C3.1 — Emit tool results (+ diff for edits) `[C]`
- `AgentBackend`: add `{kind:'tool_result'; name:string; ok:boolean; summary:string; detail?:string; diff?:string}`.
- `OpenAICompatBackend.runTurn`: after `const out = await routeToolCall(...)`, emit a `tool_result` —
  `ok` = not an error string, `summary` = short (e.g. `read_file foo.ts (1.2 KB)`), `detail` = the output
  (capped, e.g. 4 KB). Keep pushing `out` to history unchanged.
- **Edit diff:** make `WorkspaceTools.writeFile` capture the prior file content (read-before-write; empty if
  new) and expose old/new so the backend can emit a `diff`. New **pure** `src/backend/diff.ts` (a minimal
  line/unified diff) + unit tests. If a file is huge, cap the diff and fall back to `summary` only.
- MCP/run/read/list: `summary` + collapsible `detail`; no diff.

### C3.2 — Plumb tool events to the chat `[C]`
- `SessionManager.onBackendEvent`: forward `tool_use` and `tool_result` to a new typed `session.tool`
  event (`SessionEventData`) carrying `{ phase:'use'|'result', name, input?, ok?, summary?, detail?, diff? }`.
  (Keep the existing `session.output "[tool:…]"` OutputChannel line too — it's the raw log.)
- `extension.ts`: forward `session.tool` to `chatViewProvider.appendToolActivity(agentId, …)`.

### C3.3 — Render tool cards in the chat `[C]`
- `ChatViewProvider`: a **tool-card element** appended to the active agent's transcript in arrival order
  (interleaved with the live assistant message from C2). Icons: `📖 Read <path>`, `✏ Edit <path>`,
  `▶ Run <cmd>`, `🔌 <server__tool>`. `<details>`-style collapsible body shows `detail`/`diff`.
  `tool_use` creates the card (pending); `tool_result` fills it (ok/❌ + body).
- **All text (paths, args, diff, output) via `textContent`/escaping — NO innerHTML.** Diffs are data.
- Persistence: tool cards are **live turn activity** — do NOT store them in the 50-cap per-agent history
  (would bloat it with diffs/output). Restored transcripts show user+agent messages only. (Document this.)

## C3b — Surface context window + auto-compaction (integration with F1b + E1)

> Model-side already integrates (chat runs through the backend, so F1b window + E1 compaction apply). C3b
> only DISPLAYS it — do not re-implement compaction.

### C3b.1 — Context-usage bar `[C]`
- `TurnResult`: add optional `context?: { tokens:number; window:number; ratio:number }`. `OpenAICompatBackend`
  fills it after the turn from `tokenCounter` (`estimateMessages(history)` + window). Claude leaves it
  undefined.
- `SessionManager`: on `turn_complete`, forward `result.context` to `chatViewProvider.setContext(agentId, ctx)`.
- `ChatViewProvider`: a slim header bar / `N% of <window>` for the selected agent; **claude agents show
  "context managed by Claude"** (don't fake a number). Pure ratio→label formatting, unit-tested.

### C3b.2 — Compaction marker `[C]`
- `OpenAICompatBackend.compactHistory`: in addition to the log line, emit a structured
  `{kind:'compacted'; dropped:number; model:string}` (add to `BackendEvent`).
- `SessionManager`: forward as part of `session.tool`/a `session.compacted` event → chat inserts an inline
  system marker `🗜 Context compacted (N older turns summarized)` in the active agent's transcript.

## Constraints (non-negotiable)
- Webview: cards/markers/diffs rendered via DOM + escaping — **no innerHTML**; CSP nonce.
- Visibility only — **no approval/reject UI**; don't change CommandPolicy/sandbox/MCP gating.
- English-only; pure cores (`diff.ts`, context-label, summary builders) unit-tested.
- One branch for C3; `build`/`lint`/`test` green before merge; update `docs/CODEX_V0.2.0_COMPLETION_LOG.md`.

## Out of scope
Plan/Act (C4); diff approve/reject; editing files from the card; checkpoints.

## Acceptance
- A turn that reads/edits/runs shows inline cards in order; Edit shows a collapsible diff; Run shows
  collapsible output; MCP calls show server__tool + result. All escaped (an output with `<script>` is inert).
- Header context bar rises during a long session for openai-compat agents; claude shows "managed by Claude".
- When E1 compacts, a `🗜 Context compacted` marker appears in the chat.
- `diff.ts` + context-label + summary builders have unit tests; gates green.

## Review
Bring C3 to Claude at the boundary: build/lint/test counts + e2e; flag any card-vs-code divergence.
