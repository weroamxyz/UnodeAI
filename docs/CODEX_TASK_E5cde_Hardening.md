# Codex Task Card — E5c/d/e: hardening pack (improver landings + npm audit + E2E)

> Wave 1, fourth/last card (after E5b). Source: [DevPlan_v0.2.0.md](DevPlan_v0.2.0.md) §E5c/E5d/E5e.
> Rules: [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) §1 (incl. **doc governance**: don't rewrite
> review snapshots).
> **Scope = E5c + E5d + E5e only** (three small items, one branch). Branch: `codex/e5cde-hardening`.

## Goal
Land the leftover v0.1.1 IMPROVER follow-ups, close out the npm audit assessment, and expand E2E to cover
routing + concurrency. Small surface, high signal. **Several items are already partly done — verify before
implementing, don't redo.**

## E5c — IMPROVER follow-ups `[C]`
Source: `docs/CODEX_REVIEW_v0.1.1.md` "Important follow-ups".

### E5c.1 — modelTierCell provider whitelist — **ALREADY IMPLEMENTED, add the test**
- ⚠️ This is **already done**: `SettingsPanel.saveSmart()` gates on `knownProviders.has(p.provider)`
  (`src/views/SettingsPanel.ts:187`, committed in `82d5bc1`). **Do not re-implement.**
- Action: **add a regression unit test** proving an untrusted/unknown provider key from the webview is
  rejected (not persisted) by `saveSmart`, while a known provider is accepted. If `saveSmart` is awkward to
  unit-test directly, extract the validation predicate into a tiny pure helper and test that. Confirm in your
  report that the guard is present and tested.

### E5c.2 — doc consistency (lockfile / B4) — **light-touch, governance-bound**
- Verify the lockfile is actually synced (`npm ci` resolves; tests run). It is — so this is a doc check, not a
  build fix.
- Correct only **living docs** that wrongly state the lockfile is *pending/blocking*. **Do NOT rewrite v0.1.1
  review snapshots or historical "v0.1.1" subsections** (doc governance — those are point-in-time records).
  In practice: if `STATUS.md`'s *current* status implies lockfile work is outstanding, fix that line; leave the
  dated v0.1.1 retrospective text alone. If nothing in the living section is stale, say so and change nothing.

## E5d — npm audit disposition `[C]`
- Current state (verified): `npm audit --omit=dev` → **1 moderate**: `uuid <11.1.1` (missing buffer bounds
  check in v3/v5/v6 *when `buf` is provided*).
- **Not exploitable here**: every call site is `uuidv4()` with no arguments — the project never passes a `buf`
  (verified: `WorkflowEngine.ts`, `MessageBus.ts`, `TeamTools.ts`, `RoleConfig.ts`). Confirm with your own grep
  in the report.
- **Do NOT `npm audit fix --force`** — it forces `uuid@14` (breaking major). Keep `uuid ^9`.
- Action: document the disposition in `CHANGELOG.md` and the living `STATUS.md` audit line: "1 moderate (uuid
  <11.1.1, buf-bounds); not exploitable — all call sites are arg-less `uuidv4()`; not fixing via breaking
  major." No code change expected.
- (Optional, only if trivially safe: evaluate whether a non-breaking bump exists within `^9` that clears it —
  it does not, since the fix is `>=11.1.1`. So: document, don't bump.)

## E5e — E2E expansion `[C]`
- E2E harness reality (verified): `.vscode-test.mjs` globs **`out-e2e/**/*.etest.js`**, mocha `describe/it` +
  `assert`. Current suite = single file `test-e2e/suite/extension.etest.ts` (4 tests). New tests must be
  `*.etest.ts` (compiled by `npm run compile:e2e`). Add new `*.etest.ts` files (or extend the existing file)
  — follow the existing style, not DevPlan's stale `routing.test.ts` filename.
- **routing E2E**: create 2 agents (dev + qa) → send a task to qa → assert only qa shows activity / receives
  it; dev gets nothing. Use the same public command/bus path a user would (no internal poking).
- **concurrency E2E**: with `maxConcurrentAgents = 2`, start 3 agents → assert the 3rd is `pending` → stop one
  → assert the 3rd auto-starts. (If the concurrency cap isn't injectable in the E2E host, document how you set
  it, or assert the queue/pending state via the public surface.)
- These run in a real VS Code instance and can be timing-sensitive — keep them robust (await activation, poll
  with a bounded timeout rather than fixed sleeps).

## Validation / DoD
- `npm run compile` ✓ · `npm run lint` 0 error ✓ · `npm test` all green (+ the E5c.1 regression test).
- `npm run test:e2e` green, now including routing + concurrency (report the new total; was 4).
- `CHANGELOG.md` + living `STATUS.md` audit line updated (E5d). No `audit fix --force`. `uuid` stays `^9`.
- E5c.2: state explicitly what (if anything) you changed and confirm no review snapshot was rewritten.
- All user-facing text English. Security model intact.

## Out of scope
- Re-implementing the modelTierCell guard (already done — test only).
- Bumping uuid / any breaking dep change.
- esbuild/bundling (that's E5b).

## Hand-back to Claude
When green, report: branch name, unit test total (+ the new regression test), E2E total (was 4), the uuid grep
proof, and exactly which doc lines you touched for E5c.2/E5d. Claude re-runs gates, reviews
test-not-reimplement (E5c.1) + audit honesty (E5d) + E2E robustness (E5e) + governance (no snapshot rewrite),
then commits/merges to main and updates STATUS. **This closes Wave 1.** Remaining: Wave 2 (E3 MCP live —
also clears the E5b flip-to-default gate — + E5a 5-agent stress), then `vsce publish 0.2.0`.
