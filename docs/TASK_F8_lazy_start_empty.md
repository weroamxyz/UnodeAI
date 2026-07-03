# Task F8 — Fix lazy-start first-turn (intermittent) empty response

**Priority: P1 (Team-mode reliability).** Diagnosis-first task: reproduce + locate before
changing anything. Do NOT blind-fix.

Owner: DeepSeek (implement) · Claude (boundary review + merge + release).
Status: assigned 2026-06-08. See also the symptom note in
[PLAN_agent_loop_foundations.md](PLAN_agent_loop_foundations.md) (F8 section).

## Symptom
Assigning a task to a **stopped** agent (e.g. the default team's Reviewer) returns an empty reply
on the 1st (sometimes 2nd) attempt, then works on the 3rd.

## Already verified by Claude (do not redo)
The lazy-start / inbox queue path is sound — the bug is most likely NOT here:

- `src/session/SessionManager.ts`
  - `routeInbound()` (≈L352): when the agent isn't idle it **pushes to the inbox (L375-377)
    BEFORE calling `start()` (L378-382)** — the message can't be lost.
  - `start()` (≈L200): the listener `backend.onEvent(...)` (L210) is registered **before**
    `await backend.start()` (L221) — so the synchronously-emitted `ready` is **not missed**.
  - `onBackendEvent` `case 'ready'` (≈L514) → `flushInbox()` (≈L451) → `deliverTurn()` →
    `backend.sendUserTurn()`. Chain is complete.
- `src/backend/OpenAICompatBackend.ts`
  - `start()` emits `ready` synchronously at L191; `sendUserTurn()` (L227) guards on `!this.alive`;
    `drain()` (L257) → `runTurn()` (L281) → `chatStream()` (L510).

**Most likely root causes (by probability):**
1. Gateway/model **cold-start returns empty content** (first request is 200 but
   `choices[0].message.content` is empty/null with no tool_calls); a retry succeeds — matches
   "works on the 3rd try".
2. First response carries **only `reasoning_content` or only tool_calls, no body**, so the final
   `result.text` ends up empty.
3. (Minor) when `turn_complete`'s `result.text` is empty, the upper layer treats empty as a normal
   completion.

## Phase A — Reproduce + locate (do this first; bring evidence)
Add **temporary, timestamped diagnostic logging** (no behavior change) to the agent channel/console:

1. `SessionManager.deliverTurn()`: on entry log `sessionId, status, instruction.slice(0,40)`.
2. `SessionManager` `case 'ready'` and `case 'turn_complete'`: log the trigger + inbox length
   before/after `flushInbox`.
3. `OpenAICompatBackend.runTurn()` after the first API response: log
   - HTTP status, whether streaming was used, `finish_reason`
   - `content` length, presence of `tool_calls`, presence of `reasoning_content`
   - final `result.text` length, `result.isError`
4. Repro recipe: default team, **stop the Reviewer**, assign a simple task
   ("summarize this repo in one line") **3 times in a row**; paste the logs from all three.

**Deliverable:** the three attempts' logs side by side, pinpointing which layer produces the empty:
API returns empty (cause 1/2) vs. delivery never happens (cause 3 / a race Claude missed).

## Phase B — Fix per root cause
- **Cause 1/2 (empty first API response):** add a **single automatic retry for an empty-but-not-error
  first response** (only when `content` is empty, no tool_calls, no error; at most 1 retry; the retry
  must respect `cancelRequested` and must NOT stack with the existing retry into many attempts).
  Do **not** swallow network errors.
- **Cause 3 (empty treated as success):** make an empty completion **visible** to the user
  (placeholder reply, or mark `isError` so the upper layer handles it) instead of a silent empty.
- **If Phase A reveals a race Claude missed:** post the evidence; we agree on the approach first.

## Definition of Done (same as C/E tracks)
- Pure-where-possible + **unit tests** (key: empty first response retries once then succeeds; a normal
  response does NOT retry; a cancelled turn does NOT retry).
- `npm run compile` / `lint` / `test` / `test:e2e` all green.
- **Remove the temporary diagnostic logs before delivery** (or drop them to debug level) — no debug
  logging left on the production path.
- Don't touch the release flow; Claude reviews the boundary, merges, and releases.

## Hard constraints
- Don't change delivery semantics or the concurrency cap beyond this fix; don't touch the
  `pendingOrigin` single-slot logic.
- Secrets never in logs (**never print ROAM_API_KEY**).
- Don't edit `SessionManager.ts` / `OpenAICompatBackend.ts` concurrently with other tasks
  (serialize — avoid another collision).

## Handback
Send back the **three Phase A logs** with the delivery — Claude reviews the evidence before approving
the Phase B fix.
