# Codex Task Card — v0.9 UX: Orchestration Visibility + Panel-copy + Custom Icons + Edit-applies-live

> Pre-v0.9.0 UX batch. Source ideas: DeepSeek UI/UX list (#3 delegation streaming, #9 parallel
> progress, #2 status polish) + 张's "improve the visible area" + custom-icon-upload bug + a
> Claude-found correctness bug (Agent Builder edits / MCP grants don't reach the running agent).
> **Workstreams U1–U4, each on its own branch/PR so they land separately.** Status: **U1 merged +
> shipped (0.8.19).** Remaining: U2, U3, U4. Claude reviews each at the boundary.

## Roles
- **Codex owns** all four workstreams (UI + the small host wiring noted below).
- **Claude (me)** reviews + will add any *new typed `SessionManager` event* if U2 needs one beyond
  the existing message bus (see U2 anchors — I believe the bus already carries everything; confirm
  before asking). I also already shipped the toolProtocol/leaker fixes (0.8.18) — unrelated, ignore.

---

## U1 — Copy "Messages" into the bottom Panel (keep the sidebar one) `[C]`

**Decision (张):** do NOT remove the sidebar Messages view. **Add a second copy in the bottom Panel**
(where Terminal/Output live). Run both in parallel; if the Panel proves better we remove the sidebar
one *later*. So this workstream must leave `roam.messageLog` (sidebar) fully intact.

### Current-state anchors (verified)
- Manifest: `viewsContainers.activitybar` has one container `roam`; `views.roam[]` holds
  `roam.teamPanel` / `roam.messageLog` / `roam.chat`, all `type:"webview"` (package.json:301-333).
- `MessageLogProvider` (src/views/MessageLogProvider.ts:20) is a `WebviewViewProvider` registered
  **once** for `roam.messageLog` (extension.ts:502). It holds a **single** `_view` (line 22) and posts
  `newItem` to it (line 34); `onDidChangeVisibility` re-renders from `items[]` (line 46). Feed source =
  bus `message.sent` (line 30). `items[]` caps at 300.

### Subtasks
- **U1.1 Manifest:** add a Panel container + view. Add to `contributes.viewsContainers` a `"panel"`
  array with a container (e.g. `id:"roamPanel"`, title "UnodeAi Activity", icon `$(output)`), and a
  `views.roamPanel[]` entry `roam.activityPanel` (`type:"webview"`, name "Activity"). Keep
  `roam.messageLog` exactly as-is.
- **U1.2 Provider serves N views:** change `MessageLogProvider._view?` → a **`Set<vscode.WebviewView>`**
  (`_views`). `resolveWebviewView` adds the view + an `onDidDispose` that removes it; `newItem`/`refresh`/
  `setCompact` **broadcast to every** attached view; `onDidChangeVisibility` re-renders just that view.
  Both views share the same `items[]` so they're always in sync. Register the *same instance* for the new
  view id: `registerWebviewViewProvider('roam.activityPanel', messageLogProvider)` (extension.ts ~502).
- **U1.3 Title actions:** mirror the existing Messages `view/title` menus (clear/export/compact) onto
  `view == roam.activityPanel` so the Panel copy has the same controls.

### Acceptance
- A "UnodeAi Activity" tab appears in the **bottom Panel**; it shows the same feed as the sidebar
  Messages, live, and both stay in sync (new item appears in both; clear clears both).
- Sidebar `roam.messageLog` is unchanged in behavior. No duplicate-event or leak when one view closes.

---

## U2 — Orchestration visibility: delegation streaming + parallel progress + status polish `[C]`

Make the *multi-agent orchestration* legible — this is the moat, so it must be **visible**. Render the
roomy bits in the **Panel Activity view (U1)** and/or Chat where there's width; do not cram the narrow
sidebar.

### Current-state anchors (verified — confirm before adding new events)
- Message bus carries the delegation traffic already: `MessageLogProvider` consumes `message.sent`
  (MessageLogProvider.ts:30) for PM→teammate assignments. Backend/session events: `task.assign` /
  `task.complete` flow on the bus (see SessionManager `onBackendEvent` mapping; C2 card §anchors).
- `ChatViewProvider` (src/views/ChatViewProvider.ts) renders the chat; replies arrive via bus
  `task.complete` (`onReply`). Icon render sites: TeamViewProvider.ts:451, 500.

### Subtasks
- **U2.1 (#3) Delegation streaming in chat:** when the coordinator (PM) delegates, render a live
  **delegation chain** inline in the chat transcript — e.g. `PM → Senior Dev (working…) → done → PM
  summarizing`. Drive it off the existing bus assign/complete events (subscribe `ChatViewProvider` to
  them; **text nodes, no innerHTML**). Collapse to a one-line summary when the turn settles.
- **U2.2 (#9) Parallel-delegation progress:** when PM fans out to N agents, show **`done/total`**
  (e.g. "2 / 3 agents complete") + per-agent state. Track by counting assign vs complete for the active
  coordinator turn. Render in the Panel Activity view (wide) and a compact badge on the Team view.
- **U2.3 (#2) Status polish:** tighten the per-agent status line on Team cards — clear
  idle / working("…on <task>") / blocked / done states, consistent wording + a status dot. Reuse the
  existing `roam.teamCompact` mode (package.json:394/399) — status must read well in **both** compact
  and full card layouts.

### Constraints
- Pure rendering off existing events where possible. If you truly need a new signal, ask Claude to add
  a typed `session.*` event rather than parsing strings. No security-model change; English-only; CSP nonce.

### Acceptance
- Delegating in chat shows a live chain that settles into a summary; a fan-out shows `done/total`
  progress; Team status reads clearly in compact + full. Tool-loop turns unaffected.

---

## U3 — Custom agent icon: let users upload an image file `[C]`

**Bug/feature:** Add/Edit Agent only allows emoji / `$(codicon)` text. Allow uploading a small image.

### Storage contract (decided — keep it dead simple, no image lib)
- Keep the single `AgentConfig.icon: string`. Make it **polymorphic by prefix**:
  - starts with `data:image/` → render as `<img>`
  - matches `$(...)` → codicon (today)
  - else → emoji / text (today)
- **Upload handler (host, extension.ts):** `vscode.window.showOpenDialog` filtered to images →
  read bytes → **reject if > 64 KB** (toast: "Use a small icon under 64 KB") → `data:<mime>;base64,<…>`
  → set as `icon`. No resizing (avoids native deps). Validate mime is image/png|jpeg|webp|svg+xml.

### Subtasks
- **U3.1** Builder UI (AgentBuilderPanel): add an **"Upload image…"** button next to the existing
  icon field; on pick, post a `{command:'agentBuilderPickIcon'}` to the host; host runs the handler and
  posts back the data-URI to set the icon + live preview. Keep emoji/codicon entry working.
- **U3.2** Render sites: update `TeamViewProvider.ts:451` and `:500` (and any chat/card avatar) to the
  polymorphic renderer — `data:` → `<img class="agent-icon-img" …>` (CSP `img-src` must allow `data:`;
  sized to match the emoji slot), else current text path. **No innerHTML for user strings.**
- **U3.3** Persistence: data-URI rides in the existing AgentConfig/team.json save path — confirm it
  round-trips through save/restore and the builder edit view shows the uploaded image.

### Acceptance
- Upload a small PNG → it shows as the agent's icon in the builder preview, Team cards (compact + full),
  and chat. Oversize file is rejected with a clear message. Emoji/codicon still work. Survives reload.

---

## U4 — BUG: editing an agent (or granting MCP) doesn't reach the *running* agent `[C]`

**Severity: high.** The Agent Builder **Edit** path updates the stored config + UI but never pushes the
change to the live backend, so a running agent silently keeps its **old** model / system prompt /
playbooks / allowedTools / **MCP grants** / toolProtocol until it's manually restarted. Same gap for a
marketplace MCP install while an agent is live. This makes Edit and live MCP grants quietly no-op.

### Root cause (verified — read before coding)
- The backend is built **once** from a *derived clone* of the config: `SessionManager` calls
  `createBackend(this.withProjectContext(info.config))` (src/session/SessionManager.ts:254-263 — the
  comment says "derived copy so we never mutate the stored config"), and the openai-compat factory
  clones again via `withOpenAICompatBaseUrl(config)` (extension.ts:218). So later edits to the stored
  config never reach the running backend.
- The team already documented this exact trap for model swaps: `setModel` pushes the change to the
  backend too, "otherwise the swap never reaches the in-flight agent" (SessionManager.ts:158-168).
- But `handleAgentBuilderSave`'s edit branch calls **neither** `setModel` **nor** `restart` — it only
  `saveRoster()` + refreshes panels (extension.ts:2775-2780). And MCP grants are snapshotted in the
  backend's `mcp = grants.length>0 ? {hub,grants} : undefined` (extension.ts:224): an agent created with
  zero MCP servers has `mcp:undefined` baked in, so editing in a server grants nothing without a rebuild.

### Fix
- In `handleAgentBuilderSave`'s **edit** branch (extension.ts:2775), after `saveRoster()`: **if the
  session is currently running, `await sessionManager.restart(payload.id!)`** so the backend is rebuilt
  from the new config. `restart` (SessionManager.ts:306) stops+starts; the L2 snapshot-restore on start
  (SessionManager.ts:269-272) preserves the conversation. Idle/stopped agents need nothing — their next
  start already reads the new config. Gate on status so we don't spin up a stopped agent.
  - Determine "running" from the `SessionInfo.status` of `existing` (use whatever the codebase treats as
    started/running/idle-after-start; do **not** restart a `stopped`/`error`/never-started session).
  - Keep the existing `mountMcpServer` loop (the server process still needs mounting); the restart is
    what makes the *grant* live.
- **Marketplace MCP install** (`handleMarketplaceInstall`, kind `mcp`, extension.ts:2823): the server
  mounts fine; the card already says "Grant it to an agent's skills to use it." That grant flows through
  the Agent Builder edit → so the U4 restart fix covers it. No extra change needed, but **verify** an
  MCP server installed + granted to a *running* agent becomes callable after the edit-restart.

### Out of scope
Don't build a generic "hot-reload config without restart" path for prompt/skills/MCP — restart-on-edit is
the correct, low-risk fix and preserves context via the snapshot. (A live `setModel`-style push for every
field is a much bigger change; not now.)

### Tests / acceptance
- Unit/regression: editing a **running** agent triggers a session restart (mock `sessionManager.restart`,
  assert it's called for a running session and **not** called for a stopped/never-started one).
- Manual e2e (note in PR): change a running agent's model → next turn uses it; attach an MCP server to a
  running agent → it can call the server's tools after save; edit a stopped agent → no spurious start.

---

## Global constraints (all workstreams)
- Separate branch + PR per workstream; `build`/`lint`/`test` green before each merge.
- Webviews: CSP nonce; user-supplied text/icons as **text nodes / sanitized**, never innerHTML.
- English-only UI. No telemetry. No security-model change. Don't document unreleased behavior as shipped.
- Update CHANGELOG per workstream; bring each to Claude at the boundary with build/lint/test counts +
  an e2e note, flagging anywhere the code had to diverge from this card.
