# TASK — Header fix: version by the extension header, drop the redundant brand row

**Owner:** Codex · **Reviewer/Integrator:** Claude · **Type:** small UX fix (follow-up to M1/0.6.0)

> **Work on your own branch/worktree** (`feat/header-version-fix`). Don't edit in the shared primary checkout — that's caused repeated collisions.

---

## The problem (user-reported)
After the M1 two-row header, the Team panel's webview shows its own **"UnodeAi v0.6.0"** brand row ([TeamViewProvider.ts:378–387](../src/views/TeamViewProvider.ts)). That duplicates the **view-container header** ("UnodeAi", from the activity bar) and **wastes a whole row**. The version should sit up by the extension/view header, not buried inside the panel.

## The fix
1. **Version → the view's native title bar.** In `resolveWebviewView` ([TeamViewProvider.ts:34](../src/views/TeamViewProvider.ts)), set:
   ```ts
   webviewView.description = this.version ? `v${this.version}` : '';
   ```
   This renders greyed next to the view title in the panel header (`vscode.WebviewView.description`) — up by "the head", no wasted row. Set it once in `resolveWebviewView` (it persists across `refresh()`).

2. **Delete the brand row** from `_getHtml`. Remove the entire `<div class="rc-titlebar">…</div>` block (the `.rc-brand` "UnodeAi" + `v${version}` AND the `.rc-actions` Marketplace/Settings buttons). The first element in `<body>` becomes `${this._renderTeamBar(sessions)}`.

3. **Move Marketplace + Settings to the native view toolbar** (they were in the deleted brand row). In `package.json` `menus.view/title`, add for `view == roam.teamPanel`, group `navigation`:
   - `roam.openMarketplace` (already has icon `$(extensions)`)
   - `roam.openSettings` (icon `$(gear)`)
   They'll show as toolbar icons alongside collapse/expand — the idiomatic home for extension-level view actions.

4. **Remove now-dead CSS:** `.rc-titlebar`, `.rc-brand`, `.rc-title`, `.rc-version`, `.rc-actions`. **Keep** `.rc-tool` and `.rc-teambar` (the team bar still uses them).

## Result
```
┌ TEAM  v0.6.0            🛒 ⚙  ⊟   ← native title: name + version (description) + toolbar icons
│ 📋 Dev Crew  ＋Agent ⤳Switch ⧉Rules ▶All ■All ⚡Solo   ← team bar (now the first webview row)
│ …agent cards…
```
No second "UnodeAi", no wasted row, version up by the header.

## Out of scope
- Don't touch `_renderTeamBar` contents (team-level controls stay as-is).
- Don't change agent-card rendering or any command behavior — only *where* version/actions live.

## DoD
- [ ] Version shows in the Team view's native title bar; **no "UnodeAi" text or version inside the webview body**.
- [ ] Marketplace + Settings reachable as native toolbar icons on the Team view; both still open their panels.
- [ ] Team bar (Add Agent / Switch / Rules / Start-Stop All / Solo) and collapse/expand unchanged.
- [ ] `npm run compile` clean, `npx vitest run` green, `npm run lint` clean.
- [ ] Edits confined to `src/views/TeamViewProvider.ts` + `package.json`. Branch `feat/header-version-fix` → ping Claude to review + integrate (ships in the next patch).
