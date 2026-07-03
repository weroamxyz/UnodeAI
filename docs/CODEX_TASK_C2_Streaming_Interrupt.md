# Codex Task Card — C2: Streaming output + Interrupt

> Chat-Parity track, after C1 (merged). Spec: [FeatureSpec_Chat_PlanAct_Mode.md](FeatureSpec_Chat_PlanAct_Mode.md) §C2.
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1.
> **Scope = C2 only.** No tool-action cards (C3/C3b), no Plan/Act (C4).

## Goal
Typewriter streaming for the sidebar chat (OpenAI-compatible backend) + the ability to **Stop** an
in-flight turn. Builds on C1's `ChatViewProvider`.

## ⚠️ Correction to the spec's wording (read first)
The FeatureSpec says "stream only the final no-tool-call answer turn." **That's not implementable as
written** — `runTurn` calls `chat()` in a loop and the model decides *per call* whether it returns
`tool_calls` or a final answer; you can't know which call is "final" in advance (see
`OpenAICompatBackend.runTurn`, ~line 240-279). So the real design:

**Stream every chat() call. Parse the SSE stream into (a) live content deltas (sent to the UI) and (b) a
reconstructed full message (content + tool_calls + usage) that the loop uses exactly as today.** Content
deltas stream to the chat; if the reconstructed message has `tool_calls`, the loop continues unchanged.

## Current-state anchors (verified)
- `FetchFn` returns `{ ok, status, text() }` only (no stream body) — `OpenAICompatBackend.ts` ~line 35.
- `chat()` builds the body with `stream:false` and parses one JSON (~line 365-402); `requestWithRetry` /
  `fetchOnce` already use an `AbortController` for per-attempt timeout (~line 451-453) — reuse that pattern.
- `runTurn` loop emits `{kind:'assistant', text}` once per call with full content (~line 263-266).
- Events: `BackendEvent` union in `AgentBackend.ts` (~line 17-24); `SessionManager.onBackendEvent` maps
  them (assistant→`session.output`; turn_complete→bus `task.complete`).
- Chat replies reach the view via `ChatViewProvider.onReply` (bus `task.complete`). Streaming needs a NEW
  live channel in addition to that final reply.

## Subtasks

### C2.1 — Streaming fetch + SSE parser (pure) `[C]`
- Add a **separate injected streaming fetch** (don't change the existing `FetchFn` text() contract — keep it
  + its tests). E.g. `StreamFetchFn = (url, init) => Promise<AsyncIterable<Uint8Array>|ReadableStream>`;
  default impl uses global `fetch` + `response.body`. Inject like `fetchFn` (constructor/opts) so tests can
  feed scripted SSE.
- New **pure** `src/backend/sseParser.ts`: feed chunks → yields parsed `data:` JSON objects (handles
  multi-line buffering, `[DONE]`). Unit-test it (split mid-line, multiple events per chunk, `[DONE]`).
- A pure **delta reconstructor**: fold OpenAI streaming deltas into a full message — concatenate
  `choices[0].delta.content`, and merge `choices[0].delta.tool_calls[]` **by `index`** (append
  `function.arguments` strings, set `id`/`name` when present); capture `usage` if the final chunk carries it.
  Unit-test (content-only stream; interleaved tool_call deltas across chunks).

### C2.2 — `chatStream()` in OpenAICompatBackend `[C]`
- New `chatStream(tools)` mirroring `chat()` but `stream:true` (+ `stream_options:{include_usage:true}` when
  supported): call the streaming fetch, run chunks through the SSE parser + reconstructor, and **emit
  `{kind:'assistant_delta', delta}`** for each content delta. Return the reconstructed
  `{choices:[{message}], usage}` so `runTurn` is otherwise unchanged.
- `runTurn`: use `chatStream` when a streaming fetch is available, else fall back to `chat()`. Keep the
  existing `{kind:'assistant', text}` emit on completion (final text) so non-chat consumers/onReply still work.
- **Usage fallback:** if the stream omits usage, estimate output tokens via `TokenCounter.estimateTokens`.
- **Retry/robustness:** if the stream fails *before any delta* → fall back to non-streaming `chat()` (which
  has retry). A mid-stream failure ends the turn as error (no mid-stream retry). Don't hang.

### C2.3 — Event plumbing to the chat view `[C]`
- `AgentBackend`: add `{kind:'assistant_delta'; delta:string}` to `BackendEvent`.
- `SessionManager.onBackendEvent`: on `assistant_delta` → fire a new `session.stream` typed event
  `{ delta: string }` (add to `SessionEventData`). Don't touch the `turn_complete`→`task.complete` path.
- `extension.ts`: forward `session.stream` to `chatViewProvider.appendDelta(agentId, delta)`.
- `ChatViewProvider`: maintain a **live in-progress agent message** per agent; `appendDelta` grows it as a
  **plain text node** (no innerHTML). On the final `onReply` (`task.complete`), **finalize**: replace the live
  message text with the authoritative final text and **re-render it through C1's markdown** token model.
  (Streaming shows plain text growing → snaps to rich markdown when done.)

### C2.4 — Interrupt / Stop `[C]`
- `AgentBackend`: add optional `abort?(): void`.
- `OpenAICompatBackend`: hold the **current turn's** `AbortController`; `abort()` aborts the in-flight
  (stream) request and sets a cancel flag the `runTurn` loop checks → break → emit `turn_complete` with an
  `isError`/cancelled result text like "[Stopped by user]". Ensure `busy`/queue state resets so the next
  turn works.
- `ClaudeHeadlessBackend`: `abort()` is **best-effort** for v0.2.0 — document the limitation (claude is a
  persistent process; a clean per-turn cancel isn't available). Acceptable to no-op or end the current turn
  marker; do NOT kill the process. Note it.
- `SessionManager.interrupt(agentId)` → `backend.abort?.()`; command/path so the view can call it.
- `ChatViewProvider`: while a turn is running, **Send becomes ■ Stop**; clicking posts `{command:'interrupt',
  agentId}` → extension → `sessionManager.interrupt`. Re-enable Send on `turn_complete`/stream end.

## Constraints (non-negotiable)
- Webview: deltas appended as **text nodes**; final render via the C1 markdown token model — **no innerHTML**.
- Tool-loop turns must remain correct (reconstructed tool_calls drive the loop as before).
- English-only; CSP nonce; no security-model change. Pure cores (`sseParser`, reconstructor) unit-tested.
- One branch for C2; `build`/`lint`/`test` green before merge; update `docs/CODEX_V0.2.0_COMPLETION_LOG.md`.

## Out of scope
Tool-action cards / diffs (C3), context bar / compaction marker (C3b), Plan/Act (C4), diff approval.

## Acceptance
- An openai-compat reply streams token-by-token in the sidebar chat, then settles into rendered markdown.
- A turn with tool calls still works (loop unaffected); tool calls are not broken by streaming.
- Stop cancels an in-flight openai-compat turn (chat shows "Stopped"; next message works).
- `sseParser` + delta reconstructor have unit tests (incl. interleaved tool_call deltas + `[DONE]`).
- claude streaming/interrupt limitation documented.

## Review
Bring C2 to Claude at the boundary: build/lint/test counts + e2e, and flag anything where the code differed
from this card (as you correctly would).
