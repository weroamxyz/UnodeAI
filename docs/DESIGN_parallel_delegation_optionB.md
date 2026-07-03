# Design — Option B: scatter/gather parallel delegation + architect as conflict monitor

**Goal:** let the PM run several teammates **concurrently** (e.g. architect + senior-dev at once) when
their work doesn't overlap, with the **architect acting as the file-conflict referee** that partitions
ownership up front and re-partitions when a conflict is detected.

Builds on the root-cause analysis in
[ANALYSIS_pm_single_agent_delegation.md](ANALYSIS_pm_single_agent_delegation.md).

Owner: design by Claude. Implementation TBD (orchestration-core + safety-sensitive → tight review).

---

## Why this works despite the sequential tool loop
Today `assign_task` blocks until the teammate finishes ([TeamTools.ts:151](../src/backend/TeamTools.ts#L151)),
and the backend runs a turn's tool calls one-after-another
([OpenAICompatBackend.ts:347](../src/backend/OpenAICompatBackend.ts#L347)). The trick: make **dispatch
non-blocking**. Each `assign_task_async` just fires a bus message and returns instantly, so running
several of them sequentially still starts every teammate immediately. A single later `await_tasks`
blocks once and collects all results. The teammates themselves run truly concurrently — `SessionManager`
already allows different idle agents to run at the same time (the limiter was only ever on the PM side).

So **we do NOT need to parallelize the backend tool loop.** The async tools sidestep it entirely.

---

## Part 1 — Scatter/gather team tools

Add two tools alongside the existing (blocking) `assign_task`, which we keep for dependent steps.

### `assign_task_async(agent, instruction, files?)`
- Resolves the teammate; generates a `correlationId` (the **handle**).
- Optionally declares `files` (the paths/globs this task will own) → checked against the claim
  registry (Part 2). **Overlap → the dispatch is rejected immediately** with the conflicting owner,
  so the PM re-partitions instead of racing.
- Sets up the completion subscription **now** (so a fast completion isn't missed), stores the pending
  promise in a registry, and **returns the handle string immediately** (non-blocking).

### `await_tasks(handles?)`
- Awaits all pending tasks (or just the given handles) with `Promise.allSettled`.
- Returns a combined, labelled result: `=== <agent> (<handle>) ===\n<output>` per task; failures and
  timeouts are reported inline (partial success is allowed — the PM decides whether to retry the failed
  one or abort). Releases each task's file claim on settle.
- Overall cap on returned size (truncate per-task) to bound tokens.

### TeamTools internals
- `private pending = new Map<handle, { ref, promise, release }>()`.
- Refactor the existing `assignAndAwait` promise machinery into a private `dispatch(ref, instruction)`
  that returns `{ handle, promise }`; `assign_task` = dispatch + await one; `assign_task_async` =
  dispatch + store; `await_tasks` = await stored.
- Reuse the existing per-task timeout; add an `await_tasks` overall timeout safety net.
- No held locks; a rejected dispatch fails fast → **deadlock-free** by construction.

---

## Part 2 — Architect as file-conflict monitor

Two complementary layers (defense in depth, matching the existing philosophy):

### Proactive (new): claim-based ownership, partitioned by the architect
1. **Architect produces a partition.** Extend the architect prompt: when asked to plan parallel work,
   it returns, alongside the public contracts it already defines, a **non-overlapping file-ownership
   map** — e.g.
   ```
   OWNERSHIP:
   - senior-dev: src/auth/**, src/types/auth.ts
   - tester:     tests/auth/**
   - tech-writer: docs/auth.md
   ```
   This is the architect "monitoring conflicts": it is the authority that decides who owns what so the
   sets are disjoint *by design*.
2. **PM claims on dispatch.** PM passes each teammate's owned paths into
   `assign_task_async(agent, instruction, files)`. A new **`TaskClaimRegistry`** (workspace-shared,
   wired next to `FileCoordinator`) records active claims and rejects a dispatch whose files overlap an
   in-flight claim.
3. **Re-partition on conflict.** If a dispatch is rejected, or a teammate reports it must touch a file
   outside its claim, the PM routes back to the **architect** to re-partition (or serialize that pair).
   The architect stays the single referee.

`TaskClaimRegistry` surface (new file `src/backend/TaskClaimRegistry.ts`):
```ts
claim(taskId: string, agentId: string, paths: string[]): { ok: boolean; conflicts?: string[] };
release(taskId: string): void;
activeClaims(): ReadonlyArray<{ taskId; agentId; paths }>;
```
Overlap = path-prefix/glob intersection. Claims are *intent* (will touch), released on task settle.

### Reactive (existing, unchanged): the safety net
- `OptimisticFileCoordinator` compare-and-swap at write time ([FileCoordinator.ts](../src/backend/FileCoordinator.ts))
  still catches anything the claims miss (e.g. a Claude-backed teammate, or a claim that was too coarse):
  a stale write is rejected with "re-read and retry", and teammates get stale-read notices.
- `run_checks` (build/type-check/test the whole project) remains the final cross-file gate.

### Optional hardening (phase 2)
Enforce the claim at the **teammate's write level**: pass each agent's claim into its `WorkspaceTools`,
so `write_file` outside the claimed set is refused (not just discouraged by the instruction). Stronger,
but more wiring — propose after the PM-level claim proves out.

---

## PM workflow (prompt change)
Update the PM prompt to add a fan-out path (keep the serial path for dependencies):

> For independent subtasks on **non-overlapping files**: first have the architect define contracts **and
> a file-ownership partition**. Then dispatch them together with `assign_task_async(agent, instruction,
> files)` (one per teammate), and collect with `await_tasks`. Only use the blocking `assign_task` when
> task B needs task A's output. If a dispatch is rejected for a file conflict, ask the architect to
> re-partition. After gathering, run `run_checks`, then the independent reviewer — as today.

The architect prompt already anticipates this ("CONTRACT-FIRST — critical for parallel teammates");
we make it actually emit the ownership map.

---

## Risks / trade-offs
- **Cost & rate limits:** N concurrent teammates = N concurrent gateway calls. Consider a
  `roam.maxParallelDelegations` cap (separate from `maxConcurrentAgents`) and/or a setting
  `roam.parallelDelegation` (default on) to disable fan-out entirely.
- **Token bloat:** `await_tasks` concatenates outputs → truncate per task.
- **Partial failure:** one task failing must not lose the others; return partial + error and let the PM
  decide (retry the one, or abort).
- **Claims are advisory** unless phase-2 write enforcement lands — always keep CAS + run_checks behind them.
- **Determinism:** results are keyed by handle/agent so order is stable regardless of completion order.

## Files touched
- `src/backend/TaskClaimRegistry.ts` (new) + tests.
- `src/backend/TeamTools.ts`: `dispatch()` refactor, `assign_task_async`, `await_tasks`, pending
  registry, claim integration + tests.
- `src/roles/RoleConfig.ts`: architect ownership-map output; PM fan-out workflow.
- `src/extension.ts`: build + share `TaskClaimRegistry` next to `FileCoordinator`; pass to TeamTools.
- (optional) `src/backend/WorkspaceTools.ts`: write-level claim enforcement (phase 2).

## Suggested rollout
1. Land `assign_task_async` + `await_tasks` (parallelism) with the existing CAS/run_checks safety net —
   prove the speedup.
2. Add `TaskClaimRegistry` + architect partition (proactive conflict prevention).
3. (Optional) write-level claim enforcement.

## Assignee note
Steps 1–2 are orchestration-core and safety-sensitive. Step 1 is a contained, well-specified change
(good DeepSeek candidate with a precise brief); step 2's architect/PM prompt design I'd want to review
closely. Claude reviews the boundary, merges, and releases regardless.
