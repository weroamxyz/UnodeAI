# Codex Task Card — C1: Sidebar Rich Chat View

> Part of the Chat-Parity track. Spec: [FeatureSpec_Chat_PlanAct_Mode.md](FeatureSpec_Chat_PlanAct_Mode.md).
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) (esp. §1 + §6).
> **Scope = C1 only.** Streaming (C2), tool-action cards (C3), Plan/Act (C4) are SEPARATE later tasks — do NOT build them here.

## Goal
Move the per-agent chat into a **rich WebviewView in the UnodeAi sidebar** (the `roam` activity-bar
container, beside Team + Messages) and render replies as **Markdown + code**. **Not** an editor panel, **not**
the OutputChannel/terminal. One chat view with a **per-agent switcher** = "a conversation per agent".

## Current-state anchors (verified)
- Sidebar container `roam` with views `roam.teamPanel`, `roam.messageLog` — `package.json` `contributes.views.roam` (lines ~139-156).
- WebviewView pattern to copy: `src/views/MessageLogProvider.ts` (`implements vscode.WebviewViewProvider`, static `viewType`, `_view`, `resolveWebviewView`, bus subscription in ctor, `postMessage` for incremental updates, `csp`/`nonce` from `views/webviewSecurity.ts`).
- Registration site: `extension.ts` ~lines 219-225 (`registerWebviewViewProvider('roam.messageLog', …)`).
- Existing editor chat to retire: `src/views/ChatPanel.ts` + `roam.openChat` (extension.ts ~914-955) — reuse its `listAgents` / `send` / `onReply` bus wiring, move it into the new provider.
- Escaping helpers: `esc`/`escAttr` in `views/webviewSecurity.ts`. **Never `innerHTML` with model/user text.**

## Subtasks

### C1.1 — Register the sidebar chat view (scaffold)
- `package.json`: add a third view to `contributes.views.roam`: `{ "id": "roam.chat", "name": "Chat", "type": "webview", "icon": "$(comment-discussion)", "contextualTitle": "UnodeAi Chat" }`.
- New `src/views/ChatViewProvider.ts` implementing `vscode.WebviewViewProvider` (static `viewType = 'roam.chat'`), modeled on `MessageLogProvider`. Minimal HTML: agent `<select>` (top), scrollable transcript, composer (textarea + Send). CSP nonce.
- `extension.ts`: construct + `registerWebviewViewProvider('roam.chat', chatViewProvider)` (add to the existing `context.subscriptions.push(...)`).
- `roam.openChat`: stop opening the editor `ChatPanel`; instead `vscode.commands.executeCommand('roam.chat.focus')` (focuses the sidebar view).
- **DoD:** Chat view shows in the UnodeAi sidebar; `roam.openChat` focuses it; no editor tab; build/lint/test green.

### C1.2 — Agent switcher + roster sync
- Populate the `<select>` from `deps.listAgents()`; refresh on `session.created/removed/started/stopped` (provider subscribes or extension calls a `refresh()`), preserving the current selection.
- Switching the select → webview posts `{command:'selectAgent', agentId}` → provider tracks `selectedAgentId`.
- New command `roam.chatWithAgent` (arg: agentId) → focus the view + select that agent; wire a "Chat" button on the Team panel agent card to call it (TeamViewProvider already posts card commands — add `chatAgent`).
- **DoD:** switcher lists agents; switching changes the active conversation; Team card "Chat" focuses + selects the right agent.

### C1.3 — Send / receive wiring (move from ChatPanel)
- Provider deps interface: `listAgents()`, `send(agentId, text)`, `onReply(cb)` — reuse the bus wiring from `roam.openChat` (`messageBus.send('user', agentId, 'ask.question', …)`; subscribe `to:'user'`).
- **Routing fix (required):** in `onReply`, only render a reply whose `msg.from === selectedAgentId` into the visible transcript; replies for other agents update their stored transcript (C1.5) but not the visible pane. (Today's code shows every reply — wrong once per-agent.)
- Composer: Enter sends, Shift+Enter newline; show the user's message immediately, agent reply on arrival.
- **DoD:** send to the selected agent → its reply appears; replies from other agents don't leak into the current pane.

### C1.4 — Markdown + code rendering
- Render **assistant** messages as Markdown (headings, lists, bold/italic, links, inline code) + fenced code blocks with a **Copy** button. **User** messages stay plain (escaped).
- New `src/views/markdown.ts` — a small **pure** renderer: input string → an escaped-HTML string (or a token list the webview turns into DOM). It MUST escape first, then apply formatting, so raw `<script>`/`<img onerror>` is inert. Unit-test this module.
- **DoD:** a reply with bold + a list + a ```ts code block``` renders formatted; code block has Copy; an XSS payload renders as inert text; `markdown.test.ts` covers formatting + escaping.

### C1.5 — Per-agent persistence + restore + clear
- New pure store helper `src/views/chatHistory.ts` (or in the provider, but keep the cap/serialize logic pure + tested): per-agent `ChatMessage[]` (role: 'user'|'agent', text, ts), cap 50.
- Persist to `context.workspaceState` key `roam.chat.<agentId>` on change/dispose; restore on view load / agent switch.
- On `session.removed` → delete `roam.chat.<agentId>`.
- **DoD:** 5 turns → switch away and back → transcript intact; reload VS Code → restored; remove agent → its history cleared; the cap (50) is unit-tested.

### C1.6 — Retire the editor ChatPanel
- Remove `ChatPanel` usage; delete `src/views/ChatPanel.ts` (and its E2E command-list reference stays valid since `roam.openChat` still exists). No two chat UIs, no dead code, lint clean.
- **DoD:** only the sidebar chat exists; `roam.openChat` E2E smoke still passes (command registered + focuses the view).

## Constraints (non-negotiable)
- Webview: **no `innerHTML` with model/user data** — DOM APIs + `esc`/escaping; CSP nonce (copy MessageLogProvider).
- English-only user-facing text. No security-model changes. Pure cores (`markdown.ts`, `chatHistory.ts`) unit-tested.
- One branch for C1; `build`/`lint`/`test` green before merge; update `docs/CODEX_V0.2.0_COMPLETION_LOG.md`.

## Out of scope (do NOT do in C1)
Streaming/typewriter, interrupt, tool-action cards/diffs, Plan/Act, diff-approval, editor "pop-out".

**Context window + auto-compaction:** already handled at the model level — chatting runs through the agent's
backend, so F1b `contextWindowTokens` + E1 summarization apply automatically. **Do NOT re-implement them in
C1.** Surfacing them in the chat (a context-usage bar + a `🗜 Context compacted` marker) is **C3b** — not C1.

## Review
Bring C1 to Claude at the task boundary (as with E1/E2): summary + verification (build/lint/test counts + e2e),
and note anything where the plan didn't match the code.
