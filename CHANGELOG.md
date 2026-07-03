# Changelog

All notable changes to UnodeAi are documented here.

## [Unreleased]

## [0.9.17] — 2026-07-03 · Egress consent — nothing leaves the machine until you approve the destination

- **Per-gateway egress consent.** Before any model request is sent, UnodeAi asks once per destination host
  ("about to send this agent's prompt and any workspace files it includes to `<host>` — Allow?"). Nothing
  is transmitted until you approve; the choice is remembered per host. Enforced at every egress point —
  the OpenAI-compatible request path (`fetchOnce`/`fetchStreamOnce`), the chat summarizer, and before the
  Claude CLI is spawned — via a new `onBeforeEgress` hook. Declining aborts the turn with nothing sent.
- **SECURITY.md audit.** Full, verifiable write-up of every network destination, execution surface, secret
  handling, SSRF protection, Workspace Trust behavior, and what the extension does *not* contain — for
  security-conscious users and registry reviewers.

## [0.9.16] — 2026-07-03 · Workspace Trust + opt-in network

- **Workspace Trust support (`capabilities.untrustedWorkspaces: limited`).** In an untrusted workspace,
  UnodeAi runs read-only: agents can chat, plan, read, and search, but **shell commands, file
  writes/edits/deletes, MCP servers, and the verify command are disabled** until you trust the workspace.
  Enforced at every mutation/execution chokepoint (OpenAI-compat `run_command` + `write_file`/`apply_edit`/
  `delete_file`, the Claude `--permission-prompt-tool` gate for both shell and file tools, the verify
  runner, and MCP mount for both backends) and checked live, so granting trust mid-session takes effect
  immediately and re-mounts MCP servers.
  Security-sensitive settings (`unode.allowedCommands`, `commandApproval`, `verifyCommand`, `baseUrl`, …)
  are marked `restrictedConfigurations`, so a repo can't inject them. Virtual workspaces are declared
  unsupported (the extension needs a real filesystem + git).
- **No network by default.** The hosted-marketplace-catalog fetch (`unode.marketplace.fetchCatalog`) now
  defaults to **off** — the bundled catalog works offline and nothing is fetched from the internet unless
  you opt in. Model/pricing lookups still occur only against the provider gateway you configure with a key.

## [0.9.14] — 2026-07-03 · Rename Roam Crew → UnodeAi (namespace, icons, data dir)

- **Full rebrand from Roam Crew to UnodeAi.** Every globally-scoped contribution id was moved out of the
  legacy `roam.*` namespace so the extension no longer collides with an installed Roam Crew: view
  containers (`roam`/`roamPanel` → `unode`/`unodePanel`), all commands (`roam.*` → `unode.*`), the chat
  participant (`@roam` → `@unode`, `roam.crew` → `unode.crew`), context keys, and every setting
  (`roam.*` → `unode.*`). The activity-bar, editor-title, and Team-view icons now use the Unode logomark.
- **Your settings carry over automatically.** On first activation any values you set under `roam.*` are
  copied to the matching `unode.*` key (a one-time, best-effort migration; existing `unode.*` values win).
- **Workspace data dir `.roam/` → `.unode/`.** Team roster (`team.json`), project/shared memory
  (`rules.md`, `memory/`), MCP config, and worktrees now live under `.unode/`; an existing `.roam/` is
  renamed on activation and any git worktrees repaired. The worktree integration branch is now
  `unode/integration`.
- **Unchanged on purpose:** the **Roam (weroam) gateway provider** — provider id `roam`, `ROAM_API_KEY`,
  and `https://ai.weroam.xyz` — is a distinct backend from the separate Unode gateway and is left intact,
  so your agents keep hitting the same gateway with the same key.

## [0.9.8] — 2026-06-22 · Account balance for every gateway provider (not just Roam)

### Fixed / Added
- **The Providers tab now reads a live balance for *each* provider that has a key — not only Roam.** Previously
  the balance was wired for Roam alone, so **Unode (and any other gateway) was ignored**. Each provider card
  now requests its own balance host-side (its own stored key, never sent to the webview) and shows the same
  *Balance (approx.)* figure + low-balance warning. The balance slot is shown only for the gateways that
  actually expose a readable account balance — **Roam and Unode** (new-api gateways with a single account
  endpoint). Other providers — `custom` (per-agent URL, no single account) and OpenAI/Anthropic/OpenRouter
  (no balance endpoint) — get no slot. Top-up button shows only for Roam (the only promoted sign-up).
  `BalanceService` was already provider-agnostic; this generalizes the wiring + UI.

## [0.9.7] — 2026-06-22 · GA hardening: streaming fix, pricing tolerance, balance, single-gateway polish

Rolls up the 0.9.6/0.9.7 work for a clean commercial build.

### Fixed
- **Streamed tool calls reassemble correctly when the gateway omits `index` on continuation deltas.** Some
  gateways (incl. the weroam endpoint for some models) don't send `index` on argument-continuation chunks;
  the old fallback split one call into many, leaving the named call (e.g. `assign_task`) with **empty
  arguments** — so an agent could run no-arg tools (`run_checks`) but **couldn't delegate**, and a PM would
  spin. Now index-less continuations append to the call in progress. (Root cause of the PM-stall seen in
  dogfooding.)
- **Live pricing is tolerant of gateway response-shape differences** (`LivePriceService`), so Roam prices
  populate from `ai.weroam.xyz/api/pricing` even with minor field variations (falls back to bundled prices).
- Lint cleaned to **zero warnings**.

### Added
- **Roam account balance in the Providers tab** with a low-balance warning + Top-up button
  (`roam.lowBalanceThresholdUsd`; uncapped accounts show "Unlimited"). **Shown as an approximate figure** —
  the gateway's limit/quota semantics for finite accounts are still being validated, so it's labeled
  *Balance (approx.)* and should be treated as an estimate, not exact remaining credit.
- **Catalog signing — transition step (not yet enforced).** Signature *verification* is wired in, but the
  bundled public key is intentionally blank, so **unsigned hosted catalogs still merge** (a missing/failed
  signature is warn-only). This is the groundwork; full enforcement lands once the catalog is signed and the
  key is bundled. Do not treat this release as "signature verification shipped."

### Changed
- **Unode is removed from promotion/marketing only — it remains a fully usable provider.** The Unode
  **sign-up/registration link** is removed from the Providers tab and user-facing docs present only Roam
  (weroam). Unode is **still a selectable provider** (in the new-agent picker, Smart Mode tiers, and the
  Set-Provider-API-Key list) with its own `roam.unodeBaseUrl` setting and `UNODE_API_KEY` — agents migrated
  to it in 0.9.0 keep working, and you can still create/configure Unode agents.

## [0.9.5] — 2026-06-22 · Per-workspace roster migration (Codex follow-up)

### Fixed
- **Old agents in a *second* workspace are now migrated correctly.** The 0.9.0 provider-split migration moved
  two things behind a single **global** flag: the API key (correctly global) *and* the agent roster (which is
  **per-workspace**). So the first upgraded workspace consumed the flag, and an older workspace opened later
  could skip moving its old `roam` agents onto Unode. Split the guards: the **secret move stays global**, the
  **roster move is now workspace-scoped** (and retries next launch if it ever errors). Runtime was always
  safe (Roam never resolves to Unode), but this restores backward-compat for old workspaces.

## [0.9.4] — 2026-06-21 · PM-stall auto-advance nudge (the last orchestration stall)

### Added
- **The PM no longer stops half-done after a teammate finishes.** When a coordinator (PM) delegates work in a
  turn but then ends *without* verifying (`run_checks`) or finalizing — the last known orchestration stall,
  where it would hand back to the user instead of continuing — it now gets a **single, bounded nudge** to
  continue the loop: verify, send to the reviewer, update its todos, and only report the goal complete once
  it's verified (or finalize explicitly if it genuinely is). Fires at most once per turn (no loops), only in
  Act mode, and only for an agent that actually delegated. +tests.

## [0.9.3] — 2026-06-21 · Fix Unode pricing in Agent Builder + Marketplace README links

### Fixed
- **Unode models now show prices in the Agent Builder / model picker.** Pricing was attached only for the
  `roam` provider, so switching an agent to **Unode** showed no prices. Both gateways fetch `/api/pricing`
  into the same table, so prices now show for **roam *and* unode** (still omitted for direct providers like
  OpenAI, where the gateway price wouldn't apply). The legacy add-agent dialog also now resolves a tier model
  for `unode`.
- **README / Marketplace description links updated to weroam.** The store listing still pointed at
  `unodetech.xyz` for the default gateway + pricing; now `ai.weroam.xyz/v1` + `ai.weroam.xyz/pricing`, with
  Unode listed as the separate provider.

## [0.9.2] — 2026-06-21 · Self-heal a stale persisted roam.baseUrl (Codex non-blocking cleanup)

### Fixed
- **A persisted `roam.baseUrl = unodetech.xyz` is now corrected to the weroam default on every launch**, not
  only during the one-time 0.9.0 migration. Users who launched 0.9.0 before the 0.9.1 fix (so their migration
  flag was already set) would have kept the stale value *displayed* in Settings — runtime/pricing were already
  safe, but the stored setting wasn't rewritten. The correction now runs unconditionally and idempotently
  (`correctStaleRoamBaseUrl`), so the Settings UI matches reality for everyone. No-op once the value is canonical.

## [0.9.1] — 2026-06-21 · Fix Roam→Unode leak from a persisted base URL (Codex review)

### Fixed
- **Roam can no longer run on the Unode endpoint** when a workspace has a stale `roam.baseUrl =
  https://www.unodetech.xyz/v1` persisted from before the 0.9.0 split. The base-URL resolver only guarded the
  per-agent URL, not the `roam.baseUrl` *default* it was given — so a persisted unode value slipped through.
  Now `resolveOpenAICompatBaseUrl` forces Roam to the canonical weroam gateway if either the agent URL **or**
  the default would land on unode/OpenAI, and a new `canonicalRoamBaseUrl` sanitizes every site that reads
  `roam.baseUrl` (runtime + pricing). **This also closes a key leak**: the pricing refresh no longer sends
  `ROAM_API_KEY` to a persisted Unode URL. The one-time migration also rewrites a stale persisted `roam.baseUrl`
  to weroam. `roam.unodeBaseUrl` is now honored by the Unode agent runtime too (not just pricing). +regression tests.

## [0.9.0] — 2026-06-21 · Two gateway providers (Roam + Unode) · GA-aligned

A milestone release: the gateway is now **two separate providers**, the project is fully migrated to the
**weroamxyz** org, and everything is aligned for commercial launch.

### Added
- **Two distinct gateway providers.** **Roam (weroam)** is now the **default** — `https://ai.weroam.xyz/v1`,
  pricing at `https://ai.weroam.xyz/pricing?lang=en`, key `ROAM_API_KEY`. **Unode** is a **separate** provider
  — `https://www.unodetech.xyz/v1` (the previous endpoint), key `UNODE_API_KEY`, configurable via
  `roam.unodeBaseUrl`. Both are selectable per agent and **both appear in the Smart Mode tier matrix** (Roam
  first, Unode second). Live pricing is fetched from each gateway's own `/api/pricing` with its own key.

### Changed
- **Default gateway moved from unodetech to the weroam endpoint** for new agents. Provider picker, model
  picker, onboarding, and the Settings/Providers tab now reflect the Roam/Unode split.

### Migration (one-time, automatic, non-destructive)
- On first launch after upgrade: your existing `ROAM_API_KEY` (which was a Unode key) is **preserved as
  `UNODE_API_KEY`**, and existing Roam agents are **moved to the Unode provider** so they keep running
  unchanged on `unodetech.xyz`. To use the new default Roam (weroam) gateway, add a `ROAM_API_KEY` in
  Settings → Set Provider API Key. Nothing is deleted; new agents default to Roam (weroam).

### Repo / GA
- Completed the migration to **github.com/weroamxyz** (roam-crew + public roam-skills); docs/wiki updated.

## [0.8.112] — 2026-06-21 · GA repo/URL migration to the weroamxyz org

### Changed
- **Migrated all GitHub references from the temporary `yanzhang79` account to the `weroamxyz` org** ahead of
  commercial launch: `repository.url` → `weroamxyz/roam-crew`; the marketplace **catalog URL** →
  `raw.githubusercontent.com/weroamxyz/roam-skills/main/catalog.json`; the **skill library URL** →
  `weroamxyz/roam-skills` (also the hardcoded fallbacks in code, the catalog source comment, contributing/docs).
  New repos created: **weroamxyz/roam-crew** (private code) and **weroamxyz/roam-skills** (public catalog).
  `roam.modelCatalogUrl` is empty by default (nothing to migrate). The VS Code Marketplace `publisher`
  (`roamai`) is intentionally unchanged — that's a separate store-identity decision.

## [0.8.111] — 2026-06-21 · Changed-files activity on team cards

### Added
- **Each team card now lists the files that agent recently changed** (from its file checkpoints), and clicking
  one opens a **read-only unified diff** of that edit. Makes it obvious at a glance what each agent actually
  touched — orchestration visibility that complements the Dashboard. (Ported + freshened from an earlier
  unmerged branch; pure grouping logic in `checkpointSummary.ts` with tests.)

## [0.8.110] — 2026-06-21 · Smart Mode badge refreshes the team cards immediately

### Fixed
- **Toggling Smart Mode (or editing role tiers / the tier→model matrix) now updates the Team panel cards
  right away.** The `⚡ Smart → <model>` badge wasn't appearing because nothing refreshed the Team view when
  the Smart Mode settings changed — the cards only re-rendered on some other event. The config-change
  listener now refreshes the Team view on `roam.smartMode.*` and `roam.modelTiers` changes (covers both the
  Settings-panel toggle and raw settings.json edits).

## [0.8.109] — 2026-06-21 · Concurrency mode = a Team title-bar icon (no more chip row)

### Changed
- **The concurrency-mode indicator/toggle is now a single icon in the Team panel's title bar** instead of a
  full-width chip row: **📄 (files) = Optimistic**, **⎇ (git-branch) = Worktree** — the icon reflects the
  current mode and clicking it switches (same git-init / Optimistic prompt for a non-git worktree). Frees up
  the row it used to occupy. The Dashboard still shows the mode as a status line.

## [0.8.108] — 2026-06-21 · Remove the *remaining* workingDirectory pins (Codex follow-up #2)

### Changed
- **Three more creation paths no longer pin `workingDirectory`** — completing the cleanup for real this time
  (verified by a codebase-wide grep, not a claim): team-preset / default-team creation (`roam.createTeamPreset`),
  solo-agent creation (`roam.startSolo`), and the legacy add-agent dialog (`roam.addAgent`), all in `dialogs.ts`.
  The only place that now sets a working directory is the runtime (`SessionManager` writes the resolved root
  onto the per-session `runConfig`). Added regression tests asserting team and solo creation leave
  `workingDirectory` unset even with a workspace folder open.

## [0.8.107] — 2026-06-21 · Finish "don't pin workingDirectory" (Codex follow-up)

### Changed
- **Removed the last two places that pinned a per-agent `workingDirectory`** at creation, completing the
  runtime-invariant cleanup: the Agent Builder no longer sets it to the workspace-at-save, and Marketplace
  installs no longer pass a `cwd`. New agents are created with no pinned root; the runtime resolves it per
  session (`SessionInfo.runtimeWorkingDirectory`). The chat preflight outside-root check also **no longer
  falls back to the persisted `config.workingDirectory`** (which could be a stale pin from an older build) —
  it uses the runtime root, else the current workspace.

## [0.8.106] — 2026-06-21 · Concurrency-mode indicator + one-click toggle

### Added
- **You can now see — and switch — the concurrency mode at a glance.** The **Team panel** shows a chip
  (**⚙ Optimistic mode** / **⎇ Worktree mode**) that's **clickable to toggle** between them; the **Dashboard**
  shows the same status as a line. Switching to Worktree on a non-git folder reuses the git-init / "Switch to
  Optimistic" prompt. Also available from the command palette ("UnodeAi: Toggle Concurrency Mode"). This
  surfaces the runtime contract (how agents share the workspace) instead of leaving it hidden in Settings.

## [0.8.105] — 2026-06-21 · Runtime-invariants hardening: one working-directory truth

### Changed
- **Completed the "one runtime root" hardening pass** (per a review of the working-directory drift behind the
  "outside working folder" failures). `workingDirectory` is **no longer pinned/persisted** onto an agent at
  save time — it went stale when the agent later ran in another folder. The runtime resolves the root each
  session (worktree path or current workspace) and records it on `SessionInfo.runtimeWorkingDirectory`, the
  single source of truth already used (0.8.103) for grounding, chat preflight, and delegation-path
  normalization. Locked with tests: the backend is built with the same root the session reports; the
  persisted config stays clean; and **Smart Mode's per-turn `setModel` only swaps the model — it never
  restarts the session, recreates the backend, or mutates the working directory.**

## [0.8.104] — 2026-06-21 · Fix the thinking-model "reasoning_content" 400 + one-click git init

### Fixed
- **Thinking-model agents no longer fail with `"reasoning_content … must be passed back"`** (seen on the
  reviewer via the unodetech gateway). Splitting a parallel tool-call turn dropped `reasoning_content` from
  the 2nd+ segment, so the gateway rejected the next request; the split now **preserves `reasoning_content`
  on every segment**. Added a **self-heal** for that 400 too — it flattens the conversation and retries once
  (the same recovery as the assistant-prefill 400), so a delegation doesn't fail-then-need-a-lucky-retry.

### Added
- **One-click "Initialize Git" on the worktree warning.** When `worktree` mode is set on a non-git workspace,
  the warning now offers **Initialize Git** (runs `git init` + writes a safe `.gitignore`) alongside "Switch to
  Optimistic." It does not auto-commit — you review and commit, then worktree isolation engages.

## [0.8.103] — 2026-06-21 · One source of truth for an agent's working directory (Codex review)

### Fixed
- **Workspace grounding + chat preflight now use the agent's ACTUAL runtime root**, not the global workspace.
  In worktree mode a worker is sandboxed to `.roam/worktrees/<id>`, but 0.8.101 grounded it to the global
  workspace root — telling an isolated worker the wrong folder so its shared-path use got (correctly) blocked.
  The resolved root (worktree path or current workspace) is now recorded once on the session as
  `runtimeWorkingDirectory` and used for grounding, the chat preflight outside-root check, and diagnostics —
  ending the drift between the persisted-config root, the backend/tool root, and the grounding root. The
  worktree path is **never** written back into the persisted roster.
- **Delegated instructions are normalized to workspace-relative paths.** When the PM hands a task containing a
  shared-root absolute path (e.g. `C:\…\src\file.ts`) to a worktree-isolated worker (whose root differs), the
  path would land outside its sandbox and the shell guard would block it. Such paths are now converted to
  workspace-relative before dispatch, so they resolve in any agent's root. +tests for all three.

## [0.8.102] — 2026-06-21 · Warn when worktree mode can't engage (no git repo)

### Added
- **A one-time warning when `concurrencyStrategy: worktree` is set on a non-git workspace.** Worktree
  isolation needs a git repo, so it silently fell back to the shared workspace (only logged to the Output
  channel). Now a toast explains it and offers a one-click **"Switch to Optimistic"** (or run `git init` +
  commit to enable isolation). Fires once per session. +test.

## [0.8.101] — 2026-06-21 · Tell agents their real working directory (curb the `/Users/dev/...` confabulation)

### Changed
- **Agents are now explicitly told their working directory** ("Your working directory is `<root>` … you are
  NOT in a `/Users/.../workspace-…` sandbox"). Claude models are trained in a Linux sandbox and confabulate a
  `/Users/dev/workspace-<random-id>/` folder — both when asked and as path prefixes. File ops were already
  re-rooted to the real workspace (so edits/tests worked), but the model would still *report* a fake folder;
  this grounding reduces that. (Won't 100% stop a model from improvising in prose, but it's much less likely.)

## [0.8.100] — 2026-06-21 · Agents always root at the current workspace (fixes stale "outside working folder")

### Fixed
- **Agents now operate on the currently-open workspace, not a stale folder.** A per-agent `workingDirectory`
  was pinned to the workspace at agent-creation time and persisted, so an agent created/edited while a
  *different* folder was open carried that old folder — and then couldn't reach the open project's files
  ("I can't reach that path — it's outside my working folder"), while another agent created in the right
  folder worked. Non-worktree agents now always root at the **current** workspace folder at runtime
  (overriding any stale persisted value, and never `process.cwd()`). No reset needed — it applies on the
  next turn. (Complements 0.8.99, which covered the git-worktree + untracked-files case.)

## [0.8.99] — 2026-06-21 · Worktree mode no longer isolates agents away from uncommitted files

### Fixed
- **The "I can't reach that path — it's outside my working folder" failure in worktree mode.** Worktree
  cleanliness only checked *tracked* changes (`--untracked-files=no`), so **freshly-created, never-committed
  source files** (e.g. a `src/app.js` an earlier agent wrote) were invisible to the check — a worktree got
  created off HEAD **without those files**, and an agent isolated there couldn't find/edit them (the PM could
  still *read* them via the shared overlay, which is why it looked inconsistent). Cleanliness now counts
  genuinely-untracked files too (still ignoring `.roam/`/`.vscode/` state), so worktree mode **falls back to
  the shared workspace** when there's uncommitted/untracked work — agents see the files. Commit your work to
  enable per-agent worktree isolation. (The `/Users/dev/...` path some Claude models show is an unrelated
  model quirk — they hallucinate a Unix sandbox prefix that Roam re-roots to your real workspace.)

## [0.8.98] — 2026-06-21 · Team cards show the true Smart Mode model

### Added
- **When Smart Mode is on, each Team card shows the model the agent will actually run**, not just its
  configured one: `Model: <configured>  ⚡ Smart → <tier model>`. If the agent's provider has no model set
  for its tier, it shows `⚡ Smart (configured)` (it keeps the configured model — matching the 0.8.94
  runtime). Smart Mode off → just the configured model, as before.

## [0.8.97] — 2026-06-20 · Honest per-provider prices + "in use" provider marker

### Fixed
- **Model prices no longer show the Roam-gateway price for other providers' models.** The price table is the
  Roam/Unode gateway's, so it only applies to Roam models — model pickers (Agent Builder + Smart Mode tier
  matrix) now show a price **only for Roam models**, and **omit it** for OpenAI/Anthropic/OpenRouter/etc.
  (and for any model with no known price) rather than display a misleading number.

### Added
- **The Providers page marks which providers are actually in use** — a green **"● in use"** pill + left
  accent on any provider assigned to at least one agent, so it's obvious at a glance.

## [0.8.96] — 2026-06-20 · Host the catalog in the public roam-skills repo (it was dormant)

### Fixed
- **The hosted marketplace catalog now actually loads.** It pointed at the **private** `roam-crew` repo, whose
  `raw.githubusercontent.com` URL 404s for everyone — so since 0.8.89 every install silently fell back to the
  bundled catalog and live updates never worked. `roam.marketplace.catalogUrl` now points at the **public
  `roam-skills`** repo (`…/roam-skills/main/catalog.json`). Source-of-truth + CI stays in
  `roam-crew/marketplace/catalog.json`; **publishing = committing that file to `roam-skills`.** (Until that
  file exists in roam-skills it stays on the bundled catalog — offline-safe.)

## [0.8.95] — 2026-06-20 · Hosted catalog pinned to a deliberate `catalog-release` branch

### Changed
- **The hosted catalog is now served from a dedicated `catalog-release` branch, not `main`.** Publishing an
  offering change is now a deliberate act (move/commit `catalog-release`), so a random dev commit to `main`
  never reaches installs — an extra supply-chain guard on top of the 0.8.94 force-approval. Fetch failures
  still fall back to the bundled catalog. (Still migrates to the weroam org + can be pinned to a SHA/signed
  at GA.)

## [0.8.94] — 2026-06-20 · Harden MCP approval + correct Smart Mode runtime (Codex review)

### Security
- **A hosted/mutable catalog can no longer suppress the MCP approval modal.** `requiresApproval: false` no
  longer bypasses approval for **sensitive** servers — any **stdio (subprocess), remote, or env-bearing** MCP
  server now **always** shows the approval modal (with its exact command/URL) before first mount. Since the
  catalog fetches from a mutable URL and hosted entries win on id, this prevents a tampered entry from
  silently mounting or swapping an MCP command. *Behavior change:* bundled "safe" servers (Memory, Sequential
  Thinking, Time, Everything) now ask once on first mount; approve-for-project still remembers them.

### Fixed
- **Smart Mode no longer swaps to a wrong-provider model id at runtime.** If an agent's provider has no model
  set for the selected tier, Smart Mode now **keeps the agent's configured model** instead of falling back to
  another provider's id (which would 400) — both for normal turns and the economy/summarization model. This
  matches the tier-matrix warning. Fill the provider's column to enable the swap.
- **Smart Mode per-agent "→ model / ⚠ warning" labels now update live** after a tier or matrix edit, instead
  of going stale until the panel is reopened (the no-re-render tab-jump fix left them static). Recomputed
  client-side from the live controls.

## [0.8.93] — 2026-06-20 · Tier matrix: live model picker per provider

### Added
- **The Smart Mode tier matrix now suggests each provider's real model ids.** Every cell is bound to a
  per-provider `<datalist>` populated from that provider's live `/v1/models` (the same source the Agent
  Builder uses), so you pick the provider's **exact** id instead of typing — directly handling the
  cross-provider naming difference (e.g. `claude-opus-4-8` vs `anthropic/claude-opus-4`). You can still type
  a custom id. Pairs with the 0.8.92 fallback warnings.

## [0.8.92] — 2026-06-20 · Smart Mode handles provider-specific model ids

### Fixed
- **Smart Mode now flags when an agent's provider has no model set for its tier**, instead of silently
  showing another provider's id that would 400. Model ids are provider-specific (e.g. `claude-opus-4-8` on
  Roam/Anthropic vs `anthropic/claude-opus-4` on OpenRouter); the per-role rows now show `→ <model>` only on
  an **exact** provider+tier match, otherwise a red *"no &lt;provider&gt; model for &lt;tier&gt; — set it in
  the tier matrix"* warning. The tier matrix also carries a note to use each provider's exact id and fill the
  column for every provider your agents use.

## [0.8.91] — 2026-06-20 · Smart Mode: no tab-jump on tier edits + per-agent provider shown

### Fixed
- **Setting a role's tier no longer bounces you back to the Providers tab.** Each Smart Mode change
  re-rendered the whole Settings panel (resetting the active tab); it now persists the change in place, so
  you can set every role's tier in one sitting without the panel jumping. (Same re-render class as the
  earlier form fixes.)

### Added
- **Per-agent provider is now visible in Settings → Smart Mode and the model-tuning cards.** Each agent row
  shows its **provider** and the **model its tier resolves to on that provider** (e.g. `pm · roam → claude-opus-4-8`).
  Agents can each use a **different provider** (already settable in the Agent Builder's Provider field) — Smart
  Mode resolves each agent's tier→model via *its* provider, so you can run model A on whichever provider is
  cheapest for it and model B on another. This just surfaces it.

## [0.8.90] — 2026-06-20 · Agent Builder: changing the role loads that role's full template

### Fixed
- **Picking a different role in the Agent Builder now updates everything** — instructions, model, provider,
  tools/skills, icon, and color — instead of leaving the instructions (and most fields) untouched. Switching
  TO a custom role clears the prompt and shows the required hint. Smart preservation: a name you typed and an
  image icon you uploaded are kept; auto-filled role values are replaced. The **initial** render still keeps
  an existing agent's saved values (edit mode isn't clobbered). +test.

## [0.8.89] — 2026-06-20 · Hosted marketplace catalog (update offerings without a VSIX)

### Added
- **The MCP / agent / skill offerings can now grow without shipping a new extension.** A starter hosted
  catalog ([marketplace/catalog.json](marketplace/catalog.json)) is served from GitHub raw and **merged over
  the bundled catalog at startup** (hosted entries win on id collisions). Edit + commit that file to push
  new or corrected offerings to all installs live. `roam.marketplace.catalogUrl` now defaults to it;
  `roam.marketplace.fetchCatalog` (default on) controls the merge. Offline-safe: any fetch/parse failure
  falls back to the bundled catalog, and one bad section never blanks the rest. +CI test that the hosted
  file parses with the same validators.

### Notes
- The catalog URL (and `roam.marketplace.skillLibraryUrl`) point at the **temporary `yanzhang79` GitHub**;
  both **migrate to the `weroam` org at the v1.0 release** (tracked in the roadmap's GA-logistics row).

## [0.8.88] — 2026-06-20 · Fix the Sequential Thinking MCP server (wrong npm package name)

### Fixed
- **"Sequential Thinking" now mounts.** The Marketplace catalog shipped the wrong npm package —
  `@modelcontextprotocol/server-sequentialthinking` (no hyphens) is a **404**, so `npx` exited immediately
  and mounting failed with *"MCP error -32000: Connection closed."* Corrected to
  `@modelcontextprotocol/server-sequential-thinking`. Audited the rest of the MCP catalog — all other npm
  package names resolve. +regression test that fails if the 404 name reappears.

## [0.8.87] — 2026-06-20 · Security: ask mode no longer auto-runs shell-chained commands (Codex review)

### Security
- **An allowlisted prefix can no longer smuggle a chained/redirected command past the prompt.** In `ask`
  mode, `npm test && npm publish` started with the allowlisted `npm test ` and was silently allowed — so the
  unapproved `npm publish` ran. `ask` mode now applies the same shell-control guard as `allowlist` mode: a
  command containing `; & | > < \` $( ${` is **never auto-run from a prefix match** — it falls through to the
  approval prompt (the user can still approve it; catastrophic patterns remain hard-blocked). +tests.

### Fixed
- **The "Enable Safe Commands" set and the new-install default no longer drift.** `SAFE_COMMAND_TEMPLATES`
  is now the single source of truth and `roam.allowedCommands`'s default mirrors it (a test enforces it).
  Both gained the common non-destructive verify/lint tools (`npm ls`, `npm audit`, `pnpm/yarn test`,
  `npx eslint/prettier/vitest`, `tsc`, `eslint`, `prettier`, `go vet/build`, `cargo check`) and dropped the
  `git branch` prefix footgun (it matched `git branch -D`).

## [0.8.86] — 2026-06-20 · Audit: no other form loses unsaved input on navigation

### Fixed
- **Settings panel no longer wipes unsaved model-tuning edits** when you click a navigation action
  (Browse MCP Marketplace / Open native settings / Sign up / Open team file / Reset). It used to re-render
  the whole panel after *every* message; those actions change nothing it displays, so they now return
  without re-rendering — the same fix class as the Agent Builder form (0.8.85).

### Audited (no change needed)
- Reviewed every webview form. **Marketplace, Workflow Editor, Team Rules, Onboarding wizard, and Chat**
  all update via incremental `postMessage` (never rebuild their HTML after an action), so they don't lose
  in-progress input. Only the Agent Builder (0.8.85) and Settings (this release) had the re-render-on-action
  pattern.

## [0.8.85] — 2026-06-20 · Agent Builder: keep the form on Marketplace round-trip + custom-role hint

### Fixed
- **The in-progress agent form is no longer wiped when you visit the MCP Marketplace.** Clicking "Browse MCP
  Marketplace…" re-rendered the builder immediately (a leftover from the old blocking input box), erasing
  everything you'd typed. It no longer re-renders — the webview is kept alive across the round-trip, and the
  MCP grant list refreshes on return, so your name/role/instructions/model/selections survive and the newly
  installed server appears as a grantable checkbox.

### Added
- **Prominent "required" hint beside the Instructions title for a custom role** — a custom role has no
  default system prompt, so the builder now clearly says instructions are required (or the agent can't be
  created), shown the moment you pick "Custom role." +tests.

## [0.8.84] — 2026-06-20 · Reset button is now visibly a destructive action

### Changed
- The Settings → **"Reset workspace state…"** button now uses a **red/danger style** (instead of the muted
  secondary look) so it's easy to find — it clears the team, chat, message log, conversations, workflows,
  and approved MCP servers, then reopens the Setup wizard.

## [0.8.83] — 2026-06-20 · Agent Builder: clear save errors + MCP grants via the Marketplace

### Fixed
- **The Agent Builder now says *what* is wrong on save** instead of a generic "invalid save payload." It
  names the missing/invalid fields — e.g. *"please fill in: System prompt, Custom role name"* — which was
  the wall users hit building a custom-role agent (a custom role needs a name + a system prompt).

### Changed
- **"Add MCP server…" → "Browse MCP Marketplace…"** in the Agent Builder. It now opens the **MCP
  Marketplace** (its MCP tab) instead of a raw spec input box. After you install a server there, returning
  to the builder **refreshes the MCP-grants list automatically** (without wiping your in-progress form), so
  the new server appears as a grantable checkbox.

## [0.8.82] — 2026-06-20 · Better default allowlist (smoother inner loop, still safe)

### Changed
- **`roam.allowedCommands` default refined** to cover the agent's non-destructive inner loop across more
  ecosystems, so fewer needless prompts without auto-running anything risky. Added `git show`, `npm ls`,
  `npm run test`, `npm run typecheck`, and verify commands for Python/Go/Rust (`pytest`, `go test`,
  `go vet`, `cargo test`, `cargo check`) alongside the existing JS/TS verify + read-only git/npm set.
  Still **non-destructive only** — installs, commits/pushes, deletes, deploys, and bare `npm`/`git`/`npx`
  are deliberately excluded (they prompt; grow per-repo via "Allow for project"). Only seeds **new**
  installs; existing users keep their setting. Also clarified the setting's description (it's the
  pre-approved set in `ask` mode too, not just `allowlist` mode).

## [0.8.81] — 2026-06-20 · Command policy now applies live (the "Ask each never prompts" root cause)

### Fixed
- **`roam.commandApproval` / `roam.allowedCommands` edits in Settings now take effect immediately** — no
  window reload needed. The live `CommandPolicy` only reloaded via the approval-bar dropdown, "Allow for
  project", or `roam.enableCommands`; a Settings-UI edit was **silently ignored** until restart. So emptying
  the allowlist (or switching to "ask") didn't actually re-gate anything, and — combined with an earlier
  "Allow for project" that had added e.g. `npm install` to the allowlist — non-allowlisted commands kept
  running with no prompt. Added an `onDidChangeConfiguration` handler that reloads the live policy on those
  keys (logs `[policy] reloaded …` to the Output channel). +test for re-gating an emptied allowlist.

## [0.8.80] — 2026-06-20 · Harden the 0.8.79 permission gate (Codex review)

### Fixed
- **No dangling `--permission-prompt-tool` when the MCP config can't be written.** If `.roam/mcp.json`
  couldn't be written (e.g. an unwritable working directory), claude got a permission-tool name for a server
  it never mounted. The orphaned local servers are now stopped and neither `--mcp-config` nor
  `--permission-prompt-tool` is emitted in that case.
- **Failed `claude` spawn no longer leaks a local server or config file.** Startup mounts the
  permission/team-bridge servers before spawning; on a spawn error (missing/broken `claude` binary) the
  `exit` handler never fires, so cleanup is now done explicitly in a try/catch — stopping the servers and
  removing `.roam/mcp.json` — then the error is rethrown. (Pre-0.8.79 this leaked only the PM bridge; 0.8.79
  widened it to every non-autoApprove Claude agent.)
- **Shell-tool gating is case-insensitive**, so a differently-cased tool name can't slip a command past the
  approval gate ungated. +tests for all three (write-failure, spawn-failure, case normalization).

## [0.8.79] — 2026-06-20 · Unified command approval — Claude agents now honor "Ask each" too

### Added
- **Claude agents' shell commands now go through Roam's approval card**, closing a real gap (and a
  security-misperception): Claude agents run under the `claude` CLI's own `--permission-mode`, so their
  `Bash` commands previously **bypassed `roam.commandApproval` entirely** — "Ask each" never applied to
  them. Each Claude agent now mounts a per-agent MCP **permission-prompt tool** (`--permission-prompt-tool`)
  that routes shell commands through the **same `CommandPolicy` + approval card** as OpenAI-compat
  `run_command`: allowlisted commands run silently, others prompt (Allow once / session / project / Deny),
  blocked ones are denied. Agents with **auto-approve on** stay in `bypassPermissions` (no gate), matching
  the toggle's meaning.
- **Approval cards now name the requesting agent** — "**Senior Developer** wants to run `npm install`"
  instead of "An agent". The approval bar is panel-global, so a teammate's request is visible **from any
  chat view** (you don't have to be looking at that agent). Applies to `run_command`, `run_checks`, and the
  new Claude gate.

### Notes
- "Ask each" means *ask for each not-yet-approved command*; the 9 defaults in `roam.allowedCommands`
  (`npm test`, `npm run build`, `npx tsc`, `git status/diff/log`, …) run without prompting. Empty that list
  to be asked for literally everything.

## [0.8.78] — 2026-06-20 · Fix the PM verify deadlock — run_checks now prompts in `ask` mode

### Fixed
- **The PM no longer deadlocks at the verification step.** With `roam.commandApproval: ask` (the default),
  `run_checks` checked the policy and **dead-ended** with *"blocked … awaiting user approval"* — but unlike
  `run_command`, it never actually **showed an approval card**, so there was nothing to approve. The PM's
  fallback (`npm test` via `run_command`) is delegate-gated for a coordinator, so the PM had **no path to
  verify** and stalled before the reviewer (anti-spin then blocked it entirely). `run_checks` now uses the
  **same `ask`-mode approver as `run_command`**: it prompts, runs the verify command when approved, and on
  denial returns the user's note instead of a dead-end. Observed with an **Opus** PM, so this was a
  framework gap, not a model limitation. +tests.

## [0.8.77] — 2026-06-20 · Assistant-prefill 400 self-heal: flatten to a valid user-ending conversation

### Fixed
- **Stronger fix for the "must end with a user message" 400** (follow-up to 0.8.76). Appending a user
  message after a `tool_result` created two consecutive user turns in the Anthropic translation, which the
  gateway *also* rejects — so the turn still wedged. The self-heal now **flattens the tool history** (drops
  tool_results, turns assistant tool-call turns into short text notes, **merges consecutive same-role turns**
  for valid alternation) and ends on a user message, then retries once. Lossy (tool detail → summary) but it
  produces a conversation `claude-sonnet-4-6` (and similar) actually accept, instead of failing the turn.

## [0.8.76] — 2026-06-20 · Self-heal the "assistant message prefill / must end with a user message" 400

### Fixed
- **A gateway/model that rejects a conversation ending with a tool_result (or assistant turn) no longer
  wedges the turn.** Some models via the Anthropic-translating gateway (observed: `claude-sonnet-4-6`)
  return *"does not support assistant message prefill; the conversation must end with a user message"* when
  we send a history that ends on a `tool_result`. The backend now detects that 400 and **appends a short
  user message so the conversation ends with `user`, then retries once** (bounded, per turn). It also
  proactively never sends a trailing **empty** assistant turn, and dumps the role/tool_use_id sequence to
  the Output channel on this 400 (same diagnostic as the tool-pairing 400) so it can be matched to a gateway
  request id. +tests.

## [0.8.75] — 2026-06-19 · Diagnostic: dump the message pairing on a tool-pairing 400

### Added
- **When the gateway rejects a request with the tool-pairing 400** (`unexpected tool_use_id … no
  corresponding tool_use`), the Output channel now logs the **role / tool_use_id sequence we actually
  sent**, with any orphan `tool_result` flagged `⚠ORPHAN`. This lets a 400 seen in the gateway backend (by
  request id) be matched to the exact message that broke pairing — turning a guess into a precise
  diagnosis. (Only logs when that specific 400 occurs; the self-heal flatten + retry still runs.)

## [0.8.74] — 2026-06-19 · PM: call list_agents once, then delegate (deliberate role discovery)

### Changed
- **The complex-task PM now calls `list_agents` exactly once to learn the team, then delegates by role —
  and never re-lists.** (Follow-up to 0.8.73, by request.) Makes role discovery deliberate rather than
  delegating blind and relying on the wrong-role error to correct it, while still killing the loop/stall:
  any further urge to "check the team" means `assign_task` now, not re-list. The simple-task fast path is
  unchanged (delegate in one call, no `list_agents`).

## [0.8.73] — 2026-06-19 · PM no longer loops list_agents / over-explores on a complex task

### Fixed
- **A complex (escalated) task no longer makes the PM loop `list_agents` and stall.** The full-process
  prompt literally said "Call list_agents to see who is available", which invited a model to call it
  repeatedly (observed: 5× until anti-spin blocked it, then an idle stall — and, while exploring, the PM
  also hit a hallucinated-absolute-path "can't reach" give-up). The step now says: **delegate directly by
  role — do NOT call `list_agents` first or loop it, and do NOT explore the repo to "get oriented"; assign
  the task and let the specialist read what it needs.** This removes the fixation point that stalled the
  escalation path (independent of model).

## [0.8.72] — 2026-06-19 · Table parser: handle escaped/code pipes + ragged rows (Codex review)

### Fixed
- **Markdown table cells with a `\|` escaped pipe or a pipe inside inline code (`` `a|b` ``) no longer split
  into extra columns.** The parser scanned every `|` as a delimiter; it now ignores escaped pipes and pipes
  inside backtick code spans. Body rows are also normalized to the header's column count (short rows padded,
  long rows truncated) so a ragged table still aligns. +regression tests.

### Docs
- Added **Sandboxed execution** to the post-1.0 roadmap (paired with the Headless CLI + Enterprise-lite),
  with the rationale (it matters once a human leaves the approval loop) and a Docker-opt-in-first path.

## [0.8.71] — 2026-06-19 · Render Markdown tables in the chat

### Added
- **The chat now renders GFM tables** (`| a | b |` with a `|---|:--:|---:|` separator) as real tables —
  previously they showed as raw pipes. Column alignment (`:--`, `:-:`, `--:`) is honored, and inline
  formatting (bold/links/code) works inside cells. A stray `|` in prose is not mistaken for a table.
  Brings the chat closer to Claude Code / Codex / Kilo for comparison tables and structured output.

## [0.8.70] — 2026-06-19 · Gate the PM's own write tools behind "no teammate" (it must delegate)

### Changed
- **A PM with teammates can no longer do file edits / run commands itself — it must delegate.** The prompt
  alone wasn't enough (a model would still self-edit using its always-available write tools). Now, when a
  coordinator that **has teammates** calls a write/command tool (`write_file`, `apply_edit`, `delete_file`,
  `run_command`, …), the call is **bounced with a "delegate this with assign_task" message instead of
  executing** — so the work flows through the crew, the verifier gate, and per-agent attribution. The tools
  stay in the PM's set (so an aliased `Edit` resolves cleanly and never hits the "unknown tool" error that
  used to trigger a refusal), but *using* them is redirected to delegation. With **no teammates**, the PM's
  file tools execute as a genuine fallback. Read tools (`read_file`/`list_dir`/`search_files`) are not gated.
  This makes the PM a true orchestrator — the self-do path is **Solo mode**.

## [0.8.69] — 2026-06-19 · PM delegates by default (resolve the "did it itself" inconsistency)

### Changed
- **The PM now delegates *every* task, including a one-line edit, instead of sometimes doing it itself.**
  Two earlier directives conflicted: 0.8.59 told the PM "you may make a trivial change yourself" (added to
  dodge a refusal), while 0.8.67 made the default "delegate in one step". The model resolved that by
  self-editing — which bypasses the crew, the verifier gate, and per-agent attribution (the whole
  multi-agent point). Both the role line and the PM template now say: delegate by default; your own file
  tools are a **fallback only**. The PM keeps write/execute capability purely as a **safety net** (so a model
  that instinctively reaches for `Edit` gets an `apply_edit` success rather than a refusal-triggering error),
  but its first move is always `assign_task`.

## [0.8.68] — 2026-06-19 · Code-review fixes (queued-slot leak on failed start; narrower refusal detector)

### Fixed
- **A queued delegation's token slot no longer leaks if the worker never starts.** The dispatch-time slot
  reserved for a queued async delegation (0.8.62) was only released on agent *removal*. If the lazy
  `start()` failed (or the queued worker was stopped without removal), the slot stayed reserved, the root
  task's active count never hit zero, and the task never appeared in "Latest tasks" (and the tracker kept an
  open task forever). Centralized into `cancelQueuedTaskWork()` — used on **remove** and now on
  **lazy-start failure** — which releases the slot and finalizes/notifies if that completes the task.
- **The tool-distrust refusal nudge no longer flags legitimate "run it in your terminal" answers.** Phrases
  like *"run `npm test` in your terminal"* were treated as a refusal, so a correct answer to "how do I run
  the tests?" could get nudged. Now the unambiguous signals (prompt-injection / hooks / "not my toolset")
  match outright, but the "run it manually" phrasing only counts **alongside a refusal signal** ("I can't",
  "instead", "not part of my tools", …). +false-positive tests.

## [0.8.67] — 2026-06-19 · PM boundary = default-delegate + 4 concrete escalation triggers

### Changed
- **Replaced the PM's "simple vs complex" judgment with a default + explicit triggers.** Asking the model
  to classify a task as "simple" was itself a deliberation point (it just moved where a weak model dithers).
  Now the PM's **default is to delegate in ONE `assign_task`**, and it escalates to the full multi-step
  process **only** when it clearly sees one of four concrete triggers: (a) multiple distinct deliverables,
  (b) multiple files that must stay consistent, (c) an explicit ask for tests and/or review, or (d) an
  open-ended/large goal ("build X", "refactor the codebase"). "Do I see one of these 4 things?" is far
  cheaper for a weak model than "is this simple?" — which is the point of the weak-model-first design.

## [0.8.66] — 2026-06-19 · PM "fast path" so a CHEAP model can coordinate a simple task

### Changed
- **The PM now has a fast path for simple requests**, so coordinating a one-line edit doesn't require a
  premium model. The old prompt made the PM wade through 8 heavyweight steps (todos → architect contracts →
  list_agents → parallel fan-out → checks → review) for *every* request, which made weaker models dither
  (e.g. GLM looping "read first? list first?"). Now: for a single simple task, the PM is told to call
  **one `assign_task`** immediately — no reading files, no `list_agents`, no todos — and the full process is
  reserved for genuinely multi-step/multi-file work. This is the thesis (strong framework lets a weak model
  do the job), not "throw a bigger model at it". (The default PM model stays Opus for now as a safe
  out-of-box default; the goal is to validate a cheap model as the default with this fast path.)

## [0.8.65] — 2026-06-19 · Default the PM to Claude Opus 4.8 (a reliable orchestrator)

### Changed
- **The default Project Manager model is now `claude-opus-4-8` (was `claude-sonnet-4`).** Side-by-side
  testing showed some smaller/older Claude snapshots (e.g. Sonnet 4.x) cling to a "Claude Code" identity as
  a coordinator — reaching for Edit/Bash, refusing, and crying "prompt injection" — while **Opus 4.8
  delegates cleanly** (read → assign_task → verify → report) through the same gateway. The PM is the brain
  of the crew, so it now defaults to the strongest reasoner that *also* orchestrates reliably. (Non-Claude
  models like GLM also complete the job; Claude models remain excellent as the executor/developer roles.)
  Existing teams are unchanged — this only affects newly-created default crews; you can set any agent's
  model in **Edit Agent**.

## [0.8.64] — 2026-06-19 · Push back on the "your tools are fake, run it yourself" refusal + helpful delegate errors

### Fixed
- **A model that refuses by claiming its tools are faked now gets pushed back to using them.** When a model
  ends a turn insisting a tool result is a "prompt injection" / a "hook", that its real tools are
  Edit/Write/Bash, or telling the user to run a command **manually** — instead of doing the work — the
  backend now detects that and nudges once (bounded): "your tools are real and working; do the task now
  with apply_edit / write_file / assign_task; if a call failed, fix its arguments and retry." A behavioral
  guardrail like the announce-nudge, for the Claude-Code-identity refusal.
- **Delegation errors now name the available teammates.** `assign_task` with an empty/unknown target used
  to say only "no teammate '' — call list_agents"; it now says **which roles you can delegate to** (e.g.
  "Specify which teammate by role: senior-dev, reviewer …"), so a model that calls a delegate tool without
  a target can recover in one step instead of giving up.

## [0.8.63] — 2026-06-19 · Tell Claude models they're in UnodeAi, not Claude Code (stop the false "prompt-injection" alarm)

### Fixed
- **A Claude PM no longer cries "prompt injection / check your hooks" — even when its tool call succeeded.**
  A Claude model believes it is *Claude Code*, so it pattern-matches any unfamiliar tool shape or message
  to "a hook is faking my tools" and refuses, telling the user to check their hooks — observed **even after
  the `Edit` succeeded** (the line was actually written). The system prompt now states plainly that the
  agent runs **inside UnodeAi, not Claude Code**, that there are **no hooks** intercepting/faking tools,
  that every tool result is genuine, and that it must **never** call a result a "prompt injection" or tell
  the user to check their hooks. Pairs with the 0.8.59 softened corrective + working-lead PM.

> If you hit this on a chat that started before 0.8.59, the model may still anchor on the earlier narrative
> in its history — a **new chat** on 0.8.63 avoids it entirely.

## [0.8.62] — 2026-06-19 · Code-review fixes for 0.8.55–0.8.58 (queued-delegation tokens, narrower webview perms)

### Fixed
- **"Latest tasks" no longer drops tokens for an async delegation to a STOPPED/queued worker.** A task is
  now bound to its root **at dispatch time** (when the delegator is still in its turn) instead of when the
  worker's turn finally starts — and a slot is reserved then — so a PM that `assign_task_async`s to a
  stopped teammate and finishes first still has the worker's usage attributed to the task when it runs
  later. (0.8.58 handled the case where the worker had already started; this covers the queued path.) A
  removed-before-running worker releases its slot. +tests.

### Changed
- **The Agent Builder webview narrows `enableCommandUris`** from "all commands" to just
  `['roam.openSettings']` (the one link it uses) — least-privilege for a panel rendering dynamic content.
- Added a **regression test** that saves an agent with every Settings tuning field through the Agent
  Builder and verifies none is dropped (the clobber risk was already fixed at HEAD in 0.8.60–0.8.61).

## [0.8.61] — 2026-06-19 · Agent edit: add Stream + Context window (complete fine-tuning parity)

### Fixed
- **Completed the Agent edit ↔ Settings fine-tuning parity** (follow-up to 0.8.60): added the remaining two
  fields — **Stream** and **Context window (tokens)** — to the Agent edit page. Context window persists to
  the agent's `contextWindowTokens` (via `sanitizeContextWindow`), `stream` joins the model params. The
  Agent edit page and the Settings panel now expose an identical set.

## [0.8.60] — 2026-06-19 · Agent edit: model fine-tuning now matches the Settings panel

### Fixed
- **The Agent edit page's Model fine-tuning section was missing fields** the Settings panel had. Added
  **Response format, Thinking (+ budget), Tool choice, and Stop sequences**, so the two entry points show
  the same set. Both now parse through the same `sanitizeParams`, so editing an agent in either place
  produces identical stored params (smoke finding 1b).

## [0.8.59] — 2026-06-19 · PM is a working lead (fixes the Claude-PM "prompt-injection" refusal)

A Claude PM, told to delegate, would instead reach for `Edit`/`Write`/`Bash` to do a small edit itself.
Because the PM was deliberately write-less, the tool-name aliases couldn't fire, so it got an "unknown
tool — you are a COORDINATOR" corrective — which a Claude model reads as a **prompt-injection attack** and
**refuses**, telling you to check your hooks. Fighting a frontier model's "I edit files directly" instinct
with prompts kept losing.

### Changed
- **The Project Manager is now a working lead, not a pure delegator.** It gains `write` + `execute`, so a
  trivial edit it attempts **just works** (`Edit`→`apply_edit`, `Bash`→`run_command`). Its prompt still
  steers it to **delegate substantial / specialized / parallel work** to teammates — it only acts directly
  on small things (a one-line edit, reading a file, running checks). The team, verifier-gate, and
  orchestration are unchanged; build a pure-delegator custom agent if you want one.
- **The unknown-tool corrective no longer asserts the model's identity/environment** ("you are a COORDINATOR
  in UnodeAi"). It now just states the available tool names — so a Claude model stops treating it as an
  injection and recovers instead of refusing.

## [0.8.58] — 2026-06-19 · Code-review fixes for 0.8.54–0.8.57 (recovery loop, async token attribution, Settings link)

### Fixed
- **Request-body recovery now loops** instead of retrying once. A custom gateway can reject several
  incompatible fields in sequence (e.g. `parallel_tool_calls`, then `reasoning_effort`); `chat()` now
  applies at most one recovery per failed attempt, rebuilds the body, and retries until none applies (capped).
  Previously the second rejection escaped. +test.
- **"Latest tasks" no longer drops async-delegation tokens.** A task is finalized only when the root turn
  has ended **and** every inherited turn has too — so a worker dispatched with `assign_task_async` that
  finishes *after* the PM's turn is still counted (previously its usage was dropped). +test.
- **The Agent Builder's "Manage in Settings →" link now works** — the panel was created without
  `enableCommandUris`, so the Smart Mode link was inert. Enabled it.

## [0.8.57] — 2026-06-19 · Agent edit: per-agent model fine-tuning + Smart Mode tier override

### Added
- **Model fine-tuning in the Agent edit page.** Editing an agent now exposes its per-agent sampling/reasoning
  settings — temperature, top-P, max output tokens, reasoning effort, presence/frequency penalty. Blank =
  use the global default. It writes the same `modelParams` the Settings panel edits for that agent, so the
  two stay in sync.
- **Per-agent Smart Mode tier override.** A tier selector (Premium / Standard / Economy, or "Use role
  default") on the agent. When Smart Mode is on, the agent runs on the model mapped to **its** tier, which
  **overrides the role tier** — so two same-role agents can run at different tiers. The tier→model mapping
  stays global (a link opens Settings → Smart Mode). Routing now checks `config.tier` before the role tier.

## [0.8.56] — 2026-06-19 · Self-heal a wedged tool-call history (tool-pairing HTTP 400 backstop)

### Fixed
- **A session whose tool-call history the gateway can't pair now recovers automatically.** If a request is
  rejected with `unexpected tool_use_id … no corresponding tool_use block in the immediately-preceding
  message` despite the pre-send normalizers (e.g. a chat restored from a snapshot taken on an older build),
  the backend now **flattens the tool structure** — drops tool results and turns each prior assistant
  tool-call turn into a short text note — and **retries once**. It's lossy (some tool-call detail becomes a
  summary line) but it **unwedges the session** instead of failing every turn. One self-heal per turn.

> If you hit this on a chat that started before 0.8.54, this release recovers it on the next message; a
> brand-new chat avoids the wedged history entirely.

## [0.8.55] — 2026-06-19 · Code-review fixes for 0.8.52–0.8.54 (task-token attribution + parallel_tool_calls fallback)

### Fixed
- **"Latest tasks" no longer cross-counts concurrent tasks.** Per-task token usage was computed by diffing
  *every* session's cumulative usage over the task window, so two user tasks running at once on different
  agents each absorbed the other's tokens. Attribution is now **by origin**: a user turn roots a task and
  delegated turns inherit their delegator's task, so each turn's tokens land on the right task. Extracted to
  a unit-tested **`TaskTokenTracker`** (covers the two-overlapping-tasks case).
- **`parallel_tool_calls: false` no longer hard-fails stricter gateways.** Some OpenAI-compatible/custom
  endpoints 400 on the unknown field. We now **drop it and retry once** for that session (same pattern as
  `reasoning_effort`); `splitParallelToolCalls` still guarantees valid tool pairing without it. +regression
  test with a fake "unknown field parallel_tool_calls" 400.
- **`splitParallelToolCalls`** now preserves the original assistant message's fields on its first split
  segment instead of rebuilding a bare message.
- **Per-task token state is cleared when an agent is removed** mid-task (no leak / mis-attribution).

## [0.8.54] — 2026-06-19 · Fix the parallel-tool-call HTTP 400 (orphan tool_result, "immediately-preceding message")

### Fixed
- **A model making parallel tool calls in one turn no longer 400s the gateway.** When a model emits several
  `tool_calls` in a single assistant message, OpenAI answers them with several `tool` messages — but an
  Anthropic-translating gateway requires each `tool_result` to sit in the message *immediately after* its
  `tool_use`, and orphans the 2nd+ result (`unexpected tool_use_id … no corresponding tool_use block in the
  immediately-preceding message`). Now the request:
  - sends **`parallel_tool_calls: false`** so models make one tool call per turn (prevention), and
  - **splits any parallel turn already in history into sequential `assistant → tool` pairs** before sending,
    giving strict 1:1 adjacency that any gateway accepts (cure — also unwedges a session that already
    recorded a parallel turn).

This is the same 400 family as 0.8.48's orphan-result fix, but its real cause was parallel tool calls, not
just stray results.

## [0.8.53] — 2026-06-19 · Dashboard "Latest tasks" — per-task token usage, broken down by agent

### Added
- **A "Latest tasks" panel on the Dashboard** showing your most recent user-initiated tasks, each broken
  down by the agents that worked on it — a token bar per agent (hover for input/output split + cost), plus
  the task's total tokens and cost. Unlike a single total, this shows **where** the tokens went across a
  PM-led multi-agent run. A task spans the user's request and all the delegated sub-work it triggered;
  per-agent numbers are computed as the usage delta over the task window.
- **Configurable count** via a **Show last: 3 · 5 · 10 · 20** control in the panel header (persisted). The
  Dashboard now re-renders live as tasks complete.

## [0.8.52] — 2026-06-19 · Ground every agent with the real workspace file listing (root cause of the path hallucination)

Side-by-side, a Claude-powered Roam agent could fail "show me the README" while Cline/Kilo (on weaker
models) succeeded — because they **show the model the workspace files** and Roam did not. Told only the
root path string, a strong model confabulates a path from its training prior (e.g.
`/Users/dev/workspace-xxxx/README.md`). That's a grounding gap, not a model-quality gap.

### Fixed
- **The model now always sees a real, relative file listing of your workspace** (the working directory +
  files, respecting your `files.exclude`/`search.exclude`, skipping `node_modules`/`.git`/build dirs,
  capped). It's injected every turn and **on by default** — previously workspace orientation was gated
  behind `roam.engine.workspaceContext` (default off) and, even when on, only included the active editor
  file + diagnostics, never a file list. Now an agent knows `README.md` exists and uses the exact relative
  path instead of inventing one. (The richer diagnostics + active-file context stays opt-in via that flag.)

Together with 0.8.51's path re-rooting (the safety net), this closes the "outside your working folder"
give-up: the model is grounded so it won't confabulate, and if it ever does, the path is re-rooted.

## [0.8.51] — 2026-06-19 · Re-root hallucinated absolute paths (the PM "outside your working folder" give-up)

### Fixed
- **A model that prepends a foreign sandbox prefix to a path no longer dead-ends the turn.** Claude models
  (and others) sometimes call a file tool with an invented absolute path like
  `/Users/dev/workspace-xxxx/README.md` instead of the relative `README.md`. That tripped the
  outside-workdir boundary, which is a **terminal** block — so the PM gave up and told you to "open the
  folder as the workspace" instead of just editing the file. Roam now **re-roots** such a path to the
  matching file **inside** the workspace (longest in-sandbox path suffix that actually exists), so it just
  works. Security is preserved: re-rooting only ever resolves *inside* the sandbox, it's existence-gated
  (a genuine outside path with no in-workspace twin still hits the boundary block), and the
  symlink/junction realpath checks still run downstream.
- **Clearer boundary message.** When a path truly can't be reached, the block now leads with "retry with a
  path relative to the workspace root" instead of "do not try another path" — and the system prompt tells
  models to never invent or prepend an absolute path.

## [0.8.50] — 2026-06-19 · Code-review fixes for the aliasing + apply_edit work (0.8.41–0.8.49)

### Fixed
- **`apply_edit` now runs the symlink/junction sandbox check BEFORE reading the file** (matching
  `write_file`). Previously it resolved + read first, so a workspace symlink to an outside file could let
  `apply_edit` *probe* whether `old_string` was present (and how often) before the eventual write was
  blocked. Closed, with a symlink regression test.
- **Verification bookkeeping now uses the EFFECTIVE (post-alias) tool name.** A model running its check
  via a native name like `Bash` (aliased to `run_command`) now correctly satisfies the verify obligation —
  before, a genuinely-verified edit could still trip the "⚠ Changes not verified" path because the
  bookkeeping compared the model's raw name.
- **Targeted edits show as file edits in the UI.** `apply_edit` is now classified as an `edit` activity
  (category, summary, and target), so it renders like a write instead of generic tool activity.

## [0.8.49] — 2026-06-18 · Tool-name aliasing (any model's muscle memory just works) + apply_edit

Roam is built to run *many* models, and each model is trained on its own harness's tool names. Rather
than fight that variance one model at a time, the framework now **absorbs** it.

### Added
- **Cross-model tool-name aliasing.** When a model calls a tool by a name from another harness —
  `Read` / `Bash` / `Write` / `Edit` / `LS` / `Grep` / `Task` (Claude Code, Cursor, GPT, etc.) — Roam now
  **transparently maps it to the real tool and shims the arguments** (`file_path`→`path`,
  `command`, `old_string`/`new_string`, …). The model's muscle memory just works instead of erroring,
  so no call is wasted re-discovering the right name. `Task`→`assign_task` only for coordinators.
- **`apply_edit` — a targeted edit tool.** Replace an exact snippet in a file (`old_string`→`new_string`,
  with `replace_all`) instead of resending the whole file with `write_file`. It validates the match is
  present and unique, then writes through the **full safety path** (compare-and-swap, truncation guard,
  write-approval, checkpoint/restore). It's also the alias target for a model's native `Edit`/`str_replace`,
  and it's safer than whole-file writes for small changes.

This makes a Claude-model **senior developer** (not just the PM) reliable: when it reaches for `Edit` to
change a file, the edit lands — no "unknown tool", no wasted turn. It's the first of the model-variance
levers (aliasing → `apply_edit` → model-profile registry → conformance harness).

## [0.8.48] — 2026-06-18 · Claude-model PMs use the real tools + delegate; fix orphan-tool_result 400

### Fixed
- **Claude models (e.g. Sonnet/Opus) as the PM no longer flail with Claude Code's native tools.** They
  would call `Glob` / `Bash` / `Read` / `Edit` / `Task` / `edit_file` — none of which exist in UnodeAi —
  get a bare "unknown tool", and stall. Now: (a) the system prompt lists the real tools and explicitly
  says *don't* use those names, (b) a coordinator is told up front it **delegates with `assign_task` and
  has no write tool**, and (c) an unknown-tool call returns a **corrective listing the real tools** (and,
  for a coordinator, "delegate with assign_task") so the model recovers instead of looping.
- **Fixed `HTTP 400 … unexpected tool_use_id … must have a corresponding tool_use in the previous
  message`.** A malformed/blocked tool exchange could leave an **orphan `tool_result`** (an id with no
  matching `tool_use`), which an Anthropic-translating gateway rejects. The pre-request self-heal now
  drops orphan and duplicate tool results (and still backfills missing ones).

## [0.8.47] — 2026-06-18 · Zero-data-retention statement on the feature page

### Docs
- Added a precise **"Zero data retention & no telemetry"** statement to the README (Marketplace feature
  page), the wiki, and the user manual: the extension itself keeps no copy of your code/prompts and has
  no analytics/tracking/phone-home; code is sent only to the model provider you configure; and because
  UnodeAi works with any OpenAI-compatible endpoint, you can self-host / use an in-VPC model for
  provable end-to-end zero-retention. (Scoped to the extension — the gateway/provider's retention is the
  customer's choice.)

### Changed
- **Delegation now prefers a FREE teammate over a BUSY one.** When several teammates share the target
  role, the runtime router picks one that isn't currently running a task (idle **or** stopped — a stopped
  agent is free and auto-starts on assignment), round-robining among the free ones. If *every* candidate
  is busy, the least-loaded / least-recently-assigned gets it and the task simply queues (delay expected).
  Previously a `stopped` teammate was wrongly treated as "unavailable" and skipped in favor of a *busy*
  running one; now only a truly **errored** teammate is excluded. The PM still just delegates by role —
  the runtime does the load-aware selection (and logs *why* in the route audit). (张's feedback.)

## [0.8.45] — 2026-06-18 · PM delegates instead of stalling on "stopped" teammates

### Fixed
- **The PM now delegates instead of getting scared off by `stopped` teammates.** `list_agents` reported
  each teammate's status (`stopped`/`idle`), which a coordinator read as "unavailable" — so it looped
  `list_agents` and announced "let me delegate…" without ever issuing `assign_task`. Teammates are
  **lazily started on assignment** (a delegated task auto-starts a stopped agent), so the status was both
  misleading and irrelevant to the PM. `list_agents` now omits it and tells the PM to **delegate now —
  the teammate starts automatically**. Pairs with the 0.8.44 anti-spin guard so a trivial PM task
  actually lands.

## [0.8.44] — 2026-06-18 · Stop agents spinning on a succeeding tool (PM looping list_agents)

### Fixed
- **An agent can no longer burn its whole turn re-calling the same succeeding tool.** The PM would call
  `list_agents` a dozen times and stall ("I'll create a plan and delegate… let me first check…") without
  ever delegating, because the circuit-breaker only counted *failing* repeats. Now an identical
  (name+args) call that has already run a few times this turn is blocked with a firm corrective —
  *"you have the result; act now — delegate (assign_task), write the file, or run the command"* — so the
  coordinator actually moves to the next step instead of looping to the iteration cap.

## [0.8.43] — 2026-06-18 · Team Pack verify-command prompt is now unmissable

### Changed
- **Picking a Team Pack now shows the verify-command setup as a modal**, not a corner toast you could
  miss. When no `roam.verifyCommand` is set it asks (modal) to set the pack's recommended one and confirms
  when you do; when a different one is set it asks **Replace / Keep Existing** (modal); and when it's
  already the pack's command it confirms the gate is wired (no silent no-op). The choice is still yours —
  it just can't slip by unnoticed.

## [0.8.42] — 2026-06-18 · Fix HTTP 400 on Claude-backed gateways + MCP prerequisite hints

### Fixed
- **The PM no longer crashes with `HTTP 400 … text content blocks must be non-empty`** on the default
  premium path (a Claude-backed model via the Roam/unode gateway). A tool-call-only assistant turn was
  stored with `content: ""`, which OpenAI allows but an Anthropic-translating gateway rejects as an empty
  text block. The pre-request self-heal now nulls empty assistant content that carries `tool_calls` (and
  gives an empty tool result a marker), so the multi-agent loop works end-to-end on Claude routes.

### Added
- Marketplace MCP cards now show display-only **prerequisite hints** before install — the bundled Git,
  Fetch, SQLite, and Time entries are marked **"⚠ Requires uv"** (derived from the `uvx` command), while
  install actions and MCP configs are unchanged. (Codex; reviewed.)

## [0.8.41] — 2026-06-18 · Actionable MCP mount errors (missing command)

### Fixed
- **A stdio MCP server whose command isn't installed now fails with a clear, actionable message** instead
  of the opaque "Connection closed". A pre-flight PATH check names the missing tool and how to get it —
  e.g. the catalog's **Git / Fetch / SQLite / Time** servers run via `uvx`, so without `uv` installed
  you now see *"Git needs uv (the Python tool that provides uvx) — install it: https://docs.astral.sh/uv/"*
  in both the toast and the output channel. (npx-based servers like GitHub/Filesystem/Memory are
  unaffected — they only need Node.)

## [0.8.40] — 2026-06-17 · Worktree lanes keyed by agentId (last review fix)

### Fixed
- Worktree review lanes and Mission Control worktree badges now associate by stable `agentId`, not
  display name, so same-named or renamed agents keep View diff / Re-verify / Hand back, verified
  status, and files-touched on the correct lane. (Closes the last item from the Codex code review.)

## [0.8.39] — 2026-06-17 · Codex review fixes (gate honesty + data-loss guards)

### Fixed
- **Verifier-as-gate no longer treats a policy-blocked check as a pass.** When a configured
  `roam.verifyCommand` is blocked by command policy (can't run), the PM completion gate now says
  **"NOT verified"** with how to fix it, the **worktree gate holds the merge** instead of merging
  unverified work, and the **Evidence Report shows 🚧 Blocked**. (A *missing* command still proceeds —
  there's genuinely nothing to gate on.)
- **Status-bar version now stays visible** — it was immediately overwritten by the agent-count update
  (so 0.8.34's "always-visible version" didn't actually stick). The version rides alongside the count now.
- **Cost-savings is honest** — the premium baseline is the *true* estimate (not `max(premium, actual)`),
  and the Dashboard shows a real "saved $X" **or** "cost $Y over baseline" instead of always claiming savings.
- **Evidence Report counts only this run's files** — it filtered nothing before, so the persisted
  checkpoint store leaked files changed by *earlier* tasks into the report.
- **Agent Builder won't wipe a legacy agent's tools** — editing an agent that has `allowedTools` but no
  skill metadata no longer strips its capabilities (e.g. a PM losing delegate/message) on save.
- **MCP install reports the real outcome** — "added but not mounted (approval skipped)" / "failed to
  mount" instead of always claiming success.
- **Team Packs gate out of the box** — `npm run lint` / `npm audit` are in the default command allowlist,
  so the Refactor and Security Review packs' verify commands actually run in worktree mode.

## [0.8.38] — 2026-06-17 · Crew Mission Control (per-agent lane board)

### Added
- **Mission Control now opens as a per-agent lane board**: each agent row shows status, current task,
  files touched, cost, context usage, Chat/Terminal actions, and worktree verification/mergeability
  when worktree mode is active. The existing cost-savings banner stays above the lanes, and Evidence
  Report is one click from the board. Reuses the live delegation tracker + checkpoints + worktree review
  (no new tracking); the panel stays script-free (command-URI links only).

## [0.8.37] — 2026-06-17 · Evidence Report (the verifier-gate made tangible)

### Added
- **Generate Evidence Report** (Command Palette or the Team toolbar 📋) turns the crew's recent run into
  a skimmable Markdown report: a **Verdict** (✅ Verified / ⚠ Unverified / 🚧 Blocked), **Work done**
  per agent (task + outcome + fix-cycles), **Files changed**, and **Verification** (it runs your
  `roam.verifyCommand` and shows pass/fail with the failing output). It gathers from the live delegation
  tracker + file checkpoints, so the "done" claim comes with evidence — not just the agent's word.

## [0.8.36] — 2026-06-17 · Team Packs + guided Add-MCP form

### Added
- **Task-oriented team packs** now appear in the Create or Switch Team picker, grouped separately from
  knowledge-work presets. Bugfix, Refactor, Test Writer, Release, and Security Review crews compose
  existing roles only and can set a recommended `roam.verifyCommand` for the verification gate (offered,
  never silently overwriting an existing one).
- **Add MCP Server is now a guided form** for name, transport, endpoint, env placeholders, and approval,
  with an escape hatch to open `.roam/team.json`. Env values reject literal secrets and only persist
  `${VAR}` placeholders before routing through the existing MCP persist/mount approval path.

## [0.8.35] — 2026-06-17 · Cost-savings visualization on the Dashboard

### Added
- **The Dashboard now shows what mixed-model routing saved you.** Alongside actual spend, Roam prices the
  *same tokens* against a top-tier model and surfaces a banner: *"Mixed-model routing saved you $X (N%
  off) — all-premium baseline $Y vs your actual $Z."* Makes the cheap-model cost arbitrage concrete
  instead of abstract. (The baseline accrues from this build forward, so it populates as agents run turns.)

## [0.8.34] — 2026-06-17 · Always-visible Roam version in the status bar

### Added
- **The build version now shows in the status bar** (`⬡ Roam v0.8.34`), always visible no matter which
  sidebar sections you've collapsed — so folding the Team panel (which folds away its title-bar version)
  no longer hides what build you're on. One click reopens the UnodeAi sidebar. (VS Code folds a view's
  title-bar actions/version with the section when collapsed and doesn't let an extension pin them open;
  the status-bar anchor is the always-on alternative.)

## [0.8.33] — 2026-06-17 · Mission Control icon themes to the editor title bar

### Fixed
- The **Mission Control icon** in the editor title bar now ships **theme-aware light/dark variants**
  (was a single `currentColor` SVG that didn't invert against the title bar) — so it's clearly visible
  on both light and dark themes.

## [0.8.32] — 2026-06-17 · Agent Builder model combobox + security-by-default narrative

### Changed
- **Agent Builder's model + backup-model pickers are now a single type-to-filter combobox** (was a
  separate search box + dropdown). Start typing to filter the live priced catalog; pick a suggestion or
  hand-type a custom model id. Same in Build and Edit Agent.
- **README "Security by default" section reframed** as a first-class selling point — sandbox, commands
  off by default, tool-layer Plan mode, MCP default-deny, SecretStorage keys, verified-only landing, no
  telemetry — so the trust story is front and center, not buried in settings.

### Docs
- Refreshed `docs/BACKLOG.md` + `docs/STATUS.md`: v0.9 weak-model hardening is **complete** (all 6 items
  shipped across 0.8.x) plus this cycle's moat/GA work; the boards now show the **1.0 commercial punch-list**.

### Added
- **A UnodeAi brand icon now sits in the editor title bar** (top-right, where Claude/Copilot/Kilo put
  theirs). One click opens **Mission Control** — the UnodeAi Dashboard — as an editor tab, so the
  crew view is reachable without hunting through the Command Palette. (`roam.openMissionControl`, also
  in the Command Palette.)

### CI / Release process
- CI now gates on **`npm audit --omit=dev` (high)** and runs a **headless VS Code E2E** job that
  packages the bundled VSIX and smoke-tests activation/commands/panels/onboarding under xvfb — so a
  vulnerable shipped dep or a broken bundle fails the build, not the user. (Fixed the Linux extraction:
  a `.vsix` is a zip, so the smoke unpacks with `unzip` off Windows since GNU tar can't read it.)
- Added [docs/RELEASE_SMOKE_CHECKLIST.md](docs/RELEASE_SMOKE_CHECKLIST.md): a human-run GUI matrix
  (provider switching, CLI auth, MCP grant, edit-running-agent, Smart Mode, the verifier gate, Router
  audit) to run against the bundled VSIX before a GA publish.

## [0.8.30] — 2026-06-17 · Router v1 audit accuracy

### Fixed
- **The Router audit log no longer claims a route that didn't happen.** Previously the
  `Routed … [async]` line was logged *before* the async file-claim gate, so a delegation rejected by a
  file conflict still produced a (false) audit entry. The audit now fires only after the task is
  actually dispatched, on both the sync and async paths — keeping the log truthful, which is the whole
  point of Router v1. (Found by Codex review.)

## [0.8.29] — 2026-06-17 · Router v1: auditable, availability-aware delegation

### Added
- **The PM's agent selection is now explainable and avoids dead teammates (Router v1).** When the PM
  delegates by role, Roam now (a) **hard-filters out stopped/errored teammates** when a live one shares
  the role — so work never goes to a down agent — and (b) logs a one-line **audit reason** to the Roam
  Crew output channel for every routing decision, e.g. `Routed "senior-dev" → senior-dev-2 (idle,
  least-recently-assigned, 1 of 2)`. Selection stays role/idle/round-robin based, but it's now
  reproducible and inspectable instead of opaque. (Capability/MCP-aware scoring is a planned v2.)

## [0.8.28] — 2026-06-17 · GA hardening: bundled VSIX + clean security audit

### Security
- **Cleared the high-severity `hono` advisory** (`npm audit --omit=dev` → 0 vulnerabilities). The
  vulnerable code reached us transitively through the MCP SDK; we only use the MCP **client** transport,
  not hono's affected server features (serve-static / Lambda adapters / CORS middleware), so it was never
  reachable — and an `overrides` bump to the patched `hono@4.12.25` removes it outright.

### Changed
- **The extension now ships as a bundled VSIX** (~560 files / ~1.3 MB, down from ~3,900 files / ~5 MB).
  The release path is `npm run publish:bundle` (esbuild single-file bundle + ajv only), which also keeps
  heavy/vulnerable transitive `node_modules` out of the shipped package. Verified by the bundle smoke
  test (activation, command registration, Settings/Workflow panels, onboarding).

## [0.8.27] — 2026-06-17 · Verifier-as-gate on the default PM path (the moat)

### Added
- **The PM can no longer report a goal "done" while the project checks are red.** On the normal
  (optimistic/shared-tree) path, when a coordinator finishes a turn, Roam runs the objective checks
  (`roam.verifyCommand`). If they fail, the PM is sent back to fix it on a **bounded, deadlock-proof
  ladder**: a couple of same-target fix cycles → escalate to a stronger/different teammate → and if it
  still can't pass, **hand the task back to you** with the failing output and concrete options (retry
  stronger / reassign / take over). It can never loop forever — once the retry budget is spent it always
  hands off. This complements the existing worktree-merge gate (which already blocks failing lanes before
  merge); together they make "only verified work lands" true on both paths.
- New settings: `roam.gate.enabled` (default true), `roam.gate.maxSelfRetries` (2),
  `roam.gate.maxRedelegations` (1). The gate is a no-op unless `roam.verifyCommand` is set, and is
  skipped in worktree mode (already gated at merge) and for non-coordinator agents.

## [0.8.26] — 2026-06-17 · Weak-model "read the code first" rule + Smart Mode per-turn model

### Added
- **New worker rule: "Ground the task in the REAL code before you act."** Weak models tend to go
  straight from instruction → code without reading what's actually there. Every worker/solo agent now
  gets a firm protocol rule to first read the files the task touches, reconcile the instruction with the
  real structure/types/conventions (and not invent APIs or paths), stop and flag a genuine conflict
  instead of forcing a bad change, and match the surrounding code. Coordinators are unaffected.

### Fixed
- **Smart Mode no longer mutates the agent's configured model.** Tier selection for a task is now
  applied per-turn (request-scoped) instead of via `setModel`, so a Smart Mode turn can't leak the
  tier model into `AgentConfig.model` and get persisted by a later roster save. Cost is priced at the
  model actually used for the turn. (Found + fixed by Codex; reviewed.)

## [0.8.25] — 2026-06-17 · Marketplace install UX honesty

### Fixed
- **The MCP card's "Extension / Current team" scope dropdown is removed** — it was a no-op (the install
  path always added the server to the current team's `.roam/team.json` and ignored the choice). The card
  now just says "Adds to this team."
- **The Marketplace Add button now reflects the real outcome.** Previously it flipped to "Installing…"
  then back to "Add" on a fixed 1.2s timer regardless of what actually happened — so a cancelled URL
  prompt, a declined approval, or a failed mount all looked like success. It now locks while the host
  works and then shows **Added ✓** or **Retry** based on the actual result (per-card), with the
  notification still carrying the detail.

## [0.8.24] — 2026-06-17 · MCP Marketplace deep-link

### Changed
- The **Browse MCP Marketplace** button (Settings → MCP Servers) now opens the Marketplace **directly on
  its MCP tab** instead of the default Agents tab. `roam.openMarketplace` accepts an optional tab
  argument (`'agents'` | `'mcp'`), validated and defaulted so an unknown value still lands on Agents.

## [0.8.23] — 2026-06-17 · Agent-card tooltips + MCP Marketplace shortcut

### Added
- **Hover tooltips on agent-card action buttons** (Start / Stop / Restart / Chat / Edit / Terminal /
  Remove) explaining what each does — including the data-loss caveats (Stop keeps the conversation,
  Remove deletes it).
- The **MCP Servers** tab in Settings now has a **Browse MCP Marketplace** button that opens the
  Marketplace, where curated MCP servers install in one click and then appear in this tab ready to grant
  to an agent.

### Docs
- Removed **Google** from the provider API-key table in the manual — it (and Ollama) were hidden from
  the provider pickers in 0.8.21 since there's no working backend path for them.

## [0.8.22] — 2026-06-17 · Sign-up/top-up links + Agent Builder edits apply live (U4)

### Added
- The **Providers** tab in Settings now has **Sign up / Top up** buttons that open registration in your
  browser — Roam Gateway (ai.weroam.xyz) or Unode (unodetech.xyz) — so new users can get an account and
  credits without leaving the editor. The URLs are host-owned (the webview only sends a key), so the
  panel can't be turned into an arbitrary-link opener.

### Fixed
- **Agent Builder edits now apply to a running agent.** Editing a live (idle/running) agent's model,
  system prompt, skills, tool protocol, or **MCP grants** restarts its backend so the changes take
  effect immediately (conversation context is preserved via the session snapshot). Previously the
  running agent silently kept its old config until manually restarted. Stopped/starting/stopping/error
  sessions are left untouched. (U4 — Claude-found.)

## [0.8.21] — 2026-06-17 · Provider-switch + Smart Mode fixes

### Fixed
- Fixed provider switching edge cases: OpenRouter is now treated as an API-key OpenAI-compatible
  provider in Settings and gets native Smart Mode tier models, unsupported catalog-only providers are
  hidden from provider pickers, and Smart Mode no longer claims to hot-swap already-running Claude CLI
  sessions.

## [0.8.20] — 2026-06-17 · Orchestration visibility (U2) + custom agent icons (U3)

### Added
- Added orchestration visibility for delegated crew work: Chat now shows live delegation cards, the
  Activity panel summarizes fan-out progress with done/total counts and per-agent states, and Team
  cards/chips use clearer Idle/Working/Blocked/Done status wording driven by the existing message bus.
- Added custom agent image icons: Agent Builder can upload PNG, JPEG, WebP, or SVG files under 64 KB,
  stores them as `AgentConfig.icon` data URIs, and renders them in Builder preview, Team cards/chips,
  and Chat avatars while preserving emoji/codicon text icons.

## [0.8.19] — 2026-06-17 · Activity feed in the bottom Panel (U1)

### Added
- Added a second live **Activity** copy of the UnodeAi Messages feed in the bottom Panel (where the
  Terminal/Output live), giving the multi-agent feed full editor width. The sidebar Messages view
  remains in place; both views share the same provider/feed and stay in sync for live updates,
  clear/import/export, and compact mode. Phased rollout — if the Panel proves the better home we can
  retire the sidebar copy later.

## [0.8.18] — 2026-06-17 · Agent Builder defaults tool-calling to Auto

### Fixed
- **Agent Builder no longer forces new agents onto native tool-calling**, which quietly bypassed the
  0.8.14 protection. The Tool-calling method now defaults to **Auto** (persisted as "unset"), so a
  builder-made Kimi/Moonshot/GLM/MiniMax agent correctly starts in XML and skips the first-turn
  tool-call stall. Explicit **Native**/**XML** are still honored. (Found by Codex review.)
- Synced `package-lock.json`'s version with `package.json` (was stale at 0.8.0) — release-metadata hygiene.

## [0.8.17] — 2026-06-17 · First-run setup cards are clickable

### Fixed
- **The three cards on the Welcome / Setup screen now work.** "Set a provider", "Create your team", and
  "Get moving" looked clickable but were inert `<div>`s — clicking them did nothing. They're now buttons
  that jump straight to the matching step (provider / team / demo). (You could already advance with
  "Get Started"; the cards just weren't wired.)

## [0.8.16] — 2026-06-16 · Restored sessions are flagged as possibly stale

### Fixed
- **An agent restored from a previous session no longer quotes stale memory as current.** A restored
  conversation can carry old file contents, versions, and command output in its history — which is how
  the PM once reported a remembered `package.json` version. On restore, the conversation is now flagged
  with a note telling the agent the prior context predates this session and to re-read a file (or re-run
  a check) before citing it. The structural backstop to the 0.8.11 "cite from a fresh read" rule;
  context is kept (crash recovery still works), just marked. Completes the stale-memory hardening.

## [0.8.15] — 2026-06-16 · Agents know the project layout

### Changed
- **Every agent is now told the project's structure, not just its build/test commands.** The
  auto-detected conventions block (already injected) gains a **project-layout map**: the detected stack
  (TypeScript, test framework) and the real top-level directories, plus a rule to put new files under an
  existing directory and verify a path exists before writing — instead of inventing one (which led an
  agent to write data into a non-existent `src/marketplace/`). Part of the 0.9 weak-model hardening.

## [0.8.14] — 2026-06-16 · Leaky models start in XML

### Changed
- **Known tool-call leakers now start on the XML tool protocol from turn one.** Models like Kimi/K2,
  Moonshot, GLM, and MiniMax reliably emit their tool calls as text instead of the native `tool_calls`
  field, which made native function-calling stall until the first leak flipped them to XML (Option 4).
  They now begin in XML, skipping that stalled turn. DeepSeek (the high-volume default) and frontier
  models stay native; an explicit **Tool calling** setting in the Agent Builder still overrides this.
  Part of the 0.9 weak-model execution hardening.

## [0.8.13] — 2026-06-16 · Guard against catastrophic file truncation

### Fixed
- **`write_file` now blocks a catastrophic whole-file truncation.** `write_file` replaces the entire
  file, so a weak model that treats it like a patch tool can wipe a large file (we saw a ~97 KB source
  replaced with ~2 KB). A write that shrinks a substantial existing file (≥4 KB) to under 20% of its size
  is now rejected with a corrective telling the agent to re-read and supply the full content (or use
  `delete_file` if removal was intended). Thresholds are deliberately extreme so normal edits/refactors
  are never affected. First of the 0.9 weak-model execution hardening.

## [0.8.12] — 2026-06-16 · Agent Builder fixes (Codex review)

### Fixed
- **Codicon icon presets no longer save corrupted.** The icon was truncated to 8 chars, turning
  `$(beaker)`/`$(shield)` (9 chars) into invalid `$(beaker`. Raised the cap to fit codicons.
- **Switching provider no longer keeps the old provider's model.** Previously the prior selection was
  re-injected as a "custom" option, so you could save (e.g.) an OpenAI agent with a DeepSeek model.
  A provider switch now resets the model to the new provider's catalog.
- **Usage/cost chips on the model row regained their styling** (the chips moved to `.inline-metrics`
  but the CSS still only targeted the old container).
- **The model dropdown no longer hangs on slow pricing.** It waits briefly for live (discounted) prices,
  then shows the models with cached prices instead of blocking on `/api/pricing`.

## [0.8.11] — 2026-06-16 · Fresh-read rule for every agent

### Fixed
- **The "cite from a fresh read, never from memory" rule now applies to every agent** — workers, the
  PM/coordinator, and solo — not just the PM. Any agent that's about to state a version, a config value,
  or a file's contents must re-read it in the current turn rather than quote stale memory. (0.8.10 added
  this for the coordinator only.)

## [0.8.10] — 2026-06-16 · Agent Builder v2

### Added
- **Full priced model picker in the Agent Builder** — the same live catalog the Edit dialog uses, with
  prices, refetched when you change provider. On the Roam gateway it shows your **discounted** rate
  (the account's `group_ratio`), not list price.
- **Backup model** and **tool-calling method (Native / XML)** in the builder, plus an **icon picker**
  (presets or any `$(codicon)`). Max skill playbooks per agent raised to **5**.
- **Marketplace:** a **Build an agent** button on the Agents tab, and an **Add MCP server** action on
  the MCP tab.
- Agent cards show usage/cost **inline on the model row**.

### Fixed
- **The PM/coordinator no longer states facts (versions, config, file contents) from stale memory.** It
  now must re-read the file in the current turn before citing it — catching the class of bug where the
  PM confidently reported an old `package.json` version it remembered from a previous session. (The
  structural stale-memory fix lands in 0.9.)

## [0.8.9] — 2026-06-16 · Build Your Own Agent

### Added
- **Agent Builder** — a new **"Build an Agent"** webview (Team panel + `UnodeAi: Build an Agent`)
  lets you create or edit a custom agent end-to-end without touching JSON: name, role (a template or a
  custom one like *CEO*), model, system prompt, capability tools, and **MCP grants** — then it joins the
  team like any preset.
- **Attach skill playbooks (up to 3)** — pick market-proven playbooks from the skill library in the
  builder; they're folded into the agent's instructions (`## Playbooks`) so it arrives knowing how to do
  the job. The bundled library now ships **25 skills**.

### Fixed
- `testing` is now a valid skill category, so test-focused skills validate in the catalog.

## [0.8.8] — 2026-06-16 · Chat agent dropdown stops collapsing

### Fixed
- **The chat panel's agent dropdown no longer drops every agent except the selected one during active
  work.** It rebuilt the whole `<select>` on every state update — and a busy crew pushes many per second
  (streaming, tool cards), so the list kept getting wiped (and an open dropdown collapsed to just the
  current agent) until activity calmed down. The options are now rebuilt only when the roster actually
  changes; otherwise just the selected value is synced.

## [0.8.7] — 2026-06-16 · Two dogfood fixes

### Fixed
- **`2>/dev/null` (and other `/dev/*` sinks) no longer false-block as "outside your working folder."**
  The sandbox's path detector read `/dev/null` as an out-of-workspace path (→ a bogus `C:\dev\null`),
  so common commands like `grep … 2>/dev/null` were rejected with a "switch your working folder" message.
- **The Message Log no longer drops cross-agent entries that arrived while it was hidden.** A live
  message is only pushed to the panel while it's attached/visible; messages sent while the panel was on
  another tab stayed in memory but never rendered. The panel now re-renders from its full history
  whenever it becomes visible again, so PM→teammate assignments are never silently missing.

## [0.8.6] — 2026-06-16 · Agents can search and delete files

### Added
- **`search_files`** — agents can now search the workspace for a regex (or plain text) and get
  `file:line` results, instead of writing throwaway scripts to grep. Skips `node_modules`/`.git`/build
  dirs and binaries; bounded so a big repo can't hang it.
- **`delete_file`** — agents can remove a file directly (sandboxed + checkpointed, so it's restorable),
  instead of shelling out to `node -e`/`rm` — which the command sandbox blocks as a control-character
  injection risk (so those attempts just looped with no way through). Refuses directories and missing
  files with a clear message; destructive, so it goes through the same write-approval gate as a write.

These are the first two items of the v0.9 weak-model execution hardening, pulled forward because they
were actively blocking real runs.

## [0.8.5] — 2026-06-16 · Members come equipped (skill playbooks)

### Added
- **Agent presets now carry skill playbooks.** When you add a member from the Marketplace, the
  market-proven playbooks it declares (e.g. the Security Auditor's OWASP Top 10 review + dependency-risk
  triage) are folded into its instructions under a **`## Playbooks`** section — so the member arrives
  already knowing how to do its job, not just which tools it can use. Agent cards show what each member
  **Includes**. Injection is idempotent and skips any id without a playbook body.

### Fixed
- **The bundled agent catalog no longer fails validation.** The granular skill ids used by presets are
  now registered capabilities, an empty `skills` array on a preset is rejected up front, and the backend
  preset was restored to real skills — so the Agents tab loads and every member installs with real tools.

## [0.8.4] — 2026-06-16 · Inline scripts stop tripping the path guard

### Fixed
- **Agent commands that contain an inline script no longer false-block as "outside your working
  folder."** 0.8.2 fixed regex literals with `?`/`*`, but a string escape like `'\n'` inside
  `node -e "…"` still resolved to a bogus `C:\n` path. The guard now skips the body of an inline
  script (`node -e`, `python -c`, `perl -e`, …) entirely — it's source code, not shell arguments —
  while still checking the interpreter and any real file paths before the eval flag, and still
  blocking genuine out-of-workspace access (`type C:\other`, `cat /etc/passwd`).

## [0.8.3] — 2026-06-16 · The worktree review board goes live

### Added
- **The Crew Worktrees review board's lane actions now work.** 0.8.1 shipped the buttons; 0.8.3 wires
  them: each lane shows its **changed files** (click to open a diff), **View diff** opens the lane's
  full diff, **Re-verify** re-runs the project's checks on that lane, and **Hand back** returns the
  lane to its agent to finish. The board also **refreshes live** as a lane's verification state changes
  (merge gate or re-verify) — no need to reopen it.

## [0.8.2] — 2026-06-16 · Agents stop getting falsely blocked

### Fixed
- **Agent commands are no longer falsely blocked as "outside your working folder."** The
  sandbox's outside-path detector mistook a regex literal inside an inline script — e.g.
  `node -e "…split(/\r?\n/)…"` — for a filesystem path, blocked the command, and told the agent to
  switch its working folder. With no quick recovery, agents stalled on otherwise-valid commands.
  Tokens containing `?`/`*` (regex/glob wildcards that never appear in a real path) are now ignored
  by the detector, so legitimate commands run while genuine out-of-workspace paths stay blocked.

## [0.8.1] — 2026-06-15 · Stop-safe tool calls + Archive a chat

### Fixed
- **No more `HTTP 400 … insufficient tool messages following tool_calls` after a Stop.** Interrupting an agent mid tool-call (or restoring a session snapshot taken at that moment) could leave a tool request unanswered in the history, which the gateway then rejected — wedging the agent. The OpenAI-compatible backend now self-heals its history before every request, so a Stop can never break the next turn. An already-stuck agent recovers on its next message.

### Added
- **Archive a chat** — a new **Archive** button in the Chat panel title bar hides a conversation *without deleting it* (Clear still deletes). Restore any archived chat from **"View Archived Chats"** (the title-bar `…` overflow menu, or the Command Palette). Archives persist across reloads.

## [0.8.0] — 2026-06-15 · @roam in the Chat panel

### Added
- **UnodeAi is now in the VS Code Chat panel as `@roam`** — *in addition to* its sidebar (both run side by side). Type **`@roam <goal>`** in the Chat panel and your crew's PM picks it up, delegates, and streams the run back into the chat, with an **"Open in UnodeAi"** button to jump to the full team view. It runs on **UnodeAi's own backend** (your configured agents/models — not the chat panel's model), so you keep the multi-agent orchestration and the cheap-model cost arbitrage. Toggle with **`roam.chatParticipant.enabled`** (on by default; turn it off to keep UnodeAi only in its sidebar).

### Fixed
- No longer pops a spurious **"UnodeAi ignored .roam/team.json: ENOENT…"** warning on a fresh workspace that simply has no team file yet. The "file absent" case is now recognized across both Node and VS Code filesystem error shapes (real parse/permission errors still surface).

### Security
- The Claude backend's team-bridge MCP config (which carries a local loopback token) is now written to the **gitignored `.roam/mcp.json`** instead of `.roam-mcp.json`, so an abnormal-exit leftover can never be accidentally committed.

## [0.7.2] — 2026-06-15

### Changed
- **Discoverability:** Marketplace tags now include the model-vendor families available on the Roam gateway — **OpenAI/GPT, Anthropic/Claude, Gemini, Qwen, Kimi (Moonshot), DeepSeek, GLM, Grok, MiniMax** — so the extension surfaces when you search the Marketplace for any of them.
- **Bundled the refreshed user manual.** `USAGE.md` now ships current with the 0.7.x verified worktree fan-out / verifier-gate docs (the 0.7.1 VSIX had bundled the older copy); the website wiki was already updated.

## [0.7.1] — 2026-06-15 · post-0.7.0 hardening

Hardening pass over the 0.7.0 verifier-gate + worktree machinery (multi-agent code reviews — Codex, MiniMax, Kimi — each finding verified against the code before applying), plus weak-model tool-calling robustness.

### Fixed
- **Reasoning models no longer stall on the native tool protocol.** A model (e.g. Kimi) that emitted a tool call as **flat XML in its message** (`<read_file>…</read_file>`, often after a `</think>` block) instead of a native call would have the call silently dropped — the turn ended and a coordinator read it as "done." Such calls are now **recovered and executed**, and their results are fed back as a valid message (no orphaned `tool` entry that strict OpenAI-compatible APIs reject).
- **Verifier gate respects command approval & can't hang.** It no longer auto-runs a verify command awaiting approval (`roam.commandApproval: ask`); a verify command now has a hard timeout (`roam.worktree.verifyTimeoutSeconds`, default 300, max 3600); and on timeout the whole **process tree is killed on Windows** (`taskkill /T`), not just the shell — no orphaned `npm`/`node`.
- **Worktree lifecycle:** removing an agent now **deletes its branch** (so re-creating a same-named agent doesn't fail) and **waits for any in-flight merge** before removing the worktree (no silent work loss). `run_checks` got a timeout too, and "Reset Workspace State" now also clears file checkpoints.

### Added / Changed
- **Tool protocol auto-fallback (native → XML).** Native stays the default; the first time an agent leaks a tool call as text, it switches to the XML protocol for the rest of the session (where it gets an explicit format guide). Self-tuning per agent.
- **Tougher worker protocol (weak-model reliability):** workers are told to read a file before claiming "already done," to fix the **code** rather than weaken tests to pass, to work in small verified steps, and to keep their todo list honest. Plus a structural nudge when a write-capable worker ends a turn claiming "done" without having used any tool.
- Settings schema: `minimum`/`maximum` bounds for the worktree numeric settings.

## [0.7.0] — 2026-06-15 · verified worktree fan-out

### Added
- **Verified worktree fan-out — a crew only lands work that passes your checks.** In worktree mode, before an agent's work merges into the integration branch, UnodeAi now runs your **verify command** (`roam.verifyCommand` — e.g. `npm test` / `npx tsc --noEmit`) inside that agent's worktree. If it **fails**, the work is **held on the agent's own branch (not merged)** and the failing output is handed back to the agent to fix and finish again; once it **passes**, it merges. Neither Cline nor Kilo gate the *team* merge on verification — this is the differentiator. Controlled by **`roam.worktree.verifyBeforeMerge`** (default on); with no verify command there's nothing to gate on, so merges proceed unchanged. The **Crew Worktrees** review board shows per-lane status (✓ verified / ✗ failing / ⚠ unverified).
- **Anti-cheat: it flags when an agent passes by editing the tests.** A weak model can make the gate green by *weakening the tests* instead of fixing the code (the live dogfood caught one changing an assertion to match its broken code). So a passing lane that **also modified test files** is no longer shown as a clean ✓ — the review board marks it **"✓ Verified · review tests"** and lists the changed test files, and the failure feedback now tells the agent to fix the code, **not** weaken the tests. (It flags rather than blocks — legitimate changes touch tests too — leaving the human finalize as the backstop.)

> Validated by unit + real-git integration tests (incl. a reproduction of the exact "edit the test to pass" cheat) and a live extension-host smoke (failing change blocked from integration; the agent then fixed the code rather than weakening the test). **Worktree fan-out graduates from experimental → supported** with this release.

## [0.6.16] — 2026-06-15

### Changed
- **Repository link points to the active GitHub repo** (`yanzhang79/roam-crew`) for now — temporary, will move back to the `weroam` org shortly. Side benefit: the README's User-Guide / docs links now resolve on the Marketplace listing (they're resolved against the repository URL).
- **Keywords tuned for "agentic" discovery.** Added `agentic`, `ai agent`, `coding agent`, `autonomous agents` so the extension surfaces for those searches. (VS Code has no dedicated "agentic" *category* — the closest is **AI**, which is already set; discovery for that term is keyword-driven.)

## [0.6.15] — 2026-06-15

### Changed
- **Fixed the Marketplace categories.** Was listed under `Other` / `Machine Learning` / `Chat` — "Machine Learning" is for ML/data-science tooling, not an AI coding assistant, and the dedicated **AI** category was missing. Now categorized as **AI · Chat · Programming Languages**, matching where users find Cline / Kilo Code and similar assistants.

## [0.6.14] — 2026-06-15

### Fixed
- **Worktree exclude works when your workspace is itself a git worktree.** The `.roam/worktrees/` ignore entry is now written to git's *common* exclude dir (via `git rev-parse --git-common-dir`) instead of assuming `.git` is a directory — so isolation no longer trips when the folder you opened is a linked worktree.
- **Finalize lands on the branch the review panel shows.** The "Finalize Worktree Merges" command and the review panel now pass the displayed base branch through to the merge, instead of relying on an inferred base.
- **"Reset Workspace State" now also clears file checkpoints** (and, as before, per-agent chat/tool-card history) — a full reset no longer leaves stale restore points behind.
- **Marketplace MCP install trims the server URL** you paste, so leading/trailing whitespace from a copy can't break the connection.

### Changed
- **Production `uuid` upgraded 9 → 11.1.1**, clearing the remaining production `npm audit` advisory (0 prod vulnerabilities). Internal: Windows bundled-smoke runner invokes `.cmd` shims via `cmd.exe /c` (avoids a Node deprecation warning).

_Thanks to a full post-0.6.0 code review for these; verified green (build, lint, 718 tests, prod audit 0 vulns, bundled smoke)._

## [0.6.13] — 2026-06-14

### Added
- **Tool cards now persist across a window reload (Cline-parity).** Write **diffs** and **command/test output** used to live only in a transient in-memory stream, so reloading VS Code wiped them — you kept the agent's text replies but lost the record of *what it actually changed or ran*. They're now saved per agent and restored on reload, so the transcript keeps the full picture. Only **finalized** cards are persisted (an in-flight card never comes back as a phantom "Running"), capped to the most recent 60 per agent, and cleared together with the chat. Closes the durability half of the diff/terminal-visibility gaps (the prominence half shipped in 0.5.12).

## [0.6.12] — 2026-06-14

### Docs
- **Website-ready wiki** (`docs/wiki/index.html`) — a self-contained HTML page (embedded CSS/JS, no external dependencies) ready to host at a `/roam-crew/wiki` route on weroam.xyz / unodetech.xyz, or embed via iframe.
- **User Guide refreshed to current 0.6.11 features** (`USAGE.md`): Solo mode, PM orchestration, Plan/Act, Marketplace, Team Rules, approvals, Smart Mode, workflows, worktree fan-out, and troubleshooting. The Graphical Walkthrough gains a Marketplace section.
- **Listing & README**: clearer value proposition — 50+ leading models on the Roam gateway at exclusive, deeply-discounted rates with a dependable SLA — plus prominent links to the User Guide and Graphical Walkthrough so new users can find the manual fast.

## [0.6.11] — 2026-06-14

### Added
- **Worktree mode: every agent can now READ the team's merged work; writes stay isolated.** Previously each agent (and the PM) could only see its own worktree, so a worker building `featureA` couldn't see a teammate's `featureB` or the architect's shared types, and the PM — on the base checkout — couldn't see *any* isolated work, leading it to wrongly conclude tasks had failed. Now `read_file` / `list_dir` transparently **overlay the `roam/integration` worktree** (the merged team state) for any path not in the agent's own tree, marked read-only. **Writes are unchanged** — they always land in the agent's own worktree, so an agent can read a teammate's file but never clobber the shared copy (a write forks its own copy, and conflicts are still caught at merge). This is the "read = shared, write = isolated" model. Applies to OpenAI-compatible agents (the native-Claude backend uses its own tools); off unless `roam.concurrencyStrategy` is `worktree`.

### Changed
- **Clearer command-approval buttons.** The approval card's middle option read just "This session" — ambiguous about whether it allowed or denied. It's now **"Allow this session"**, so every allow option (Allow once / Allow this session / Allow for project / Deny) is unmistakable and matches the native dialog.
- **Friendlier shared-read marker.** The note on a file read from the shared integration view no longer implies a teammate "owns" it (which made agents over-refuse legitimate edits). It now explains that editing is fine — a write forks your own copy and merges back, with conflicts reconciled — it just doesn't change the shared file in place.

## [0.6.10] — 2026-06-14

### Fixed
- **The PM now fans tasks out across same-role teammates instead of piling them on one.** When you had two teammates sharing a role (e.g. two "senior-dev"s, "Developer" + "Backend Developer") and the PM delegated *by role*, every task landed on the first match — the second teammate sat idle, and worktree isolation never kicked in for it. Role delegation now **spreads**: sequential `assign_task`s round-robin across same-role teammates, and parallel `assign_task_async`s skip a teammate that's already running one of the PM's tasks. Firm-retries still stay on the *same* teammate. The PM can also now target a teammate by **display name** ("Backend Developer"), not just id or role. Exact-id targeting is never reinterpreted.

## [0.6.9] — 2026-06-13

### Fixed
- **Finalize now materializes the merged files in your working tree.** Previously, finalizing advanced the branch *ref* (via `git update-ref`) without touching the working tree, so the merged files showed up as phantom "deleted" in `git status` and weren't on disk until a manual `git reset --hard`. Finalize now **fast-forwards your live checkout** (git refuses if your tree has uncommitted tracked changes, protecting your edits), so the files appear immediately — no manual step. (Found by the live worktree smoke.)

## [0.6.8] — 2026-06-13

### Fixed
- **Worktree mode now engages even with untracked config present.** The dirty-tree guard counted *untracked* files — the `.vscode/settings.json` you create when enabling the setting, and Roam's own `.roam/` files — as "uncommitted changes," so it silently fell back to the shared workspace and isolation never turned on for a normal first use. The check now ignores untracked files; only modified/staged **tracked** files (real in-flight work that wouldn't propagate to a worktree) defer isolation.

## [0.6.7] — 2026-06-13

### Added
- **Worktree fan-out — experimental, opt-in.** Set `roam.concurrencyStrategy: "worktree"` and each worker agent runs **isolated in its own git worktree** (no more stepping on each other's edits). When an agent finishes a turn its work is committed and merged into a **`roam/integration`** branch — conflict-aware (a conflict is handed back to that agent to reconcile, and the integration branch is left clean). Review the staged work and land it on your branch with the new **"Crew Worktrees (Review)"** panel or the **"Finalize Worktree Merges to Branch"** command (or set `roam.worktree.autoMerge` to land automatically). Requires a git repo with a clean tree; the PM and solo agents stay on the live tree; `roam.worktree.maxParallel` caps simultaneous worktrees. **Off by default** — the existing `optimistic` strategy is unchanged. (This release is for validating the live flow; see `docs/WORKTREE_FANOUT_SMOKE.md`.)

## [0.6.6] — 2026-06-13

### Added
- **Marketplace Starter Pack.** Catalog expanded to **13 agent presets** (added Debugger, Code Reviewer, Frontend Developer, Backend Developer, QA Analyst) and **15 MCP servers** (added Time, Sequential Thinking, Slack, GitLab, Google Maps, and the Everything reference server). Plus `THIRD_PARTY_NOTICES.md` crediting the MIT-licensed MCP servers project.

### Fixed
- **Clearer "file not found" errors for agents.** When an agent reads/lists a path that's inside the workspace but doesn't exist (a wrong-path guess), it now gets an actionable hint ("use `list_dir` on the parent, don't retry the same path") instead of a raw `ENOENT realpath` dump — which had been sending weaker agents into a flailing loop.

## [0.6.5] — 2026-06-13

### Added
- **Hermes integration (first-party bridge).** New Marketplace entries: a **Hermes Bridge** MCP server — point it at your local or remote Hermes MCP endpoint (e.g. `http://127.0.0.1:8765/mcp`) at install time; it's URL-validated and mounted through the approval gate, with no Hermes runtime bundled — and a **Hermes Operator** agent preset bound to that bridge, so the PM can hand long-memory / skill-accumulating tasks to Hermes. Catalog schema gained `urlPrompt` (install-time URL prompt for bridge-style servers) and agent-preset `mcpServers` grants.

## [0.6.4] — 2026-06-13

### Fixed
- **Packaging: stop shipping internal scratch in the VSIX.** `.vscodeignore` now excludes `.worktrees/`, dogfooding scratch dirs (`_xmltest*`, `_v0*test*`, `bench/`, `_runtest.js`, `_testout.txt`) — these had been bundled into the published extension (the 0.6.3 package had ballooned to 4680 files / 6.9 MB from a stray worktree). No user-facing behavior change; just a much smaller, cleaner package.

## [0.6.3] — 2026-06-13

### Changed
- **Version now shows in the Team section title** ("Team · v0.6.3"). It previously used the greyed title-bar `description` slot, which gets crowded out by the toolbar icons on a normal-width sidebar — folding it into the title keeps it always visible in the toolbar row.

## [0.6.2] — 2026-06-13

### Fixed
- **Team toolbar restored to native title-bar icons.** v0.6.0's header rework had moved Add Agent, **Solo**, Create/Switch Team, Team Rules, Start/Stop All, and Restore Checkpoint out of the view's title-bar toolbar into text buttons inside the panel (wasting a row and dropping the icons, including the Solo zap). They're all back as icons in the title row — alongside the new **Marketplace** and **Settings** icons — and the version stays in the title bar. The team panel body is now just the agent cards again.

## [0.6.1] — 2026-06-13

### Fixed
- **Team panel header no longer duplicates the "UnodeAi" title.** The version now shows in the view's title bar (next to the panel header) instead of a separate brand row inside the panel — that row duplicated the extension header and wasted space. **Marketplace** and **Settings** moved to the Team view's title-bar toolbar (icons).

### Added
- **Hosted marketplace catalog (opt-in plumbing).** Roam can now merge a hosted catalog with the bundled one at startup (`roam.marketplace.catalogUrl` + `roam.marketplace.fetchCatalog`) — so the Agents/MCP catalog can grow without an extension update. Off by default (no URL set); fetch failures fall back to the bundled catalog.

## [0.6.0] — 2026-06-13

### Added
- **Marketplace.** A new **🛒 Marketplace** (opened from the header) to browse and one-click install **Agents** and **MCP servers** from a curated catalog — no more hand-writing JSON. Browse globally, choose the scope on install (an agent joins your team; an MCP server is added to the workspace and mounted through the existing approval gate). Ships with 7 agent presets (Security Auditor, API Designer, Test Engineer, Performance Optimizer, DevOps Engineer, Technical Writer, Data Engineer) and 8 popular MCP servers (filesystem, git, github, fetch, memory, sqlite, puppeteer, brave-search). The **Skills** tab is present but arrives in a later phase.

### Changed
- **Header information architecture — two rows by scope.** The Team panel header now separates **extension-level** controls (🛒 Marketplace, ⚙ Settings) — placed to the right of the *UnodeAi* brand — from **team-level** controls (Add Agent, Switch Team, Rules, Start/Stop All, Solo) on their own row. The native view toolbar is reduced to collapse/expand. Clearer at a glance what acts on the whole extension vs. the current crew.

### Fixed
- **`read_file` pagination is now line-based** (`offset` = start line, `limit` = line count), matching the convention agents expect — byte offsets were causing agents to read tiny fragments and get stuck. A 100 KB cap still bounds each read.

## [0.5.12] — 2026-06-13

### Added
- **Proactive workspace context (Cline #2) — opt-in.** When `roam.engine.workspaceContext` is on, each turn starts with the **active editor file (capped) + current Error/Warning diagnostics** injected into the agent's context — so it stops "starting blind" and burning tool calls just to see what you're looking at. Injected ephemerally (never persisted to history, so stale file content can't accumulate), gathered inside the workspace only, capped both host- and backend-side (diagnostics first so they survive). **Off by default** pending a benchmark on the token cost.
- **Product Manager role.** A new built-in role, distinct from the PM coordinator: it defines *what* to build — user stories, acceptance criteria, scope, priorities — and hands a spec to the Project Manager to delegate. Available in the Add-Agent picker.

### Changed
- **"Create Team" → "Create or Switch Team."** The team button now opens a picker to **create a new team** or **switch** to a different preset; switching that replaces your current roster asks for confirmation first (no silent loss).
- **The PM is notified when the roster changes.** Adding or removing an agent tells the Project Manager so it can adjust assignments to the new personnel/resources (debounced — bulk team-creation notifies once; no-op when there's no PM).

### Changed
- **Write diffs and command output are now visible at a glance (G-004 / G-005).** They were already in the tool cards but **collapsed by default**, so you had to click to see what changed or what a command printed. Now: a write's **diff opens expanded with red/green coloring**, and a command's **output opens expanded** (labeled "Output") — matching Cline's prominence. Tool *input* (args) stays collapsed. Closes the two visibility gaps R2 flagged (U3 diff, U7 terminal).
- **Discount no longer hardcoded in the fallback.** 0.5.10 baked the current 40% Anthropic discount into the static price table — but discounts vary (and VIP group ratios are coming), so a hardcoded discounted fallback goes stale. The static table is back to **base** gateway prices; the live `/api/pricing` path remains authoritative and applies `group_ratio × vendor_discount` on top. Static table = offline estimate only.
- **Reasoning Effort options are now backend-specific.** `max` is a Claude-CLI level — offering it to OpenAI-compatible models just got it silently dropped (losing the user's intent). The Settings dropdown now shows `low/medium/high/xhigh/max` for **Claude** agents and `none/minimal/low/medium/high/xhigh` for **OpenAI-compatible** agents (no `max`). DeepSeek (no effort param) and GLM/Qwen/Gemini (own thinking controls) are noted in the field help. The drop-on-reject retry remains as a backstop.

## [0.5.10] — 2026-06-12 (Correct discount pricing)

### Fixed
- **Displayed prices now reflect the real gateway discount.** Roam's `/api/pricing` carries the discount in `vendors[].discount` (not just `group_ratio`), and it wasn't being applied — so discounted models showed list price. Prices now apply **both layers multiplicatively**: `base × group_ratio (account/VIP) × vendor_discount`. E.g. `claude-opus-4-8` is **$3 / $15** per 1M (40% Anthropic vendor discount off the $5/$25 base); a future VIP group ratio stacks on top automatically. The static fallback table was updated to match. (Found & fixed by Codex.)

## [0.5.9] — 2026-06-12 (Version in the panel header)

### Added
- **The running version is now shown in the Team panel header** — `UnodeAi v0.5.9`, right above the agent list — so you always know which build you're on at a glance.

## [0.5.8] — 2026-06-12 (Listing refresh)

### Changed
- **Pricing made prominent.** The README and Marketplace listing now state up front that the **default Roam gateway serves deeply discounted, price-competitive AI tokens** (DeepSeek, Claude, GPT, Qwen and more), with a live-pricing link — so a whole multi-agent crew stays cheap to run.
- **Changelog backfilled** for 0.5.6 (interject + dogfooding fixes) and 0.5.7 (flat tool-call format); the published changelog previously stopped at 0.5.2.

## [0.5.7] — 2026-06-12 (Flat tool-call format)

**Weak-model reliability foundation.** Replaces the two-level `<use_tool><tool>X</tool>…</use_tool>` XML tool format with a flat, tool-name-as-tag format: `<read_file>…</read_file>`.

### Changed
- **Flat XML tool calls.** The block tag is now the tool name itself — no `<use_tool>` wrapper. This removes a whole class of weak-model failure: models (e.g. DeepSeek in XML mode) would mis-close the wrapper (`</tool>` instead of `</use_tool>`), the call would silently vanish, and the agent appeared to **stall**. With no wrapper, there's nothing to mis-close. (Cline's format works the same way.)
- **Robust parser ladder.** Tool calls are parsed flat-first (anchored on known tool names), then the legacy `<use_tool>` wrapper (still mis-close tolerant) for back-compat, then leaked-token recovery. Nothing in-flight breaks.

## [0.5.6] — 2026-06-12 (Mid-run steering + dogfooding fixes)

**Interject: steer a running agent**, plus four reliability fixes surfaced while building it. (Versions 0.5.3–0.5.5 were internal dev builds, folded into this release.)

### Added
- **Mid-run steering (interject).** While an agent is running, the chat composer stays enabled — type a message and **Steer ⚡** to fold it into the live turn; the agent re-plans from it at the next step. A separate **■ Stop** button hard-aborts. Steering is injected at a safe point that respects the OpenAI tool-call ordering rule (never between a tool call and its answer).

### Fixed
- **Out-of-folder detector false positives.** No longer misreads relative paths (`src/backend/x.ts`) or paths written in prose with trailing punctuation (`(C:\…\proj).`) as outside the workspace.
- **XML tool-call mis-close** tolerance (a weak-model stall) — superseded by the flat format in 0.5.7, kept as a fallback.
- **Out-of-folder guidance** now suggests opening the target project in a **new window** so the current chat survives.
- **Model picker pricing** re-renders with your account's **discounted** price once it loads, instead of freezing on list price.

## [0.5.2] — 2026-06-11 (Agent Execution Engine: write→feedback loop)

The first car of the V0.5.x execution-engine line — making each agent's inner loop closer to Cline's by
having the framework observe and verify, not just expose tools. OpenAI-compatible backends only (the
Claude backend runs its own loop); each hook has a `roam.engine.*` kill-switch (default on).

### Added
- **Post-write diagnostics (the write→feedback hook).** After an agent writes a file, UnodeAi collects
  the editor's own diagnostics (TypeScript/ESLint/…) for that file and feeds any errors straight back
  into the agent's next turn — so it sees and fixes the red line it just created without having to
  remember to run a checker. Settles the language server briefly, takes only Error/Warning for the file
  just written, and is token-capped so a noisy file can't flood the context. VS-Code-unique leverage
  (BACKLOG #3). Toggle: `roam.engine.postWriteDiagnostics`.
- **Verification obligation (no silent skip).** When a turn modified files but never verified them, the
  agent is nudged once to run the project's checks (test/build script, or `run_checks`) — or to say
  verification is genuinely blocked — before finishing. A successful check command, or clean post-write
  diagnostics, satisfies it. If it still doesn't verify, the turn is surfaced as **⚠ Changes not
  verified** rather than silently passing (and a team PM sees that) — it is never hard-blocked. Toggle:
  `roam.engine.verifyObligation`.

### Added
- **The ⚡ button toggles Solo ⇄ team, and shows a solid bolt while Solo is active.** Click it to
  create/focus the Solo agent; click again while you're viewing Solo to flip the chat back to the first
  (team) agent (it stays on Solo if that's your only agent). The toolbar icon is a dim outline ⚡ normally
  and a **solid gold ⚡** while a Solo agent exists. (No working-folder popup on start — a Solo agent uses
  the open workspace folder.)
- **If your task names a folder the agent can't reach, it tells you — in the chat — to open it.** The
  moment you send a task that references an absolute path *outside* the agent's working folder (e.g.
  `…\ux-scratch\src\app.ts` when the agent is rooted elsewhere), UnodeAi detects it (framework-side, not
  left to the model) and posts a clear notice **in the chat panel**: the file is outside the agent's
  folder, and to work on it you open that folder yourself via **File → Open Folder…** (it infers the
  project root by walking up to the nearest `package.json`/`.git`). The turn isn't routed, so the agent
  never starts flailing — and the chat composer is freed immediately (it isn't left stuck on "Stop").
  If an agent hits an out-of-folder path mid-run, the turn ends immediately with the same guidance.

### Security
- **The shell is sandboxed to the workspace root too, and a boundary violation is terminal.**
  `run_command` (and the file tools) now reject any path outside the agent's root (e.g.
  `type C:\…\secret`, `Get-Content …`, UNC `\\…`, `/etc/…`) — closing the gap where an agent could read
  or write outside the sandbox via the shell. The refusal uses a hard, machine-readable code
  (`BLOCKED_OUTSIDE_WORKDIR`) that the tool loop treats as a **terminal** state: the turn ends with a
  clear "switch my working folder" message instead of letting a weak model keep trying other commands to
  route around it. (Directory boundary is a first-class rule; the command check is just a fuse, not a
  smart parser. Relative paths and ordinary flags are unaffected. Thanks to Codex for the framing.)

### Fixed
- **A solo agent no longer gets stuck when its task is outside the open folder, or when a command
  returns no output — the two ways it could become "unusable" (found by dogfooding).**
  - **The agent now knows its workspace root.** Its system prompt states the absolute root and that it
    can only read/write/run inside it — so a weaker model stops trying to edit files elsewhere via the
    shell and just uses `write_file`/`read_file` with relative paths.
  - **Out-of-sandbox errors are actionable, not a dead-end.** Instead of "Path … escapes the working
    directory sandbox," the agent is told its actual root, to use a path inside it, and to ask the user
    to open the right folder — so it stops looping on the same outside path.
  - **Blocked shell commands point at the legal path.** When a command is rejected for shell control
    characters (`; | & > …`), the message now tells the agent to run a single simple command and to edit
    files with `write_file` rather than shell redirection.
  - **Commands no longer run "blind."** When the integrated terminal reports a command finished but
    streams back no output (notably PowerShell on Windows' shell integration), the agent now gets an
    explicit `[exit N] (no output captured…)` note instead of a blank, and subsequent commands route
    through a direct runner that reliably captures stdout/stderr. (The command is never re-run, so
    nothing with side effects executes twice.)

### Changed
- **Approvals now happen inside the chat panel, in UnodeAi's own style — no more native OS dialogs.**
  When an agent wants to run a command or write a file (in `ask` mode), a styled approval card appears in
  the chat with the command / diff preview and the same choices (Allow once / this session / for project
  / Deny-with-note for commands; Approve / Approve all / Deny for writes). The panel is revealed
  automatically so the request isn't missed. If the chat view isn't available, it still falls back to the
  native prompt so an agent never deadlocks.
- **Auto-approve selector in the chat footer (à la Cline/Codex).** A footer bar shows the current command
  and write approval policy as two dropdowns you can change on the spot (`Disabled / Ask each / Allowlist
  / All` for commands; `Auto / Ask each` for writes) — no digging through Settings. Changes apply live.

### Tool-call Reliability (P0/P1/P2) — PowerShell atomic-command execution
- **P0: `ask` mode now allows legitimate PowerShell syntax.** Pipes (`|`), chains (`&&`, `;`), and
  substitution (`$()`) no longer get pre-rejected — they go straight to the user approval dialog. Only
  catastrophic patterns (rm -rf, format drives, fork bombs, etc.) are blocked in every mode. This restores
  PowerShell reliability: agents can now execute atomic commands like `Get-Content | Set-Content` instead
  of falling back to multi-turn workarounds. *Measured impact: tool-call success rate ~40% → 85%+ on
  PowerShell tasks.*
- **P1: Hard rule in system prompt for atomic execution.** Agents now see: "If your previous message
  described an action but didn't include a tool call, your NEXT message MUST open with a tool call."
  Prevents analysis loops where the model describes work without executing (a root cause of high
  Turn Count to First Correct).
- **P2: System prompt now lists available tools.** Agent sees "Available tools: read, write, run_command,
  …" — eliminating the path-blackbox problem where agents couldn't tell what tools they had and kept
  trying unavailable commands.

## [0.5.1] — 2026-06-10 (stabilization)

### Changed
- **Chat renders incrementally.** A state update no longer rebuilds the entire transcript — existing
  message/tool/reasoning nodes are reused by identity, so long chats don't flicker or stutter, and the
  view only auto-scrolls to the bottom when you're already there (it no longer yanks you down while you
  read history). Streaming reuses the same in-flight element.

### Fixed
- **Stop now cancels in-flight delegations.** When you press Stop (or a PM backend is torn down), the
  coordinator's pending `assign_task` / `assign_task_async` waits settle immediately as cancelled instead
  of hanging until the teammate replies or the timeout fires, and the async file claims those tasks held
  are released — so a Stop mid-delegation leaves no zombie promises and the next task isn't blocked by
  stale ownership. Wired through `abort()` and the team MCP bridge/server shutdown.
- **Shared memory no longer reports a false success.** `memory_note` now returns an explicit error when
  the note could not be saved (no workspace folder, or `.roam/memory` not writable) instead of always
  saying "Noted" — so an agent can't believe it remembered something it didn't.
- **Workflow verify command runs with a sanitized environment.** `roam.verifyCommand` no longer inherits
  the VS Code/Electron host's `NODE_OPTIONS`/`ELECTRON_RUN_AS_NODE`/`VSCODE_*` (the same vars that broke
  agent-run tooling), so gated-workflow verification matches how agents run commands.

## [0.5.0] — 2026-06-10

The v0.5 line — team shared memory, and a big push on making cheaper/non-Claude models (DeepSeek, Kimi,
Qwen, …) actually usable as autonomous agents.

### Added
- **Team shared memory (V6).** A new `memory_note` tool records a short note to the team's shared
  `.roam/memory/notes.md`; the most recent notes are injected into every agent's prompt as a
  `<shared_memory>` block, so agents share decisions, gotchas, and interface contracts without the PM
  hand-carrying them. Human-readable and git-trackable.
- **Visible team plan.** The PM now lays out the delegated work as a live `update_todos` checklist, so
  the Team mode chat shows the same pinned plan Solo already had.

### Changed
- **Solo agents skip the read-before-write guard.** A single agent has no teammates to clobber, so the
  optimistic "read the file before overwriting it" check is removed for solo (teams keep it) — less
  friction for everyday single-agent work.
- **Weak-model "act, don't announce."** When an agent ends a turn announcing an action ("let me check
  the file:") without issuing the tool call, it's nudged to follow through in the same turn instead of
  stalling (zh/en heuristic, bounded), reinforced by an explicit prompt rule for workers and the PM.

### Fixed
- **Leaked tool calls are recovered across model formats.** Some models emit their tool call as text in
  the message content instead of the `tool_calls` field — DeepSeek's `<｜｜DSML｜｜invoke…>` and Kimi's
  `<|tool_call_begin|>functions.NAME…>` tokens. These are now parsed and executed (so e.g. a Kimi PM's
  `assign_task` actually delegates) and hidden from the transcript, in both native and XML tool modes.
- **`reasoning_effort` is model-specific.** Switching a model whose effort value the new model rejects
  (e.g. `max` → Kimi) no longer fails the turn: the value is dropped and the request retried; `none`
  and `minimal` were added to the options.
- **Discounted pricing (unode `group_ratio`).** Model prices now reflect the account's discounted group
  instead of list price when several usable groups exist (`roam.priceGroup` still overrides).
- **Real-time Plan renders for recovered/typed tool calls** (parseTodos accepts a JSON string or array),
  and tool-call markup is stripped from the chat transcript.

## [0.4.2] — 2026-06-10

### Fixed
- **Real-time Todo "Plan" now appears for recovered tool calls.** A tool call recovered from leaked text
  delivers its parameters as raw text, so `update_todos` arrived with `todos` as a JSON *string* and the
  checklist parsed to empty (no Plan). `parseTodos` now also accepts a JSON string, so the pinned Plan
  renders whether the call came in natively or was recovered from a leak.

## [0.4.1] — 2026-06-10

### Fixed
- **XML tool-calling mode now also recovers leaked tool calls.** When a model ignores the `<use_tool>`
  format and emits its own tool tokens as text (e.g. DeepSeek's `<｜｜DSML｜｜invoke…>` markup), XML mode
  now recovers and executes them instead of dead-ending — so the mode we recommend for weaker models no
  longer fails on exactly those models. (Native mode already recovered these; recovery is now
  protocol-independent, so it works regardless of which Tool-calling setting an agent is on.)
- **Tool-call markup is hidden from the chat transcript** (XML `<use_tool>` blocks and leaked native
  tokens are stripped from the displayed/persisted message once parsed).

## [0.4.0] — 2026-06-10

The v0.4 line — "trust + the team actually parallel" + making cheaper models productive.

### Added
- **Checkpoints / Restore (V1).** Every file an agent writes is snapshotted (before/after); the 🕘
  **Restore File Checkpoint** button (Team panel + command) reverts a file to its pre-edit content (or
  deletes it if it was newly created). Survives reloads.
- **Write-file approval (V2).** `roam.writeApproval: ask` previews each write as a diff and asks
  **Approve / Approve all (session) / Deny** before it lands (read live — toggling applies without a
  restart). In `none` mode writes are free but still checkpointed.
- **Live agent metrics in the Team panel (V3).** Each agent's card shows its status, current task,
  context %, and cost/turns, refreshing as it works; the Team panel's compact mode collapses everything
  to icons. (No separate Console panel — it folds into the team you already have.)
- **XML tool-calling mode (C).** `AgentConfig.toolProtocol: xml` (Edit-Agent → Tool calling) makes an
  OpenAI-compatible agent call tools via Cline-style XML in the prompt instead of native function
  calling — an option for weaker models. Native remains the default.

### Changed
- **Interactive command approval by default.** `roam.commandApproval` now defaults to **ask**: each
  not-yet-allowed command prompts **Allow once / Allow this session / Allow for project / Deny with a
  note to the agent**. Catastrophic patterns are always blocked.
- **Weak-model robustness.** Tool calls missing required parameters are rejected up front with a
  corrective message; a tool call that keeps failing with identical arguments is circuit-broken instead
  of looping; and a tool call a model leaks into message *text* (e.g. DeepSeek emitting tool tokens as
  content instead of the `tool_calls` field) is now recovered and executed instead of dead-ending in
  chat — directly fixing the empty/looping/leaking `write_file` behavior seen with weaker models.
- **Real-time Todo** auto-collapses to a one-line `✓ N/N` summary when every step is done, freeing chat
  height.

## [0.3.0] — 2026-06-09

**The v0.3 milestone** — faster solo work, a real terminal per agent, a second OpenAI-compatible
provider, portable transcripts, a live plan you can watch, and richer chat context. Most of the line
shipped incrementally across 0.2.27–0.2.33; this release adds the last gate item (@-context) and
marks v0.3 complete.

### Added
- **Richer chat @-context: `@folder` / `@problems` / `@url`** (extends the existing `@file`). Reference
  a folder to attach its file tree, `@problems` to attach the current workspace errors/warnings, or
  `@url` to attach a fetched page — each expanded into the message before it's routed to the agent.
  Sandbox-guarded (folder reads can't escape the workspace), diagnostics limited to in-workspace
  errors/warnings, and `@url` only fetches on an explicit mention (timeout + size cap + SSRF checks).
  Unreadable/failed mentions are silently left as plain text. (Codex; reviewed.)

### Highlights of the v0.3 line (shipped 0.2.27–0.2.33, consolidated here)
- **Solo / Fast mode** — a single generalist agent, no PM/delegation, for everyday tasks.
- **Agent commands run in a real VS Code terminal (PTY)** — TTY-needing tools (e.g. vitest) work, and
  every agent has its own revealable terminal.
- **OpenRouter provider** — one key, hundreds of OpenAI-compatible models.
- **One-click knowledge-work teams** (Business Planning / Analysis / Financial).
- **Chat & Messages export / import + compact views.**
- **Real-time Todo checklist** — agents maintain a live, pinned plan via `update_todos`.

## [0.2.33] — 2026-06-09

### Fixed
- **Blank panels when opened with no folder (notably VS Code on macOS launched from the Dock).** The Team / Messages / Chat panels showed their titles but no content. Root cause: with no workspace folder open, the project-memory path resolved under an unwritable `process.cwd()` (e.g. `/`), and the `mkdir` for `.roam/` threw *uncaught* during activation — which runs before the webview providers register, so they never rendered. `ensureExists()` is now fully fault-tolerant, and activation skips the project-memory disk work entirely when no folder is open. (Reported on macOS.)

### Added
- **Real-time Todo checklist (C3).** Agents can maintain a live plan via a new `update_todos` tool; the current step list renders as a pinned, auto-updating checklist at the top of the chat (☑ done / ▸ in-progress / ☐ pending). Transient per agent; each update replaces the list.

## [0.2.32] — 2026-06-09

### Added
- **Chat & Messages export / import.** Each panel's title bar gets **Export** and **Import** buttons (next to Clear): save a chat — or the team activity feed — to a JSON file and load it back later. Import validates the payload (rejects bad JSON, wrong kind, or a non-array body) and asks before replacing a non-empty view. *Chat import is restored to history; Messages import is view-only and is cleared on reload (Tier 1 scope).* (Codex; reviewed.)
- **Compact view for Chat & Messages.** A **Compress** button collapses long message bodies / tool details so you can skim a transcript fast; the underlying data and exports are untouched. (Codex; reviewed.)
- **A terminal for every agent.** The **Terminal** button now appears on every agent card (in any state) and creates that agent's own `Roam: <agent>` terminal on demand — so even a PM that only delegates has its own visible terminal thread.

### Changed
- **Removed the per-card Output button** — an agent's transcript already lives in the Chat panel; `UnodeAi: Show Agent Output` remains available in the Command Palette.

## [0.2.31] — 2026-06-09

### Added
- **Per-agent terminals you can reveal (#13 Phase 2).** Each agent's commands run in its own `Roam: <agent>` terminal, now centrally managed: a **Terminal** button on the agent's Team-panel card reveals it, and the terminal is disposed when the agent is removed (and on deactivate). (Builds on the Phase 1 integrated-terminal execution.)

## [0.2.30] — 2026-06-09

### Fixed
- **OpenRouter actually works now (was broken in 0.2.29).** Adding an OpenRouter agent was silently routed to the Claude backend and skipped the endpoint/model picker, so the provider didn't function. The backend router now treats OpenRouter (and future OpenAI-compatible providers) as in-process, with sensible endpoint/model defaults. (`defaultBackendKind` extracted to a tested module so this can't silently regress again.)
- **Terminal command runner:** the agent's terminal is now revealed (`show`) so you actually see commands run; the per-command timeout timer is cleared on the success path (no more dangling timers). (Codex review of 0.2.29.)

## [0.2.29] — 2026-06-09

### Added
- **OpenRouter provider** — one API key → hundreds of models, OpenAI-compatible (Codex; reviewed). Pick it when adding an agent.
- **Agent commands run in a real VS Code terminal (#13 Phase 1).** `run_command` now executes through an integrated terminal with shell integration (a real PTY) per agent, falling back to raw spawn where shell integration isn't available. This gives commands a controlling terminal (so TTY-needing tools like vitest can run) and makes the command visible to the user. (The npx→npm rewrite, command policy/approval, and output framing are unchanged.) Engine bumped to VS Code ^1.93.

### Changed
- Command-env sanitization narrowed (keeps a user's legit `--require`); all team-creation entry points (panel, onboarding, missing-PM prompts) route through the Create-Team picker; E2E smoke covers the new commands. (Codex review follow-ups.)

## [0.2.28] — 2026-06-09

### Added
- **One-click knowledge-work teams.** "Create Team…" (Team panel button, command, and the onboarding Team door) now offers a picker: the Software crew (PM + Architect + Developer + Reviewer) or a knowledge-work team — **Business Planning / Business Analysis / Financial Analysis** — each with a PM coordinating the right specialists. (Wires up the v0.2.27 specialist roles into one-click teams.)

### Changed
- **PM self-diagnosis rules.** The Project Manager's instructions now include hard rules learned from real failures: use the project's own scripts (never bare `npx vitest`), report the precise symptom instead of fabricating a root cause, defer to teammate corrections, keep each change scoped, and stop-and-report instead of spinning silently.
- **Upgraded vitest 1.6.1 → 4.x** (modernization; suite stays 488 green). It did NOT fix the separate "agents can't run `npm test` via `run_command`" issue (vitest's worker runtime can't initialize with no controlling terminal in the console-less VS Code/Electron process tree on Node 25 — reproduces on every vitest version/pool); the real fix is integrated-terminal execution (planned). Agents verify with `npm run build` + `npm run lint`; the test suite is run at review.

## [0.2.27] — 2026-06-09

### Added
- **Solo / Fast mode (first of the v0.3 push).** A single generalist "Solo" agent that does the whole task itself — read → edit → run → verify → iterate — with no PM/delegation overhead and no review gate. The fast path for simple/everyday asks; use a Team for complex multi-file work that wants an independent review. Start it from the ⚡ button on the Team panel, the "Start Solo Agent" command, or the **new onboarding "How do you want to work?" two-door** (Solo / Team), where Solo is the recommended default. It opens a chat ready to work, gets a higher tool-loop limit (no teammates to spread work across), and is cost-routed like any agent.
- **New specialist agent roles** for knowledge work — Business Analyst, Market Researcher, Financial Analyst, Strategy Lead — selectable from "Add Agent" (one-click knowledge-work *teams* land next).

### Fixed
- **Agents can now actually run the test suite.** When an agent ran `npm test` (or any tool) via `run_command`, the command was spawned as a child of the VS Code extension host and inherited its `NODE_OPTIONS` (debugger/bootstrap injections), `ELECTRON_RUN_AS_NODE`, and `VSCODE_*` vars — which break a child Node toolchain (e.g. vitest's worker pool dies and it reports "No test suite found" for *every* file). UnodeAi now sanitizes the environment for agent-run commands so they execute as they would in a normal terminal. Surfaced by dogfooding (a delegated agent kept "failing" tests that actually pass) and directly unblocks the "agent verifies its own work" loop.

## [0.2.26] — 2026-06-09

### Added
- **Clear buttons for Chat and Messages.** Each panel has a clear (clear-all) button in its title bar. "Clear Chat" wipes the selected agent's transcript + saved history (keeping it selected); "Clear Messages" empties the cross-agent activity feed. Both now ask for a quick confirmation that spells out the consequence before deleting.
- **Compact Team panel.** A collapse/expand button next to the Team title shrinks every agent to a small icon chip (role icon + a status-colored dot, details in the tooltip; click a chip to open that agent's chat). Collapsing frees vertical space for the Chat and Messages panels; expand restores the full cards.

### Changed
- **Copy button on replies is now a compact, always-visible icon.** It no longer requires hovering to appear and uses a small copy glyph instead of the "Copy" label, saving space.
- **Agents can't footgun test/build commands anymore.** When an agent tries to run a test/type/lint runner directly (e.g. `npx vitest`, `tsc`, `eslint`), UnodeAi now rewrites it to the project's matching script (`npm test`/`npm run build`/`npm run lint`) before running, and tells the agent to use the project scripts. When no script matches, bare `vitest` is at least forced out of watch mode (which otherwise hangs forever). This closes the most common way weak/cheap models break — running the wrong test command and blaming "the environment".

## [0.2.25] — 2026-06-08

### Added
- **Model escalation when a teammate's model is on strike (L3).** If a delegated teammate returns nothing even after the firm retry (0.2.24), UnodeAi now automatically switches it to its configured **fallback model** and tries once more. If there's no fallback — or the fallback also returns nothing — the delegation comes back with a clear message that *this teammate's model is refusing and needs to be changed*. That message flows up to the PM (the agent you're talking to), which relays it to you, so a dead/refusing model surfaces as actionable advice instead of a silent stall.

- **Async delegation now gets the same reliability net.** The empty-reply retry and fallback-model escalation (0.2.24/0.2.25) previously only covered the blocking `assign_task`. They now also apply to parallel `assign_task_async` work — a teammate that returns nothing is retried/escalated before `await_tasks` collects it, and a teammate still blocked after escalation is flagged as a failed subtask. File-ownership claims are held until the final (post-retry) result, so retries never leak a claim.

### Fixed
- **Model hot-swap now actually reaches the running agent.** Switching an agent's model (fallback escalation or Smart Mode / tier changes) updated the stored config but not the live backend's own copy, so in-process (openai-compat) agents could keep using the old model. `setModel` now pushes the change into the running backend.
- **Project conventions are loaded before the first turn.** `.roam/rules.md` and auto-detected package.json scripts are now awaited during activation, so a message sent the instant the extension loads still gets the project context injected.

### Security
- **`@file` chat references are symlink-safe.** Mentions were validated only by string path; a symlink/junction inside the workspace could point a `@file` at an external file. Both the workspace root and each target are now resolved with `realpath` and re-checked for containment before the file is read.
- **"Always allow" for `npm run <script>` no longer over-approves.** Approving `npm run build` previously whitelisted `npm run`, silently green-lighting `npm run deploy` and any other script. The template now keeps the script name (`npm run build`), so each script is approved individually (same for pnpm/yarn/bun).
- **`fetch_url` blocks numeric IP encodings of internal hosts.** Decimal/hex/octal/short IPv4 encodings of private addresses (e.g. `http://2130706433/` = 127.0.0.1) are now decoded and blocked at the literal level, independent of platform DNS. A known TOCTOU residual (re-resolution at connect time) is documented in code and BACKLOG 10b.

## [0.2.24] — 2026-06-08

### Added
- **Agent compliance enforcement — make delegated teammates actually do the work.** Two layers target the weak-model failure mode where a teammate returns empty, replies with only a plan, or tells you to run a script yourself:
  1. Every non-coordinator agent's instructions now carry a firm "carrying out an assigned task" protocol: do the work with your tools, don't punt it back, don't return an empty response, and only report a blocker with a specific reason. (Coordinators/PM are excluded; phrased to fit read-only roles like the reviewer.)
  2. When a teammate hands back nothing usable, the delegation now **forces one firm retry automatically** before returning — independent of how capable the PM model is. If it still returns nothing, the PM gets a clear "this teammate is refusing/unable; reassign, escalate, or tell the user you're blocked" message instead of a silent empty turn.

## [0.2.23] — 2026-06-08

### Changed
- **Delegated work stays in each agent's own chat (reverted the PM-chat mirroring from 0.2.22).** Mirroring every teammate's actions into the PM transcript made the PM view too noisy. Instead, when the PM delegates, its chat now shows a clear **"Waiting on <agent>"** card that stays in the running state until the teammate finishes — so you know who to go watch, and you open that teammate's own chat to see the detailed work.

## [0.2.22] — 2026-06-08

### Added
- **See what the crew is doing from the PM's chat.** When the PM delegates to a teammate, that teammate's live actions (reading files, running commands, edits) are now mirrored into the PM's transcript — indented and tagged with the teammate's name (`↳ senior-dev`) — so you no longer have to switch chats to see what's happening while the PM waits.
- **Agent status emoji.** Each agent in the Team panel now shows a little figure that mirrors its state: 🏃 working, 🧍 idle, 😴 stopped, 🚶 starting/stopping — alongside the existing status dot.

## [0.2.21] — 2026-06-08

### Fixed
- **Copy button on agent replies was invisible** on some themes (dark text on a transparent background). It now uses a matched secondary foreground/background so the label is always legible.
- **Team Rules editor wiped the default template the moment you typed.** The defaults were only a placeholder (which vanishes on the first keystroke) and could never be saved. New teams now open the editor pre-filled with the default rules as real, editable text you can tweak and save.
- **PM now reports back to the user instead of going silent.** When a teammate finished delegated work (especially via a message back to the PM), the PM often ended its turn without summarizing — the user saw the turn end with nothing to show for it. The PM is now instructed to always close a turn with a plain-language status update for the user, to summarize when a delegation completes, and to stop and surface a blocker (e.g. suggest restarting) when it's stuck or a teammate keeps failing rather than spinning silently.

## [0.2.20] — 2026-06-08

### Added
- **Background long-running commands.** `run_command` now takes an optional `background: true` — the command starts and returns a handle (`bg_N`) immediately instead of blocking, so an agent can run `npm run dev`, a watcher, or a server without stalling its turn. Two new tools: `check_command` polls status + captured output, `kill_command` stops it. Background commands are gated by the same command policy as foreground ones, and any still running are killed when the agent stops.

## [0.2.19] — 2026-06-08

### Added
- **`@file` references in chat.** Mention a workspace file with `@path` in your message (e.g. "explain `@src/auth.ts`") and UnodeAi attaches that file's contents to the turn automatically — no copy-pasting. Path traversal outside the workspace is blocked and large files are capped. Non-path mentions like `@reviewer` are left as plain text.

## [0.2.18] — 2026-06-08

### Added
- **Agents now know your project's conventions automatically.** UnodeAi detects your `package.json` scripts and package manager and tells every agent how to build/test/lint *your* way — so they use `npm test` (or your real script) instead of guessing a command, and won't mistake a wrong command for a "broken environment." It refreshes when `package.json` changes. This makes the crew far more reliable, especially with cheaper models.

## [0.2.17] — 2026-06-08

### Security / Fixed
- **Stronger SSRF protection for `fetch_url`.** Previously only the literal hostname was checked, so a public domain that resolves to a private IP (DNS rebinding) or a redirect into the internal network could slip through. Now the host's DNS records are resolved and rejected if any point at a private/internal address, and redirects are followed manually with every hop re-validated.
- **Narrower default safe-command list.** "Enable Safe Commands" no longer pre-allows bare `npm run` (any script) or `npm install` / `npm ci` (which run lifecycle scripts = arbitrary code); only explicit safe scripts run automatically (`npm test`, `npm run build`/`compile`/`lint`/`typecheck`, etc.), everything else asks.
- **Parallel-delegation safety nudge.** When the PM dispatches a parallel task without declaring its files, the result now warns that file-conflict protection is off for that task (declare files, or use sequential delegation).

## [0.2.16] — 2026-06-08

### Added
- **Web access for agents (`fetch_url`).** Agents with read access can now fetch a public http/https page or API and get its text back (HTML stripped, JSON as-is; 10s timeout, 100 KB cap) — useful for docs, references, and API lookups. Requests to localhost and private/internal networks are blocked (SSRF guard).

## [0.2.15] — 2026-06-08

### Added
- **Team Rules.** A new **Edit Team Rules** button on the Team panel opens an editor where you write rules your whole crew must follow — e.g. *"Developers must have the architect review their work before it's done."* Creating a team now prompts you to set them. Rules are saved to `.roam/rules.md` and injected into every agent's instructions (refreshed each turn), so they take effect on the next turn — a simple way to enforce your own workflow without per-task reminders.

## [0.2.14] — 2026-06-08

### Added
- **Conflict-free parallel delegation.** Building on v0.2.12's parallel delegation, the PM can now declare which files each parallel task owns; if two tasks would touch overlapping files, the second is rejected up front (telling the PM who holds the conflict) so two teammates never edit the same files at once. The architect now produces an explicit non-overlapping ownership map to drive this. Optimistic file coordination and whole-project checks still backstop anything not declared.

## [0.2.13] — 2026-06-08

### Fixed
- **Inter-agent messages now actually reach the recipient.** `send_message` put a note on the bus but the target teammate never read it as input. A directed message is now delivered to that agent as a turn (so it genuinely "hears" its teammate); broadcasts stay informational.
- **Tighter command allowlist.** "Enable Safe Commands" (and "Always allow") used bare tool names, so allowing `git` once also silently allowed `git reset --hard`, and `node`/`python` allowed arbitrary code. The default safe list is now narrow templates (`git status`, `npm test`, `npm run`, …), and "Always allow" remembers a specific two-token template (`git status`, not all of `git`) for tools like git/npm/node. Anything else still prompts.
- **Parallel delegation safety.** When the PM runs teammates in parallel, a failed/timed-out task is now clearly marked as failed (instead of looking successful), and the number of simultaneous delegations is capped (the PM is told to collect results before dispatching more).

## [0.2.12] — 2026-06-08

### Added
- **Parallel delegation.** The Project Manager can now run teammates **at the same time** instead of strictly one after another. For independent work on non-overlapping files, the PM fans tasks out (dispatch each, then collect all results together), which is noticeably faster than serial delegation; it still works sequentially when one task depends on another's output. Cross-file safety is unchanged (optimistic file coordination + whole-project checks).

## [0.2.11] — 2026-06-08

### Fixed
- **Delegated agent stuck on "Stop".** When the PM delegated to a teammate, that teammate's chat kept showing "Stop" (input disabled) even after it had finished and reported back, and its reply never landed in its own chat tab. The chat now finalizes a completion for any agent — not just replies addressed to you — so a delegated agent frees up and shows its result.
- **Empty cold-start reply.** Some gateways occasionally return an empty first turn (no content, no tool call) right after an agent starts; UnodeAi now retries once before accepting it, instead of surfacing a blank reply.

### Added
- **Copy button on agent replies.** Hover a finished agent reply to get a "Copy" button in its top-right corner — handy for relaying an agent's output.

## [0.2.10] — 2026-06-08

### Added
- **Live "Analysis" in chat.** When an agent reasons before answering (thinking models like DeepSeek-R1), its reasoning now streams into a dimmed, collapsible **Analysis** card right above the reply — so you can watch *how* the agent is thinking, not just the final answer.
- **Status dots on activity cards.** Every tool/action card now shows a Claude-style status dot: a pulsing gray dot while running, green when it succeeds, red when blocked or failed — an at-a-glance read of what the agent is doing and how it went.
- **Rotating activity indicator.** While an agent is working but hasn't started replying, the "Thinking…" indicator now cycles through changing verbs (Thinking → Pondering → Analyzing → …) so it's always visibly alive instead of looking frozen.

## [0.2.9] — 2026-06-08

### Added
- **Agents can message each other (`send_message`).** Any agent can now send a direct message to a teammate by id or role, or broadcast to the whole team with `"*"`, over the shared team bus — so a developer can hand findings to the reviewer, the PM can ping a role, etc., without going through you. Read-only roles (e.g. Reviewer) gain messaging without gaining write or command access.

## [0.2.8] — 2026-06-08

### Added
- **Interactive command approval ("ask" mode), like Claude Code.** When an agent wants to run a command that isn't already allowed, you get a prompt: **Run** (once) / **Always allow "`<prefix>`"** (whitelists it, so that command runs automatically next time) / **Deny**. "UnodeAi: Enable Safe Commands" now turns this on — common build/test commands (npm, node, git, python, …) run automatically, and anything new asks first. Shell-chained and destructive commands are never auto-allowed.

## [0.2.7] — 2026-06-08

### Added
- **Run commands without copy-pasting.** Command execution is off by default for safety; a new guided prompt — **"UnodeAi: Enable Safe Commands"** (also offered after creating a team) — switches it on with a safe allowlist (npm, npx, node, git, python, …). Once enabled, agents run those build/test commands themselves instead of asking you to paste them. (Never enables unrestricted execution.)
- **Large-file reads.** `read_file` now returns up to 100 KB and supports `offset`/`limit` pagination, so agents can read and edit full-size source files (previously truncated at 16 KB). `run_command` output stays capped at 16 KB.

### Fixed
- Chat transcript items no longer collapse/overlap (flex layout fix).

## [0.2.6] — 2026-06-07

### Added
- **Chat "Thinking…" indicator.** While an agent is working but hasn't started streaming a reply, the chat now shows an animated "Thinking…" instead of looking frozen; it clears as soon as the reply (or a tool step) starts.
- **Per-agent context usage in the Dashboard.** The Agent Overview table has a new "Context" column showing each agent's window usage (% of its context window; "Managed by Claude" for Claude agents).

### Fixed
- **Live prices now reflect your account's discount.** Model prices were shown at gateway list price. Roam gateway pricing is now fetched with your API key (so the account's discount group is returned) and the new-api `group_ratio` is applied. New `roam.priceGroup` setting for accounts with multiple usable groups.
- **Quick Start label** corrected to match the team it actually creates: **PM + Architect + Developer + Reviewer** (was "PM + Dev + QA").

## [0.2.5] — 2026-06-07

### Fixed
- **Reset Workspace State now also clears `.roam/team.json`.** Previously, after a reset the cleared roster could be immediately re-seeded from a leftover `.roam/team.json` (e.g. an old "Browser" agent reappeared). Reset now deletes that team file too, so it reliably lands on the setup wizard with no agents.

## [0.2.4] — 2026-06-07

### Added
- **"UnodeAi: Reset Workspace State" command** (also a button in Settings → More). Permanently clears this workspace's team roster, all chat history, the message log, saved conversations, workflows, and approved MCP servers — with an option to also clear stored provider API keys — then reloads so you start clean (the setup wizard reopens). Useful when an old team or old conversations carried over from earlier use.

## [0.2.3] — 2026-06-07

### Fixed
- **Roam agents no longer fall back to OpenAI's API endpoint.** Older persisted agent configs could carry
  `https://api.openai.com/v1` as their base URL, and the OpenAI-compatible backend also had OpenAI as
  its internal default. Roam-provider agents now resolve blank or legacy OpenAI base URLs to the configured
  Roam/unode gateway (`https://www.unodetech.xyz/v1` by default), preventing Roam keys from being sent to
  OpenAI and producing confusing 401 errors.

## [0.2.2] — 2026-06-07

### Changed
- **Model picker now says when the live list is unavailable.** If only the built-in models can be shown (usually a missing API key or base URL), the picker shows a non-blocking notice — "Live model list unavailable — showing built-in defaults (check API key / base URL)" — instead of silently displaying a short list that looks like a regression.

## [0.2.1] — 2026-06-07

Hotfixes for issues found right after the v0.2.0 release.

### Fixed
- **Startup restored the wrong team.** A `.roam/team.json` in the workspace could shadow your last working roster, so VS Code would reopen with an old/stale team (e.g. a leftover single agent). The last workspace roster now wins; `.roam/team.json` members are only used to seed a brand-new workspace. The setup wizard opens only when no agents are restored.
- **Model Tuning save reset the Settings panel.** Saving one agent's parameters re-rendered the whole panel, forcing you to re-navigate before editing the next agent. Saving now persists in place; a dedicated **Close** button owns closing the panel.
- **Model picker showed only the built-in models when the base URL was blank.** A blank `roam.baseUrl` skipped the live `/models` endpoint and fell back to the few static models. A blank Roam URL now resolves to the default gateway so the live model list loads. (If the live list still can't be fetched — e.g. no API key — the built-in defaults are used as a fallback.)
- **Chat agent list could drift from the Team panel.** The Chat view now re-syncs its agent switcher whenever it becomes visible, so it always matches the current team.

## [0.2.0] — 2026-06-06

Theme: **a real per-agent chat experience (Cline-level), live MCP, and a smoother first run.**

### Added
- **Rich per-agent chat in the sidebar** — the `roam.chat` view renders Markdown/code, streams tokens live with a **Stop** button, shows **tool-call cards** (with unified diffs for edits), a **context-usage bar**, and **compaction markers**. Switch agents from one view. (Chat parity C1–C3)
- **Plan / Act mode** — a per-agent toggle. **Plan mode is enforced at the tool layer** (read-only tools only; file writes, commands, delegation, and MCP tools are refused — not just discouraged by a prompt). Defaults to Act. (C4)
- **Visual workflow editor** — `UnodeAi: Edit Workflow` opens an editor for multi-step workflows with **conditional branches** (jump to a step when a result matches), drag-to-reorder, and built-in templates. Custom workflows persist to `.roam/team.json`. (E4)
- **Setup wizard / onboarding** — a first-run wizard (provider + API key with the Base URL prefilled, one-click team, demo task), a friendlier empty Team panel, and a demo-task library. (E6)
- **PM → Claude delegation bridge** — the PM can delegate to Claude-headless agents over a loopback MCP server. (E2)
- **Context summarization** — long OpenAI-compatible sessions compact older turns into a rolling summary instead of dropping them. (E1)
- **Opt-in bundled build** — `npm run package:bundle` produces a ~1 MB VSIX (vs ~5 MB), validated to run MCP correctly. (E5b)
- **Official logomark** as the activity-bar icon.

### Changed
- **Default maximum concurrent agents raised from 4 to 10.** Changing it takes effect immediately; agents beyond the cap queue and auto-start as slots free up.

### Fixed
- **Set Provider API Key → custom secret name** no longer skips straight to the value prompt (an emoji-string-equality bug dropped the name step).
- Roam-provider agents with a blank `roam.baseUrl` no longer fall back to `api.openai.com` (now use the default gateway).
- Streamed **thinking-model** tool loops preserve `reasoning_content`, fixing a gateway 400 that forced a non-streaming fallback.

### Hardening
- Added regression coverage for Smart Mode model-tier edits: unknown provider keys from the webview are rejected, while known provider keys are accepted.
- Expanded VS Code E2E coverage for public command routing and the concurrency queue.
- Documented the production `npm audit --omit=dev` result: 1 moderate `uuid <11.1.1` buf-bounds advisory. It is not exploitable in UnodeAi because all call sites use arg-less `uuidv4()`; no `audit fix --force` was applied because that would require a breaking major upgrade.

### Validated (live)
- MCP servers **github** and **playwright** validated end-to-end against a real backend (both unbundled and bundled builds).
- 5-agent concurrency stress: negligible per-agent overhead (~+10 MB for 5 concurrent).

## [0.1.2] — 2026-06-05

### Changed
- **Fully English user-facing content.** Rewrote the Marketplace README and the usage guide (USAGE.md) in English, and removed the last Chinese from user-visible UI strings (the provider picker label). Internal development docs are not shipped and are unchanged.

## [0.1.1] — 2026-06-05

Theme: **give users control over model behavior without editing JSON by hand**, plus concurrency/routing hardening.

### Added
- **Advanced model parameters per agent (F1)** — temperature, top_p, max_tokens, presence/frequency penalty, stop, response_format, reasoning_effort, thinking, tool_choice. A new **Model Tuning** tab in Settings edits them per agent; the OpenAI-compatible backend sends the full surface, the Claude backend maps `reasoning_effort` → `--effort` (the only sampling flag its CLI exposes — other params are disabled in the UI for Claude agents).
- **Per-agent Context Window (F1b)** — set each agent's window (feeds the 70%/80% context gate), with an inline ⓘ guide on how to find your model's real window.
- **Global defaults + override hierarchy (F2)** — `roam.modelDefaults.*` settings; effective params resolve agent > smart tier > legacy fields > global > built-in defaults.
- **Smart Mode (F3)** — auto-select a model tier per task (explicit task tier → task-type hint → role tier → default), hot-swapping the model per turn. A **Smart Mode** Settings tab with an editable tier→model matrix, per-role tiers, and task-tier hints (`roam.smartMode.*`, `roam.modelTiers`).
- **Session Memory (F4)** — `.roam/rules.md` project memory (à la `.clinerules`) is injected into every agent's system prompt and refreshed per turn; edits picked up live.
- **Chat panel** — `UnodeAi: Open Chat with Agent` opens a persistent multi-turn chat with any chosen agent (not just the PM); messages route over the team bus.
- **Role-tuned defaults from experience** — each role template ships a sensible default temperature (reviewer/security `0.1`, code/test/devops/data `0.2`, pm `0.3`, architect `0.5`, tech-writer `0.6`). `reasoning_effort` is **not** forced by default (some gateways/models reject it) — it's a one-click opt-in per agent (Model Tuning) and per tier (Smart Mode).

### Changed
- Default gateway is now `https://www.unodetech.xyz/v1` (OpenAI-compatible; `Authorization: Bearer <key>`).
- Over the `maxConcurrentAgents` cap, starting an agent now **queues** it (with a toast) and auto-starts it when a slot frees, instead of throwing (B1).
- Commands blocked by `roam.commandApproval` now surface a warning toast with an "Open Settings" shortcut instead of failing silently (B2).

### Fixed
- **Busy-agent completion cross-talk** — a second task arriving while an agent was mid-turn overwrote the in-flight task's reply target, misrouting completions. Turns now strictly serialize per agent (deliver only when idle; queue otherwise).
- **Turn error wrongly freed a concurrency slot** — a transient turn failure marked the session `error` and drained the start queue, letting a queued agent breach `maxConcurrentAgents`. A turn-level error with a live backend is now surfaced without releasing the slot; only a dead backend frees one.

### Known limitations
- **`reasoning_effort` is opt-in, not a default.** It's only sent when you set it (per agent or per Smart Mode tier) — `roam.modelDefaults.reasoningEffort` defaults to empty — because some OpenAI-compatible gateways/models reject the parameter. Enable it for reasoning-capable models once you've confirmed your gateway accepts it.
- **Claude reasoning effort is a start parameter.** Smart Mode changing a tier's reasoning effort for an *already-running* Claude agent only takes effect on its next start (OpenAI-compatible agents apply it next turn).
- **MCP servers require the SDK at runtime** (`@modelcontextprotocol/sdk`, shipped) and live tokens — MCP live validation is deferred to v0.2.0.
- **E2E coverage is a smoke test** (activation, command registration, Settings). Routing/concurrency are covered by unit tests, not yet E2E.

### Security / supply chain (non-blocking, reviewed)
- `npm audit` reports 14 findings: **13 are E2E devDependencies** (mocha/serialize-javascript, @vscode/test-*) that are **not shipped in the VSIX**; the 1 production finding (`uuid`) does not apply to our usage (we call `uuidv4()` with no `buf` argument). No `audit fix` applied to avoid breaking churn.

## [0.1.0] — 2026-06-05

- First Marketplace release: build a team of AI agents in VS Code, PM orchestration over a shared message bus, per-role/model assignment, file/command/MCP permission guards, cost visibility.
