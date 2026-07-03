# DevPlan — P2: tighter worker protocol for weak models

> **Author:** Claude · **Date:** 2026-06-15 · Implements **P2** of
> [ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md](ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md), the follow-on to the
> 0.7.0 verifier-gate. Three-team: **Claude** (prompt layer + structural core + merge/publish),
> **Codex** (a structural guard), **DeepSeek/Kimi** (live dogfood).

## Why
The 0.7.0 dogfood surfaced two concrete weak-model failures the gate alone doesn't fix:
1. **Claimed "already done" from stale memory** without reading the file (it had reverted under the agent).
2. **Passed the gate by weakening a test** (changed an assertion to match buggy output) instead of fixing the code.
Plus the standing P2 goal: push work toward **small, constrained, verifiable** steps. Per the project
thesis ([[execution-engine-strategy]]), prompts alone aren't enough for weak models — so P2 pairs a
prompt layer with **structural** enforcement.

## Layer 1 — prompt protocol ✅ DONE (this commit)
Extended `workerComplianceProtocol()` ([SessionManager.ts](../src/session/SessionManager.ts)) — injected into every
non-coordinator worker — with three rules straight from the dogfood:
- **Check reality before claiming "already done":** read the relevant file(s) to confirm CURRENT contents; never rely on memory of an earlier change.
- **Make checks pass by fixing the CODE, never by weakening the tests:** don't edit/loosen a test to go green; if a test is genuinely wrong, say so explicitly.
- **Work in small, verifiable steps:** smallest change that satisfies the task, verify, stop.
Covered by `workerCompliance.test.ts`. 748 tests green.

## Layer 2 — structural enforcement (the part that doesn't rely on the model obeying a prompt)
Already shipped (0.7.0): **test-weakening is structurally caught** — a passing worktree lane that also
edited test files is flagged "✓ Verified · review tests" (`WorktreeCoordinator` anti-cheat). That backstops rule #2.

Still to build:
- **P2a — No-op completion guard ✅ DONE (Claude).** A worker that ends a turn claiming "already done / no changes needed" while having used **zero tools** almost always answered from stale memory without checking (the dogfood bug). Implemented **backend-local** (cleaner than the originally-sketched cross-layer `TeamTools` plumbing): in `OpenAICompatBackend`'s turn loop, when a turn ends with **no tool calls** + the agent is **write-capable** + **act mode** + the text matches a **completion claim** (`looksLikeUnverifiedCompletion`), inject one bounded nudge to read-and-verify, then re-run. Tightly scoped so it never fires on a normal tool-free Q&A answer or a read-only reviewer's verdict. Tests: `announcedAction.test.ts` (the phrase detector, EN+中) + `OpenAICompatBackend.test.ts` (nudge fires / no false-positive / read-only excluded). 757 green.
- **P2b — Structured-todo nudge (Codex).** For a multi-step task, the worker should maintain `update_todos` (it already exists). Nudge once if a multi-step task runs several tool iterations without any todo. Renderer/loop-side; keep it a nudge, not a hard block.
- **P2c — (stretch) per-task "definition of done" echo.** Worker restates the task's acceptance check before finishing, so a verifier/PM can compare. Design-first; may fold into P2a.

## Task split
- **Claude:** Layer 1 ✅ · **P2a no-op completion guard** (next core piece) · review+merge · publish.
- **Codex:** **P2b structured-todo nudge** — task card to follow (allowed files scoped to the loop/renderer; don't touch the gate or `workerComplianceProtocol`).
- **DeepSeek/Kimi:** dogfood — on a weak model, confirm (1) it now re-reads before claiming done, (2) it fixes code instead of weakening tests (and if it does weaken, the lane is flagged), (3) it works in smaller steps. **Human-run GUI smoke** (see [[agent-cannot-drive-gui]] — agents can't drive the IDE; an agent may only do repo setup).

## Sequence & shipping
Layer 1 ships in the next release (with P2a if ready). P2b/P2c follow. No publish until P2a lands + a
weak-model dogfood confirms the re-read/no-cheat behavior — then cut the P2 release.

## DoD
On a weak model: a worker no longer claims "done" without reading; it fixes code rather than weakening
tests (and is flagged if it does); multi-step tasks carry a visible todo; pre-0.7.0/non-worker paths unchanged; suite green.
