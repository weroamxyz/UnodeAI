# Codex Task Card — E4: Workflow conditional-branch UI

> Wave 1, first card after C1–C4. Source: [DevPlan_v0.2.0.md](DevPlan_v0.2.0.md) §E4 (Tasks E4.1–E4.3).
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1 (security model, English-only user text,
> webview injects user data via `textContent`/DOM only — **never `innerHTML` string-building**).
> **Scope = E4 only.** Branch: `codex/e4-workflow-ui`.

## Goal
A focused editor panel to **create/edit/reorder/delete workflows**, including `gated` steps with conditional
**branches** (`whenResultContains` → `goto`). Custom workflows persist to `.roam/team.json` so they're
versionable and shareable. Built-in templates stay read-only and are offered as starting points.

## Current-state anchors (verified — read before coding)
- **Types** (`src/types.ts`): `WorkflowConfig {id,name,description?,steps,triggers?}` (L240), `WorkflowStep
  {id,from,to,action,condition?,autoTransition,branches?}` (L251), `WorkflowBranch {whenResultContains?,goto}`
  (L266).
- **Engine** (`src/workflow/WorkflowEngine.ts`): `WorkflowTemplate {id,name,description,steps,gates?}` (L27);
  `BUILTIN_TEMPLATES` (L48, 5 templates); `getWorkflowTemplates()` returns built-ins only (L123). Branch
  routing already works at runtime via `resolveBranch(...)` (L313) — E4 is the **authoring UI** for it, the
  engine already executes branches.
- **Persistence** (`src/state/PersistenceManager.ts`): `loadTeamConfig()` reads & validates
  `<ws>/.roam/team.json` (L91); `loadWorkflows()/saveWorkflows()` use **workspaceState** key `roam.workflows`
  and store **`WorkflowInstance[]`** (running instances for L3 recovery) — **NOT templates**. Do not reuse that
  key for authored workflows.
- **Schema** (`src/state/TeamFileSchema.ts`): `TeamFileDocument {members, mcpServers}` (L3) — **no `workflows`
  field yet**; `validateTeamFile` is tolerant (collects issues, drops bad entries).
- ⚠️ **There is currently NO writer for `.roam/team.json`** (grep confirms: only readers). E4 introduces the
  first one — see E4.0. It MUST round-trip and preserve `members` + `mcpServers` (never clobber them).
- **Webview pattern to follow**: `src/views/SettingsPanel.ts` — inline HTML + minimal inline JS + CSP nonce,
  `data-command` buttons, `postMessage` to extension. Security helper: `src/views/webviewSecurity.ts`.
- **Registration**: `src/extension.ts` — `registerWebviewViewProvider` (L250-252), `registerCommands` (L917),
  `workflowEngine = new WorkflowEngine(...)` (L199).

## Subtasks

### E4.0 — Persistence: make `.roam/team.json` writable (workflows field) `[C]`
- `TeamFileSchema.ts`: add `workflows?: WorkflowConfig[]` to `TeamFileDocument`; validate in `validateTeamFile`
  tolerantly (optional; if present must be an array; drop malformed entries with an `issues` note; default
  `[]`). Add a focused unit test (valid workflows parse; non-array → issue + dropped).
- `PersistenceManager.ts`: add `async saveTeamConfig(doc: TeamFileDocument): Promise<void>` that writes
  `<ws>/.roam/team.json` via `vscode.workspace.fs.writeFile` (pretty JSON, trailing newline, create `.roam/`
  if missing). **Critical: callers pass the full doc; never write `{workflows}` alone — load → mutate
  `workflows` → save, preserving `members`+`mcpServers`.** Add `async saveCustomWorkflows(workflows:
  WorkflowConfig[])` convenience that does load-merge-save.

### E4.1 — `WorkflowEditor` panel `[C]`
- New file `src/views/WorkflowEditor.ts` — a **WebviewPanel** (independent editor panel, like opening a doc),
  not a sidebar view: workflow editing is a high-focus task. Command `roam.editWorkflow` →
  `UnodeAi: Edit Workflow` creates/reveals a singleton panel.
- Inline HTML/JS, CSP nonce, no external frameworks (mirror `SettingsPanel`).
- **Layout**: top = template tabs (`Feature` / `Bug Fix` / `Code Review` / `Docs`) that load a built-in as a
  starting point (does not overwrite saved custom workflows); left = step list (`<ul>`, each `<li>`: index,
  type badge, agent name, truncated action, 🗑 delete); right = selected-step detail (type `<select>`, `from`/
  `to` agent `<select>`s, action `<textarea>`, branches editor); bottom = `+ Add Step` and `Save`.
- **Drag-to-reorder** via native HTML Drag&Drop (`draggable="true"` + `dragstart/dragover/drop`) — no SortableJS.
- **Branches editor** (only shown for `gated`/conditional steps): each branch = `whenResultContains` text input
  + `goto` `<select>` (lists other step ids/names) + 🗑; bottom `+ Add Branch`. If a `goto` targets an
  earlier step index, show 🔄 on that row (loop hint).
- **Security**: all model/user/workflow strings rendered via `textContent`/`createElement` or escaped — **no
  `innerHTML` with workflow data**. Agent lists come from the extension (request via postMessage).
- **Data flow**: open → postMessage `requestWorkflows` → extension replies with `{ custom: WorkflowConfig[],
  builtins: WorkflowTemplate[], agents: {id,name,role}[] }`. Save → postMessage `saveWorkflow` →
  extension validates + persists → replies `saved`/`error`.

### E4.2 — `WorkflowEngine` authoring methods `[C]`
- `listWorkflows(): WorkflowTemplate[]` — built-ins **plus** custom workflows from team.json
  (`loadTeamConfig().workflows`), mapped to the template shape; tag origin so the UI can mark built-ins
  read-only (e.g. a `builtin: boolean` on the returned items, or two separate arrays as in E4.1's reply).
- `async saveWorkflow(workflow: WorkflowConfig): Promise<{ ok: true } | { ok: false; error: string }>` —
  **validate before persist**: (a) non-empty `id`/`name`; (b) every `branch.goto` references an existing
  `step.id` in the same workflow → otherwise reject with a clear message; (c) `from`/`to` non-empty. On
  success, load-merge-save via `PersistenceManager.saveCustomWorkflows` (upsert by `id`). Refuse to overwrite
  a built-in id.
- `async deleteWorkflow(id: string): Promise<void>` — remove from team.json custom list (no-op for built-ins).
- **Pure helpers** (testable without vscode), e.g. in a new `src/workflow/workflowSerialize.ts`:
  `serializeWorkflowSteps(rows) → WorkflowStep[]` and `parseWorkflowSteps(WorkflowStep[]) → rows`, plus
  `validateWorkflowGotos(workflow): string | null`. Keep all goto/branch validation here.

### E4.3 — Integration + regression `[C]`
- `extension.ts`: register `WorkflowEditor` + `roam.editWorkflow` command; wire its deps (WorkflowEngine,
  PersistenceManager, resolveAgentName/agent list, MessageBus).
- Add an "Edit Workflow" entry point (command palette is enough; a button on the Team panel is a nice-to-have,
  optional).
- Regression: existing `GatedWorkflow` (8) + `WorkflowEngine` tests stay green.

## Validation / DoD
- `npm run compile` ✓ · `npm run lint` 0 error ✓ · `npm test` all green.
- **New unit tests (≥6)**:
  - TeamFileSchema: valid `workflows` parse; non-array/ malformed → issue + dropped (2).
  - workflowSerialize: `parse`↔`serialize` round-trip (1); `validateWorkflowGotos` invalid goto → message (1).
  - WorkflowEngine: `saveWorkflow` invalid goto → reject (1); valid branches → persisted + appears in
    `listWorkflows` (1); `deleteWorkflow` → gone from list (1); refuse overwrite built-in id (1).
- **+1 E2E** (`test-e2e/suite/`): open Workflow Editor → a loaded workflow has steps.
- **Manual check** (report it): open editor, add a `gated` step with two branches, reorder by drag, Save →
  reopen → state persisted in `.roam/team.json` **and `members`/`mcpServers` untouched**.
- All user-facing strings English. No `innerHTML` with workflow/agent data. Security model intact.

## Out of scope
- No new runtime branch semantics (engine already routes branches — E4 is authoring only).
- No multi-tab "named dialogs" (that's backlog).
- No changes to how workflows are *triggered*.

## Hand-back to Claude
When green, report: branch name, test count, the manual-persistence check result, and confirm
`members`/`mcpServers` are preserved across a save. Claude re-runs gates, reviews the team.json writer +
no-innerHTML + goto validation, then commits/merges to main and updates STATUS.
