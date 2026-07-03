# DEVPLAN v0.8.2 — "Reviewable crew + members that come equipped"

**Type:** patch release plan. Single progress source stays [STATUS.md](STATUS.md). This is the
sequencing + ownership doc for 0.8.2. Claude integrates, gatekeeps, and publishes; agents never bump
the version or publish.

## Theme

Two coherent threads, both deepening the moat (an orchestrated, **verified** team), neither a new
headline capability — so they ship as a patch:

- **Thread A — Finish the review board** (the "review the PR from your crew" moment): per-lane diffs,
  live refresh, re-verify / hand-back on held lanes.
- **Thread B — Members come equipped** (skills folded into members, MVP): mount a member's declared
  skills into it on Add; remove the dead "Coming in Phase 3" Skills tab; wire the 6 existing skills +
  author the first market-proven batch. See [DESIGN_member_skills.md](DESIGN_member_skills.md).

## Workstreams, owners, briefs

| WS | What | Owner | Status | Brief |
| -- | ---- | ----- | ------ | ----- |
| A1 | Review-board UI: lane diffs, `update()` live refresh, re-verify/hand-back buttons | **Codex** | ✅ **landed** (main `f1e7936`) | [TASK_v0.8.2_CODEX_review_board_phase2.md](TASK_v0.8.2_CODEX_review_board_phase2.md) |
| A2 | Review-board backend: lane `changedFiles`, `laneDiff()`, re-verify/hand-back, change emitter | **DeepSeek** | ▶ open | [TASK_v0.8.2_DEEPSEEK_lane_diff_backend.md](TASK_v0.8.2_DEEPSEEK_lane_diff_backend.md) |
| B1 | Member-skills UI: drop dead Skills tab; member cards show "Includes: …" | **Codex** | ✅ **landed** (main `f1e7936`) | [TASK_v0.8.2_CODEX_member_skills_ui.md](TASK_v0.8.2_CODEX_member_skills_ui.md) |
| B2 | Member-skills backend: `skills` field + mount-on-Add injection (the contract) | **DeepSeek** | ▶ open | [TASK_v0.8.2_DEEPSEEK_member_skills_backend.md](TASK_v0.8.2_DEEPSEEK_member_skills_backend.md) |
| B3 | Skill **content**: wire 6 existing onto members + author the top ~10 new (license-clean) | **RoamCrew crew dogfood** (tech-writer + reviewer; DeepSeek may author JSON) | ▶ open | [DESIGN_member_skills.md](DESIGN_member_skills.md) gap list |
| C | Bug audit of **all** the above + skill-content quality/license review | **Kimi** | ▶ open (after merge) | [TASK_v0.8.2_KIMI_audit.md](TASK_v0.8.2_KIMI_audit.md) |

> **Note — Codex's A1+B1 already landed.** They were in the working tree at the start of the 0.8.1
> hotfix session and rode into the build, so they shipped (UI only) in **published 0.8.1**: the
> marketplace skills cleanup is live and complete; the review-board lane buttons render but are
> **inert no-ops** because their handler is optional and `extension.ts` doesn't wire it yet — that's
> exactly what A2/B2 below complete. (They were committed to main in `f1e7936`, which is why its
> message understates the diff.)

## What's left to hand out

- **RoamCrew bundle (the remaining work):** A2 + B2 (DeepSeek backend) + B3 (content) and C (Kimi audit).
- **Codex bundle:** ✅ done — nothing to dispatch. A2/B2 must wire `onLaneAction` into `extension.ts`'s
  `WorktreePanel.createOrShow(...)` call and populate `changedFiles`, turning the shipped UI live.

## Execution order

```
Phase 1 (parallel):  DeepSeek[A2,B2]  ‖  RoamCrew-crew[B3 content]      (Codex A1+B1 ✅ already in main)
                     ↓ (code/content against the frozen contracts — no cross-waiting)
Phase 2:  Claude integrates A2+B2+B3 onto the landed A1/B1 UI → build/lint/test green → one branch
                     ↓ (must exist before audit)
Phase 3:  Kimi[C] audits the merged change (code + skill content)
                     ↓
Phase 4:  Claude verifies each finding (≈40% are false positives — debunk, don't drop),
          applies real fixes, full gates, package 0.8.2 VSIX
                     ↓
Phase 5:  张 runs the GUI smoke (panel actions + Add-a-member-with-skills) → confirm → Claude publishes
          0.8.2 + tag v0.8.2; update USAGE.md + docs/wiki on publish (standing rule)
```

**Hard serial point:** Kimi audits only after the merged, compiling version exists. A2 wires the
already-landed A1 UI; B2 wires the already-landed B1 UI — so A2/B2 are what make 0.8.1's inert buttons
real. B3 is pure content with no code dependency.

## Acceptance (release gate)

- `build` + `lint` + `test` green; new logic + render/message paths covered.
- Review board: lane diffs open, board live-refreshes on verify state change, held lane can re-verify /
  hand back. Re-verify honors the command-approval gate (no auto-run of unapproved commands).
- Members: adding a skill-bearing member injects its playbooks; no dead Skills tab; cards show includes.
- Skill content: every new skill maps to a member, license-clean, measurably useful.
- No version/CHANGELOG churn from agents; Claude cuts 0.8.2.

## Out of scope (later)

Standalone skill install, attach-arbitrary-skill-to-any-agent, hosted skill-only catalog, and the
full 0.9 project-conventions injection (member-skills is its MVP down payment).
