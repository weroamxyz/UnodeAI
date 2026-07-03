# TASK — M2 · Marketplace webview (Agents + MCP tabs)

**Owner:** Codex · **Reviewer/Integrator:** Claude · **Type:** new webview (renderer only — install handlers are M4/Claude)
**Design:** [V0.6.0_MARKETPLACE_AND_HEADER_IA.md](V0.6.0_MARKETPLACE_AND_HEADER_IA.md) §4 · **Contract:** [`src/marketplace/catalog.ts`](../src/marketplace/catalog.ts) (M0, frozen) · **Authoring contract:** [`marketplace/README.md`](../marketplace/README.md)

> **Branch/worktree `feat/m2-marketplace-panel`.** Builds on M1 (same owner) — land M1 first, then this. Do **not** edit `src/marketplace/catalog.ts` (frozen M0) or the catalog JSON (M3/DeepSeek owns content).

---

## Why
M1 added a `🛒 Marketplace` button that opens a "coming soon" stub. M2 replaces that stub with the real panel: a webview that browses the curated catalog (Agents / MCP / Skills) and dispatches a scoped install action. **This task renders + dispatches only — the install logic is M4.**

## Scope
1. **New `src/views/MarketplacePanel.ts`** — a webview panel (model on `SettingsPanel.ts` / `TeamViewProvider.ts`: CSP + nonce via the existing `webviewSecurity` helper, `data-*` → `postMessage` dispatch).
2. **Load the catalog via M0**: build a reader that reads the **bundled** `marketplace/{agents,mcp,skills}.json` from `context.extensionUri` (e.g. `vscode.workspace.fs.readFile` + `JSON.parse`), then `loadCatalog(read)` from `catalog.ts`. The JSON files ship in the VSIX already (not in `.vscodeignore`). If a file fails to parse, degrade gracefully (empty tab + a console warning) — don't blank the whole panel.
3. **Three tabs**: `Agents` · `MCP` · `Skills`. **Skills tab is present but disabled** with a "coming in Phase 3" note (it ships with progressive skill loading). Agents + MCP are live.
4. **Cards + search**: each entry renders a card (icon, name, summary; MCP also shows transport + `source` link if present). A search box filters the active tab by name/summary.
5. **`Add ▾` per card** → post a `MarketplaceInstallAction` (exact shape from `catalog.ts`):
   - Agents: `{ kind: 'agent', entryId, target: 'current-team' | 'new-team' }`
   - MCP: `{ kind: 'mcp', entryId, scope: 'extension' | 'current-team' }`
   - (Skills disabled, no action yet.)
   The dropdown surfaces the scope choice (e.g. "Add to current team" / "Create team with it").
6. **Open the panel** from `roam.openMarketplace`: replace the M1 stub body in `extension.ts` with `MarketplacePanel.createOrShow(...)`. Keep the command id stable.

## The M2 ↔ M4 boundary (important)
M2 **posts** the `MarketplaceInstallAction` and shows an optimistic ack ("Installing…"/toast). The extension-side **handler that actually performs the install** (mint AgentConfig + addAgent; generate MCP config + approval gate) is **M4 (Claude)**. So:
- Wire a **temporary** `onDidReceiveMessage` handler that validates the action shape against the contract and `showInformationMessage('(M4 will handle) ' + JSON.stringify(action))`. M4 replaces the body, not the wiring.
- Keep the message contract exactly as `MarketplaceInstallAction` — that's the seam.

## Out of scope (do NOT)
- No real install logic (M4), no MCP config generation, no `addAgent` calls.
- No catalog content — the JSON stays as M3 authors it; you may add a tiny local fixture **only** inside a test, not in `marketplace/*.json`.
- No changes to `catalog.ts`. If the contract feels wrong, flag Claude — don't edit it.

## Definition of Done
- [ ] `roam.openMarketplace` opens the panel; Agents + MCP tabs render cards from the bundled catalog (test with M3's content if landed, else a test fixture).
- [ ] Search filters the active tab.
- [ ] `Add ▾` posts a well-formed `MarketplaceInstallAction`; temporary handler echoes it.
- [ ] Skills tab visibly disabled with the Phase-3 note.
- [ ] Malformed/missing JSON degrades gracefully (no crash, no blank panel).
- [ ] CSP/nonce correct (no console security warnings); `npm run compile` clean; `npx vitest run` green (add a `MarketplacePanel` render/dispatch test).
- [ ] Edits confined to `src/views/MarketplacePanel.ts`, `src/extension.ts` (open command), and a new test. Ping Claude to wire M4 + integrate.

## Pointers
- Webview scaffold + CSP/nonce: `src/views/SettingsPanel.ts`, `src/views/webviewSecurity.ts`.
- `data-command`/postMessage dispatch pattern: `src/views/TeamViewProvider.ts`.
- Contract types & loader: `src/marketplace/catalog.ts` (`loadCatalog`, `MarketplaceInstallAction`).
