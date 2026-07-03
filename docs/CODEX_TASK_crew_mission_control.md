# Codex Task Card — Crew Mission Control (first-screen lanes)

> Last item of the 1.0 attractiveness batch. **Consolidation, not new data** — every signal below
> already exists; the job is to compose it into one strong "what is my crew doing and can it land"
> landing view. Single branch/PR. Claude reviews at the boundary. Baseline **0.8.37**, bundled release
> path (`npm run publish:bundle`); keep CI's audit + headless E2E green.

## Goal
Turn the **Dashboard** (already the "Mission Control" tab — opened by the editor-title brand icon /
`roam.showDashboard` / `roam.openMissionControl`) into a **per-agent lane board** as its first screen:
one row per agent showing **status · current task · files touched · cost · verified/mergeable**, plus a
one-click **Evidence Report** entry. The pitch it should make real: *"see who's doing what, where it's
stuck, and whether it can land — at a glance."*

## Reuse these (all live; do NOT add new tracking)
- `DashboardProvider.getDashboardHtml` / `_renderAgentRow` — src/views/DashboardProvider.ts:20,211. The
  stats grid + **cost-savings banner** (0.8.35) + agent table already render here. The panel is
  `enableScripts:false`, so interactive actions use **`command:` URIs** (e.g.
  `href="command:roam.generateEvidenceReport"`) — keep that pattern; no webview scripts, CSP unchanged.
- Per-agent fields on `SessionInfo` (src/types.ts): `status`, `currentTask`, `errorMessage`,
  `usage.costUsd`, `context` (context-window %). Use `contextLabel` (already imported in the provider).
- `orchestrationProgress.agentStates()` (src/views/orchestrationProgress.ts) → per-agent delegation
  state `{ status: 'working'|'done'|'blocked', task, coordinatorName }`. The provider gets the tracker via
  the extension (thread it in like the existing deps if not already available — a getter is fine).
- Changed-files per agent: `checkpointStore.list()` entries carry `{ agentId, path }` — group by agent.
  (Thread a `filesByAgent()` accessor from extension.ts rather than importing the store into the view.)
- Worktree verified/mergeable: `WorktreeReview.lanes[]` (src/views/WorktreePanel.ts:24) carry
  `{ agent, branch, verification?, changedFiles? }` — use the lane's `verification` for the
  "✅ verified / ❌ failed / —" mergeable badge when in worktree mode. Reuse the existing
  `WorktreeReviewLoader`; if not worktree mode, omit the badge.

## Subtasks
- **M1 — Lane rows.** Replace/augment the agent table with a **lane per agent**: icon+name, a status dot
  (idle/working/blocked/done — reuse the Team panel's status vocabulary), the **current task** (truncated),
  **files changed** count, **cost** ($), context %, and (worktree only) a **verified/mergeable** badge.
  Keep the existing top stats grid + cost-savings banner above the lanes.
- **M2 — Per-lane actions** via `command:` URIs: **Chat** (`roam.chatWithAgent` with the agent id if a
  command arg works in a `command:` link; else a focus command), **Terminal** (`roam.showAgentTerminal`),
  and a board-level **📋 Evidence Report** (`roam.generateEvidenceReport`). Don't invent new commands.
- **M3 — Empty/edge states.** No agents → a friendly "Create a team" line. No worktree mode → no
  mergeable column (don't show a broken/empty one). Long task text truncates; everything `esc()`'d
  (no innerHTML of agent/task strings).
- **M4 — Tests.** Unit-test the pure row/section rendering (a lane shows status/task/cost; worktree badge
  appears only with lane verification; empty state renders) — mirror how other view renderers are tested.

## Constraints
- `enableScripts:false` stays — actions are `command:` URIs only; CSP unchanged; English-only; no telemetry.
- Reuse existing data/commands; no new SessionManager state. `build`/`lint`/`test` green; bundled smoke green.
- Update CHANGELOG. Bring to Claude with build/lint/test counts + an e2e note, flagging any divergence.

## Acceptance
Opening Mission Control shows, at a glance: each agent as a lane with status + current task + files + cost
(+ verified/mergeable in worktree mode), the cost-savings banner, and a one-click Evidence Report — no
hunting through separate panels. Empty/no-worktree states are clean.
