# TASK — RoamClaw · Kilo gap-analysis revision (resolve the worktree contradiction)

**Owner**: RoamClaw (tech-writer → reviewer loop) · **Reviewer**: Claude · **Type**: research revision
**Goal**: fix the **one required revision** from Claude's review of [KILO_GAP_ANALYSIS.md](KILO_GAP_ANALYSIS.md). The doc is otherwise PASS — this is the only blocker before Claude designs the v0.6.0 worktree feature.

> The whole v0.6.0 design hinges on this one fact, so it must be pinned down — confirmed with a source, or explicitly marked unresolved. Do **not** guess.

---

## The contradiction to resolve
- **KILO_GAP_ANALYSIS.md** (§2) says: **Kilo Code** has **no** git-worktree / parallel-agent feature (marked UNCONFIRMED), and it's **Roo Code** that has first-class worktrees.
- But **张's own Kilo comparison** (the source that kicked off this work) said the opposite: *"Kilo — **Agent Manager** does parallel isolated worktrees."*

Both can't be the ground truth. **Which is right?**

## What to confirm (with sources)
1. Does **Kilo Code's "Agent Manager"** exist, and does it run **multiple agents in parallel**? In **separate git worktrees**? — find the actual Kilo docs/repo page for "Agent Manager" (kilocode.ai/docs, github.com/Kilo-Org/kilocode). Quote it.
2. If Kilo's Agent Manager **does** use worktrees: how are they created, and **how is work merged back** (auto-merge? user-driven? PR?)?
3. Re-confirm the **Roo** worktree claim too — is `roocodeinc.github.io/Roo-Code/features/worktrees` a real page, or was it inferred? (The reviewer flagged it as presented-as-confirmed but possibly unverified.)

## Update the doc
In `KILO_GAP_ANALYSIS.md` §2:
- Replace the "Kilo — UNCONFIRMED / single-agent" row with the **confirmed** finding (Agent Manager: yes/no worktrees, with a source) — or, if you genuinely can't confirm, state explicitly: *"Kilo Agent Manager: claims parallel worktrees (张's source) but I could not find a primary doc confirming the mechanism — UNRESOLVED."*
- Make sure §2 clearly separates **Kilo** vs **Roo** worktree facts so they're not conflated.
- Keep the honesty bar: every worktree/merge claim needs a citation or an explicit UNCONFIRMED.

## DoD
- [ ] §2 reconciles Kilo (Agent Manager) vs Roo worktrees, each with a source or an explicit UNCONFIRMED.
- [ ] The merge-back mechanism (auto vs user-driven) is stated for whichever tool actually has worktrees.
- [ ] Run it through the reviewer again (independent), then commit `KILO_GAP_ANALYSIS.md`.
- [ ] Ping Claude when done — this unblocks the v0.6.0 worktree fan-out design.
