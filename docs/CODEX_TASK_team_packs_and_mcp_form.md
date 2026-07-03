# Codex Task Card — Team Packs + guided "Add MCP server" form

> Two independent 1.0-attractiveness items from the market analysis. **Separate branch/PR each.** Claude
> reviews at the boundary (diff vs card + gates). Baseline: **0.8.35**, bundled release path
> (`npm run publish:bundle`), CI runs audit + headless E2E — keep both green.

---

## A — Team Packs (task-oriented crews you pick in one click) `[C]`

Today the team picker only offers the software crew + 3 knowledge-work presets. Add **task packs** so a
user doesn't have to understand "multi-agent" — they pick a job (Fix a bug, Cut a release, Security
review) and get a crew wired for it. This is a top market-pull item; keep it to role composition + a
recommended verify hint (the richer "Evidence Report" is a separate later item — don't build it here).

### Verified anchors
- `TEAM_PRESETS` — src/roles/RoleConfig.ts:777, shape `Record<string,{ label:string; roles:(keyof typeof
  ROLE_TEMPLATES)[] }>`. Each starts with `'pm'` (coordinator) then specialists. Existing role keys live
  in `ROLE_TEMPLATES` (same file) — **only compose keys that already exist** (e.g. pm, system-architect,
  senior-dev, reviewer, qa-engineer, devops-engineer, security-engineer, technical-writer — grep
  ROLE_TEMPLATES and use the real keys; don't invent roles).
- The picker that lists presets: `roam.createTeamPreset` — extension.ts:2140 (`createTeam()` consumes the
  preset's `roles`).

### Subtasks
- **A1** Extend the preset model with an optional `description?: string` and `verifyCommand?: string`
  (a sensible default check for that job, e.g. `npm test` / `npm run build`), and an optional
  `kind?: 'software' | 'knowledge' | 'pack'` so the picker can group them. Keep existing presets working
  (new fields optional).
- **A2** Add 5 packs (compose from REAL role keys; adjust to what exists):
  - **Bugfix Crew** — pm + senior-dev + reviewer (find→fix→independent review).
  - **Refactor Crew** — pm + system-architect + senior-dev + reviewer.
  - **Test Writer Crew** — pm + qa-engineer (or senior-dev) + reviewer.
  - **Release Crew** — pm + senior-dev + devops-engineer + reviewer.
  - **Security Review Crew** — pm + security-engineer + reviewer.
- **A3** Surface them in the `roam.createTeamPreset` quick-pick, grouped (e.g. a "Task Packs" separator
  vs "Knowledge-work"), each showing its `description`. On create, if the pack has a `verifyCommand` and
  the user has none set, offer to set `roam.verifyCommand` to it (so the verifier-gate works out of the
  box for that pack). Don't overwrite an existing verifyCommand without asking.
- **A4** Unit-test the new presets (valid role keys resolve; picker list includes the packs).

### Acceptance
A user runs *Create or Switch Team* → sees "Bugfix Crew / Release Crew / Security Review Crew / …" with
descriptions → picking one builds a real crew (PM + the right specialists) and offers the pack's verify
command. No invented roles; existing presets unchanged.

---

## B — Guided "Add MCP server" form (replace the team.json alias) `[C]`

`roam.addMcpServer` currently just opens `.roam/team.json` (extension.ts:2136 → `openTeamFile()`). Replace
it with a guided flow so a non-expert can add an MCP server without hand-editing JSON.

### Verified anchors / reuse (do NOT reimplement these)
- `toMcpServerConfig` (src/marketplace/install.ts) builds the `MCPServerConfig`.
- `persistMcpServerToTeamFile(cfg)` (extension.ts ~2894) writes it into `.roam/team.json`.
- `mountMcpServer(cfg)` (extension.ts ~1396) gates sensitive servers behind the approval modal + registers.
- `mcpRegistry.set(id, cfg)` is how the in-memory registry is updated (see the marketplace MCP install path
  in `handleMarketplaceInstall`, extension.ts ~2846 — mirror that tail: registry.set → persist → mount).
- Security: `env` values must stay `${VAR}` placeholders (resolved from SecretStorage), **never raw
  secrets**; `.roam/mcp.json` bridge token stays gitignored. (See [[marketplace-skills-into-members]] /
  the existing MCP design.)

### Subtasks
- **B1** Build the flow with `vscode.window.showInputBox`/`showQuickPick` (no new webview needed):
  1. **name** (required), 2. **transport** quick-pick (`stdio` | `streamable-http` | `sse`),
  3. for stdio → **command** + **args** (space-split or repeated prompt); for http/sse → **url**
  (validate `http(s)://`), 4. optional **env** as `KEY=${VAR}` lines (validate the value is a `${VAR}`
  placeholder, not a literal secret — reject literals with a clear message), 5. **requires approval?**
  (yes/no, default yes for network/stdio).
- **B2** Build the `MCPServerConfig` (reuse `toMcpServerConfig` shape), then `mcpRegistry.set` →
  `persistMcpServerToTeamFile` → `mountMcpServer` (same tail as the marketplace install). Cancel at any
  step → nothing written.
- **B3** Keep an "Open .roam/team.json instead" escape hatch (a final quick-pick option) for power users.
- **B4** It appears in **Settings → MCP Servers** afterward, ready to grant to an agent.
- **B5** Unit-test the pure validation bits (url validation; env placeholder-vs-literal check).

### Acceptance
*Add MCP server* (Marketplace MCP tab button or command) walks through name/transport/endpoint/env/approval,
writes a valid entry to `.roam/team.json`, mounts it (approval-gated), and shows it in Settings — no manual
JSON. A literal secret in `env` is rejected.

---

## Global constraints
- English-only UI; no security-model change; CSP/webview-safe if any HTML; reuse existing helpers (don't
  fork the MCP install/persist/mount path). `build`/`lint`/`test` green; bundled smoke stays green.
- Update CHANGELOG per workstream; bring each to Claude with build/lint/test counts + an e2e note, flagging
  any spot you had to diverge from this card.
