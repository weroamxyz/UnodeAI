# TASK — DeepSeek / RoamClaw · Research: what Kilo Code & Roo Code do well

**Owner**: DeepSeek (via UnodeAi) or RoamClaw · **Reviewer**: Claude · **Type**: research, no code
**Goal**: ground the v0.6.0 "absorb Kilo" direction in **facts, not assumptions** — produce a gap analysis vs UnodeAi so Claude can design the right features.

> This is a **research/writing** task — perfect for an autonomous agent because it's low-risk (no code, no build to break) and high-value (it decides what we build next). Cite sources (docs, repos, changelogs). Where you're unsure, **say so** rather than guess.

---

## Research these areas (Kilo Code, and its parent Roo Code / Cline where relevant)

### 1. Modes & orchestration
- What **modes** does Kilo ship (Code/Architect/Debug/Orchestrator/custom)? How do custom modes work?
- **Orchestrator / subtask delegation** ("boomerang tasks"): how does it break a big task into subtasks and delegate them? How are results returned/merged?
- How does this compare to UnodeAi's **PM-led team** (TeamTools delegate/assign_task)?

### 2. Parallel agents & git worktrees ⭐ (the headline for 张)
- Does Kilo (or a Kilo/Roo extension/feature) run **multiple agents in parallel**? In **separate git worktrees**? How exactly — who creates the worktrees, how is work merged back, how are conflicts handled?
- If it's NOT literal git worktrees, what IS the isolation mechanism? (branches? copies? in-memory?)
- What's the **UX** — how does the user start a fan-out, watch the parallel agents, and merge?

### 3. MCP
- Kilo's **MCP marketplace / one-click install** — how does discovery + install work? How is it better than typing a server config?
- Per-server permissions / approval model vs UnodeAi's default-deny + approval.

### 4. Skills / rules / memory
- Custom modes, `.kilocode`/rules files, memory bank — what's the model? How does it compare to UnodeAi's Skills→capability tokens + `.roam/rules.md`?

---

## Deliverable → `docs/KILO_GAP_ANALYSIS.md`
A table per area:

| Area | What Kilo/Roo does | What UnodeAi has today | Gap / opportunity | Worth absorbing? (Y/N + why) |
|---|---|---|---|---|

Plus a short **top-3 recommendation**: which Kilo strengths are highest-value for UnodeAi to absorb in v0.6.0, ranked by (user impact × fit with our multi-agent/cost-arbitrage moat).

**Honesty bar**: for the worktree/parallel claim especially — pin down *exactly* what Kilo does (with a source). If you can't confirm it does git worktrees, say "unconfirmed — Kilo appears to do X instead." Claude designs off this, so wrong facts here cost us later.

## DoD
- [ ] `docs/KILO_GAP_ANALYSIS.md` with the per-area tables + top-3 recommendation.
- [ ] Sources cited; uncertainties flagged explicitly.
- [ ] No code changes (research only).
