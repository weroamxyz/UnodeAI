# Codex v0.2.0 Completion Log

> Purpose: record v0.2.0 implementation work so milestone reviews can start from intent and
> verification notes instead of rediscovering them from diffs.

## Action Log

### 2026-06-06 - E5c/d/e Hardening Pack

- Files changed:
  - `CHANGELOG.md`
  - `docs/AUDIT_NOTES.md`
  - `docs/STATUS.md`
  - `src/dialogs.ts`
  - `src/extension.ts`
  - `src/session/SessionManager.ts`
  - `src/types.ts`
  - `src/views/SettingsPanel.ts`
  - `src/views/settingsSmartValidation.ts`
  - `src/views/__tests__/settingsSmartValidation.test.ts`
  - `test-e2e/suite/extension.etest.ts`
  - `test-e2e/suite/hardening.etest.ts`
- Changes:
  - Extracted a tiny pure Smart Mode provider validation helper and added regression coverage proving
    unknown `modelTierCell` providers are rejected while known providers are accepted.
  - Kept the existing SettingsPanel whitelist behavior intact and reused the helper in the existing
    `saveSmart` path.
  - Added public command return values/direct-send options so E2E can exercise the real command and
    MessageBus path without reaching into extension internals.
  - Exposed queued starts as `SessionInfo.pendingStart` and kept the existing stopped/running status
    model unchanged.
  - Added VS Code E2E coverage for routing a task to QA only and for max-concurrency queue draining.
  - Documented the production `uuid` audit disposition and corrected living lockfile/E2E audit notes;
    no review snapshots or historical v0.1.1 sections were rewritten.
- Verification:
  - `npm.cmd ci --dry-run --ignore-scripts --cache .npm-cache` passed.
  - `npm.cmd audit --omit=dev` reported exactly 1 moderate advisory: `uuid <11.1.1` buf-bounds; no
    fix available within `^9`.
  - `rg "uuidv4\(" src -n` showed only arg-less call sites; `rg "uuidv4\([^)]" src -n` returned no
    matches.
  - `npm.cmd run compile` passed.
  - `npm.cmd run lint` passed with 0 errors.
  - `npm.cmd test` passed: 301 tests.
  - `npm.cmd run test:e2e` passed: 8 tests.

### 2026-06-05 - E5b Esbuild Bundling

- Files changed:
  - `package.json`
  - `package-lock.json`
  - `.vscodeignore`
  - `.vscodeignore.bundle`
  - `esbuild.config.mjs`
  - `scripts/package-bundle.mjs`
  - `scripts/smoke-bundled-vsix.mjs`
  - `src/mcp/RealMcpClient.ts`
  - `docs/PUBLISH_CHECKLIST_v0.1.1.md`
- Changes:
  - Refactored `RealMcpClient` from variable dynamic imports to literal dynamic imports so esbuild
    can trace and inline the MCP SDK and `uuid` while preserving lazy SDK loading.
  - Added an opt-in `build:bundle` script using esbuild with `external: ['vscode', 'ajv',
    'ajv-formats']`; default `build`, `vscode:prepublish`, and `main` remain unchanged.
  - Added explicit runtime dependencies on `ajv@8.20.0` and `ajv-formats@3.0.1` so bare
    `require('ajv')` in the bundled output resolves to the MCP SDK's expected ajv major.
  - Added a bundle packaging path that stages a minimal VSIX containing the bundle output, icons,
    user docs, and the ajv runtime closure only.
  - Added a bundled-VSIX smoke script that extracts `roam-crew-0.1.2-bundled.vsix` and runs the
    E2E suite against the unpacked `extension/` directory.
- Verification:
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed with 0 errors.
  - `npm.cmd test` passed: 299 tests.
  - `npm.cmd run test:e2e` passed: 6 tests on the default tsc path, including sending a demo task
    to the PM through the normal non-MCP turn entrypoint.
  - `npm.cmd run build:bundle` passed; bundle output was `out/extension.js` 788.7 KB plus a 1.4 MB
    source map. `vscode`, `ajv`, and `ajv-formats` stayed external; SDK and `uuid` were inlined.
  - Default `npm.cmd run package -- --out roam-crew-0.1.2-unbundled.vsix` passed: 3,870 entries,
    5.15 MB.
  - `npm.cmd run package:bundle` passed: 553 entries, 0.95 MB. Bundled VSIX `node_modules` contains
    only `ajv`, `ajv-formats`, `fast-deep-equal`, `fast-uri`, `json-schema-traverse`, and
    `require-from-string`.
  - `npm.cmd run smoke:bundle` passed: 5 E2E tests against the unpacked bundled VSIX extension
    directory. This smoke covers activation and non-MCP webview/command paths. The demo-turn test is
    excluded in bundled smoke because the package-local `vscode` wrapper cannot be monkey-patched to
    auto-dismiss the API-key prompt; real MCP tool-call validation remains the E3 gate before
    switching bundle packaging to the publish default.

### 2026-06-05 - E6 Onboarding / 30-Seconds-to-Value

- Files changed:
  - `package.json`
  - `src/extension.ts`
  - `src/state/DemoTasks.ts`
  - `src/state/__tests__/DemoTasks.test.ts`
  - `src/views/OnboardingWizard.ts`
  - `src/views/TeamViewProvider.ts`
  - `src/views/webviewSecurity.ts`
  - `src/views/__tests__/webviewSecurity.test.ts`
  - `test-e2e/suite/extension.etest.ts`
- Changes:
  - Added the `roam.onboarding` setup wizard with Welcome, Provider, Team, Demo, and Done steps,
    plus first-run auto-open gated by `roam.onboardingComplete`.
  - Provider setup reads the existing `roam.baseUrl` default, writes the same `roam.baseUrl`
    setting, and stores API keys through the existing `ROAM_API_KEY` SecretStorage name.
  - Added the required `Browse models & pricing` link to
    `https://www.unodetech.xyz/pricing?lang=en`, opened extension-side after `sanitizeHref`.
  - Added a five-item demo task library and `roam.runDemoTask`; both the command and wizard cards
    send the selected prompt to the PM through `MessageBus.send(..., 'task.assign', ...)`.
  - Reused `roam.createDefaultTeam` for Quick Start and `roam.addAgent` for Custom instead of
    duplicating team creation logic.
  - Enhanced the empty Team view with three DOM-built cards: Quick Start Team, Run Demo Task, and
    Open Documentation.
- Verification:
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed with 0 errors.
  - `npm.cmd test` passed: 299 tests.
  - `npm.cmd run test:e2e` passed: 5 tests, including onboarding completion setting
    `roam.onboardingComplete = true`. VS Code logged the known mutex/WindowsApps/Jump List
    environment warnings, then exited successfully.
  - Static review confirmed the onboarding Base URL comes from `roam.baseUrl`, the pricing link is
    present, the API key path uses `ROAM_API_KEY`, and new E6 webview rendering uses DOM APIs rather
    than `innerHTML`/`insertAdjacentHTML`/`outerHTML`.

### 2026-06-05 - E4 Workflow Conditional-Branch UI

- Files changed:
  - `package.json`
  - `src/extension.ts`
  - `src/state/PersistenceManager.ts`
  - `src/state/TeamFileSchema.ts`
  - `src/state/__tests__/TeamFileSchema.test.ts`
  - `src/workflow/WorkflowEngine.ts`
  - `src/workflow/workflowSerialize.ts`
  - `src/workflow/__tests__/WorkflowEngine.test.ts`
  - `src/workflow/__tests__/workflowSerialize.test.ts`
  - `src/views/WorkflowEditor.ts`
  - `test-e2e/suite/extension.etest.ts`
- Changes:
  - Added optional custom `workflows` support to `.roam/team.json` validation and added writer
    methods that save a full team document while preserving `members` and `mcpServers`.
  - Added pure workflow authoring helpers for step parse/serialize round-trip and branch `goto`
    validation.
  - Added WorkflowEngine authoring APIs to list built-ins plus custom workflows, save validated
    custom workflows, delete custom workflows, reject invalid `goto` targets, and refuse built-in
    overwrites.
  - Added a focused Workflow Editor WebviewPanel with built-in template tabs, custom workflow
    loading, step add/delete/reorder, gated branch editing, save/delete commands, CSP nonce, and
    DOM/text-node rendering for workflow and agent data.
  - Registered `roam.editWorkflow` as `UnodeAi: Edit Workflow` and added an e2e smoke check that
    opens the editor.
- Verification:
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 294 tests.
  - `npm.cmd run test:e2e` passed: 4 tests. VS Code logged the known mutex/WindowsApps/Jump List
    environment warnings, then exited successfully.
  - Manual persistence check wrote a temporary reordered gated workflow with two branches to
    `.roam/team.json`, verified `members` and `mcpServers` remained unchanged, and restored the
    original file bytes.

### 2026-06-05 - C4 Plan/Act Mode Hard Gating

- Files changed:
  - `src/types.ts`
  - `src/backend/AgentBackend.ts`
  - `src/backend/OpenAICompatBackend.ts`
  - `src/backend/ClaudeHeadlessBackend.ts`
  - `src/backend/planMode.ts`
  - `src/backend/toolSummary.ts`
  - `src/backend/__tests__/planMode.test.ts`
  - `src/backend/__tests__/OpenAICompatBackend.test.ts`
  - `src/backend/__tests__/ClaudeHeadlessBackend.test.ts`
  - `src/session/SessionManager.ts`
  - `src/session/__tests__/routing.test.ts`
  - `src/extension.ts`
  - `src/views/ChatViewProvider.ts`
- Changes:
  - Added `ChatMode` (`plan`/`act`) and carried it through chat messages, `MessagePayload`,
    `TurnAttachments`, extension chat send, and `SessionManager.deliverTurn`; invalid/missing mode
    values normalize to `act`.
  - Added pure `planMode.ts` allow/deny logic: Plan mode allows only `read_file`, `list_dir`, and
    `list_agents`; write/run/delegation/check/broadcast/MCP tools are denied.
  - OpenAI-compatible Plan mode now filters offered tool specs before model calls and refuses any
    disallowed tool call again at `routeToolCall`, returning a visible Plan-mode refusal instead of
    executing the tool.
  - Prepended a short `[PLAN MODE]` note to Plan turns as defense-in-depth, while keeping the hard
    guarantee in the OpenAI-compatible tool layer.
  - Added Claude best-effort Plan-note behavior and documented the limitation in code: Claude
    native tool permissions are fixed at spawn (`--permission-mode`), so true per-turn hard gating
    would require restart-on-mode-change and remains out of C4 scope.
  - Added a per-agent Plan/Act toggle in the sidebar chat (default Act), with Plan blue, Act green,
    mode-aware placeholder text, and DOM-only rendering.
- Verification:
  - Targeted C4 test run passed: 64 tests.
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 284 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code used the already-installed local test build
    and logged the known mutex/WindowsApps/Jump List environment warnings, then exited successfully.

### 2026-06-05 - C3 Tool/Action Cards + C3b Context Bar

- Files changed:
  - `src/backend/AgentBackend.ts`
  - `src/backend/OpenAICompatBackend.ts`
  - `src/backend/WorkspaceTools.ts`
  - `src/backend/diff.ts`
  - `src/backend/toolSummary.ts`
  - `src/backend/__tests__/OpenAICompatBackend.test.ts`
  - `src/backend/__tests__/WorkspaceToolsSecurity.test.ts`
  - `src/backend/__tests__/diff.test.ts`
  - `src/backend/__tests__/toolSummary.test.ts`
  - `src/session/SessionManager.ts`
  - `src/session/__tests__/routing.test.ts`
  - `src/extension.ts`
  - `src/views/ChatViewProvider.ts`
  - `src/views/contextLabel.ts`
  - `src/views/__tests__/contextLabel.test.ts`
- Changes:
  - Added structured backend events for `tool_result` and `compacted`, while keeping the existing
    raw OutputChannel `[tool: ...]` line and unchanged tool-result strings in the model history.
  - Captured `WorkspaceTools.write_file` old/new content for UI-only edit diffs without changing
    the existing sandbox, FileCoordinator, or CommandPolicy gates.
  - Added pure helpers for capped unified diffs, tool-card summaries/categories, and context-bar
    labels, with focused unit coverage.
  - Forwarded `tool_use`/`tool_result` as `session.tool`, compaction as `session.compacted`, and
    real OpenAI-compatible context usage as `session.context`.
  - Rendered sidebar chat tool cards in arrival order with pending/result states, collapsible
    input/diff/output bodies, a slim context-usage bar, and inline compaction markers.
  - Kept tool cards and compaction markers as live transcript activity only; persisted
    `workspaceState` chat history remains capped to user/agent messages.
  - Preserved the C1/C2 webview safety model: all card, diff, output, marker, and context text is
    rendered through DOM APIs/text nodes, with no dynamic `innerHTML`.
- Verification:
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 278 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code used the already-installed local test build
    after network-restricted version lookup warnings; it also logged WindowsApps scan/Jump List
    environment warnings, then exited successfully.

### 2026-06-05 - C2 Streaming Output + Interrupt

- Files changed:
  - `src/backend/AgentBackend.ts`
  - `src/backend/OpenAICompatBackend.ts`
  - `src/backend/ClaudeHeadlessBackend.ts`
  - `src/backend/sseParser.ts`
  - `src/backend/__tests__/sseParser.test.ts`
  - `src/backend/__tests__/OpenAICompatBackend.test.ts`
  - `src/session/SessionManager.ts`
  - `src/session/__tests__/routing.test.ts`
  - `src/extension.ts`
  - `src/views/ChatViewProvider.ts`
- Changes:
  - Added a pure SSE parser and OpenAI stream delta reconstructor that handles chunk buffering,
    `[DONE]`, content deltas, usage chunks, and interleaved tool-call deltas merged by index.
  - Added a separate injected streaming fetch path for OpenAI-compatible backends; the existing
    text `FetchFn` remains unchanged for non-streaming chat and tests.
  - Implemented `chatStream()` with `stream:true`, live `assistant_delta` events, reconstructed
    full messages for the existing tool loop, pre-delta fallback to non-streaming chat, and token
    usage fallback when the stream omits usage.
  - Added turn-level OpenAI-compatible interrupt support with an abort controller and a stopped
    turn result, so the next queued/user message can run normally.
  - Plumbed `assistant_delta` through `SessionManager` as `session.stream`, then into the sidebar
    chat as a live text-node message; final replies still replace the live message with the
    authoritative Markdown-rendered transcript entry.
  - Added a Stop state to the chat composer while the selected agent is running.
  - Added Claude `abort()` as an explicit best-effort no-op log: clean per-turn cancellation is not
    available for the persistent Claude process in v0.2.0, and the process is not killed.
- Verification:
  - `npm.cmd test -- --run src/backend/__tests__/OpenAICompatBackend.test.ts src/backend/__tests__/sseParser.test.ts src/session/__tests__/routing.test.ts` passed: 54 tests.
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 263 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code used the already-installed local test build
    after network-restricted version lookup warnings; it also logged WindowsApps scan/Jump List
    environment warnings, then exited successfully.

### 2026-06-05 - C1 Sidebar Rich Chat View

- Files changed:
  - `package.json`
  - `src/extension.ts`
  - `src/views/ChatViewProvider.ts`
  - `src/views/TeamViewProvider.ts`
  - `src/views/chatHistory.ts`
  - `src/views/markdown.ts`
  - `src/views/__tests__/chatHistory.test.ts`
  - `src/views/__tests__/markdown.test.ts`
  - `test-e2e/suite/extension.etest.ts`
  - `src/views/ChatPanel.ts` (deleted)
- Changes:
  - Registered `roam.chat` as a sidebar `WebviewView` in the UnodeAi container and changed
    `roam.openChat` to focus that view instead of opening an editor tab.
  - Added `roam.chatWithAgent` plus a Team card `Chat` action that focuses the sidebar chat and
    selects the chosen agent.
  - Moved chat send/reply bus wiring into `ChatViewProvider`; replies are persisted per sender and
    only shown in the visible transcript when `reply.from === selectedAgentId`.
  - Added bounded per-agent transcript persistence under `workspaceState` key `roam.chat.<agentId>`,
    restored on load/switch and cleared on `session.removed`.
  - Added a pure Markdown renderer model with fenced code blocks and a webview renderer that uses
    DOM APIs/text nodes for model and user text, plus a safe-HTML output covered by XSS tests.
  - Deleted the old editor `ChatPanel` so the sidebar chat is the only primary chat UI.
- Verification:
  - `npm.cmd test -- --run src/views/__tests__/markdown.test.ts src/views/__tests__/chatHistory.test.ts` passed: 7 tests.
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 251 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code used the already-installed local test build
    after network-restricted version lookup warnings; it also logged WindowsApps scan/Jump List
    environment warnings, then exited successfully.

### 2026-06-05 - M1/E1 Context Compaction Foundation

- Files changed:
  - `src/session/Summarizer.ts`
  - `src/backend/AgentBackend.ts`
  - `src/backend/TokenCounter.ts`
  - `src/backend/OpenAICompatBackend.ts`
  - `src/session/SessionManager.ts`
  - `src/extension.ts`
  - `src/session/__tests__/Summarizer.test.ts`
  - `src/backend/__tests__/TokenCounter.test.ts`
  - `src/backend/__tests__/OpenAICompatBackend.test.ts`
  - `src/session/__tests__/routing.test.ts`
- Changes:
  - Added a pure `LlmSummarizer` module with injected chat-completion IO.
  - Extended `TokenCounter.softLimit()` with a compaction plan that preserves system messages, the
    first user anchor, and recent full turns while identifying the middle turns to summarize.
  - Added optional `AgentBackend.compactHistory()` so only capable backends participate; Claude
    headless does not implement the hook.
  - Implemented OpenAI-compatible rolling-summary compaction at the soft limit and kept backend
    trimming as a hard-limit/message-cap emergency safety valve.
  - Wired `SessionManager` to run compaction before dispatching turns when the backend supports it.
  - Wired extension activation to use an economy-tier model for summaries through the same provider
    API key/base URL path, without forcing unsupported model parameters.
- Verification:
  - `npm.cmd test -- --run src/session/__tests__/Summarizer.test.ts src/backend/__tests__/TokenCounter.test.ts src/backend/__tests__/OpenAICompatBackend.test.ts src/session/__tests__/routing.test.ts` passed: 50 tests.
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 233 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code emitted network-restricted Marketplace/version
    lookup warnings, then used the already-installed local test build and exited successfully.

### 2026-06-05 - M1/E1 Review Fix: Preserve Summary During Hard Trim

- Files changed:
  - `src/backend/OpenAICompatBackend.ts`
  - `src/backend/__tests__/OpenAICompatBackend.test.ts`
- Changes:
  - Updated the hard-limit `trimHistory()` safety valve to preserve every leading system message,
    including the rolling summary inserted after the main system prompt.
  - Added regression coverage for history containing a rolling summary that then crosses the hard
    limit during a subsequent turn.
- Verification:
  - `npm.cmd test -- --run src/backend/__tests__/OpenAICompatBackend.test.ts` passed: 20 tests.
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 234 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code again used the existing local test build after
    network-restricted version lookup warnings.

### 2026-06-05 - M2/E2 Claude PM Team Bridge

- Files changed:
  - `src/mcp/LocalMcpServer.ts`
  - `src/mcp/ClaudeMcpConfig.ts`
  - `src/backend/ClaudeHeadlessBackend.ts`
  - `src/extension.ts`
  - `src/mcp/__tests__/LocalMcpServer.test.ts`
  - `src/mcp/__tests__/ClaudeMcpConfig.test.ts`
  - `src/backend/__tests__/ClaudeHeadlessBackend.test.ts`
- Changes:
  - Added a vscode-free loopback-only `LocalMcpServer` that mounts `TeamMcpBridge` at `POST /mcp`
    with per-instance random bearer-token auth.
  - Implemented JSON-RPC handling for `tools/list` and `tools/call`, returning tool-call errors as
    JSON-RPC errors and rejecting unauthenticated requests with HTTP 401.
  - Extended Claude MCP config generation with HTTP headers and a `roam_team_bridge` local server
    entry.
  - Wired Claude PM agents to lazy-start the local team bridge server before spawn, merge it with
    user-granted MCP servers, pass `--mcp-config`, and stop the bridge on backend stop/exit.
  - Reused PM `TeamTools` for both OpenAI-compatible and Claude-backed PM agents.
  - Added a reference-counted shared local MCP server factory in extension wiring so multiple Claude
    PM backends do not race to stop the same local port.
- Verification:
  - `npm.cmd test -- --run src/backend/__tests__/ClaudeHeadlessBackend.test.ts src/mcp/__tests__/ClaudeMcpConfig.test.ts src/mcp/__tests__/LocalMcpServer.test.ts src/mcp/__tests__/TeamMcpBridge.test.ts` passed: 19 tests.
  - `npm.cmd run build` passed.
  - `npm.cmd run lint` passed.
  - `npm.cmd test` passed: 244 tests.
  - `npm.cmd run test:e2e` passed: 3 tests. VS Code used the existing local test build after
    network-restricted version lookup warnings.
