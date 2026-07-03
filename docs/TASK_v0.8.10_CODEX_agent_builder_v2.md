# TASK v0.8.10 — Codex: Agent Builder v2 + Marketplace/card polish

**Owner:** Codex (UI). **Gatekeeper/integrator/publisher:** Claude (don't bump version or publish).
**Backend half:** Claude lands it against the frozen contract below (model-list host messages +
`fallbackModel`/`toolProtocol` on the save payload). Build the UI against the contract; coordinate the
seam with Claude. **Runs in parallel with** Claude's backend.

Six items from user feedback on 0.8.9. (#6 — max playbooks 3→5 — is already done by Claude; the UI
imports `MAX_AGENT_PLAYBOOKS` so the "n/5" counter + cap follow automatically. Just verify.)

## #1 — Real model picker (the big one), in the Agent Builder
Today the builder shows only ~5 static models. Match the **Edit Agent dialog**: the **full live model
list with prices**.
- **Use the live priced catalog** — same source as the Edit dialog (`ModelCatalog.list` →
  `LivePriceService`). **It already applies the account's discount** (`group_ratio` / `roam.priceGroup`),
  so when connected to the **Roam (unode) gateway the dropdown must show the discounted price, not list
  price.** Don't recompute pricing — just render what the catalog returns.
- The list is **per-provider and async**, so request it from the host (don't bake it into the view model):
  on open and **whenever the provider changes**, post `{ command: 'listModels', providerId, baseUrl }`
  and render the reply. Show a loading state.
- Each option: `name — $in/$out` (whatever the catalog provides). Searchable if long.
- **Backup model** — add a second model dropdown (same list) → `payload.fallbackModel` (optional).
- **Tool calling method** — add a select: **Native** / **XML** → `payload.toolProtocol`
  (`'native' | 'xml'`). Default native.

## #2 — "Build an agent" in Marketplace → Agents
Add a button at the top of the **Agents** tab in `MarketplacePanel` that runs `roam.openAgentBuilder`.

## #3 — "Add MCP server" in Marketplace → MCP
Add an **Add MCP server** affordance to the **MCP** tab → fire the existing add-MCP command/flow
(`roam.addMcpServer` / the Settings `.roam/team.json` path — confirm the exact command with Claude).

## #4 — Change the agent icon in the builder
Add an icon control to the Identity section → `payload.icon` (emoji or `$(codicon)`). A small set of
presets + a free-text field is fine. (The save payload already carries `icon`.)

## #5 — Agent card: usage on the model line
In `TeamViewProvider`, move the per-agent **usage/cost** onto the **same line as the model name** (one
compact row) instead of its own line.

## Frozen contract (host ↔ webview — code against this)
```ts
// webview → host
{ command: 'listModels', providerId: string, baseUrl?: string }   // Claude replies with priced+discounted list
{ command: 'save', payload: AgentBuilderSavePayload }

// host → webview
{ command: 'models', providerId, models: { id: string; name: string; price?: string }[] }

// AgentBuilderSavePayload gains (Claude adds host-side handling):
fallbackModel?: string;
toolProtocol?: 'native' | 'xml';
// (icon already present)
```
`getViewModel(agentId)` will also return current `fallbackModel` / `toolProtocol` / `icon` for edits.

## Files
- [src/views/AgentBuilderPanel.ts](../src/views/AgentBuilderPanel.ts) — #1, #4 (+ its test).
- [src/views/MarketplacePanel.ts](../src/views/MarketplacePanel.ts) — #2, #3 (+ test).
- [src/views/TeamViewProvider.ts](../src/views/TeamViewProvider.ts) — #5.

## Acceptance
- `build`+`lint`+`test` green; render/message paths covered. No GUI smoke from you — Claude/张 run it.
- The model dropdown shows the **discounted** price on the Roam gateway (verify against the Edit dialog).
- Deliver code + tests + a 5-line summary and any contract friction with Claude's host seam.

## Constraints
- Renderer + message-handler only; CSP/nonce intact; everything `esc()`/`escAttr()`'d.
- Don't touch versioning/CHANGELOG/publish. Hand back to Claude to integrate as 0.8.10.
