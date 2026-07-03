# TASK — DeepSeek/Kimi · v0.5.4 Cline-parity reliability pair (#1 + #3-delta)

**Owner**: DeepSeek/Kimi · **Reviewer**: Claude · **Target**: v0.5.4
**Two small backend levers** from RoamClaw's Cline-parity feedback. Both are *deltas on existing machinery* — not rewrites. Read the grounding before coding.

> ⚠️ Every type/method/line named here is verified against current source. Don't invent events or methods. Both features are small; if your diff balloons, you've misread the existing code — stop and ask Claude.

---

## Feature A (#1 safe slice) — force a tool call instead of nudging with prose

**What already exists** (do NOT rebuild): when the model announces an action but emits no tool call, `runTurn` already detects it (`looksLikeAnnouncedAction`) and pushes a prose nudge, bounded by `MAX_ANNOUNCE_NUDGES` — [runTurn:443-458](../src/backend/OpenAICompatBackend.ts#L443-L458).

**What's wrong with prose-nudging weak models**: they often re-announce and stall again. **What we will NOT do**: have the framework guess which tool + which args from the prose and auto-execute it — that can write the wrong file. Intent-inference is itself an LLM job; doing it in code is unsafe.

**The safe lever**: on the announce-without-call retry, re-issue the request with **`tool_choice: 'required'`** so the *gateway* forces the model to emit a real tool call (model still chooses tool+args). `buildChatBody` already plumbs `tool_choice` for native tools — [buildChatBody:858](../src/backend/OpenAICompatBackend.ts#L858). This only works in the **native** protocol (`sendsNativeTools === true`); in XML mode keep the existing prose nudge.

**Change**:
- Add a per-turn flag, e.g. `let forceToolNextCall = false;` near the other loop-state vars (~[line 364](../src/backend/OpenAICompatBackend.ts#L364)).
- In the announce-nudge branch ([447-457](../src/backend/OpenAICompatBackend.ts#L447)): if `this.currentProtocol.sendsNativeTools`, set `forceToolNextCall = true` **instead of** (or in addition to) the prose push; keep the prose push for XML mode.
- In `buildChatBody` (or just before the `chat()`/`chatStream()` call), when `forceToolNextCall` is set, override `body.tool_choice = 'required'` for that one request, then clear the flag after the call returns. Simplest: pass it through a private field `this.forceToolChoice?: 'required'` that `buildChatBody` reads at [858](../src/backend/OpenAICompatBackend.ts#L858), and reset it right after `chat()`/`chatStream()`.
- Guard: only force when `tools.length > 0` and native (same condition already at line 858). Never force two turns in a row indefinitely — it's gated by `MAX_ANNOUNCE_NUDGES` already, so reuse that bound; don't add a second counter.

**Why safe**: model still owns tool+args; we only remove the "reply with prose" escape hatch for one retry. If the gateway rejects `tool_choice:'required'` (some don't support it), reuse the existing `dropEffortOnRejection`-style fallback pattern: catch, drop the override, retry once without it. Check whether a generic "unsupported param → retry" path already exists before adding one.

---

## Feature B (#3 delta) — `roam.verifyCommand` auto-run after writes

**What already exists** (do NOT rebuild): post-write diagnostics collection + injection, and the verification-obligation nudge/⚠ marker — [runTurn:531-565](../src/backend/OpenAICompatBackend.ts#L531-L565), gated by `this.verifyObligation`. A successful `run_command`/`run_checks` already sets `verifiedSinceLastWrite` ([533-535](../src/backend/OpenAICompatBackend.ts#L533-L535)).

**The delta**: let the *project* define one verify command that the framework runs automatically after a write, feeding its output back like post-write diagnostics do — so weak models that skip verification still get the signal.

**Change**:
- New setting `roam.verifyCommand` (string, default `""`). Plumb it into `EngineOptions` next to `verifyObligation`/`postWriteDiagnostics` (the engine options object already flows into the backend ctor — mirror `this.verifyObligation = engine.verifyObligation ?? false` at [line 182](../src/backend/OpenAICompatBackend.ts#L182)).
- In the post-write block ([539-565](../src/backend/OpenAICompatBackend.ts#L539-L565)), **after** diagnostics handling, if `this.verifyCommand` is non-empty and a write happened this iteration: run it **through the same executor `run_command` uses** (so it honors the sandbox/CommandPolicy path — do NOT shell out directly), append a capped summary of its output to the tool result (like `formatPostWriteDiagnostics` does), and if it exits 0 set `verifiedSinceLastWrite = true`.
- **Bounds**: run it at most once per turn (not per write) — add a `let ranVerifyCommand = false;` guard. Cap injected output length. A failure of the verify command must never throw out of the turn (wrap like the diagnostics `try/catch` at [544-548](../src/backend/OpenAICompatBackend.ts#L544-L548)).
- Find the existing command executor the backend already holds (the ctor takes a `commandExecutor` — grep the constructor params); reuse it. Don't introduce a new spawn path.

---

## Tests — [OpenAICompatBackend.test.ts](../src/backend/__tests__/OpenAICompatBackend.test.ts)

Reuse the scripted-`fetch` harness. **Four tests:**

**A1** — native protocol, model announces ("let me check the file") with no tool call → next request body carries `tool_choice: 'required'`; assert via the captured request body. Then model emits a real call → flag is cleared (a *following* request does NOT carry `tool_choice:'required'`).
**A2** — XML protocol, same announce → prose nudge still used, `tool_choice` NOT forced (no native tools advertised).
**B1** — `roam.verifyCommand = "npm test"`, a write occurs → the executor is invoked once with that command and its output is appended to the next turn's context; exit 0 sets verified (no ⚠ marker).
**B2** — `verifyCommand` set but the command throws/rejects → turn still completes, no exception escapes; `ranVerifyCommand` prevents a second run on a second write same turn.

---

## Definition of Done
- [ ] A: one per-turn force flag; reuses `MAX_ANNOUNCE_NUDGES` bound; native-only; graceful fallback if gateway rejects `tool_choice:'required'`.
- [ ] B: `roam.verifyCommand` setting plumbed via `EngineOptions`; runs through the existing executor (sandbox-respecting); once/turn; output capped; never throws out.
- [ ] 4 tests above + full `npm test` + `npm run build` green.
- [ ] Prod diff small (~50–70 lines total). Bigger ⇒ you're rebuilding something that exists; stop and check.
- [ ] PR references this card and the落地评估 table in [ROADMAP_v0.5_EXECUTION_ENGINE.md](ROADMAP_v0.5_EXECUTION_ENGINE.md).
