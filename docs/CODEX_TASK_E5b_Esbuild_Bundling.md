# Codex Task Card — E5b: esbuild bundling (optional, gated on MCP smoke)

> Wave 1, third card (after E6). Source: [DevPlan_v0.2.0.md](DevPlan_v0.2.0.md) §E5b. **Landmine map**:
> [PUBLISH_CHECKLIST_v0.1.1.md](PUBLISH_CHECKLIST_v0.1.1.md) §"esbuild bundling" (investigated 2026-06-05).
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1.
> **Scope = E5b only.** Branch: `codex/e5b-esbuild`.

## Goal
Add an esbuild bundle path that cuts the VSIX from ~4115 files to ~50–650, **without breaking MCP at runtime**.
Ship it as an **opt-in** build (`build:bundle`); keep `tsc` (`build`) as the default. **Do NOT switch the
default/publish artifact to the bundle in this card** — flipping the default is gated on a real MCP smoke test
on the packaged VSIX, which belongs with E3 (MCP live, Wave 2). This card delivers the machinery + proof it
works for non-MCP paths, and leaves a documented flip-switch.

## Why this is delicate (read the landmine map first)
This was investigated and deliberately deferred at v0.1.1. The two concrete blockers:
1. **`RealMcpClient` uses a variable-specifier dynamic import** — `await import(spec)` where `spec` is a
   runtime var (`src/mcp/RealMcpClient.ts` L16-23). esbuild **cannot follow a non-literal `import()`**, so the
   SDK won't bundle; it stays an external runtime require. To bundle the SDK you must convert to **literal**
   dynamic imports (`import('@modelcontextprotocol/sdk/client/index.js')`, one per entrypoint).
2. **`ajv` / `ajv-formats`** (transitive via `@modelcontextprotocol/sdk`) use dynamic `require()`s esbuild
   can't trace — the bundle emits bare `require("ajv/dist/runtime/*")` / `require("ajv-formats/dist/formats")`.
   These load lazily **during tool-schema validation**, not at SDK import — so a missing dep fails silently at
   first real MCP tool call, not at startup. They MUST stay `external` and be shipped via a `.vscodeignore`
   allowlist.

## Current-state anchors (verified)
- Build = `tsc -p ./` only (`package.json` scripts L455-467, `build`/`vscode:prepublish`). `main` =
  `./out/extension.js` (L36). Prod deps: `@modelcontextprotocol/sdk ^1.29.0`, `uuid ^9.0.0` (L483-486).
- `.vscodeignore` currently keeps `node_modules` (NOT ignored) and excludes `out/**/__tests__/**`; comment
  there explains "not bundled → ships prod deps". E5b changes this story for the bundle path only.
- `RealMcpClient.ts` L16-23: `SDK_CLIENT/STDIO/HTTP/SSE` consts + `await import(spec)` with the variable
  `spec`. This is the import to make literal.

## Subtasks

### E5b.1 — Literal dynamic imports in RealMcpClient `[C]`
- Replace the variable `await import(spec)` with a small literal switch/map so each SDK entrypoint is a
  **string-literal** `import('@modelcontextprotocol/sdk/client/index.js')` etc. Keep the existing lazy/error
  behavior (the "Install the SDK" message) and the same public interface.
- `npm test` + `npm run compile` (tsc, `node16`/`node16` resolution) must stay green — this change is safe
  under tsc independent of esbuild.

### E5b.2 — esbuild config `[C]`
- `npm install -D esbuild` (devDep).
- `esbuild.config.mjs`: entry `src/extension.ts` → `out/extension.js`, `--bundle`, `platform=node`,
  `format=cjs`, `sourcemap`, **`external: ['vscode', 'ajv', 'ajv-formats']`**. (SDK + uuid bundle in via the
  now-literal imports.)
- `package.json`: `"build:bundle": "node esbuild.config.mjs"` (or the equivalent `esbuild …` one-liner from
  DevPlan §E5b). **Do not** change `build`, `vscode:prepublish`, or `main` — tsc stays the default.
- Do NOT edit `tsconfig.json` (esbuild transpiles; type-checking remains `tsc`'s job via `compile`).

### E5b.3 — `.vscodeignore` allowlist for the bundle path `[C]`
- Add an allowlist so that *when packaging the bundle* only the ajv subtree ships from `node_modules`:
  `ajv`, `ajv-formats`, `fast-deep-equal`, `fast-json-stable-stringify`, `json-schema-traverse`, `uri-js`
  (per the landmine map). Everything else under `node_modules` excluded.
- ⚠️ The allowlist is the fragile part — a missing transitive dep silently breaks MCP. Derive the closure from
  `npm ls ajv ajv-formats` rather than guessing; list what you included and how you verified the closure.
- **Guard the default**: because `build` stays tsc + full `node_modules`, the default `vsce package` must keep
  working unchanged. The allowlist must not break the unbundled default. If `.vscodeignore` can't cleanly
  serve both, document a `package:bundle` flow (build:bundle → temporary ignore → package) instead of
  mutating the shared `.vscodeignore` destructively.

### E5b.4 — Verify + document the flip-switch `[C]`
- Build both ways; package both; **report file counts** (expect ~4115 unbundled vs ~50–650 bundled) and bundle
  size.
- Smoke the **bundled** VSIX for non-MCP paths you can verify here (extension activates, a webview opens, a
  non-MCP agent turn runs). MCP-on-bundle verification is explicitly deferred to E3/Wave 2.
- Update `PUBLISH_CHECKLIST` (and a short note in `STATUS`): the bundle path exists, what's verified, and the
  **one remaining gate before making it the publish default**: "package the bundled VSIX, install it, and run a
  real MCP server end-to-end (a tool call that triggers ajv schema validation) — do this during E3."

## Validation / DoD
- `npm run compile` ✓ · `npm run lint` 0 error ✓ · `npm test` all green (E5b.1 must not regress MCP unit tests).
- `npm run build:bundle` produces `out/extension.js` (bundled) with no esbuild errors; bundle references to
  `ajv`/`ajv-formats`/`vscode` remain external (expected), SDK + uuid are inlined.
- Default `npm run build` (tsc) + default `vsce package` still work unchanged (no regression to the shippable
  default).
- File-count + size comparison reported. Bundled VSIX activates + runs a non-MCP turn.
- **Honesty requirement**: the card does NOT claim MCP-on-bundle works. The flip-to-default gate is documented,
  not performed.

## Out of scope
- Switching `main`/`build`/publish to the bundle (gated on E3 MCP smoke).
- Any runtime behavior change beyond the literal-import refactor.

## Hand-back to Claude
When green, report: branch name, test count, file-count/size for both package modes, what the bundled VSIX
smoke covered, and the exact allowlist closure (+ how verified). Claude re-runs gates, reviews the
literal-import refactor + external/allowlist correctness + that the unbundled default is untouched, then
commits/merges to main and updates STATUS. Next Wave-1 card: E5c/d/e (improver landings + npm audit + E2E
expansion), then Wave 2 (E3 MCP live — which also clears the E5b flip-to-default gate — + E5a stress).
