# Codex Release Hardening Log

> Purpose: record every Codex-side action taken to prepare UnodeAi for formal release.
> Date: 2026-06-02

## Baseline

- `npm.cmd test` passed: 160 tests.
- `npm.cmd run build` passed.
- `npm.cmd run package` passed and produced `roam-crew-0.1.0.vsix`.
- Known release blockers before this pass:
  - Webview CSP / nonce hardening.
  - `.roam/team.json` schema validation.
  - ESLint configuration / CI wiring.
  - MCP least-privilege execution and approval gaps.
  - Command execution defaults and `verifyCommand` trust boundary.
  - Workspace symlink / junction sandbox escape.
  - README / USAGE / STATUS drift for Marketplace readiness.

## Action Log

### 2026-06-02 - Started Codex release hardening pass

- Created this dedicated hardening log.
- Confirmed scope with the user: implement necessary release fixes and update `docs/STATUS.md` plus related docs.

### 2026-06-02 - Hardened MCP authorization gates

- Patched `OpenAICompatBackend` so MCP execution receives the current agent grants instead of relying only on the server namespace.
- Added execution-time grant validation in `MCPHub` and tests for hidden-but-real MCP tools.
- Reworked MCP approval persistence from mutable server ids to workspace-scoped launch-spec fingerprints.
- Applied the same approval filter before generating Claude native `--mcp-config`, preventing Claude agents from bypassing the MCP approval prompt.

### 2026-06-02 - Reduced MCP subprocess secret exposure

- Changed stdio MCP startup to inherit only minimal OS launch variables instead of the full VS Code extension environment.
- Added a unit test proving common process secrets are not copied into MCP subprocess env by default.

### 2026-06-02 - Tightened command execution defaults

- Routed PM `run_checks` through the same `CommandPolicy` used by agent shell tools.
- Routed gated workflow `verifyCommand` through `CommandPolicy` so it cannot bypass shell execution controls.
- Changed release defaults to disable command execution by default and removed broad `node` / generic `npm run` prefixes from the default allowlist.

### 2026-06-02 - Hardened workspace file sandbox

- Added realpath validation for read/list/write targets so symlinks and Windows junctions cannot escape the workspace sandbox.
- Added a regression test covering read and write attempts through an outside-pointing link.

### 2026-06-02 - Added `.roam/team.json` schema validation

- Added a reusable team-file validator for `members` / legacy `agents` / `mcpServers`.
- Updated restore flow to validate `.roam/team.json` once and show a friendly warning instead of silently accepting malformed fields.
- Added schema tests for valid teams, legacy `agents`, and field-level validation failures.

### 2026-06-02 - Started webview CSP hardening

- Added a shared webview security helper for nonce generation, CSP composition, and HTML escaping.
- Applied `script-src 'none'` CSP to the Dashboard webview and disabled scripts for the Dashboard panel.
- Applied nonce-based CSP to Message Log and replaced inline `onclick` expansion with delegated event handling.
- Applied nonce-based CSP to Team Panel, removed inline button handlers, escaped skill names, and added host-side message schema checks.
- Applied nonce-based CSP to Settings Panel, removed inline button handlers, and restricted secret operations to provider-owned secret names from the current snapshot.

### 2026-06-02 - Added ESLint release gate

- Added a conservative TypeScript ESLint configuration so `npm run lint` can execute in CI without triggering unrelated style churn.

### 2026-06-02 - Added CI and packaging metadata

- Added a GitHub Actions workflow covering install, lint, build, unit tests, and VSIX packaging.
- Added an MIT `LICENSE` file to remove the VSIX packaging warning.
- Updated `.vscodeignore` so Marketplace users can open `USAGE.md`, `docs/STATUS.md`, and this hardening log from README links.
- Attempted `npm install --package-lock-only --ignore-scripts` to sync E2E dev dependencies into `package-lock.json`; it timed out in this restricted environment, so lockfile sync remains a release-environment task.

### 2026-06-02 - Updated release-facing documentation

- Added a current Codex hardening status note to `docs/STATUS.md`.
- Added release safety notes to `README.md` and `USAGE.md`, including the new command-execution default and remaining lockfile/E2E task.

### 2026-06-02 - Ran final validation pass

- `npm test` passed: 25 files, 168 tests.
- `npm run lint` passed with 0 warnings/errors after removing stale unused imports.
- `npm run build` passed.
- `npm run package` passed and produced `roam-crew-0.1.0.vsix` (4279 files, 5.55 MB); LICENSE warning is gone. Remaining package warning is file count / lack of bundling because production `node_modules` is intentionally shipped.
- `npm run compile:e2e` still fails with `TS2688: Cannot find type definition file for 'mocha'`, matching the known unsynced E2E devDependency/lockfile issue.
