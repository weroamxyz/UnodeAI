# TASK — Codex · v0.5.3 G-001 UI: steer a running agent

**Owner**: Codex · **Reviewer**: Claude · **Target**: v0.5.3
**One job**: when the selected agent is *busy*, let the user send a message that steers it instead of being blocked. Thin UI over DeepSeek's `interject()`.

> ⚠️ Depends on DeepSeek's backend card (the `interject` path + `SessionManager.interjectAgent`). You can build and unit-test the UI in parallel with a stubbed dep; integrate once their PR lands. Every type named here is real — verified against source. Don't invent message kinds or renderers.

---

## Scope (and what is NOT in scope)

- ✅ A new `interject` dep on the chat view, wired in `extension.ts` exactly like `interrupt`.
- ✅ While busy: keep the composer **enabled**; pressing Send routes to `interject` (not `send`). A one-line hint tells the user the message will steer.
- ❌ **No modal. No Instruction/Observation radio. No new "interject message card."** The backend already echoes each steer as visible transcript text (`↩ steering: …` via an `assistant` event) — it renders through the existing message path. Don't build a second renderer.
- ❌ No `allowInputWhileBusy` setting. Steering-on-send is the feature; gating it off defeats the point. The existing **Stop** button remains the hard-abort.

---

## Changes

### 1. New dep — [ChatViewProvider.ts](../src/views/ChatViewProvider.ts) `ChatViewDeps`

Beside `interrupt` ([line 38](../src/views/ChatViewProvider.ts#L38)) add:

```ts
/** Steer a running agent (G-001). Routed to the backend's interject(). */
interject: (agentId: string, text: string) => void;
```

Wire it in [extension.ts](../src/extension.ts) right where `interrupt` is wired ([line 375](../src/extension.ts#L375)):

```ts
interject: (agentId, text) => sessionManager.interjectAgent(agentId, text),
```

### 2. Composer behaviour — busy ≠ disabled

Today the composer is disabled while the agent is busy. Change it so that, for the **currently selected** agent:

- **Idle** → Send routes to the existing `deps.send(agentId, text, mode)` (unchanged).
- **Busy** → composer stays enabled; Send routes to `deps.interject(agentId, text)`; clear the input; **do not** flip the agent into a new turn.

The view already tracks per-agent running state (it drives the Stop button). Reuse that signal — do **not** add a parallel busy flag that can drift from it. If you can't find a single source of truth for "is the selected agent running," ask Claude before inventing one.

### 3. Affordances (minimal)

- **Send button label**: when the selected agent is busy, render it as `Steer ⚡` (or set `title="Send a steering message to the running agent"`); otherwise `Send`. Pure label/title swap off the existing running state — no new state.
- **Hint line** under the composer, shown only while busy:
  `Agent is working — your message will steer it. Use Stop to cancel.`
  Plain text node, not `innerHTML`. Use the file's existing `esc()` ([webviewSecurity](../src/views/webviewSecurity.ts)) for any interpolation.
- **Stop** button: unchanged.

That's the whole UI. No modal, no extra CSS beyond the hint line.

---

## Tests — `ChatViewProvider` test file (mirror the existing webview-message tests)

**Three tests:**

1. **Busy routes Send → interject.** Selected agent marked running; simulate the webview "send" message with text `"use read_file"`; assert `deps.interject` was called with `(agentId, "use read_file")` and `deps.send` was **not** called.
2. **Idle routes Send → send.** Same agent not running; assert `deps.send` called, `deps.interject` not.
3. **Hint + label reflect running state.** Toggling the selected agent's running state flips the Send label to `Steer ⚡` and shows/hides the hint line.

No screenshots required for merge, but attach one of the busy composer (label + hint) to the PR for the reviewer.

---

## Definition of Done
- [ ] `interject` dep added and wired in `extension.ts` (mirrors `interrupt`).
- [ ] Composer enabled while busy; Send routes to `interject`; input cleared; no new turn started.
- [ ] `Steer ⚡` label + hint line driven off the **existing** running signal (no duplicate flag).
- [ ] 3 tests green; `npm test` + `npm run build` clean.
- [ ] No `innerHTML`; hint text escaped.
- [ ] Diff is small (UI-only, ~40–60 lines). Bigger ⇒ you added scope this card didn't ask for; check with Claude.
- [ ] PR references this card and DeepSeek's; integration verified once both land.
