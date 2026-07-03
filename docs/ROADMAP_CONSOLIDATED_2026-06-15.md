# UnodeAi — Consolidated Roadmap (2026-06-15)

**Type:** review snapshot / planning. Single source of *progress* truth remains
[STATUS.md](STATUS.md); this doc triages the six 2026-06-15 deliverables into one
prioritized, sequenced plan. It does not get back-filled — supersede it with a new
dated snapshot when the picture changes.

## Source deliverables

Two reviewers (Codex + the RoamCrew dogfood team) each answered the same three
questions — code audit, product/business, market/distribution:

- Code audit: [CODEX_2026-06-15_CODEBASE_DEEP_AUDIT.md](CODEX_2026-06-15_CODEBASE_DEEP_AUDIT.md) · [CODEBASE_DEEP_ANALYSIS.md](CODEBASE_DEEP_ANALYSIS.md)
- Product/business: [CODEX_2026-06-15_PRODUCT_BUSINESS_EXPANSION.md](CODEX_2026-06-15_PRODUCT_BUSINESS_EXPANSION.md) · [PRODUCT_STRATEGY_REPORT.md](PRODUCT_STRATEGY_REPORT.md)
- Market/distribution: [CODEX_2026-06-15_MARKET_DISTRIBUTION.md](CODEX_2026-06-15_MARKET_DISTRIBUTION.md) · [GO_TO_MARKET_REPORT.md](GO_TO_MARKET_REPORT.md)

## Triage method

Every audit finding was verified against the code before being accepted. Across the
multi-agent reviews this cycle (MiniMax/Kimi/Codex), roughly **40% of top-line
findings were false positives** — so "a report says X" is a lead, not a fact. The
buckets below reflect what survived verification.

---

## P0 — Ship with 0.8.0 (done this cycle)

| Item | Status | Notes |
| ---- | ------ | ----- |
| `.roam-mcp.json` could be committed on abnormal exit | ✅ done | Already gitignored; **relocated** to gitignored `.roam/mcp.json` (defense-in-depth). |
| MergeOrchestrator real-git test flakiness on Windows | ✅ done | Per-test 30s timeouts. |
| OSS hygiene files missing | ✅ done | Added `SECURITY.md`, `CONTRIBUTING.md`. |
| `npm audit` advisories | ✅ verified non-blocking | Dev-only; **production deps = 0 vulns**. |
| "Chat participant has no tests" | ⚠️ stale finding | 5 tests exist; debunked. |

---

## P1 — Next release (0.8.x / 0.9), highest leverage

Ordered by leverage on the moat (verified, orchestrated team runtime) and on
distribution.

1. **Make the verifier-as-gate visible & trustworthy in the UI.** The gate is the
   differentiator ("neither Cline nor Kilo gate the merge on verification"), but
   it's currently mostly backend. Surface per-lane verify status, the
   "✓ Verified · review tests" anti-cheat flag, and a one-click "hand back / hold"
   in the team panel. *This is the story we sell — show it.*
2. **First-run / onboarding for the team + worktree flow.** Biggest adoption
   cliff per both market reports: users don't discover fan-out + verify. A guided
   "create a team → run a goal → watch it verify-and-merge" walkthrough.
3. **Marketplace listing conversion.** Tighten README hero + screenshots/GIF of a
   team verifying and merging; the 50+ models / Roam gateway value prop above the
   fold. (Listing copy is the cheapest growth lever per GO_TO_MARKET.)
4. **Project-conventions injection (BACKLOG A1/A2).** Weak agents repeatedly
   misuse commands and blame "the environment" because conventions aren't fed in.
   Auto-inject project conventions — also a concrete differentiator vs. Cline.

## P2 — Product expansion (validate before building)

- **Solo/quick-task mode polish** as the low-friction on-ramp before users commit
  to a full team (product reports flag the team setup as heavy for first use).
- **Hosted team/catalog templates** so users start from a working crew, not a
  blank one.
- **Cost/usage transparency panel** — lean into the cost-arbitrage story (cheap
  gateway + verified output) with visible per-run spend.

## P3 — Later / watch

- Broader provider matrix surfacing (vendor brand keywords already in the listing).
- Deeper MCP/skills integration.
- Anything gated on real usage data we don't have yet — revisit after the
  DeepSeek-default data-collection window produces routing/quality signal.

---

## Explicitly debunked / deferred (do not re-open without new evidence)

- Chat participant "untested" — false (tests exist).
- Several MiniMax/Kimi audit items (run_checks blocking on `ask`; commandPolicy
  mutation; auto-finalize serialization) — verified non-issues; see
  [v0.7.0_BUG_AUDIT.md](v0.7.0_BUG_AUDIT.md) and the Kimi review.
- `npm audit` "fix everything" — prod is clean; dev advisories aren't shipped.

## Next checkpoint

After 0.8.0 ships and the @roam smoke passes, pick **P1 #1 + #2** as the 0.9
theme ("make the moat visible + get users to it"). Re-snapshot this doc then.
