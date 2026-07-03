# UnodeAi v0.1.1 — Product Brief

> **Status**: Revised after codebase reconciliation (rev. 2)  
> **Date**: 2026-06-04  
> **Baseline**: v0.1.0 (Marketplace published 2026-06-05, commit `3acc89b`)  
> **Target**: Mid-June 2026

> **Rev. 2 changes (2026-06-04)** — corrected three things the first draft got wrong against the
> actual code & `claude` CLI:
> 1. **F3 (Smart Mode) reworked to reuse existing tier infrastructure.** The repo already ships
>    `type ModelTier = 'premium'|'standard'|'economy'` ([RoleConfig.ts](../src/roles/RoleConfig.ts)),
>    `DEFAULT_MODEL_TIERS` (per-provider tier→model tables), `modelForRole()`, and a runtime
>    `TierController.applyTiers()` ([TierController.ts](../src/workflow/TierController.ts)). The first
>    draft proposed a *parallel* `ModelTier` **interface** that would collide on the type name and
>    duplicate the tier tables. F3 now builds the auto-selection layer + config UI on top of what exists.
> 2. **F1 backend scope corrected.** The `claude` headless CLI exposes only `--model`,
>    `--fallback-model`, `--effort` (low/medium/high/xhigh/max → `reasoning_effort`), and
>    `--json-schema` (≈ structured output). It has **no** flags for `temperature`, `top_p`,
>    `max_tokens`, penalties, `stop`, `thinking.budget_tokens`, or `tool_choice`. The full parameter
>    surface is therefore **openai-compat only**; see the F1 backend matrix.
> 3. **B4 reduced.** `package-lock.json` is already committed (verified 2026-06-04). Only the E2E
>    devDependency sync remains.

---

## 1. Scope Summary

v0.1.1 is a **feature patch** (not a pure bugfix patch) centered on four user-requested capabilities plus selected P1 carryover from the Phase 2 backlog. The theme is **"give users control over model behavior without editing JSON by hand."**

### In Scope ✅

| # | Feature | Priority | Est. |
|---|---------|----------|------|
| F1 | Advanced model parameters per agent (temperature, top_p, thinking, etc.) | 🔴 P0 | 3d |
| F1b | Per-agent Context Window setting + inline ⓘ guidance (field already wired) | 🟡 P1 | 0.5d |
| F2 | Global defaults + per-agent override hierarchy | 🔴 P0 | 1d |
| F3 | Smart Mode — tier auto-selection (on existing `TierController`) + tier-matrix UI | 🟡 P1 | 1.5d |
| F4 | Session Memory — `.roam/rules.md` cross-session global context (à la `.clinerules`) | 🟡 P1 | 2d |
| B1 | Concurrent-agent cap behavior definition (STATUS.md P2 #todo) | 🔴 P0 | 0.5d |
| B2 | PM `run_checks` UX when `commandApproval: none` (silent reject → user feedback) | 🔴 P0 | 0.5d |
| B3 | OutputChannel HTML escaping (PRD §13.5 known gap) | 🔴 P0 | 0.5d |
| B4 | E2E devDeps sync (lockfile already done ✅) | 🟢 P2 | 0.25d |

### Out of Scope ❌ (deferred to v0.2.0)

- MCP live validation (needs live tokens)
- PM delegation to Claude backend (needs IPC architecture)
- Workflow conditional-branch UI
- E2E full test suite (only dependency fix + 2-3 smoke tests)
- 5-agent concurrency stress test with real `claude` processes

---

## 2. Feature Details

### F1 — Advanced Model Parameters per Agent

**Problem**: Today `AgentConfig` only has `model`, `maxTokens`, `temperature`, and `baseUrl`. Users want to tune thinking mode, reasoning effort, response format, top_p, frequency/presence penalty, stop sequences, and tool_choice — the full OpenAI/Anthropic API surface.

**Design**:

```typescript
// New types (src/types.ts)
export interface AgentModelParams {
  // ── Sampling ──
  temperature?: number;        // 0.0–2.0
  top_p?: number;              // 0.0–1.0
  // ── Penalties ──
  presence_penalty?: number;   // -2.0–2.0
  frequency_penalty?: number;  // -2.0–2.0
  // ── Thinking / Reasoning ──
  // NOTE: openai-compat accepts thinking.budget_tokens; claude CLI only takes --effort (no budget).
  thinking?: { type: 'enabled'; budget_tokens?: number } | { type: 'disabled' };
  // openai-compat: low|medium|high. claude --effort also has xhigh|max. Union covers both;
  // the resolver clamps per backend (see backend matrix).
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  // ── Output control ──
  max_tokens?: number;
  stop?: string | string[];    // max 4
  response_format?: { type: 'text' | 'json_object' };
  // ── Tool behavior ──
  tool_choice?: 'auto' | 'none' | string;
  stream?: boolean;
}

// AgentConfig gains:
export interface AgentConfig {
  // … existing fields …
  /** Advanced model parameters. Falls back to global defaults. */
  modelParams?: AgentModelParams;
}
```

**Backend support matrix** (verified against `claude --help`, 2026-06-04):

| Param | openai-compat | claude headless | Mapping for claude |
|-------|:---:|:---:|---|
| `model` | ✅ body | ✅ | `--model` |
| `fallbackModel` (existing) | ✅ | ✅ | `--fallback-model` |
| `reasoning_effort` | ✅ body | ✅ | `--effort` (low/medium/high/xhigh/max) |
| `response_format` json | ✅ body | ⚠️ partial | `--json-schema <schema>` (schema, not `{type:json_object}`) |
| `temperature` | ✅ body | ❌ | — no CLI flag |
| `top_p` | ✅ body | ❌ | — |
| `max_tokens` | ✅ body | ❌ | — |
| `presence_penalty` / `frequency_penalty` | ✅ body | ❌ | — |
| `stop` | ✅ body | ❌ | — |
| `thinking.budget_tokens` | ✅ body | ❌ | only `--effort`, no budget |
| `tool_choice` | ✅ body | ❌ | — (claude auto-decides) |
| `stream` | ✅ (already `false` in tool loop) | n/a | controlled by `--output-format stream-json` |

**Backend wiring**:
- `OpenAICompatBackend`: extend the request body at [OpenAICompatBackend.ts:290](../src/backend/OpenAICompatBackend.ts#L290) — today it only sets `model` / `messages` / `stream` / `temperature` / `max_tokens`. Add the remaining params conditionally (omit when undefined). **This is where the full surface lands.**
- `ClaudeHeadlessBackend`: extend `buildArgs()` at [ClaudeHeadlessBackend.ts:176](../src/backend/ClaudeHeadlessBackend.ts#L176) — add `--effort` (from `reasoning_effort`) and optionally `--json-schema`. **All other params are silently ignored for claude agents** (no flags exist).

**UI — Settings Panel**: New tab "Model Tuning" per agent in the team config. Each parameter has:
- A label + short description tooltip
- A control (slider / dropdown / text input depending on type)
- A "Use global default" checkbox that grays out the control
- **Backend-aware disabling**: when the agent's `backend` is `claude`, params not in the matrix above render disabled with a "openai-compat only" hint (avoids the false impression they take effect).

**F1b — Context Window (per-agent), with inline guidance**

The runtime already gates context occupancy at 70% (soft compaction) / 80% (hard stop) of a per-agent
window — `AgentConfig.contextWindowTokens` exists and feeds `TokenCounter`
([OpenAICompatBackend.ts:109](../src/backend/OpenAICompatBackend.ts#L109)). It defaults to 128K
(Anthropic-shaped), but real windows differ per model — so the value should be **user-settable**, with
help on how to choose it.

- **Control**: a "Context Window (tokens)" number input in the Model Tuning card, writing
  `AgentConfig.contextWindowTokens`. Placeholder shows the 128K default. **No backend change** — the
  field and gate are already wired; this is purely surfacing it.
- **Ref affordance (ⓘ)**: a CSP-safe inline help — a pure-HTML `<details><summary>ⓘ</summary>…</details>`
  (no JS; the webview CSP is nonce-only script). Clicking expands guidance that points the user to look
  up THEIR model's window online rather than hardcoding a per-model table that goes stale. Guidance text:
  - *What it is*: max tokens a model considers at once — varies by model, no universal default.
  - *How to find yours*: check your provider's model docs/spec page. Rough ranges (verify for your exact
    model — these change often): many GPT/Claude 128K–200K; Gemini up to 1M+; some open models 32K–64K.
  - *Why set it accurately*: UnodeAi compacts at 70% and stops new tool calls at 80% of this number to
    stay out of the degradation band near the limit — set it to the model's real window.
  - *Bigger isn't free*: a larger window holds more context but costs more tokens/latency per call and
    asks the model to reason over more — set the model's actual limit, don't inflate it.

---

### F2 — Global Defaults + Per-Agent Override Hierarchy

**Problem**: Each agent in `team.json` currently sets `model` and `temperature` independently. Users want to set organization-wide defaults and only override per-agent when needed.

**Resolution order** (first match wins):

```
1. Agent-level explicit value (team.json → members[].modelParams)
2. Agent-role smart tier (Smart Mode, when enabled)
3. Global VS Code setting (roam.modelDefaults.*)
4. Hardcoded fallback (temperature=0.7, max_tokens=4096, stream=true)
```

**New VS Code settings** (`package.json` contributes):

```json
{
  "roam.modelDefaults.temperature": { "type": "number", "default": 0.7, "minimum": 0, "maximum": 2 },
  "roam.modelDefaults.topP": { "type": "number", "default": 1, "minimum": 0, "maximum": 1 },
  "roam.modelDefaults.maxTokens": { "type": "integer", "default": 4096 },
  "roam.modelDefaults.reasoningEffort": { "type": "string", "enum": ["low", "medium", "high", "max"], "default": "medium" },
  "roam.modelDefaults.stream": { "type": "boolean", "default": true },
  "roam.modelDefaults.responseFormat": { "type": "string", "enum": ["text", "json_object"], "default": "text" }
}
```

**Implementation**: A new `ModelParamResolver` utility that takes `(agentConfig, globalDefaults)` → resolved `AgentModelParams`.

---

### F3 — Smart Mode (Tier-Based Model Selection)

**Problem**: Users have access to multiple models at different price points (Opus/Sonnet/Haiku, or DeepSeek Pro/Flash on the Roam gateway). They want a "cheap" model for simple tasks and a "powerful" model for complex reasoning, without manually switching per task.

> **⚠️ Reuse, don't reinvent.** The tier mechanism already exists. v0.1.1 only adds the **auto-selection
> trigger** (task → tier) and the **config UI** on top of it. Do **not** introduce a new `ModelTier`
> type — the name is taken.

**What already exists (the foundation):**

| Existing piece | Location | Role in F3 |
|---|---|---|
| `type ModelTier = 'premium'\|'standard'\|'economy'` | [RoleConfig.ts:123](../src/roles/RoleConfig.ts#L123) | the 3 tiers — reuse as-is |
| `DEFAULT_MODEL_TIERS: Record<ModelTier, Record<providerId, modelId>>` | [RoleConfig.ts:125](../src/roles/RoleConfig.ts#L125) | the per-provider tier→model tables — the "2–3 models per role" data |
| `RoleTemplate.tier` + `modelOverride` | [RoleConfig.ts:158](../src/roles/RoleConfig.ts#L158) | each role's default tier + per-provider override |
| `modelForRole(template, provider, tiers)` | [RoleConfig.ts:135](../src/roles/RoleConfig.ts#L135) | resolves tier → concrete model |
| `TierController.applyTiers({roleOrId: tier})` | [TierController.ts:50](../src/workflow/TierController.ts#L50) | runtime hot-swap via `SessionManager.setModel` (no restart for openai-compat) |

So the user's request — *"each role lists 2–3 model choices"* — is already modeled by `DEFAULT_MODEL_TIERS` (3 tiers × per-provider model). F3 makes it **editable and auto-driven**.

**What v0.1.1 adds:**

```typescript
// src/workflow/SmartMode.ts  (NEW — the auto-selection layer; pure, unit-testable)
import { ModelTier } from '../roles/RoleConfig';   // reuse the existing union

export interface SmartModeConfig {
  enabled: boolean;
  /** Tier used when nothing else matches. */
  defaultTier: ModelTier;                          // 'premium' | 'standard' | 'economy'
  /** Optional: bump/drop a role's tier for specific message types. */
  taskTierHints?: Partial<Record<string, ModelTier>>; // e.g. { 'review.request': 'economy' }
}

/** Decide the tier for an inbound task, then defer to TierController to apply it. */
export function selectTier(
  msg: { type: string; payload?: { metadata?: { tier?: ModelTier } } },
  cfg: SmartModeConfig,
  roleDefault: ModelTier,
): ModelTier {
  if (!cfg.enabled) return roleDefault;            // OFF → keep the role's configured tier
  return (
    msg.payload?.metadata?.tier ??                 // 1. explicit per-task override
    cfg.taskTierHints?.[msg.type] ??               // 2. task-type hint
    roleDefault                                    // 3. role default (RoleTemplate.tier)
  );
}
```

**Override-table editing** (the user's *"config page with 2–3 models per role"*): the editable
data is `DEFAULT_MODEL_TIERS` plus per-role `modelOverride`. v0.1.1 surfaces these in
`team.json` as an optional `modelTiers` override map that, when present, replaces the built-in
defaults passed into `TierController`/`modelForRole`:

```json
{
  "smartMode": {
    "enabled": true,
    "defaultTier": "standard",
    "taskTierHints": { "review.request": "economy", "task.assign": "premium" }
  },
  "modelTiers": {
    "premium":  { "roam": "claude-opus-4-8",    "anthropic": "claude-opus-4-8",   "openai": "gpt-4o" },
    "standard": { "roam": "deepseek-v4-pro",    "anthropic": "claude-sonnet-4-5", "openai": "gpt-4o" },
    "economy":  { "roam": "deepseek-v4-flash",  "anthropic": "claude-haiku-4-5",  "openai": "gpt-4o-mini" }
  }
}
```

> Both keys are optional; absent → falls back to `DEFAULT_MODEL_TIERS` and Smart Mode OFF. **No schema break.**
> Model ids above match the existing `DEFAULT_MODEL_TIERS` — keep them in sync, don't re-pick (the
> first draft used stale `claude-*-20250514` ids).

**Tier selection flow** (at task dispatch in `SessionManager`):

```
1. Smart Mode OFF → leave the agent on its configured model (no change)
2. ON → selectTier(msg, smartMode, agentRoleDefault)
3. TierController.applyTiers({ <agentId>: tier })  → modelFor(tier, provider) → setModel
4. OpenAICompatBackend picks up the new model on the next turn (zero restart, context kept).
   claude agents: setModel requires a process restart — gate behind the existing restart path,
   or skip live-swap for claude backends in v0.1.1 (document the limitation).
```

**UI — Settings Panel "Smart Mode" tab**:
- Global ON/OFF toggle + default-tier dropdown
- An editable **tier matrix**: rows = `premium/standard/economy`, columns = configured providers, cells = model picker (seeded from `DEFAULT_MODEL_TIERS`). This *is* the "2–3 models per role" surface — a role's tier (from `RoleTemplate.tier`) points at one row.
- Per-role default-tier override (small dropdown next to each agent)
- "Advanced" JSON editor for `taskTierHints`

---

### F4 — Session Memory (`.roam/rules.md`)

**Problem**: Each agent session starts with a clean slate. There is no cross-session "project memory" — agents don't know what happened in previous sessions, what architectural decisions were made, or what conventions the team follows. Cline solves this with `.clinerules`.

**Design**: RoamCrew introduces `.roam/rules.md` (workspace root) as the project-level memory file.

**Behavior**:
1. **On session start**: Every agent's system prompt is **appended** with the contents of `.roam/rules.md` (wrapped in `<project_context>` tags).
2. **On manual update**: User edits `.roam/rules.md` → all running agents get the updated context on their next turn (re-read before `sendUserTurn`).
3. **Agent-driven update** (v0.1.1 MVP — manual only; v0.2.0 for agent auto-update): Agent can suggest updates but they are not auto-applied.

**Structure of `.roam/rules.md`**:

```markdown
# UnodeAi Project Memory

> Last updated: 2026-06-04 by PM agent · Auto-generated section — edit freely

## Architecture Decisions
- 2026-06-01: Chose PostgreSQL over MongoDB for structured billing data
- 2026-06-03: Adopted Event Sourcing for the Orders bounded context

## Coding Conventions
- TypeScript strict mode enabled project-wide
- Use Zod for all API boundary validation
- Error types must extend AppError base class

## Active Context
- Currently migrating auth from JWT to session tokens (75% complete)
- PR #342 is the active integration branch — don't merge to main until it lands
```

**Implementation**:

```typescript
// src/session/RulesFile.ts
export class RulesFile {
  private content: string = '';
  private path: string;
  private watcher?: vscode.FileSystemWatcher;

  constructor(workspaceRoot: string) {
    this.path = path.join(workspaceRoot, '.roam', 'rules.md');
  }

  /** Read the current rules content. Returns '' if file doesn't exist. */
  async load(): Promise<string> { /* … */ }

  /** Get cached content (last loaded value). */
  get(): string { return this.content; }

  /** Watch for changes and auto-reload. */
  watch(onChange: (content: string) => void): vscode.Disposable { /* … */ }
}
```

**System prompt augmentation** (in `backend.start()`):

```
Current system prompt
+ "\n\n<project_context>\n" + rulesFile.get() + "\n</project_context>"
```

This is appended **after** the agent's explicit `systemPrompt` so the agent's role-specific instructions take precedence, but project-level facts are always available.

---

### B1–B4 — Bugfixes & Polish

| ID | What | Where | Notes |
|----|------|-------|-------|
| B1 | `maxConcurrentAgents` over-limit behavior | `SessionManager.start()` | Current: throws error. Better: queue + notify user with "Agent X queued (slot available in ~N seconds)" |
| B2 | PM `run_checks` / `verifyCommand` silent reject | `CommandPolicy` or `TeamTools` | When `commandApproval: "none"`, show a warning toast explaining *why* the command was blocked. Don't just fail silently. |
| B3 | OutputChannel HTML escaping | `MessageLogProvider` or `extension.ts` where output is written | Wrap agent output in a `<pre>` or use `escAttr` before emitting to the OutputChannel tree view. |
| B4 | E2E devDeps sync | `test-e2e/` | `package-lock.json` is **already committed** (verified 2026-06-04) — that half is done. Remaining: in a networked env run `npm install` so the E2E `@vscode/test-cli` devDeps resolve, then run the smoke tests. Not a release blocker. |

---

## 3. File Change Map

| File | Change | Feature |
|------|--------|---------|
| `src/types.ts` | Add `AgentModelParams` + `SmartModeConfig`; extend `AgentConfig` (`modelParams?`) and `TeamConfig` (`smartMode?`, `modelTiers?`). **Do NOT add `ModelTier`** — reuse the existing union in `RoleConfig.ts`. | F1, F2, F3 |
| `src/backend/AgentBackend.ts` | Extend `BackendOptions` / `UserTurnOptions` to carry resolved `AgentModelParams` | F1, F2 |
| `src/backend/ClaudeHeadlessBackend.ts` | In `buildArgs()` add `--effort` (from `reasoning_effort`) + optional `--json-schema`. Other params N/A (no CLI flags). | F1 |
| `src/backend/OpenAICompatBackend.ts` | In `chat()` extend the request body with the full resolved param surface (conditional on defined) | F1 |
| `src/params/ModelParamResolver.ts` | **New file** — resolve `(agentConfig, smartTier, globalDefaults) → AgentModelParams` (the F2 hierarchy); pure/unit-testable | F2 |
| `src/workflow/SmartMode.ts` | **New file** — `selectTier()` auto-selection layer; defers to existing `TierController` to apply | F3 |
| `src/workflow/TierController.ts` | Reused as-is; accept optional `modelTiers` override from `team.json` (constructor already takes a tiers table) | F3 |
| `src/settings/SettingsBridge.ts` | Add `roam.modelDefaults.*` read; Smart Mode + `modelTiers` config read/write | F2, F3 |
| `src/views/SettingsPanel.ts` | New tabs: "Model Tuning" (per-agent, backend-aware disabling), "Smart Mode" (editable tier matrix + per-role default tier) | F1, F3 |
| `src/session/SessionManager.ts` | Integrate `ModelParamResolver`; call `SmartMode.selectTier` + `TierController.applyTiers` at dispatch; queue-on-cap (B1); inject `.roam/rules.md` | F2, F3, F4, B1 |
| `src/session/RulesFile.ts` | **New file** — `.roam/rules.md` reader/watcher | F4 |
| `src/extension.ts` | Wire `RulesFile`, `ModelParamResolver`, `SmartMode`; update Settings panel deps | F2, F3, F4 |
| `package.json` | Add `roam.modelDefaults.*` and `roam.smartMode.*` configuration contributions | F2, F3 |
| `docs/PRD_v0.1.1_Product_Brief.md` | This document | — |

---

## 4. Migration & Compatibility

- **No breaking changes to `team.json` schema**: All new fields are optional with sensible defaults.
- **Existing agents without `modelParams`**: Fall through to global defaults → hardcoded fallbacks. Behavior unchanged.
- **Smart Mode OFF by default**: Existing teams continue using explicit `model` fields.
- **`.roam/rules.md`**: Created empty on first launch if missing. No impact on existing projects.

---

## 5. Test Plan

| Layer | What |
|-------|------|
| Unit | `ModelParamResolver` resolution order (agent > smart tier > global > fallback) |
| Unit | Smart Mode tier selection logic (explicit tier, task hint, default) |
| Unit | `RulesFile.load()` / `.get()` / file-not-found returns `''` |
| Unit | `AgentModelParams` serialization round-trip |
| Integration | `OpenAICompatBackend` receives resolved params in request body |
| Integration | `ClaudeHeadlessBackend.buildArgs()` emits `--effort` for `reasoning_effort`, and omits unsupported params |
| Unit | `SmartMode.selectTier` precedence: explicit metadata.tier > taskTierHint > role default; OFF → role default |
| Unit | `TierController` honors a `team.json` `modelTiers` override (vs `DEFAULT_MODEL_TIERS`) |
| UI smoke | Settings Panel "Model Tuning" tab renders per-agent controls + disables non-matrix params for claude agents |
| UI smoke | Settings Panel "Smart Mode" tab renders the editable tier matrix |
| E2E | Create default team → launch → verify `.roam/rules.md` is injected into system prompt |

---

## 6. Milestones & Versioning

| Milestone | Target | Contents |
|-----------|--------|----------|
| M1 — Foundation | Day 1–2 | B1–B3 bugfixes + F2 (`ModelParamResolver` global defaults + resolution hierarchy) |
| M2 — Advanced Params | Day 3–4 | F1 (openai-compat full surface + claude `--effort`; backend-aware Settings UI) |
| M3 — Smart Mode | Day 5–6 | F3 (`SmartMode.selectTier` on existing `TierController` + editable tier-matrix UI) |
| M4 — Session Memory | Day 7–8 | F4 (`.roam/rules.md`) + B4 E2E sync (networked) |
| **Release** | **Day 9** | `0.1.1` → `vsce publish` |

**Version**: `0.1.1` (semver patch — adds backward-compatible features, no breaking changes)

---

*End of Product Brief*

---

## Post-Implementation Note — 2026-06-05

Codex completed the PRD completion pass after the initial review. The implemented behavior now covers
the previously missing PRD surfaces:

- F1: Settings Model Tuning exposes the remaining advanced controls (`stream`, `thinking`, thinking
  budget, `stop`, `tool_choice`) plus per-field default toggles.
- F2/F3: Smart Mode tier-level params are available via `roam.modelTierParams` and flow into
  `ModelParamResolver`.
- F3: `taskTierHints` can be edited in Settings.
- F4: running turns receive latest `.roam/rules.md` project context; missing rules file can be created.
- B1/B4: queued-start lifecycle blockers were fixed; E2E devDeps are synced into `package-lock.json`;
  package metadata is `0.1.1`.

Verification recorded in [CODEX_V0.1.1_COMPLETION_LOG.md](CODEX_V0.1.1_COMPLETION_LOG.md):
`build`, `lint`, 218 unit tests, `compile:e2e`, full VS Code E2E smoke, and `vsce package` pass.
npm audit review remains a pre-publish caution.
