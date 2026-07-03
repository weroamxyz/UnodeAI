# Feature Spec: Cline-Level Chat Experience (per-agent rich sidebar chat)

> **Status**: Revised by Claude (reprioritized + placement fixed) — for Codex
> **Date**: 2026-06-05
> **Origin**: user feedback — per-agent chat is far below Cline; wants parity.
> **Supersedes**: the v0.2.0 DevPlan E7 ("Chat enhancement") — that work is folded in here as C2.

---

## 0. What actually makes Cline feel good (the real gap)

The first draft headlined **Plan/Act + multi-window + persistence**. Those are nice, but they are NOT why
Cline feels better. Ranked by impact on the felt experience:

| # | Dimension | RoamCrew today | Priority |
|---|-----------|----------------|----------|
| 1 | **Streaming / typewriter output** | whole turn returns as one blob | **must** |
| 2 | **Tool/action visibility in the conversation** (Reading X, Editing Y + diff) | tool calls go to a separate OutputChannel, not the chat | **must** |
| 3 | **Markdown + code rendering** | plain `textContent`, no formatting | **must** |
| 4 | **Interrupt the in-flight turn** | none | should |
| 5 | **Plan/Act mode** | none | should (secondary) |
| 6 | per-agent window + persistence | single editor panel, lost on close | should |

If we ship Plan/Act + multi-window but the chat still dumps one unformatted blob with no streaming and no
visible tool actions, it will still feel far below Cline. So #1–#3 lead.

> **Expectation setting:** full Cline parity (diff approve/reject, checkpoints, plan editing) is a large
> roadmap. This spec targets *core felt parity* for a single-agent conversation. Diff **approval** UI and
> checkpoints are explicitly later.

---

## 1. Placement (user requirement — important)

**The chat is a rich WebviewView in the UnodeAi sidebar (activity-bar container) — NOT an editor panel,
and NOT the per-agent OutputChannel.** "Don't mix it with the terminal."

- New sidebar view `roam.chat` registered in the existing `roam` view container (alongside Team + Activity
  Feed). The current editor `ChatPanel` (WebviewPanel, opens as an editor tab) is **replaced** by this
  sidebar view. The per-agent **OutputChannel stays** but only as a raw debug log, not the primary UI.
- **Per-agent conversation:** the user wants "a chat window per agent." VS Code can't spawn N *dynamic*
  sidebar views (views are statically declared), so the native realization is **one Chat view with an agent
  switcher** (a tab/dropdown bound to the Team roster; selecting an agent in the Team panel focuses its
  chat). Each agent keeps its own persisted transcript; switching is instant. This delivers "a conversation
  per agent" in the sidebar without fighting the platform.
- **Optional later:** a "pop out to editor" action for users who want two agents side-by-side (editor
  WebviewPanels). Not in the core scope — the sidebar view is the requirement.

---

## 2. Epics (reprioritized)

| # | Epic | Est. | Summary |
|---|------|------|---------|
| **C1** | Sidebar rich-chat view + Markdown/code rendering + agent switcher + persistence | 3d | The structural move (sidebar view) + #3 markdown |
| **C2** | Streaming / typewriter output + interrupt (folds DevPlan E7) | 2.5d | #1 + #4; requires the streaming-fetch build (below) |
| **C3** | Tool/action visibility cards (Reading/Editing/Running + collapsible diff) | 3d | #2 — the biggest missing piece |
| **C4** | Plan/Act mode with **hard** tool gating | 2d | #5 |

Suggested order: **C1 → C2 → C3 → C4** (C1 gives the rich webview base; C2 the live feed; C3 the action
cards; C4 the mode on top). ~10.5d total — this is a real track, not a 4-day add-on.

---

### C1 — Sidebar rich-chat view (structure + rendering + persistence)

- **View:** `roam.chat` WebviewView in the `roam` container; `package.json` `contributes.views`.
- **Agent switcher:** top bar dropdown listing the roster; selecting an agent shows its transcript. Sync:
  selecting an agent card in the Team panel focuses that agent here (via a command/postMessage).
- **Rich rendering:** render assistant text as **Markdown** (headings, lists, bold, links) with **fenced
  code blocks** (monospace + a copy button; syntax highlighting optional/later). Use a tiny, dependency-free
  markdown renderer **or** a vetted small lib bundled via esbuild — **but all text goes through escaping;
  never `innerHTML` with raw model output.** (Render to DOM nodes; if using a markdown lib, sanitize.)
- **Persistence:** per-agent transcript in `workspaceState` key `roam.chat.<agentId>` (cap ~50 msgs);
  restored on view load / agent switch; **cleared when the agent is removed** (`session.removed`).
- **Routing fix (keep from draft):** replies are matched by `msg.from === selectedAgentId`; the current
  "push every reply to the panel" is wrong once it's per-agent.

### C2 — Streaming + interrupt (folds DevPlan E7)

- **Streaming is a BUILD, not "already there"** (confirmed): `OpenAICompatBackend.chat()` hardcodes
  `stream:false` and `FetchFn` returns `text()` only. Add a **streaming fetch injection** (returns a
  readable/iterable body), and a `chat`-stream path used **only for the final, no-tool-call answer turn**
  (tool-loop turns stay non-streaming — they need the full response to parse `tool_calls`). Emit
  `session.stream_chunk { turnId, delta }` over the bus; the chat view appends tokens.
- **Claude backend:** stream-json already arrives incrementally; surface partial assistant text as chunks
  (verify `StreamJsonParser` granularity).
- **Interrupt:** Send becomes ■ Stop while a turn runs → `SessionManager.interrupt(agentId)` →
  `backend.abort()` (openai-compat: `AbortController`; claude: end stdin / kill). Chat shows "Stopped."

### C3 — Tool/action visibility cards (the biggest gap)

- Render each tool call inline in the conversation as a **card**, not hidden in the OutputChannel:
  - `📖 Read <path>`, `✏ Edit <path>` (collapsible **diff**: before/after or unified), `▶ Run <cmd>`
    (collapsible output), MCP tool calls (`server__tool` + args/result, collapsible).
  - Cards stream in as `tool_use` / tool-result events arrive (we already emit `tool_use`; add the result +
    enough detail to render). For edits, surface a diff (WorkspaceTools already knows old/new content — pass
    it through).
- **No approval UI in this epic** (that's a later roadmap item) — cards are *visibility*, matching Cline's
  "see what it's doing." Keep the existing CommandPolicy/sandbox gating underneath.
- Security: every path/diff/output rendered via `textContent`/escaping; diffs are data, never HTML.

**C3b — Surface context window + auto-compaction (integration with F1b + E1)**

The model-side already integrates: chatting with an agent runs through the same backend, so the per-agent
**context window (F1b `contextWindowTokens`)** and **auto-compaction (E1 summarization at the soft limit)**
already apply. C3 makes them *visible* in the chat (Cline shows a context bar) — it does NOT re-implement them.

- **Context usage indicator:** a slim bar / `N% of <window>` in the chat header for the selected agent =
  current context tokens ÷ `contextWindowTokens`. Needs a small signal: the backend reports occupancy
  (reuse `TokenCounter.estimateMessages(history)` + window) — emit it on `turn_complete` (extend `TurnResult`
  with optional `context?: { tokens; window; ratio }`) or via a `context` BackendEvent; SessionManager
  forwards it to the chat view. Claude backend manages its own window → show "managed by Claude" / hide the
  bar for claude agents (don't fake a number).
- **Compaction marker:** when E1 compacts, show an inline chat marker `🗜 Context compacted (older turns
  summarized)`. Source: `OpenAICompatBackend.compactHistory` already logs it — emit a **structured** signal
  (a dedicated event, or a `turn_complete`/event flag) instead of only a `log` line, and SessionManager
  forwards it as a chat system marker.
- Pure/testable: the occupancy calc and the "should-show-marker" decision are pure; unit-test them. UI is the
  bar + marker rendering (escaped, no innerHTML).
- **DoD (C3b):** chatting a long session shows the context bar rising and a `🗜 compacted` marker when E1
  fires; claude agents show "managed by Claude"; numbers come from real `TokenCounter`/window, not faked.

### C4 — Plan/Act mode with hard gating

- **Toggle** in the chat top bar (Plan = blue, Act = green); default **Act**. Input placeholder reflects mode.
- **Hard tool gating (not prompt-only):** in **Plan mode the agent's write/execute tools are disabled at the
  tool layer** — `WorkspaceTools`/`TeamTools` exposed to the model exclude write/run (read/search only), and
  `CommandPolicy` rejects execution regardless. A `[PLAN MODE]` system note is added too, but it is
  *defense-in-depth*, not the mechanism (weak models ignore prompts). This makes Plan mode genuinely safe and
  useful (a planning turn truly cannot touch files).
- Wire: webview sends `{command:'send', agentId, text, mode}`; the **mode is applied extension-side** (tool
  set + policy), never trusted from the webview alone.

---

## 3. Constraints (same non-negotiables as GUIDANCE)

- Webview input/rendering: **no `innerHTML` with model/user/tool data** — DOM APIs + escaping; CSP nonce.
- English-only user-facing text.
- Don't weaken the security model: Plan-mode gating is *additive*; CommandPolicy/sandbox/MCP default-deny stay.
- Pure cores unit-tested (markdown render fn, tool-card model, mode→toolset resolver, stream parser).
- Per-merge `build`/`lint`/`test` green; one epic per branch; update the completion log.

## 4. Acceptance (high level)

- **C1:** chat lives in the sidebar (not editor, not OutputChannel); Markdown + code render; switch agents →
  correct per-agent transcript; reload VS Code → transcript restored; remove agent → its history cleared.
- **C2:** openai-compat reply streams token-by-token; Stop cancels mid-turn; tool-loop turns unaffected.
- **C3:** a turn that reads/edits/runs shows inline cards with collapsible diffs/output, in order, as they happen.
- **C4:** Plan mode → agent cannot write/run (verified by a tool-layer test, not just prompt); Act mode → normal.

## 5. Notes carried over from the draft (correct, kept)
- `onReply` filter by `msg.from`; persistence via `workspaceState`; plan-prefix injected extension-side.
- These were right; the change is **placement (sidebar, not editor), priority (rendering/streaming first),
  and Plan-mode safety (hard gating, not prompt-only).**
