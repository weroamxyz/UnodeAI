# Codex Task Card — Flag an MCP server's prerequisite in the Marketplace (before install)

> Small UX polish surfaced by smoke testing: four catalog servers (Git/Fetch/SQLite/Time) run via `uvx`
> and silently need **`uv`** installed. 0.8.41 already gives a clear *runtime* error when the command is
> missing; this card shows the prerequisite **on the card, before the user installs**. Single branch/PR.
> Baseline **0.8.41**, bundled release path; keep CI audit + E2E green.

## Goal
On a Marketplace MCP card, show a short **"Requires: uv"** (or Node/Docker) line so a user doesn't pick a
server they can't run. Reuse the runtime detection from 0.8.41 where it helps.

## Verified anchors
- `McpCatalogEntry` — src/marketplace/catalog.ts (~the interface with `transport`/`command`/`args`/
  `requiresApproval`/`source`). **Add an optional `prerequisite?: string`** (free text, e.g. `"uv"`).
- Catalog data — `marketplace/mcp.json`. The `uvx`-based entries are **git, fetch, sqlite, time**
  (`"command": "uvx"`). The `npx`-based ones (filesystem, github, memory, …) only need Node (ubiquitous —
  no flag needed).
- Card meta render — src/views/MarketplacePanel.ts:390 (`mcpCards`): the line that already shows
  `transport / approval / URL on install`. Add the prerequisite here.
- Runtime hint helper (0.8.41) — `mcpCommandHint(command)` in extension.ts maps `uvx`→uv, `npx`→Node,
  `docker`→Docker. Mirror its wording for consistency (or factor a tiny shared map if convenient).

## Subtasks
- **P1** Add `prerequisite?: string` to `McpCatalogEntry` (optional; existing entries unaffected). If the
  catalog parser/validator (`catalogSource.ts` / `isMarketplaceInstallAction`) enumerates fields, allow it
  through (it's display-only, not part of the install action).
- **P2** Populate `marketplace/mcp.json`: add `"prerequisite": "uv"` to **git, fetch, sqlite, time**. (Leave
  npx servers alone.) Optional nicety: if no explicit `prerequisite` is set, **derive** a display hint from
  `command` (`uvx`→"uv", `docker`→"Docker") so a future hosted catalog entry is covered automatically.
- **P3** Render it on the MCP card — a clear meta line, e.g. `⚠ Requires uv` (esc'd), visually distinct
  from the neutral transport/approval meta so it reads as a prerequisite, not a feature.
- **P4** Tests: `renderMarketplaceHtml` (or `mcpCards`) shows "Requires uv" for a uvx entry and **not** for
  an npx entry; the optional command-derivation maps `uvx`→uv.

## Constraints
- Display-only; **don't block install** (the user may install `uv` after, and the 0.8.41 runtime error
  still guards mount). `enableScripts:false` Marketplace stays; esc all strings; English-only; no security
  change. `build`/`lint`/`test` + bundle smoke green. Update CHANGELOG.

## Acceptance
A Marketplace MCP card for Git/Fetch/SQLite/Time shows **"Requires uv"** before install; npx servers don't;
install still works (and the 0.8.41 runtime error remains the backstop if the tool is missing).
