# ROADMAP — v0.9.0 "Weak-Model Execution Hardening" (the last big version before commercial 1.0)

**Type:** roadmap / planning. Progress source stays [STATUS.md](STATUS.md). Extends
[ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md](ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md) and the
[[execution-engine-strategy]] thesis: *weak model + strong execution framework*.

## Why this is 0.9 (and the commercial argument)
1.0 is the commercial release. The only defensible claim we have is **"a verified crew of cheap models
that actually finishes the job."** The 2026-06-15/16 dogfooding proved the framework — the moat — is
still fragile *on exactly the cheap models we monetize*: agents stalled for dozens of turns, the sandbox
false-blocked legit commands, a botched whole-file write truncated `extension.ts` to 53 lines, and agents
hallucinated other projects / old work. A paying user hits one of those in their first hour and churns.
**0.9 retires that risk.** Breadth features (Agent Builder → 0.8.6) sit on top of this, not before it.

## The backlog (ranked by leverage on reliability)
Each item below was *observed failing* in dogfood this cycle, not speculative.

1. **`search_files` tool** — agents have no grep/regex search, so they chunk-read a 2,600-line file 40×
   and conclude "the symbol isn't there" (it was at line 160). The single biggest unblock; Cline/Kilo/Roo
   all ship it. Regex → `file:line`, workspace-sandboxed.
2. **Safe edits / catastrophic-write guard** — `write_file` is whole-file replace; a weak model used it
   like a patch and **truncated `extension.ts` 97 KB → 53 lines** (recovered only by git). Add a guard
   that refuses/flags a write that shrinks an existing file past a threshold without confirmation; consider
   a targeted/anchored diff-edit tool.
3. **Over-aggressive command guards (the false-positive class)** — `detectOutsideRootPath` kept reading
   regex literals / inline-script bodies as paths and telling agents to "switch your working folder"
   (patched in 0.8.2/0.8.4, but audit the whole guard surface for the same class).
4. **Weak-model tool-call discipline** — leaky models (Kimi/DeepSeek) emit calls as `<tool_call>` /
   `<file_read>` / leaked tokens and end turns describing actions without doing them. Force XML for known
   leakers from the start (don't wait for Option-4 to flip), and nudge on reasoning-only turns (not just
   when the *visible* content matches the announce regex).
5. **Project-conventions injection** (BACKLOG A1/A2, [[agent-robustness-insight]]) — with no conventions,
   weak agents hedge and make a mess (wrote data to a non-existent `src/marketplace/`). Auto-inject
   canonical paths / build & test commands / "don't do X". Also the headline differentiator vs Cline.
6. **Stale-memory isolation** — reused agents on the same workspace path hallucinated finished work
   (`add.ts`, an old CHANGELOG, `roam-crew@0.2.31`). Fresh-path / auto-reset for a new task, and the P2a
   "read before you claim done" nudge tightened.

## Sequencing
- **Now: 0.8.6 = Agent Builder** ([DESIGN_v0.8.6_agent_builder.md](DESIGN_v0.8.6_agent_builder.md)).
- **Then: 0.9.0 = items 1–6** above (ship incrementally as 0.9.x if useful; the *theme* is reliability).
- **1.0 (commercial): hardened core + onboarding/time-to-value + store/billing polish.**
- **1.1: Agent Builder grows** (share/export custom agents, hosted skill authoring).

## 1.0 readiness bar (what 0.9 must deliver toward)
A new paying user points a **cheap model** (DeepSeek/Kimi) at a real multi-file task and the crew
**finishes it without a human nursing it through stalls** — searches code, edits safely, runs the
project's checks, verifies, and merges. No false blocks, no file-clobbering, no "switch your working
folder" dead-ends. That's the commercial promise; 0.9 is how we earn the right to make it.
