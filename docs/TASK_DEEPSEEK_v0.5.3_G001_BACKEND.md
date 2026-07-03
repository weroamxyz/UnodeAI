# TASK — DeepSeek/Kimi · v0.5.3 G-001 Backend: `interject()`

**Owner**: DeepSeek/Kimi · **Reviewer**: Claude · **Target**: v0.5.3
**One job**: let a user push a mid-task message into a *running* turn so the agent re-plans on the next step. Backend only.

> ⚠️ Read this whole card before writing code. Every type/method named here is **real** — verified against the current source. Do not invent events, methods, or a mutex. If something here doesn't match the code you see, STOP and ask Claude — do not guess.

---

## Scope (and what is NOT in scope)

- ✅ One new optional method `interject(text)` on the backend, plus the minimal loop change to consume it.
- ✅ **One** message kind. No `instruction` vs `observation` split — both are just a user message. Drop the two-mode idea.
- ❌ No `AsyncMutex`, no locks. This is a **single-threaded** Node event loop (`sendUserTurn → drain → runTurn`, see [OpenAICompatBackend.ts:272-335](../src/backend/OpenAICompatBackend.ts#L272-L335)). An array `push`/`shift` cannot race. If you add a mutex the PR will be rejected.
- ❌ No new `BackendEvent` kinds. The union is fixed: `ready, assistant_delta, reasoning_delta, assistant, tool_use, tool_result, compacted, turn_complete, log, error, exit` ([AgentBackend.ts:17-28](../src/backend/AgentBackend.ts#L17-L28)). Use `log` for diagnostics, `assistant` for visible text. There is no `kind: 'message'`.
- ❌ No fallback-model / circuit-breaker work — that's a separate post-R2 PR (C3), not this one.

---

## The one decision, already made: **wait, don't pre-empt**

When `interject()` is called, the loop is almost always parked on `await this.chat()` ([line 397](../src/backend/OpenAICompatBackend.ts#L397)). For v1 we **do not** abort the in-flight request. The queued text is consumed at the **top of the next loop iteration**, after the current model response and its tool calls have completed. Latency = up to one tool round-trip. That is acceptable and simple. Do not try to interrupt the in-flight `fetch`.

## The invariant you must not break

The tool-call loop appends a tool result for **every** requested call within the same iteration ([lines 490-566](../src/backend/OpenAICompatBackend.ts#L490-L566)). The OpenAI wire format requires that once an assistant message carries `tool_calls`, **each** is answered by a `tool` message **before any `user` message**, or the gateway 400s.

➡️ **Therefore inject the user message ONLY at the top of the iteration loop** (and in the no-tools `continue` path described below). Never inject between/inside tool execution. The top-of-loop point is safe precisely because the previous iteration already answered all tool calls.

---

## Changes

### 1. Interface — [AgentBackend.ts](../src/backend/AgentBackend.ts)

Add one optional method next to `abort?()`:

```ts
/** Queue a user message into the CURRENTLY RUNNING turn (G-001 mid-run steering).
 *  No-op (logged) if the agent is idle. Optional per backend. */
interject?(text: string): void;
```

`ClaudeHeadlessBackend`: do **not** implement it (leave the optional method absent). SessionManager already guards with `?.` — see §4. That's the correct "stub": absence, not a fake body.

### 2. State + method — [OpenAICompatBackend.ts](../src/backend/OpenAICompatBackend.ts)

Add a field beside `queue` (line ~130):

```ts
/** G-001: user messages to fold into the running turn at the next safe point. */
private interjections: string[] = [];
```

Add the method (sync `void`, mirrors `abort()` at [line 290](../src/backend/OpenAICompatBackend.ts#L290) — not async):

```ts
interject(text: string): void {
  const t = (text ?? '').trim();
  if (!t) return;
  if (!this.busy) {                       // nothing running → nothing to steer
    this.emit({ kind: 'log', stream: 'stderr', line: 'interject ignored: agent is idle.' });
    return;
  }
  this.interjections.push(t);
  this.emit({ kind: 'log', stream: 'stderr', line: `interjection queued (${this.interjections.length} pending).` });
}
```

### 3. Consume in the loop — `runTurn()` [around line 379](../src/backend/OpenAICompatBackend.ts#L379)

**3a.** At the very top of the `for` iteration, right after the `cancelRequested` check ([line 380](../src/backend/OpenAICompatBackend.ts#L380)) and before the context gate, drain **all** queued interjections into history as user messages:

```ts
while (this.interjections.length > 0) {
  const text = this.interjections.shift()!;
  this.history.push({ role: 'user', content: `[User interjected mid-task] ${text}` });
  this.emit({ kind: 'assistant', text: `↩ steering: ${text}` }); // visible echo in transcript
}
```

**3b.** In the "no tools requested → turn is done" branch, *before* the final `break` ([line 486](../src/backend/OpenAICompatBackend.ts#L486)), keep the turn alive if a steer arrived during the last `chat()`:

```ts
if (this.interjections.length > 0) continue; // fold the steer in on the next iteration instead of ending
```

Place this so it also runs after the announce/verify nudges have been considered — it only needs to win over the plain `break`. Drain-at-top (3a) then turns it into a real user message and the next `chat()` sees it.

That's the whole mechanism. ~15 lines.

### 4. Wiring note (DeepSeek does this part too)

`SessionManager` must expose a path the view can call. Add:

```ts
interjectAgent(agentId: string, text: string): void {
  this.backends.get(agentId)?.interject?.(text);   // ?. — claude backend simply won't have it
}
```

(Match the real backend-lookup the file already uses for `interrupt`/`sendUserTurn`; grep `interrupt` in [SessionManager.ts](../src/session/SessionManager.ts) and mirror it. Don't assume the field is named `backends` if the code says otherwise.)

---

## Tests — [OpenAICompatBackend.test.ts](../src/backend/__tests__/OpenAICompatBackend.test.ts)

Use the existing harness in that file (`makeBackend` + scripted `fetch`); mirror the abort test at [line 414](../src/backend/__tests__/OpenAICompatBackend.test.ts#L414). **Three tests, that's enough:**

1. **Folds in & re-plans.** Script `chat()` to: (turn 1) ask for a tool, (turn 2) ask for a tool, (turn 3) finish. After the first `tool_result`, call `backend.interject('use read_file instead')`. Assert history contains a `user` message starting `[User interjected mid-task]` positioned **after** the first tool result and **before** the turn-2 assistant message — i.e. the ordering invariant held (no user msg between an assistant `tool_calls` and its `tool` answers).
2. **Idle is a no-op.** `interject('x')` before any `sendUserTurn` → `interjections` stays empty, a `log` event fired, no throw.
3. **Steer on the final step isn't lost.** Script `chat()` so the model returns *no* tool calls (would end the turn); queue an interjection during that step; assert the loop does **one more** iteration that consumes it (3b path) rather than dropping it.

No mutex tests, no concurrency tests — there is no concurrency.

---

## Definition of Done
- [ ] `interject?()` added to `AgentBackend`; **absent** on Claude backend (not stubbed).
- [ ] Field + method + the two loop edits (3a, 3b) in `OpenAICompatBackend`.
- [ ] `SessionManager.interjectAgent()` mirrors existing `interrupt` wiring.
- [ ] 3 tests above, all green; full `npm test` green; `npm run build` clean.
- [ ] Diff is small (~30–40 lines prod). If it's bigger, you've added something this card didn't ask for — stop and check with Claude.
- [ ] PR references this card; Claude reviews before merge.
