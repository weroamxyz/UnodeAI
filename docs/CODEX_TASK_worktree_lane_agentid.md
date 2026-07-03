# Codex Task Card — Worktree lanes keyed by agentId, not display name

> The one remaining item from your own 0.8.36–0.8.38 + 0.8.1–0.8.31 reviews (Claude fixed the other 8 in
> 0.8.39). Single branch/PR. Baseline **0.8.39**, bundled release path; keep CI audit + E2E green.

## The bug (you found it)
Worktree review lanes carry the agent's **display name**, and both the WorktreePanel actions and the
Dashboard lane map associate by that name. Two agents with the same name (or a rename / fallback-name
change) → **View diff / Re-verify / Hand back act on the wrong lane**, and the Dashboard glues
verified/files-touched onto the wrong row. Identity must be the stable **agentId**; name stays display-only.

## Verified anchors
- `WorktreeReview.lanes[]` shape — src/views/WorktreePanel.ts:24-28: `{ agent: string; branch; path;
  verification?; changedFiles? }`. **Add `agentId: string`** (keep `agent` as the display name).
- Lane construction — `gatherWorktreeReview()` in extension.ts (~1096): it already has the live worktree
  list (which carries `agentId` — see `wt.agentId` used in WorktreeCoordinator). Populate `agentId` here.
- WorktreePanel buttons — src/views/WorktreePanel.ts:~203 use `data-agent` (the name). Switch the actions
  to **`data-agent-id`** (keep showing the name as the label).
- WorktreePanel command handlers — extension.ts (~2468) currently match the live worktree by display
  name; match by **agentId** instead.
- Dashboard lane map — src/views/DashboardProvider.ts:~395 builds `filesByAgent` / lane association keyed
  by name; key by **agentId** (the SessionInfo already has `config.id`; `DelegationAgentState` has
  `agentId`; thread the worktree review's `agentId` through too).

## Subtasks
- **L1** Add `agentId` to `WorktreeReview.lanes[]` and populate it in `gatherWorktreeReview()`.
- **L2** WorktreePanel: render actions with `data-agent-id`; resolve View diff / Re-verify / Hand back by id.
- **L3** extension.ts action handlers: look up the live worktree by `agentId`, not name.
- **L4** Dashboard lanes: associate verification + files-touched by `agentId` (display name still shown).
- **L5** Tests: a roster with two same-named agents — assert lane actions + Dashboard association resolve
  to the correct id (the current code would mismatch).

## Constraints
- Display still shows the friendly name; only the *association/commands* switch to id. `escAttr` ids in
  attributes; no innerHTML of names. English-only; no security change; build/lint/test + bundle smoke green.
- Update CHANGELOG. Bring to Claude with build/lint/test counts + an e2e note.

## Acceptance
With two agents sharing a display name (or after a rename), each worktree lane's verified/mergeable badge,
files-touched, and View-diff/Re-verify/Hand-back act on the **correct** agent.
