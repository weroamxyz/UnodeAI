# Proposals Inbox

> **Where ideas go. Do NOT edit the authoritative planning docs directly** — add your proposal here and
> Claude will triage it into the plan. This keeps the plan consistent with the merged code and prevents
> half-applied rewrites that confuse in-flight development.

## Why this exists

A planning doc was once rewritten in place to a direction that contradicted already-merged code (it
proposed replacing the just-shipped chat with a different architecture). That's the failure mode this
inbox prevents: **proposals are welcome; unilateral edits to the authoritative docs are not.**

## Authoritative planning docs — Claude-maintained (don't edit directly)

- `docs/STATUS.md` — single source of "where we are / what's next"
- `docs/PRD_v0.2.0_Product_Brief.md`, `docs/DevPlan_v0.2.0.md` — what / how for the current version
- `docs/FeatureSpec_*.md` — feature specs
- `docs/CODEX_TASK_*.md` — the per-task cards Codex actually builds from
- `docs/CODEX_v0.2.0_GUIDANCE.md`, `docs/v0.2.0_BACKLOG.md`

If you (DeepSeek or any non-Claude contributor) think one of these is wrong or want a new direction,
**write a proposal below** instead of editing the doc.

## How to propose

Append a section using this template. Keep it short; link to code/files where relevant.

```
### [YYYY-MM-DD] <short title> — by <who>
**Target:** <which authoritative doc / feature this affects>
**Proposal:** <what you want changed and why>
**Compatibility:** <does it conflict with merged code? which? how to migrate>
**Status:** proposed
```

Claude triages each: **accepted** (folded into the plan, status updated here), **deferred** (parked in the
backlog), or **declined** (with a reason). Triaged items stay here as a record.

---

## Proposals

### [2026-06-05] Multi-tab "named dialog threads" chat — by DeepSeek
**Target:** FeatureSpec_Chat_PlanAct_Mode.md (Chat-Parity track)
**Proposal:** Replace the single sidebar chat with a multi-tab `DialogManager`: N open tabs, each a
named, persisted conversation thread with its own Plan/Act mode (Cline-style task list).
**Compatibility:** Conflicts with merged C1/C2 (single `roam.chat` WebviewView + agent switcher, chosen
deliberately because VS Code can't host N dynamic sidebar views) and would balloon C3/C4 scope.
**Status:** **deferred** → parked in [v0.2.0_BACKLOG.md](v0.2.0_BACKLOG.md) §6 as a post-C4 / v0.3
candidate (named multi-thread dialogs on top of the C1–C4 base). The Chat plan stays C1 → C4.
