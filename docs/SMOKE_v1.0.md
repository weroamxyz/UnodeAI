# UnodeAi — v1.0 GA smoke test (command-by-command)

Full pre-release smoke for the commercial 1.0 build. Run top-to-bottom on a **clean install**. Commands in
**`UnodeAi: …`** form are run from the **Command Palette** (`Ctrl+Shift+P`). Terminal blocks are **Windows
PowerShell**. Update the Status column as you go. Findings → `SMOKE_FINDINGS.md`.

Test workspace: `c:\AI_Program\BankingAPI` (needs git for Phase 4 worktree).

Legend: ✅ pass · ⏳ pending · 🔁 retest · 🚧 blocked

---

## Phase 0 — Install & first-run

| # | Action / command | Expected | Status |
|---|---|---|---|
| 0.1 | Uninstall any old build; **Install from VSIX** `roam-crew-<ver>-bundled.vsix` (or Marketplace), then **Developer: Reload Window** | UnodeAi icon in the Activity Bar | ⏳ |
| 0.2 | **File: Open Folder** → `c:\AI_Program\BankingAPI` | Workspace open | ⏳ |
| 0.3 | `UnodeAi: Run Setup Wizard` | Wizard opens (key → team → demo) | ⏳ |
| 0.4 | Settings (`Ctrl+,`, search `roam`): set `Roam: Concurrency Strategy` = **optimistic**, `Roam: Command Approval` = **ask** | Saved | ⏳ |

**Pass:** extension activates with no errors in **Output → "UnodeAi"**.

---

## Phase 1 — Providers (Roam + Unode split, 0.9.x)

| # | Action / command | Expected | Status |
|---|---|---|---|
| 1.1 | `UnodeAi: Set Provider API Key` → pick **`ROAM_API_KEY`** → paste your **weroam** key | "Key saved" | ⏳ |
| 1.2 | `UnodeAi: Set Provider API Key` → pick **`UNODE_API_KEY`** → paste your **unode** key | `UNODE_API_KEY` appears in the picker list (proves provider registered) | ⏳ |
| 1.3 | `UnodeAi: Open Settings` → **Providers** tab | **Roam (weroam)** shows a sign-up/top-up link. **Unode** is usable but **not promoted** — there is intentionally **no** Unode sign-up link (0.9.7); Unode stays selectable in the agent picker/Smart Mode | ⏳ |
| 1.4 | `UnodeAi: Build an Agent` → set provider **Roam** | Model list loads **with prices** ($in/$out per 1M) | ⏳ |
| 1.5 | Same dialog → switch provider to **Unode** | Model list **still shows prices** (0.9.3 fix — must NOT go blank) | ⏳ |
| 1.6 | Settings → **Smart Mode** → tier matrix | Columns include **roam** (1st) and **unode** (2nd) | ⏳ |
| 1.7 | Confirm default endpoint: Settings → `roam.baseUrl` | `https://ai.weroam.xyz/v1` (NOT unodetech) | ⏳ |

**Pass:** Roam is the default, Unode is selectable, **prices show for both**, Smart Mode lists both.
**Upgrade-path check (only if upgrading an existing install):** on first launch you should see a one-time
notice that your old key/agents were kept on **Unode**; old agents show provider **unode**.

---

## Phase 2 — Core loop (S1–S5)

| # | Action / command | Expected | Status |
|---|---|---|---|
| 2.1 (S1) | `UnodeAi: Create Default Team` | PM + Architect + Senior Dev + Reviewer appear; Team title bar shows the **📄 Optimistic** concurrency icon | ⏳ |
| 2.2 (S2) | `UnodeAi: Solo Agent (toggle)` → `UnodeAi: Open Chat with Agent` → Solo → type: *"Add a `/health2` route to src/app.js returning {ok:true}"* | Live streaming, tool cards, file actually edited | ⏳ |
| 2.3 (S3) | Open **PM** chat → *"Read src/app.js and tell me what routes exist."* | PM delegates a read (or reads), reports back; **no gateway 400s** | ⏳ |
| 2.4 (S4) | `UnodeAi: Open Settings` → **MCP Servers** → add **Sequential Thinking** (`@modelcontextprotocol/server-sequential-thinking`) → approve | Mounts (no `-32000`); status Ready | ⏳ |
| 2.5 (S5) ⭐ | **PM** chat → *"Add a `GET /status` endpoint returning {ok:true} with a test. Delegate it, review it, run the tests, and tell me when done."* | senior-dev edits app.js + test; reviewer PASS; `run_checks` green; **PM marks plan complete**; no "outside working folder", no `/Users/dev` path | ⏳ |

**Pass S5 (the keystone):** the full delegate → implement → review → verify → finalize loop completes with files changed on disk and no wrong-folder errors.

---

## Phase 3 — Reliability & UX features (0.8.x–0.9.x)

| # | Action / command | Expected | Status |
|---|---|---|---|
| 3.1 — PM-stall nudge (0.9.4) | **PM** chat → *"Delegate adding a `/ping3` route to senior-dev."* (give only the delegation, no "verify") | After the dev returns, the PM **does not stop** — it continues to run_checks / reviewer / finalize on its own (Output shows *"coordinator … nudging to advance"* if it tried to stop) | ⏳ |
| 3.2 — Command approval (S6) | **PM** chat → *"Run the command `git branch` and tell me the current branch."* (non-safe cmd) | An **approve/deny prompt** appears; Approve → runs. (Safe cmds like `npm test` won't prompt by design.) | ⏳ |
| 3.3 — Deny path | **PM** chat → *"Run `node -v`."* → **Deny** | Agent reports it was refused, cleanly | ⏳ |
| 3.4 — Smart Mode badge (S7) | Settings → enable **Smart Mode**; set PM=**premium**, senior-dev=**standard** | No tab-jump on save; each Team card shows **⚡ Smart → \<model>** live | ⏳ |
| 3.5 — Concurrency icon | Click the Team title-bar **📄/⎇ icon** | Toggles Optimistic ⇄ Worktree (icon + Dashboard line update) | ⏳ |
| 3.6 — Changed-files cards (0.8.111) | After S5, look at the senior-dev Team card | Lists the files it changed; clicking one opens a **read-only diff** | ⏳ |
| 3.7 — Dashboard | `UnodeAi: Show Dashboard` | Concurrency status line + agent/cost panels render | ⏳ |

---

## Phase 4 — Worktree isolation + verify-gate (S8)

```powershell
# In the BankingAPI folder, make it a git repo (worktree mode needs one commit):
cd c:\AI_Program\BankingAPI
git init
git add -A
git commit -m "init"            # if git asks who you are:
# git config user.email "you@weroam.xyz"; git config user.name "You"
```

| # | Action / command | Expected | Status |
|---|---|---|---|
| 4.1 | Click the Team title-bar icon → **Worktree** (or it prompts **Initialize Git** if not a repo) | Icon shows **⎇ Worktree**; Dashboard says Worktree | ⏳ |
| 4.2 | **PM** chat → *"Add a `GET /ping2` route returning {pong:true} with a test."* | Each agent works under its own `.roam/worktrees/<id>`; the **verify-gate** merges to `roam/integration` only if `npm test` passes | ⏳ |
| 4.3 | Inspect: `git worktree list` (terminal) and the Worktree panel | Per-lane ✓ verified / ✗ failing shown; only passing work lands | ⏳ |

```powershell
git worktree list               # shows the per-agent lanes
git log --oneline -5            # the merged work landed only after passing
```

---

## Phase 5 — Final release gates (run before tagging 1.0)

```powershell
# From the repo (c:\AI_Program\RoamCrew), green on all four:
npm run build
npm run lint
npm test                         # expect all green
npm run publish:bundle           # builds the bundled VSIX (publishes to Marketplace)
```

| # | Check | Pass |
|---|---|---|
| 5.1 | `npm test` all green; `npm run build` clean | ⏳ |
| 5.2 | Bundled VSIX installs cleanly in a fresh VS Code profile and activates | ⏳ |
| 5.3 | Marketplace listing shows **weroam** links + correct description (README) | ⏳ |
| 5.4 | **Live billing**: a brand-new weroam account can top up → key → a request is **metered/deducted** (gateway side) | ⏳ |
| 5.5 | `ai.weroam.xyz/api/pricing` returns rows `LivePriceService` parses (prices populate, not bundled-only) | ⏳ |

**1.0 is GO when:** Phases 0–4 pass, Phase 5 is green, and the business gates (billing 5.4, publisher co-owner ✅, store/legal assets) are cleared.
