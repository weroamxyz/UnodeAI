# Codex review request — v0.9.1 (re-review of the 0.9.0 provider-split blocking fix)

**Repo:** `github.com/weroamxyz/roam-crew` · branch `main`
**Review range:** `git diff v0.9.0..v0.9.1` (fix commit `2d9e166`)
**Prior verdict:** You reviewed v0.9.0 and returned **one-more-patch** — two blocking findings (Roam could run
on Unode via a persisted `roam.baseUrl`; pricing could send `ROAM_API_KEY` to that persisted Unode URL). This
patch is the fix. Please confirm both are closed.

## Please verify the blocking findings are resolved
1. **Roam never resolves to Unode/OpenAI — even via `roamDefault`.**
   `resolveOpenAICompatBaseUrl()` ([src/backend/openAICompatBaseUrl.ts](../src/backend/openAICompatBaseUrl.ts))
   now computes a `candidate` (per-agent URL unless it's unode/OpenAI, else `roamDefault`) and then forces
   `ROAM_DEFAULT_BASE_URL` if the candidate itself is unode/OpenAI. Confirm a persisted
   `roam.baseUrl = https://www.unodetech.xyz/v1` (passed as `roamDefault`) can no longer send a Roam agent to
   Unode. New regression tests are in `src/backend/__tests__/openAICompatBaseUrl.test.ts`.

2. **No Roam-key leak in pricing.**
   New `canonicalRoamBaseUrl()` sanitizes every `roam.baseUrl` read site: `getConfiguredRoamBaseUrl()` and
   `configuredRoamBaseUrl()` (dialogs) collapse a blank/unode/OpenAI value to weroam, and `refreshPrices()`
   ([src/extension.ts](../src/extension.ts)) now pairs `ROAM_API_KEY` with the **sanitized** roam base, and
   `UNODE_API_KEY` with the unode base. Confirm `ROAM_API_KEY` can no longer be sent to a unode URL.

3. **Migration also rewrites the persisted setting.** `migrateToProviderSplit()` now resets a stale
   `roam.baseUrl = unodetech…` to the weroam default in both Workspace and Global scopes. Confirm scope
   handling is correct and only triggers on a stale-unode value.

4. **Non-blocking from last time — `roam.unodeBaseUrl` runtime wiring.** `withOpenAICompatBaseUrl()` and
   `openAIBaseUrlFor()` now pass `getConfiguredUnodeBaseUrl()` as the `unodeDefault`, and treat `unode` as a
   pinned provider (so the setting is honored, not just `UNODE_DEFAULT_BASE_URL`). Confirm.

## Verification to run
- `npm test` (expect 994 green) · `npm run build` · `git diff --check v0.9.0..v0.9.1`

## Report back
Blocking / Non-blocking / **verdict (accept or one-more-patch)**.

> Note (for the maintainer, not Codex): the `ai.weroam.xyz/api/pricing` response-shape check still needs a live
> authenticated call and is best verified by hand, not by Codex reading static code.
