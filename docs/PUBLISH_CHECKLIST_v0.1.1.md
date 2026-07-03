# v0.1.1 Publish Checklist

> Status as of 2026-06-05: **local RC-ready.** Concurrency/routing blockers fixed; gates green.
> Publish is a manual, billed action (needs a Marketplace PAT + network) — run the steps below.

## Gate status (verified locally)

| Gate | Result |
|------|--------|
| `npm run build` (tsc) | ✅ pass |
| `npm run lint` | ✅ 0 errors |
| `npm test` (Vitest) | ✅ 223 passing |
| `npm run test:e2e` (VS Code smoke) | ✅ 3/3 (Codex run; needs a networked, GUI-capable host) |
| `npm run package` (vsce) | ✅ produces `roam-crew-0.1.1.vsix` |
| Version / lockfile | ✅ `0.1.1`, lockfile synced with E2E devDeps |

## Before `vsce publish`

1. **Re-run gates** in a clean, networked checkout: `npm ci && npm run build && npm run lint && npm test`.
2. **Audit review** (non-blocking, already graded): `npm audit --omit=dev` should show only the `uuid`
   moderate finding (does not apply to our buf-less `uuidv4()` usage). Confirm no new *critical* entered
   production deps. Do **not** blanket `npm audit fix --force` (pulls breaking majors).
3. **Smoke the VSIX** in a real VS Code: install `roam-crew-0.1.1.vsix`, create the default team, open the
   Chat panel, send a message, open Settings → Model Tuning / Smart Mode. (The packaged MCP path can't be
   verified in CI — exercise it here if MCP matters for the release.)
4. `vsce publish` (publisher `roamai`) or `vsce publish --packagePath roam-crew-0.1.1.vsix`.
5. Tag: `git tag v0.1.1 && git push origin v0.1.1 --tags`.

## Deferred to v0.2.0 (documented, non-blocking)

- **v0.2.0 update - esbuild bundle path is now available opt-in.** Use `npm run build:bundle`
  and `npm run package:bundle`. The default `npm run build` and `npm run package` remain the
  tsc/unbundled publish path until MCP live smoke clears the final gate.
  - `RealMcpClient` now uses literal dynamic imports, so esbuild can inline the MCP SDK and `uuid`.
  - esbuild keeps `vscode`, `ajv`, and `ajv-formats` external. The bundled package stages only the
    ajv runtime closure verified from `npm ls --omit=dev`: `ajv`, `ajv-formats`, `fast-deep-equal`,
    `fast-uri`, `json-schema-traverse`, and `require-from-string`.
  - Local E5b verification: unbundled VSIX = 3,870 entries / 5.15 MB; bundled VSIX = 553 entries /
    0.95 MB. `npm run smoke:bundle` passed activation and non-MCP webview/command E2E against the
    unpacked bundled VSIX.
  - **Remaining gate before making bundle packaging the publish default:** during E3, package the
    bundled VSIX, install it, and run a real MCP server end-to-end with a tool call that triggers ajv
    schema validation. Do not switch `vscode:prepublish` or the default publish artifact before this.

- **esbuild bundling** to cut the vsce "4115 files" warning (cosmetic; v0.1.0 + v0.1.1 ship fine unbundled).
  **Investigated 2026-06-05 — blocked by a concrete issue, here's the map for next time:**
  - Converting `RealMcpClient` to literal dynamic imports lets esbuild bundle the SDK+uuid into a 550 KB
    `dist/extension.js` (tsc resolves them under `node16`; build/tests stay green).
  - **But** `ajv` (JSON-schema validator, transitive via `@modelcontextprotocol/sdk`) uses dynamic
    `require()`s esbuild can't follow — the bundle still emits bare `require("ajv/dist/runtime/*")` and
    `require("ajv-formats/dist/formats")`. Dropping `node_modules` would break MCP at runtime (uncaught,
    since these load during tool-schema validation, not at SDK import).
  - **Safe path to finish it:** `external: ['vscode','ajv','ajv-formats']` in esbuild, then ship ONLY
    `node_modules/{ajv,ajv-formats,fast-deep-equal,fast-json-stable-stringify,json-schema-traverse,uri-js}`
    via a `.vscodeignore` allowlist (≈4115 → ~650 files), and **smoke-test a real MCP server** on the
    packaged VSIX before publishing (the allowlist is the fragile part — a missing transitive dep silently
    breaks MCP). Deferred because that runtime verification can't be done in CI here.
- **`@types/vscode` pin** — currently `^1.85.0` resolves to a newer minor than the declared min engine
  (`engines.vscode ^1.85.0`). Pin to `~1.85.0` and reinstall in a networked env so the type surface
  matches the oldest supported VS Code (prevents accidentally using newer APIs). devDep-only; no user impact.
- **E2E expansion** — add an agent start→send→complete→routing E2E (unit tests cover the routing fixes now).
- **MCP live validation**, PM→Claude delegation, workflow conditional-branch UI.
