# TASK — M1 · Header IA reorg (Phase 1)

**Owner:** Codex · **Reviewer/Integrator:** Claude · **Type:** UX refactor (self-contained, no marketplace dependency)
**Design:** [V0.6.0_MARKETPLACE_AND_HEADER_IA.md](V0.6.0_MARKETPLACE_AND_HEADER_IA.md) §3 · **Breakdown:** the M1 row in the v0.6.0 plan.

> **Work on your own branch/worktree** (`feat/m1-header-ia`). The v0.6.0 isolation feature isn't built yet, so isolate manually — this is exactly the collision we hit on context-injection. Don't touch `src/marketplace/*` (M0, frozen) or any file another M-task owns.

---

## Why
The `roam.teamPanel` toolbar crams **extension-level** and **team-level** controls into one undifferentiated row, and there's no home for the coming Marketplace. Sort controls by scope and give extension-level its own row to the right of the "UnodeAi" brand.

## The target (two webview rows + a near-empty native toolbar)
```
┌─ TEAM ───────────────────────(native: collapse/expand only)─┐
│ ⦿ UnodeAi  v0.5.12          🛒 Marketplace   ⚙ Settings   │  ← Row 1: EXTENSION level
│ 📋 Dev Crew ▾   ＋Agent ⤳Switch ⧉Rules  ▶All ■All  ⚡Solo    │  ← Row 2: TEAM level
├─────────────────────────────────────────────────────────────┤
│  …agent cards (unchanged)…                                   │
└─────────────────────────────────────────────────────────────┘
```

## Scope sort (move each control to its home)
| Control | Command | Goes to |
|---|---|---|
| Settings | `roam.openSettings` | **Row 1** (right) |
| **Marketplace** (NEW) | `roam.openMarketplace` (new stub) | **Row 1** (right) |
| Add Agent | `roam.addAgent` | Row 2 |
| Switch/Create Team | `roam.createTeamPreset` | Row 2 |
| Team Rules | `roam.editTeamRules` | Row 2 |
| Start All / Stop All | `roam.startAllAgents` / `roam.stopAllAgents` | Row 2 |
| Solo toggle | `roam.startSolo` / `roam.startSoloActive` | Row 2 |
| Restore Checkpoint | `roam.restoreCheckpoint` | Row 2 |
| Collapse / Expand | `roam.collapseTeam` / `roam.expandTeam` | **stays in native** `view/title` |

## Changes
1. **`package.json` → `menus.view/title`**: remove every `roam.teamPanel` item **except** `roam.collapseTeam` / `roam.expandTeam`. **Keep all the `commands` declarations** — they're still invoked, just from the webview now. Add a new `roam.openMarketplace` command (`title: "UnodeAi: Open Marketplace"`, `icon: "$(extensions)"`).
2. **`src/extension.ts`**: register `roam.openMarketplace` as a **Phase-1 stub** — `vscode.window.showInformationMessage('UnodeAi Marketplace — coming soon.')`. (M2 replaces the body with the real panel; keep the command id stable.)
3. **`src/views/TeamViewProvider.ts`**:
   - `.rc-titlebar` (Row 1): keep brand + `v${version}` on the left; add a right-aligned action group with **Marketplace** and **Settings** buttons. Use `justify-content: space-between` (brand group ↔ actions group).
   - Add `.rc-teambar` (Row 2): the team-level buttons above the agent grid. The team name may double as the Switch-Team affordance (dispatches `roam.createTeamPreset`) — or a plain button; your call, keep it discoverable.
   - Wire every button through the **existing** `data-command` → `postMessage` path the panel already uses (see the empty-state cards: `data-command="createDefaultTeam"`), and extend the `onDidReceiveMessage` allow-list so each new command id maps to `vscode.commands.executeCommand(id)`.
   - Solo toggle should reflect state (it has two command ids by `roam.soloActive`); mirror the existing `when`-clause logic in the webview (the provider already knows solo state).

## Out of scope (do NOT)
- No Marketplace panel/catalog work (that's M2). The button is a stub.
- No changes under `src/marketplace/`, no catalog JSON.
- Don't change agent-card rendering, status logic, or any command's behavior — only **where** it's triggered.

## Definition of Done
- [ ] Two webview rows render as in the mockup; native toolbar shows only collapse/expand.
- [ ] Every moved control still fires its exact existing command (manually verify each in the Extension Host).
- [ ] `roam.openMarketplace` registered and opens the "coming soon" message.
- [ ] Solo toggle still reflects active/inactive state.
- [ ] `npm run compile` clean; `npx vitest run` green (add/adjust any TeamViewProvider snapshot/test if present).
- [ ] No edits outside `package.json`, `src/extension.ts`, `src/views/TeamViewProvider.ts` (+ its test).
- [ ] PR/branch `feat/m1-header-ia` → ping Claude for review + integration. Ships as its own small release.

## Pointers
- Current toolbar wiring: `package.json` `menus.view/title` (the `view == roam.teamPanel` block) and the `roam.*` commands above it.
- Webview header today: `TeamViewProvider.ts` `.rc-titlebar` (brand + version) and the `data-command` dispatch already used by the empty-state grid.
