# TASK — Codex · Context-injection host (finish) + Team create/switch button

**Owner**: Codex · **Reviewer**: Claude
**⚠️ Work on a SEPARATE branch/worktree — NOT the shared main tree.** We just lost ~8 cycles to parallel edits clobbering each other in one working directory. Set up isolation first:
```
git worktree add ../RoamCrew-codex feat/context-host
```
Then work in `../RoamCrew-codex`. **Do NOT touch `src/backend/*`** — that contract is final.

---

## Task A — Finish context-injection host (Cline #2)

The backend is **done and merged**: `TurnAttachments.workspaceContext` is a **`string`** (final contract — host formats it; backend caps + injects ephemerally). Your earlier structured version was reverted; align to the string contract.

**What's left (your lane):**
1. The **gatherer** in `extension.ts`: implement `getWorkspaceContext()` (the dep SessionManager already calls) to return a **formatted string** when `roam.engine.workspaceContext` is on, else `undefined`:
   - Active editor: `vscode.window.activeTextEditor` → relative path + a **capped** content slice (≤ ~150 lines / fixed char cap; if larger, head + `"(truncated — use read_file for the rest)"`).
   - Diagnostics: `vscode.languages.getDiagnostics()` → **Error/Warning only**, capped, compact lines.
   - Compose into ONE string (e.g. `Active file: <path>\n<snippet>\n\nDiagnostics:\n- …`). Return that string.
2. Wire `getWorkspaceContext` into the SessionManager deps in `extension.ts`.
3. **Re-add the test** you had — but against the **string** contract and with correct import depths (`../SessionManager`, `../../bus/MessageBus`, `../../backend/AgentBackend`, `../../types`). Assert: when `getWorkspaceContext` returns a string, `attachments.workspaceContext === that string`; off by default.

**Files**: `extension.ts`, `package.json` (setting already added), the host test. **Not** `src/backend/*`.

---

## Task B — "Create Team" → "Create or Switch Team" (improvement #1)

Today `roam.createTeamPreset` (title "Create Team…") only creates. Make it **create OR switch**.
1. **Investigate the team-persistence model first** (`.roam/team.json`, `createTeamFromPreset`, how the active team is stored). Note in the PR what you found.
2. Change the command title to **"UnodeAi: Create or Switch Team…"** and the flow to a **QuickPick**:
   - `➕ Create a new team…` → the existing preset-creation flow.
   - One entry per **existing/known team** (preset or saved) → **switch** the active team to it. If switching **replaces** the current team's agents, **confirm first** ("This replaces your current N agents. Continue?") so no silent data loss.
3. If the model currently only supports ONE team at a time (no saved profiles), scope "switch" as "replace current team with a different preset (confirmed)", and say so in the PR — don't build a full multi-team profile store unless it's already there.

**Files**: `extension.ts` (the command), `src/dialogs.ts` (the create/switch dialog), maybe `package.json` (command title). UI/command only.

---

## DoD (both tasks)
- [ ] On `feat/context-host` branch/worktree, **no `src/backend/*` edits**.
- [ ] Context host: gatherer returns a formatted **string**; off by default; correct-path test green.
- [ ] Team button: create-or-switch QuickPick with confirm-on-replace; title updated.
- [ ] `npm run build` + `npm test` green; PR per task (or one PR, two clearly-separated commits).
- [ ] PR references this card; Claude reviews + merges.
