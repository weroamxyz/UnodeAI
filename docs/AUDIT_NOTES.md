# UnodeAi — Audit Notes & Reviewer Guide

> Prepared for an external code review/audit (codex team). Purpose: give reviewers an honest map of
> the project, the **dependency-vulnerability triage** (what actually ships vs dev-only), and a
> candid **known-limitations** list so review effort goes to deep correctness/security rather than
> rediscovering things we already know.
>
> **Date**: 2026-06-02 · **Version**: 0.1.0 · **Baseline**: this is the first git commit of an
> existing working tree (see commit message). History before this point lived outside git.
> Authoritative progress/next-steps: [STATUS.md](STATUS.md). Spec: [PRD](../PRD_MultiAgent_VSCode_Extension.md).

---

## 1. Dependency vulnerability triage

`npm audit` reports **11** (4 moderate / 6 high / 1 critical). **Severity is misleading without the
prod-vs-dev split** — almost all of it is in build/test tooling that is **never packaged into the
`.vsix`**.

### What actually ships (production deps in the VSIX)

`npm audit --omit=dev` → **1 moderate, 0 high, 0 critical**:

| Package | Severity | Advisory | Applies to our usage? | Action |
|---------|----------|----------|----------------------|--------|
| `uuid` | moderate | Missing buffer bounds check in v3/v5/v6 **when `buf` is provided** | **No** — we only call `uuidv4()` with no `buf` argument (see MessageBus / RoleConfig / WorkflowEngine). The vulnerable code path is never reached. | Optional bump to `uuid@14` (semver-major); low urgency given non-applicability. |

> Net shipped attack surface from dependencies: effectively zero in our usage pattern.

### Dev-only (NOT shipped — build/test toolchain)

These cannot affect an installed extension; they only matter on a developer's machine running the
toolchain:

| Package | Severity | Note |
|---------|----------|------|
| `vitest` | **critical** | Arbitrary file read/exec **only when the Vitest UI server is listening**. We run `vitest run` (no UI server) in CI/local; not exposed. |
| `@typescript-eslint/*` (5 pkgs) | high | Transitive `minimatch` ReDoS. Dev lint/build only. |
| `esbuild`, `vite`, `vite-node` | moderate | Vite dev-server path traversal / esbuild dev-server. We don't run a Vite dev server. |

**Recommendation**: bump dev tooling at convenience (`npm audit fix` covers most; vitest major may
need a version bump). None of these gate a release.

---

## 2. Known limitations (candid — don't waste audit time rediscovering)

Tracked in [STATUS.md](STATUS.md); summarized here for reviewers:

> **Update (Codex hardening pass + review follow-ups):** several items below were ADDRESSED — kept
> here with ✅ so reviewers see what changed. See [CODEX_RELEASE_HARDENING_LOG.md](CODEX_RELEASE_HARDENING_LOG.md) and PRD §13/changelog v2.8.

| Area | Current state | Planned / notes |
|------|---------------|-----------------|
| **Webview CSP/nonce** | ✅ **Addressed.** Shared `views/webviewSecurity.ts`; Dashboard `script-src 'none'`; Team/MessageLog/Settings use a **crypto-grade nonce** (`crypto.randomBytes`, fixed from Math.random in follow-up); inline `onclick` → delegated handlers; Settings restricts secret ops to provider-owned names. `style-src 'unsafe-inline'` retained for inline `<style>` (low risk). | Optional: externalize styles to drop `'unsafe-inline'`. |
| **`.roam/team.json` schema validation** | ✅ **Addressed.** `state/TeamFileSchema.ts` validates members/legacy agents/mcpServers with friendly errors; tests added. | — |
| **ESLint** | ✅ **Addressed.** `.eslintrc.cjs` (conservative TS config); `npm run lint` passes with 0 errors. | Tighten rules over time. |
| **CI** | Addressed. `.github/workflows/ci.yml`: install -> lint -> build -> test -> package. The lockfile is synced; CI still uses `npm install --ignore-scripts`. | Switch CI to `npm ci`; add E2E job. |
| **Command execution default** | ✅ **Tightened (behavior change).** Default `allowlist`→`none`; `run_checks`/gated `verifyCommand` now go through CommandPolicy. A gate blocked by policy now **pauses with guidance** (not a false quality failure). Trade-off: verify-loop/gated workflow require opt-in (`commandApproval='allowlist'` + `verifyCommand`). | Documented in PRD §13.1/§13.4. |
| **MCP least-privilege** | ✅ **Hardened.** Execution-time grant validation; workspace-scoped approval fingerprints; subprocess env minimization. | — |
| **Claude stream-json validation** | `StreamJsonParser` is unit-tested (5 cases) but does not assert the `type` field is in a known enum. | Validate `type` against the expected set. |
| **E2E tests** | Active VS Code E2E harness (`.vscode-test.mjs`, `test-e2e/`) with activation, command smoke, onboarding, workflow editor, demo-task, routing, and concurrency coverage. | Wire into CI when the release environment can run VS Code. |
| **Gated workflow PM-judge** | The `gated` workflow implements the **objective** gate (`run_checks`) + tier switching + retry. The design's optional **subjective PM PASS/FAIL** judge is intentionally not wired yet. | Add as an injected judge step. |
| **MCP claude delegation** | `TeamMcpBridge` (core, tested) adapts TeamTools to the MCP client interface, but is not yet hosted behind a local MCP endpoint for the claude backend. | Host as streamable-http/stdio endpoint + `--mcp-config`. |
| **Bundling** | Not bundled (`tsc` only); `.vsix` ships prod-dep files (vsce warns). Works correctly; load time is the only cost. | Optional esbuild bundle. |
| **Session Digest compaction** | Context hard gate (80%) stops the tool loop; history trimming is by message count, not structured summarization. | Structured digest at the soft gate. |
| **Lockfile sync** | Addressed. `package-lock.json` is synced with E2E devDependencies; `npm ci` and `compile:e2e` resolve locally. | Keep using `npm ci` in clean release checks. |

---

## 3. Strengths worth verifying (we believe these are solid)

- **Command execution gate** (`backend/CommandPolicy.ts`): default-deny allowlist + shell-control-char
  filtering + catastrophic-command blacklist. 10 tests. The primary anti-LLM-RCE control.
- **File sandbox + optimistic concurrency** (`backend/WorkspaceTools.ts`, `FileCoordinator.ts`):
  path-traversal rejection; compare-and-swap writes + read-set invalidation. 10 tests.
- **Secrets** (`secrets/SecretsManager.ts`): SecretStorage only; never written to config/logs/Git;
  never sent to a webview (`settings/SettingsBridge.ts` exposes booleans only).
- **MCP default-deny + approval gate** (`mcp/MCPHub.ts`, `mcp/McpApproval.ts`): servers exposed only
  to agents that explicitly reference them; sensitive servers require persisted user approval.

---

## 4. Reviewer's map (where to look)

| Module | Responsibility | Tests |
|--------|----------------|-------|
| `backend/AgentBackend.ts` + `OpenAICompatBackend.ts` + `ClaudeHeadlessBackend.ts` | Pluggable agent runtimes (in-process HTTP / claude CLI) | OpenAICompat 13, StreamJsonParser 5 |
| `session/SessionManager.ts` | Lifecycle + MessageBus bridge + routing + fallback + cost timeline | routing 10 |
| `bus/MessageBus.ts` | Pub/sub + persistence (export/import) | persistence 4 |
| `workflow/` (Engine, GatedWorkflow, TierController) | Linear + gated workflows, tier hot-swap, conditional routing, L3 restore | 21 |
| `backend/CommandPolicy.ts` / `FileCoordinator.ts` / `TeamTools.ts` | Security + concurrency + PM delegation | 30 |
| `mcp/` (MCPHub, ClaudeMcpConfig, RealMcpClient, McpApproval, McpPlaceholders, TeamMcpBridge) | MCP integration (backend-aware) | 25 |
| `roles/` (RoleConfig, SkillResolver) | Role templates, tiers, skill→tool derivation | 28 |
| `models/` (ModelCatalog, ModelPricing, LivePriceService) | Model list + cost estimation | 17 |
| `backend/TokenCounter.ts` | Context-window soft/hard gates | 4 |
| `settings/SettingsBridge.ts` | Config/secret/MCP access layer (powers Settings panel) | 5 |
| `views/` (Team / Dashboard / Settings / MessageLog) | Webviews | **0 (gap — see §2 CSP)** |
| `extension.ts` + `dialogs.ts` | Wiring + command/dialog flows | 0 (integration; covered by E2E scaffold) |

**Run the suite**: `npm install && npm run build && npm test` → currently **169 unit tests passing**
(25 files, Vitest) + `npm run lint` clean. Package: `npm run package` (needs `images/icon.png`, present).
