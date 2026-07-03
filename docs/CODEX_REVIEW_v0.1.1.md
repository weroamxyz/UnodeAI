# Codex Review Handoff — v0.1.1 (M1–M4)

> **For**: Codex code-review + test pass.
> **Branch/base**: `main` (v0.1.1 M1–M4 complete). Compare against `3acc89b` (v0.1.0 release) or
> `2eb760f` (planning commit — docs only, so `2eb760f..HEAD` is the pure implementation diff).
> **Status**: `npm.cmd run build` ✓ · `npm.cmd run lint` 0 error ✓ · `npm.cmd test` **203 passing** ✓ ·
> `npm.cmd run compile:e2e` ✗ (`TS2688: Cannot find type definition file for 'mocha'`).
> **Release readiness (Codex 2026-06-05)**: **not ready to publish v0.1.1 yet**. M1–M4 are implemented,
> but the release metadata/lockfile and B1 queue cancellation/error paths need cleanup first.
> **Specs**: [PRD v0.1.1 Rev.2](PRD_v0.1.1_Product_Brief.md) · [DevPlan](DevPlan_v0.1.1.md) (each milestone has a ✅ banner with the landed files).

## Scope under review

v0.1.1 is a feature patch: "let users control model behavior without editing JSON by hand." All four
milestones landed.

| ID | What | Key files |
|----|------|-----------|
| **B1** | `maxConcurrentAgents` over-limit → queue + auto-drain + `session.queued` toast (was: throw) | `session/SessionManager.ts`, `extension.ts` |
| **B2** | `roam.commandApproval` blocks no longer silent → debounced warning toast w/ "Open Settings" | `backend/TeamTools.ts`, `extension.ts` |
| **B3** | OutputChannel HTML escaping — **verified already mitigated**, no change (see note) | — |
| **F2** | `ModelParamResolver`: 5-level param hierarchy + `roam.modelDefaults.*` | `params/ModelParamResolver.ts`, `types.ts`, `session/SessionManager.ts` |
| **F1** | Full model-param surface to backends (OpenAI body; claude `--effort`) | `backend/OpenAICompatBackend.ts`, `backend/ClaudeHeadlessBackend.ts` |
| **F1b** | Per-agent Context Window setting + inline ⓘ guidance | `views/SettingsPanel.ts` |
| **F3** | Smart Mode: `selectTier` per-task tier auto-selection + hot-swap; Settings tab | `workflow/SmartMode.ts`, `session/SessionManager.ts`, `views/SettingsPanel.ts`, `extension.ts` |
| **F4** | Session Memory: `.roam/rules.md` appended to each agent's system prompt at start | `session/RulesFile.ts`, `session/SessionManager.ts`, `extension.ts` |

## Suggested review focus (highest-risk first)

1. **Untrusted webview input** — `params/sanitizeModelParams.ts` and `SettingsPanel.saveTuning`/`saveSmart`.
   All Model-Tuning / Smart-Mode edits arrive from the webview. Confirm clamping/enum-whitelisting is
   airtight and that `setAgentTuning`/`updateSmartMode` can't be driven with an unknown agentId or
   out-of-range values. (Webview CSP is nonce-only script; the ⓘ help is pure-HTML `<details>`.)
2. **B1 concurrency queue** — `SessionManager.start()` (queue path), `drainPendingStarts()` (called from
   the `exit` handler), and `remove()` cleanup. Check for: double-start races, a queued agent that was
   removed before a slot freed, and the cap never being exceeded within the drain loop (relies on
   `start()` setting status `'starting'` synchronously before its first `await`).
3. **F3 tier hot-swap correctness** — `resolveTaskModel` (extension) → `SessionManager.deliverTurn` →
   `setModel`. Precedence in `SmartMode.selectTier`. Note the documented claude limitation (model is a
   spawn-time `--model`, so `setModel` only applies on next start — openai-compat hot-swaps next turn).
4. **F1 request-body construction** — `OpenAICompatBackend.chat()` only emits set fields; `stream`
   stays `false` regardless of param; `tool_choice` only when tools present. `ClaudeHeadlessBackend.buildArgs()`
   maps only `reasoning_effort`→`--effort` (other params have no CLI flag — verified against `claude --help`).
5. **Param resolution hierarchy** — `ModelParamResolver.resolve()` order: agent.modelParams > smart tier
   > legacy `temperature`/`maxTokens` > `roam.modelDefaults.*` > hard defaults; undefined fields dropped.
6. **F4 system-prompt injection** — `SessionManager.withProjectContext()` appends `.roam/rules.md` via a
   derived config copy (never mutates `info.config`, so restart re-derives). Note the runtime semantics:
   edits apply to newly (re)started agents (watcher reloads the cache); running sessions are not
   mid-flight mutated. Also: a restored L2 snapshot keeps its old system message — worth a look.

## Deviations from the DevPlan (intentional)

- **F3 roster access** lives in `SettingsPanelDeps` (`listAgentTunings`/`setAgentTuning`,
  `getSmartMode`/`updateSmartMode`), **not** `SettingsBridge` — the roster is live SessionManager state,
  not a "setting." Bridge stays scoped to secrets/config/MCP.
- **Smart Mode config storage** is VS Code settings (`roam.smartMode.*`, `roam.modelTiers`), not
  `team.json` — consistent with F2's `roam.modelDefaults.*`, and avoids team.json write plumbing.
  `roam.modelTiers` stores only deltas (shallow-merged over `DEFAULT_MODEL_TIERS` per tier).
- **`--json-schema` deferred** — claude's flag needs a concrete JSON schema; `response_format:json_object`
  intent can't map cleanly, so it's documented as not-yet-wired (not silently dropped).
- **B3 no-op** — the webview XSS surface was already escaped (`MessageLogProvider` server-side `esc()` +
  client `textContent`; Dashboard/Team via `esc`/`escAttr`). Agent OutputChannels are plain-text. The
  original "OutputChannel HTML escaping" item was a misdiagnosis; corrected in the DevPlan.

## Out of scope for this review

- MCP live validation, PM→claude delegation, workflow conditional-branch UI, full E2E suite —
  deferred to v0.2.0 (see PRD §1).
- F4 runtime mid-session system-prompt hot-update (current behavior: applies on next agent start).

## Test status

203 unit tests (Vitest) pass. New tests this cycle: `ModelParamResolver` (7), `sanitizeModelParams` (7),
`OpenAICompatBackend` F1 body (1), `TeamTools` B2 (1), `SmartMode` (8), `RulesFile`/`projectContextBlock` (6),
`SessionManager` B1 queue (2) + F3 tier swap (1) + F4 injection (1). E2E scaffold is unchanged and still
needs a networked run (`npm run test:e2e`).

---

## Codex readiness review — 2026-06-05

### Bottom line

**Do not publish v0.1.1 yet.** The feature work is in good shape and the core unit-test gate is green,
but the repository is not in a releaseable state. Two items should be treated as release blockers:

1. release metadata/lockfile are still effectively v0.1.0;
2. the new B1 concurrency queue can outlive user stop intent and can stall after start/error paths.

After those are fixed, rerun build/lint/unit tests plus at least E2E compile from a clean install.

### Blocking findings

#### P0 — Release would still package/publish as `0.1.0`, and the lockfile is not synced

- `package.json:5` is still `"version": "0.1.0"`, and `package-lock.json` root is also still `0.1.0`.
  `vsce package` / `vsce publish` from this tree would produce a `0.1.0` artifact, not v0.1.1.
- `package.json` declares E2E dev dependencies (`@types/mocha`, `mocha`, `@vscode/test-cli`,
  `@vscode/test-electron`), but `package-lock.json` does not contain them. This is observable locally:
  `npm.cmd run compile:e2e` fails with `TS2688: Cannot find type definition file for 'mocha'`.
- Release action: run a real dependency sync in a networked environment, commit the updated lockfile,
  bump to `0.1.1`, then package from that exact commit.

#### P0 — Queued starts are not cancel-safe

- `SessionManager.start()` queues over-cap starts in `pendingStarts` while leaving the session status
  as `stopped` (`src/session/SessionManager.ts:165`).
- `SessionManager.stop()` returns early for `stopped` sessions (`src/session/SessionManager.ts:208`)
  before removing that id from `pendingStarts`. As a result, `Stop Agent` / `Stop All` can leave a
  queued agent in the pending-start FIFO; when another agent later stops, `drainPendingStarts()` can
  start an agent the user already tried to stop.
- Release action: make `stop(id)` remove that id from `pendingStarts` before the early return, and
  make `stopAll()` clear all pending starts. Add regression coverage for `startAll()` followed by
  `stopAll()` before the queued agent gets a slot.

#### P0 — Queued starts can stall when a start/error path frees capacity without an `exit`

- In `SessionManager.start()`, if `backend.start(env)` throws, the catch block marks the session
  `error` and deletes the backend (`src/session/SessionManager.ts:198`), but it does not call
  `drainPendingStarts()`.
- In `onBackendEvent('error')`, status becomes `error`, but the queue is not drained there either.
  Since `getRunningCount()` no longer counts the errored session, capacity is available, but queued
  agents may sit forever until some unrelated backend emits `exit`.
- Release action: drain the queue whenever a starting/running session transitions to `error` or a
  start attempt fails after consuming a slot. Add regression coverage for “first start fails, second
  queued agent starts.”

### Important follow-ups

- `SettingsPanel.saveSmart()` validates `tier` and string shape, but `modelTierCell` accepts any
  provider key from the webview and persists it into `roam.modelTiers` (`src/views/SettingsPanel.ts:180`,
  `src/extension.ts:865`). This is not an obvious RCE/security issue, but it is still untrusted
  webview input and should be restricted to the rendered provider ids or known provider registry.
- The docs currently describe B4 as “lockfile already done” in a few places. That is no longer true
  after comparing `package.json` to `package-lock.json`; update PRD/DevPlan/STATUS after the lockfile
  decision so Claude/DeepSeek do not chase stale assumptions.
- E2E remains unverified. Unit coverage is strong, but the new Settings webview and VS Code activation
  paths are precisely where E2E smoke coverage is valuable.

### Positive signals

- `npm.cmd run build` passed.
- `npm.cmd run lint` passed with 0 errors.
- `npm.cmd test` passed: 29 test files, 203 tests.
- The high-risk input path for Model Tuning is mostly well-contained: `saveTuning()` checks known
  `agentId`, and `sanitizeParams()` clamps/whitelists the persisted model params.
- F4 rules injection is implemented as a derived config copy, so the stored agent config is not mutated
  on each restart.

### Suggested handoff for Claude / DeepSeek

Ask the next agent to make a narrow release-readiness patch:

1. Fix `SessionManager` pending-start cancellation and error-drain semantics.
2. Add unit tests for queued-start cancellation and failed-start drain.
3. Sync `package-lock.json` with current `package.json` devDependencies.
4. Bump package metadata to `0.1.1`.
5. Rerun: `npm.cmd run build`, `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run compile:e2e`.
6. Only then run `vsce package` and publish/tag from the clean commit.

---

## PRD implementation coverage review — 2026-06-05

### Summary

**Not all PRD features are fully implemented.** The backend/runtime foundation is mostly present, but
several PRD-visible surfaces are incomplete, especially Settings UI coverage and F4 runtime semantics.

| PRD item | Coverage | Notes |
|---|---:|---|
| F1 Advanced model params | Partial | Types and OpenAI-compatible backend pass-through exist. Settings UI does not expose the full PRD surface. |
| F1b Context Window UI | Mostly | Number input + inline help exist; context window applies on next backend start. |
| F2 Global defaults + hierarchy | Mostly | Resolver and VS Code settings exist. Smart-tier params are accepted by the resolver but not wired from Smart Mode. |
| F3 Smart Mode | Partial / mostly core | Auto tier selection and tier matrix exist. `taskTierHints` has settings/backend support but no Settings-panel editor. Storage intentionally uses VS Code settings, not PRD's `team.json`. |
| F4 Session Memory | Partial | `.roam/rules.md` is loaded/watched and appended at session start. Running agents are not updated on the next turn, and the file is not created empty on first launch. |
| B1 Concurrency cap | Partial | Queue + toast exist, but cancellation/error drain semantics are incomplete. |
| B2 Command blocked UX | Implemented | User warning/toast path exists for command-policy rejects. |
| B3 OutputChannel escaping | Mitigated/no-op | The original risk was reclassified: webviews escape content; OutputChannel is plain text. |
| B4 E2E devDeps sync | Not complete | `package.json` declares deps; `package-lock.json` is not synced and `compile:e2e` fails. |

### Missing or incomplete against PRD

#### F1 — Settings UI does not expose all advanced parameters

PRD says Model Tuning should expose temperature, top_p, max_tokens, reasoning_effort, stream,
thinking/budget, response_format, presence/frequency penalties, stop sequences, tool_choice, and a
"Use global default" checkbox per parameter.

Current `SettingsPanel.agentTuningCard()` exposes only:

- `temperature`
- `top_p`
- `max_tokens`
- `reasoning_effort`
- `presence_penalty`
- `frequency_penalty`
- `response_format`
- `contextWindowTokens`

Missing from the UI: `stream`, `thinking` / `budget_tokens`, `stop`, `tool_choice`, and per-field
"Use global default" checkboxes. `sanitizeParams()` also only persists the exposed subset, so those
missing fields cannot be controlled through the UI today. They can still be honored by
`OpenAICompatBackend.chat()` if manually present in `team.json`.

#### F2 — Smart-tier model params are not actually wired

`ModelParamResolver.resolve(agent, smartTierParams?)` supports the PRD hierarchy shape, but
`SessionManager` is wired as `resolveModelParams: (config) => modelParamResolver.resolve(config)`.
No Smart Mode path currently supplies tier-level `AgentModelParams`, and there is no tier-params
configuration surface. Practically, the active hierarchy is:

1. `agent.modelParams`
2. legacy `agent.temperature` / `agent.maxTokens`
3. `roam.modelDefaults.*`
4. hard defaults

That is good enough for global/per-agent defaults, but not the full PRD line item "agent-role smart
tier params."

#### F3 — Smart Mode lacks task hint editor in Settings

Runtime support reads `roam.smartMode.taskTierHints`, and `selectTier()` applies it. However the
Settings panel only exposes enabled/default tier, per-role tier, and tier model matrix. The PRD asks
for an "Advanced JSON editor for `taskTierHints`"; that UI is not implemented.

Also note a storage deviation: the PRD examples put `smartMode` and `modelTiers` in `team.json`;
the implementation stores them in VS Code settings (`roam.smartMode.*`, `roam.modelTiers`). This may
be an acceptable product decision, but it is not PRD-exact and affects team-shareability.

#### F4 — Runtime update semantics do not match PRD

PRD behavior says editing `.roam/rules.md` should update running agents on their next turn by re-reading
before `sendUserTurn`. Current code appends `project_context` only in `SessionManager.start()` through
`withProjectContext()`. The watcher reloads the cache, but running backend conversations are not changed.

Additional gaps:

- Missing-file behavior is "empty string"; PRD says `.roam/rules.md` is created empty on first launch.
- A restored conversation snapshot keeps its old system message, so a restarted/restored session may not
pick up a changed rules file if the backend preserves the previous system prompt.
- No agent-suggested update flow exists in v0.1.1.

#### B1 — Queue behavior is not robust enough to call complete

The happy path works: over-cap starts are queued and drained after a backend exit. But release-readiness
review found two gaps:

- `stop()` / `stopAll()` do not reliably cancel queued starts because queued sessions remain `stopped`.
- `backend.start()` failure or backend `error` can free capacity without draining `pendingStarts`.

#### B4 — E2E dependency sync is incomplete

`package.json` includes E2E dependencies, but `package-lock.json` does not. Current local result:
`npm.cmd run compile:e2e` fails with `TS2688: Cannot find type definition file for 'mocha'`.

### What is implemented well

- OpenAI-compatible backend conditionally sends the advanced params it receives (`top_p`, penalties,
  `stop`, `response_format`, `reasoning_effort`, `thinking`, `tool_choice`).
- Claude backend correctly limits parameter mapping to `--effort` and documents why `json_object` is
  not directly mapped to `--json-schema`.
- Model Tuning validates known `agentId` and clamps/whitelists exposed parameter values.
- Smart Mode core tier selection and model lookup are pure and unit-tested.
- `.roam/rules.md` start-time injection uses a derived config copy, avoiding repeated mutation of
  stored agent config.

### Verdict

For "core backend/runtime scaffold": **mostly implemented**.

For "all PRD functionality, especially UI-visible user controls and documented runtime behavior":
**not fully implemented**.

---

## Post-fix status — 2026-06-05

Codex completed a PRD-completion pass after the review above. See
[`CODEX_V0.1.1_COMPLETION_LOG.md`](CODEX_V0.1.1_COMPLETION_LOG.md) for the step-by-step action log.

### Fixed since the review

- B1 queued-start cancellation and error-drain semantics.
- F4 running project-context update semantics:
  - `.roam/rules.md` can be created empty on activation;
  - each delivered turn carries latest project context;
  - OpenAI-compatible backend refreshes the system `<project_context>`;
  - Claude backend injects current project context on later turns.
- F1 Settings Model Tuning now exposes `stream`, `thinking`, `thinking.budget_tokens`, `stop`,
  `tool_choice`, and per-field "Use global default" controls.
- F2 Smart Mode tier params are wired through `roam.modelTierParams` into `ModelParamResolver`.
- F3 task-tier hints now have a Settings JSON editor, and invalid metadata/webview tier/provider/role
  inputs are filtered.
- E2E devDependencies were synced into `package-lock.json`.
- Package metadata was bumped to `0.1.1`.
- `.npm-cache/**` was excluded from VSIX packaging.

### Current verification

- `npm.cmd run build` passed.
- `npm.cmd run lint` passed.
- `npm.cmd test` passed: 30 files, 218 tests.
- `npm.cmd run compile:e2e` passed.
- `npm.cmd run test:e2e` passed: 3 tests.
- `npm.cmd run package` passed and produced `roam-crew-0.1.1.vsix` (5.61 MB).

### Remaining release cautions

- `npm install` reported 14 audit findings in the dependency tree (6 moderate, 7 high, 1 critical).
  No automatic `npm audit fix` was applied because it may introduce unrelated or breaking dependency
  churn. Review before Marketplace publish.
- VS Code E2E emitted Windows environment warnings (`WindowsApps` EPERM / Jump List / mutex), but tests
  passed and exited 0.
- VSIX still carries many files because the extension is not bundled; `vsce` warns about bundling.
  This warning existed before and is not a new functional blocker, but bundling remains a good follow-up.
