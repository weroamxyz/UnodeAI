# Codex Task Card — E6: Onboarding / 30-seconds-to-value

> Wave 1, second card (after E4). Source: [DevPlan_v0.2.0.md](DevPlan_v0.2.0.md) §E6 (Tasks E6.1–E6.4).
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1 (security model intact, **all user-facing
> text English**, webview injects data via `textContent`/DOM only — **never `innerHTML` string-building**).
> **Scope = E6 only.** Branch: `codex/e6-onboarding`.

## Goal
A first-run setup wizard that takes a new user from install → working team → first demo task in ~30 seconds,
plus a friendlier empty state and a demo-task library. **Reuse existing commands/flows — do not reinvent team
creation, API-key storage, or message sending.**

## Hard requirements (user-mandated — must appear verbatim-ish)
- Provider step's **Base URL input is prefilled with `https://www.unodetech.xyz/v1`** (read the default from
  the existing `roam.baseUrl` config, which already defaults to this — do NOT hardcode a second copy).
- Provider step shows a clickable link: **`Browse models & pricing → https://www.unodetech.xyz/pricing?lang=en`**
  to help users pick a model.

## Current-state anchors (verified — reuse these, don't duplicate)
- **Command registration**: `src/extension.ts` `registerCommands()` (~L917) uses `reg(name, handler)` +
  `guard(...)` + `dialogs.*` + `dialogDeps()`. Webview providers registered ~L252.
- **Quick Start team already exists**: `roam.createDefaultTeam` → `dialogs.createDefaultTeam(dialogDeps())`
  (PM + Dev + QA). The wizard's "Quick Start" MUST call this, not build its own team logic.
- **API key flow already exists**: `roam.setApiKey` → `dialogs.showSetApiKeyDialog` (`src/dialogs.ts`). It owns
  provider selection + base URL + SecretStorage secret name. The wizard's Provider step must persist via the
  **same SecretStorage secret name + same `roam.baseUrl` config** — inspect `showSetApiKeyDialog` and reuse its
  storage path so Settings and the wizard agree. Do not invent a new secret key.
- **Base URL default**: `getBaseUrl` (`extension.ts` ~L414) = `roam.baseUrl` config, default
  `https://www.unodetech.xyz/v1`. Prefill the wizard input from this config value.
- **Send to PM**: messages reach an agent via the MessageBus path used by `roam.sendMessage` /
  `dialogs.showSendMessageDialog` → `SessionManager` `deliverTurn` → `backend.sendUserTurn`. Demo-task run must
  use this same path (resolve the PM agent, send the demo `prompt`). Reuse, don't bypass.
- **Chat focus**: `roam.openChat` (auto-creates default team if none, then `roam.chat.focus`);
  `roam.chatWithAgent(agentId)`.
- **First-run flag**: use `context.workspaceState` (already passed around, e.g. `state:` at L247). Key:
  `roam.onboardingComplete`.
- **Webview pattern**: mirror `src/views/SettingsPanel.ts` (inline HTML + CSP nonce + `data-command` +
  `postMessage`). Security helper: `src/views/webviewSecurity.ts`. **No `innerHTML` with user/model data.**

## Subtasks

### E6.1 — `OnboardingWizard` webview (5 pages) `[C]`
- New file `src/views/OnboardingWizard.ts` — a **WebviewPanel** (modal-feel, not dockable). Command
  `roam.onboarding` → `UnodeAi: Run Setup Wizard` (also manually invokable).
- One HTML file, 5 `<section>`s toggled by `display:none/block` (no SPA router). Bottom bar: 5 step dots
  (● ○ ○ ○ ○) + Back / Skip / Next.
  1. **Welcome** — "Welcome to UnodeAi" + "AI agents that work together, right in VS Code" + "Get Started →".
  2. **Provider** — radio: OpenAI Compatible (default) / Claude Headless. **Base URL input prefilled from
     `roam.baseUrl`** (`https://www.unodetech.xyz/v1`). API Key input (or Skip) → persist via the existing
     setApiKey storage path (same secret name + write base URL to `roam.baseUrl`). **Clickable link
     `Browse models & pricing → https://www.unodetech.xyz/pricing?lang=en`** (use `sanitizeHref`; open via
     `vscode.env.openExternal` from the extension side on a postMessage, or a plain anchor with `target`).
  3. **Team** — 2 cards: ⚡ Quick Start (PM+Dev+QA, default-selected) → calls `roam.createDefaultTeam`; ✏
     Custom → `roam.addAgent`. "Create Team →".
  4. **Demo** — 3 demo-task cards (from E6.3's library) → "Run →" sends the chosen demo prompt to PM.
  5. **Done** — "You're all set!" + 3 buttons: Dashboard (`roam.showDashboard`) / Chat (`roam.openChat`) /
     Settings (`roam.openSettings`) + "Finish" (sets `roam.onboardingComplete = true`, closes panel).
- All wizard actions run extension-side via `postMessage` → an `OnboardingDeps` wrapper (SessionManager,
  SecretStorage, workspaceState, command invocations). Webview never touches secrets directly.
- **Security**: every label/value via `textContent`/`createElement` or escaped; links via `sanitizeHref`.

### E6.2 — Team panel empty-state enhancement `[C]`
- `src/views/TeamViewProvider.ts` `getWebviewContent`: when the agent list is empty, replace the current
  "Add your first agent →" with a 3-card grid (CSS Grid, hover bg change):
  - 🚀 **Quick Start Team** — "One click to create PM + Dev + QA" → `roam.createDefaultTeam`.
  - 🧪 **Run Demo Task** — "See UnodeAi in action with a pre-built task" → `roam.runDemoTask`.
  - 📖 **Open Documentation** — "Learn about agents, teams, and workflows" → open `USAGE.md`.
- Keep existing non-empty rendering untouched. No `innerHTML` with dynamic data.

### E6.3 — Demo task library `[C]`
- New file `src/state/DemoTasks.ts`: export `DEMO_TASKS: DemoTask[]`, each
  `{ id, title, description, prompt, expectedOutcome }`. 5 presets: ① Hello World HTTP Server (TS, ~20 lines)
  ② Add unit tests to selected file (vitest, 3–5 tests) ③ Code review `src/extension.ts` ④ Create a React
  component ⑤ Write project README (inferred from code).
- Command `roam.runDemoTask` → QuickPick of titles → selected → send `prompt` to PM via the existing send path.
  Guard: no PM → prompt to create a team; no agents → prompt to run the Setup Wizard.
- Pure-export + a tiny unit test (e.g. `DEMO_TASKS` ids unique, all fields non-empty).

### E6.4 — `extension.ts` integration `[C]`
- Register `OnboardingWizard` provider + commands `roam.onboarding`, `roam.runDemoTask` (and confirm
  `roam.editWorkflow` from E4 stays registered).
- `package.json` contributes the new commands (`UnodeAi: Run Setup Wizard`, `UnodeAi: Run Demo Task`).
- `activate()`: if `workspaceState.get('roam.onboardingComplete')` is falsy → after a ~1s delay (let UI render)
  → `vscode.commands.executeCommand('roam.onboarding')`.
- Build `OnboardingDeps` (SessionManager, SecretStorage, workspaceState, command runner). Inject into the
  wizard.

## Validation / DoD
- `npm run compile` ✓ · `npm run lint` 0 error ✓ · `npm test` all green.
- **New unit tests**: DemoTasks (ids unique / fields non-empty); any pure helper you extract (e.g. wizard
  step/state reducer if you make one). Aim ≥3 new unit tests.
- **+1 E2E** (`test-e2e/suite/`): completing the wizard sets `roam.onboardingComplete = true`.
- **Manual checks** (report them):
  1. Fresh workspace (clear `roam.onboardingComplete`) → wizard auto-opens; Base URL prefilled with
     `https://www.unodetech.xyz/v1`; pricing link present and opens `…/pricing?lang=en`.
  2. Quick Start creates PM+Dev+QA (via `createDefaultTeam`); Demo step sends a task that reaches PM; Finish
     sets the flag and the wizard does not re-open on reload.
  3. Empty Team panel shows the 3 cards.
- All user-facing strings English. No `innerHTML`/`insertAdjacentHTML`/`outerHTML` with dynamic data. API key
  stored via the existing SecretStorage secret name (verify Settings still reads it). Security model intact.

## Out of scope
- No new provider/auth mechanism — reuse `showSetApiKeyDialog`'s storage.
- No telemetry/analytics.
- No changes to how agents actually run.

## Hand-back to Claude
When green, report: branch name, test count, and the 3 manual-check results (esp. Base URL prefill + pricing
link, and that the existing SecretStorage key is reused so Settings agrees). Claude re-runs gates, reviews
no-innerHTML + reuse-not-duplicate (team creation / API-key storage / send path) + the two user-mandated
items, then commits/merges to main and updates STATUS. Next Wave-1 card after E6: E5b (esbuild).
