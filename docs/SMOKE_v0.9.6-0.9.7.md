# Smoke test — v0.9.6 (GA hardening) + v0.9.7 (balance indicator)

Targeted smoke for the two changesets below. Maps onto the phase numbers in
[SMOKE_v1.0.md](SMOKE_v1.0.md) so it folds into the GA run. Findings → [SMOKE_FINDINGS.md](SMOKE_FINDINGS.md).

Legend: ✅ pass · ⏳ pending · 🔁 retest · 🚧 blocked

## What changed (scope of this smoke)

- **0.9.6** — catalog Ed25519 signature verify (warn-only transition); defensive pricing-shape parsing; lint→0.
- **0.9.7** — Providers tab: live Roam balance + low-balance warning + Top-up button (roam only).

---

## Part A — Automated gates (run from the repo; no GUI)

Run with Node on PATH (`export PATH="/c/Program Files/nodejs:$PATH"` in this env).

| # | Check | Command | Expected | Status |
|---|---|---|---|---|
| A.1 | Build clean | `npm run build` | tsc exits 0, no errors | ✅ |
| A.2 | Lint zero | `npm run lint` | 0 warnings, 0 errors | ✅ |
| A.3 | Unit tests | `npm test` | all green | ✅ (1019/1019) |
| A.4 | New balance tests | `npm test -- src/models/__tests__/BalanceService.test.ts` | 7/7 pass | ✅ |
| A.5 | New catalog-sig tests | `npm test -- src/marketplace/__tests__/catalogSource.test.ts` | all pass (valid/ tampered/ unsigned-transition/ wrong-key) | ✅ |
| A.6 | **5.5 pre-check** — live pricing shape | `curl https://ai.weroam.xyz/api/pricing` | top-level `data`/`group_ratio`/`usable_group`/`vendors`; ~40 rows each with `model_name`/`quota_type`/`model_ratio`/`completion_ratio` → `LivePriceService` parses it | ✅ (verified live) |

> A.1–A.6 already run and green in this environment. Re-run A.1–A.3 before tagging.

---

## Part B — Manual GUI smoke (you run in VS Code — agents can't drive the IDE)

Prereq: install the build, open a workspace, set a **weroam** key (`UnodeAi: Set Provider API Key` → `ROAM_API_KEY`).

### B1 — Providers / balance (0.9.7) — folds into **Phase 1**

| # | Action | Expected | Status |
|---|---|---|---|
| B1.1 | `UnodeAi: Open Settings` → **Providers** tab, with a Roam key set | Under the **Roam (weroam)** card a balance line appears (no key → no line) | ⏳ |
| B1.2 | Observe the balance value | A funded account shows **Balance: $X.XX** (and **$Y used** if usage returns); an **uncapped** account shows **Unlimited** with no warning | ⏳ |
| B1.3 | Set `roam.lowBalanceThresholdUsd` (Settings) **above** your balance, reopen Providers | Balance turns amber + **⚠ Low balance** + a **Top up** button appears (skip if account is Unlimited) | ⏳ |
| B1.4 | Click **Top up** | Opens `https://ai.weroam.xyz/login?lang=en` in the browser (same host-owned deep link as the banner) | ⏳ |
| B1.5 | **Degrade-silently:** delete the Roam key (or go offline), reopen Providers | No balance line, **no error** — panel renders normally | ⏳ |
| B1.6 | Set `roam.lowBalanceThresholdUsd = 0` | Balance still shows; **no** low-balance warning | ⏳ |

**Pass B1:** balance shows for a keyed account, low-balance warning + working Top-up at/under threshold, Unlimited handled, silent when unreadable.

### B2 — Pricing still populates (0.9.6) — folds into **Phase 1.4/1.5 + 5.5**

| # | Action | Expected | Status |
|---|---|---|---|
| B2.1 | `UnodeAi: Build an Agent` → provider **Roam** | Model list loads **with prices** ($in/$out per 1M) — not bundled-only | ⏳ |
| B2.2 | Output → "UnodeAi" after startup | A "Refreshed N model price(s) from …weroam…" line (N>0); no parse warnings | ⏳ |

### B3 — Marketplace catalog under signature verify (0.9.6) — folds into **Phase 2.4 area**

| # | Action | Expected | Status |
|---|---|---|---|
| B3.1 | `UnodeAi: Open Marketplace` | Catalog loads normally (agents/MCP/skills listed) | ⏳ |
| B3.2 | Output → "UnodeAi" | In the transition window (no `.sig` published yet) you may see *"hosted catalog is unsigned … merging anyway"* — expected, **not** an error. No "did NOT verify". | ⏳ |
| B3.3 | (after a `.sig` is published + real public key pasted) install an item | A tampered/badly-signed hosted catalog is **ignored** (bundled only); a valid one merges | ⏳ (post-keygen) |

---

## Acceptance for this changeset

- **0.9.6:** Part A green; B2 + B3.1/3.2 pass. (Original accept: "Codex review clean; full smoke Phase 1 + 5.5 green".)
- **0.9.7:** B1 passes on a funded account; degrades silently when the endpoint/key is absent.

## Known / deferred

- Full suite is green locally: 1019/1019 (111 files).
- Balance field semantics (remaining vs limit; usage cents) verified only against an **uncapped** test key →
  re-confirm B1.2 once a **finite/funded** account is available; adjust `BalanceService` if needed.
- Real signature protection (B3.3) is gated on the out-of-repo keygen + publishing `catalog.json.sig` to roam-skills.
