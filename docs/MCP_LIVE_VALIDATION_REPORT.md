# MCP Live Validation Report (E3)

> Live validation of MCP servers against a real backend, per [DevPlan_v0.2.0.md](DevPlan_v0.2.0.md) §E3.
> Run by the user (GUI + real credentials) with Claude co-piloting (config + log analysis + fixes).
> Date: 2026-06-06.

## Environment
- Extension: `roam-crew-0.2.0-dev.vsix` (unbundled / default `vsce package`, 3874 files), installed in the
  user's normal VS Code (not the Extension Dev Host — see "Process notes").
- Workspace: `c:\AI_Program\RoamCrew` (a real folder, stable workspace root).
- Backend: openai-compat (`roam` provider), gateway `https://www.unodetech.xyz/v1`, model `deepseek-v4-pro`.
- claude CLI present (2.1.158) but the claude-native MCP path (E3.3) was not exercised this run.

## E3.1 — github MCP server (stdio) · openai-compat injection path → ✅ PASS
- Server config (`.roam/team.json`): `{ id: "github", transport: "stdio", command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" } }`.
  `${GITHUB_TOKEN}` resolves from SecretStorage (stored via `Set Provider API Key → Custom secret name`).
- Agent: a `developer` agent granted the server via `mcpServers: ["github"]` (default-deny otherwise).
- Prompt: *"List the 3 most recent open issues in the modelcontextprotocol/servers GitHub repo. Use the github tools."*
- Evidence (logs):
  - `MCP server "github" mounted.` — npx fetched the package, started the stdio server, SDK connected.
  - Agent output channel: `[tool: github__list_issues]` followed by **real, current data** (#4286 / #4285 /
    #4284 with correct authors, dates, comment counts).
- Conclusions:
  - The injection-style MCP client (`RealMcpClient` → `MCPHub`, namespaced `serverId__tool`) works end-to-end
    on a real install: tool discovery, the model choosing the tool, execution, and result synthesis.
  - The literal-dynamic-import refactor (E5b) and the lazy SDK load path work in a packaged extension.
  - Tool-call latency was acceptable (first call includes a one-time `npx` package fetch, ~seconds).
- Not exercised this run: the approval gate (`requiresApproval` was set `false` for a clean first pass);
  streaming fell back to non-streaming once on the pre-fix 401 then worked normally.

## E3.2 — playwright MCP server (stdio) · openai-compat injection path → ✅ PASS
- Server config: `{ id: "playwright", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp@latest"] }`.
  Chromium pre-installed to the ms-playwright cache (`npx playwright install chromium`).
- Agent: a `senior-dev` agent granted `mcpServers: ["playwright"]`.
- Prompt: *"Open https://example.com and report the page title and the main heading text. Use the playwright tools."*
- Evidence (logs): `MCP server "playwright" mounted.`; Browser agent called `playwright__browser_navigate`, then
  `playwright__browser_run_code_unsafe`, and returned the **real** page data — title `Example Domain`, h1
  `Example Domain`.
- Finding (non-blocking, external server): `playwright__browser_navigate` returned a server-side "permissions
  error"; the agent automatically fell back to `playwright__browser_run_code_unsafe` and succeeded. This is a
  `@playwright/mcp` capability/permission default (navigate may need extra `--caps`), NOT a UnodeAi issue —
  and it incidentally demonstrates the injection tool loop's failure→retry-with-another-tool behavior.
- This makes **two live MCP servers** validated (github + playwright) on the openai-compat backend.

## E3.3 — claude headless native MCP (`--mcp-config`) → ⬜ deferred
Not run. The user's working backend this session was openai-compat. The claude-native path + the
openai-compat-vs-claude behavior comparison remain to be done in a follow-up.

## Bugs found and fixed (E3.4)
Both were found *because* of live validation and are fixed on main:

1. **Set-API-Key custom-secret flow skipped the name step** (`src/dialogs.ts`).
   - Symptom: picking "➕ Custom secret name…" went straight to the value box; the typed name was stored as
     the value (no chance to enter the PAT).
   - Root cause: the QuickPick result was compared against an emoji string constant
     (`pick === '➕ Custom secret name…'`); that equality silently failed at runtime, skipping the
     name-entry branch.
   - Fix: use `QuickPickItem` objects with an explicit `custom` boolean (no emoji-string equality), inline
     the value prompt with clear "Step 1 of 2 / Step 2 of 2" titles + non-empty validation, and a small gap
     between the two input boxes to defeat buffered-Enter bleed-through.

2. **roam-provider agents hit `api.openai.com` when `roam.baseUrl` is blank** (`src/extension.ts`
   `getConfiguredRoamBaseUrl`).
   - Symptom: a `roam` agent without an explicit `baseUrl` got `HTTP 401 from https://api.openai.com/v1`.
   - Root cause: an empty-string `roam.baseUrl` setting (e.g. written by onboarding) wins over the default in
     `config.get('baseUrl', default)`, collapsing the whole base-URL resolution to `""` → the OpenAI SDK
     falls back to `api.openai.com`.
   - Fix: treat a blank configured value as "use the default gateway" (fall back to
     `DEFAULT_PROVIDER_CONFIGS.roam.baseUrl`).

## E5b "flip bundle to default" gate → ✅ CLEARED (bundled VSIX MCP smoke)
Repeated the github run on the **bundled** VSIX (`roam-crew-0.1.2-bundled.vsix`, 553 files; installed extension
disk-confirmed: `node_modules` = exactly the 6-package ajv closure, `out/extension.js` = the ~791 KB bundle).
Clean session `20260606T132956`:
- `13:30:17 MCP server "github" mounted.`
- Developer agent log: `[tool: github__list_issues]` → real #4286/#4285/#4284 data.

Because the MCP SDK validates tool I/O schemas with `ajv` at call time, a successful `github__list_issues` on
the bundled build proves the `.vscodeignore` ajv allowlist (`ajv, ajv-formats, fast-deep-equal, fast-uri,
json-schema-traverse, require-from-string`) is **complete** — no missing transitive dep. The E5b machinery is
now safe to promote to the publish default (flip `build`/`vscode:prepublish`/`main` to the bundle at the v0.2.0
publish step).

## Additional finding (non-blocking): streaming + tool-calls + thinking model
Observed on every run: `streaming request failed before content; falling back to non-streaming chat: HTTP 400
from https://www.unodetech.xyz/v1: "reasoning_content in the thinking mode must be passed back to the API."`
- The streamed path for a **thinking** model (`deepseek-v4-pro`) with tool calls hits a gateway 400 because the
  prior turn's `reasoning_content` isn't echoed back. The backend **gracefully falls back to non-streaming**
  and the turn completes correctly (real data returned).
- Impact: chat loses token streaming for thinking models on this gateway (still correct, just not live-typed).
  Logged for follow-up (OpenAICompatBackend streaming path should echo `reasoning_content`, or skip streaming
  for thinking models). Not an E3/E5b blocker.

## Process notes (for next time)
- The Extension Development Host launched via F5 had **no workspace folder** (its terminal `Get-Location` was
  `C:\Users\recit`), so `loadTeamConfig` returned undefined and the extension fell back to workspaceState — no
  `.roam/team.json` edits were ever read. Installing the VSIX into a normal window with a real folder open is
  the reliable path for live MCP validation.
- Sharp edge observed: an empty `members: []` in `.roam/team.json` shadows workspaceState agents (the load is
  `teamConfig?.members ?? loadAgents()`, and `[]` is not nullish). Worth revisiting separately.
