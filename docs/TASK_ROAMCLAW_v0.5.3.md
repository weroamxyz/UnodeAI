# TASK — RoamClaw · v0.5.3: measure first, then dogfood the steer

**Owner**: RoamClaw (in-product UnodeAi agent) · **Reviewer**: Claude · **Target**: v0.5.3
**Two jobs**: (1) run the **R2 benchmark** that justifies — or reshapes — v0.5.3 scope, *before* Codex/DeepSeek finalize; (2) once `interject()` lands, be the end-to-end dogfood + integration test owner.

> Why RoamClaw and not Codex/DeepSeek: this is judgement + measurement work (designing fair tasks, reading results, deciding if C3 is even needed). Implementation goes to the other two; RoamClaw closes the loop with real usage — the dogfooding that surfaced P0/P1/P2 in the first place ([[agent-robustness-insight]]).

---

## Job 1 — R2 benchmark (do this FIRST; it gates scope)

The whole v0.5.x premise (PowerShell 40%→85%, Turn-Count-to-First-Correct 4-6 → 1-2) is still **unmeasured**. Don't build three more features on an unverified number. Run R2 on the **published v0.5.2** and report.

**Setup**
- 8 tasks × 2 tool surfaces (every task uses `run_command`; half also use `read_file`/`write_file`).
- Tasks: T1 (mathUtils validation, already defined) + 7 siblings of similar size — small, verifiable code edits in `ux-scratch`.
- Model: DeepSeek v4 flash. Workdir: `ux-scratch`.
- Run each task fresh (no carried context). Timeout per task; **skip** outliers (network), note them — don't average them in.

**Metrics (table per task + median)**
- **Turn Count to First Correct** — turns until the first tool call that lands correctly.
- **Tool Call Success Rate** — calls that weren't rejected / total calls.
- **Context tokens** at turn end.

**Report** → `docs/R2_BENCHMARK_v0.5.2.md`, compared against the v0.5.1 baseline if available.

**The report must answer the scope questions:**
1. Did P0 actually move PowerShell success? By how much?
2. Did P1/P2 reduce the light-talking / wrong-tool turns? **If yes, the C3 "dead-loop detection" rewrite is largely unnecessary** — say so, and C3 stays deferred/cancelled.
3. Is `interject()` solving a real observed pain (agents going down a wrong path for N turns), or speculative? Quote a concrete trace.

➡️ Deliver Job 1 **before** the 06-14 scope-lock. Claude uses it to confirm "v0.5.3 = interject only."

---

## Job 2 — dogfood + integration test (after Codex + DeepSeek land)

Once both PRs merge, prove the feature works on a real model, not just unit mocks.

**Integration test** (`src/session` or `src/__tests__`, wherever cross-component tests live — mirror an existing one):
- Drive `SessionManager.interjectAgent(agentId, text)` against a scripted backend; assert the steer reaches history with the `[User interjected mid-task]` prefix and the turn continues. (Backend-internal ordering is DeepSeek's unit test; here you test the **wiring** SessionManager↔backend.)

**Live dogfood** (write up in the PR, not a test):
- Real run in `ux-scratch` on DeepSeek flash. Give a task, let the agent start down one path, then **Steer ⚡** it ("use read_file instead of cat"). Confirm it folds the message in within one tool round-trip and changes course.
- Try the two edge cases by hand: steer on the **final** step (must not be dropped — DeepSeek test 3 path); steer while **idle** (must be a no-op, not a new turn).
- Capture one transcript snippet for the release note.

**If dogfood fails**: file the trace, hand to DeepSeek/Codex with the exact step that broke. Do **not** patch the backend yourself — RoamClaw measures and reports; the other two implement (task-routing split).

---

## Definition of Done
- [ ] `docs/R2_BENCHMARK_v0.5.2.md` delivered **before** scope-lock, with the 3 scope questions answered and C3's fate recommended.
- [ ] Integration test for the SessionManager↔backend interject wiring, green.
- [ ] Live dogfood write-up in the PR: happy path + 2 edge cases + one transcript snippet.
- [ ] Any failure routed to the implementer with a reproducible trace (no self-patching).
- [ ] Claude signs off that the measured numbers match (or correct) the roadmap's claims.
