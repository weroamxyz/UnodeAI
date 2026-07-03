# Analysis — why the PM only uses one teammate at a time

**Question:** the PM delegates to architect OR senior-dev, never both at once. Why won't it run two
teammates concurrently?

**Short answer:** it's **by design, enforced at three reinforcing layers**. Nothing is broken — the
PM literally *cannot* fan out to two teammates from a single turn, because (1) its prompt tells it to
go one-at-a-time, (2) the `assign_task` tool blocks until the teammate fully finishes, and (3) the
backend runs a turn's tool calls sequentially. Notably, the concurrency limiter is **entirely on the
PM side** — `SessionManager` would happily run two different teammates at once.

---

## The three layers (each one alone is enough to serialize)

### 1. The PM prompt explicitly says "one at a time"
`src/roles/RoleConfig.ts` (PM template):
- L314-315: `assign_task(agent, instruction): hand a task to a teammate ... and WAIT for their result.`
- L325-326: *"Delegate **one task at a time** with assign_task, giving each teammate a NON-OVERLAPPING
  set of files to own ... Read each result, then decide the next step."*

So the model is instructed to delegate → wait → read → decide → delegate again.

### 2. `assign_task` is a blocking await-for-completion call
`src/backend/TeamTools.ts` → `assignAndAwait()` (L151-192): returns a `Promise<string>` that resolves
**only** when the teammate emits `task.complete` (matching correlationId), errors, or times out. There
is no fire-and-forget "dispatch now, collect later" variant. (The only non-blocking team tool is
`broadcast`, which expects no reply.) So a single `assign_task` ties up the PM turn until that one
teammate is done.

### 3. The backend executes a turn's tool calls **sequentially**
`src/backend/OpenAICompatBackend.ts` `runTurn()` (L347-363):
```js
for (const call of msg.tool_calls) {
  ...
  const result = await this.routeToolCall(call.function.name, args);  // awaits each, in order
  ...
}
```
Even if the PM model emitted **two** `assign_task` calls in one assistant message, the loop awaits the
first (which blocks until architect finishes) before it even *starts* the second. Parallel tool calls
from the model are flattened into sequential execution.

---

## What is NOT the cause
- **Not the concurrency cap.** `roam.maxConcurrentAgents` defaults to 10.
- **Not SessionManager.** Turn serialization there is **per-agent** (an agent won't run two turns at
  once), but two *different* teammates (architect + senior-dev) are independent idle sessions and can
  run concurrently. The PM side is the only thing preventing it.

## The design intent (why it was built this way)
The PM prompt's rationale (L340-342) is collision safety: *"two agents editing the SAME file are
blocked by the workspace ... the real danger is one agent changing a file that ANOTHER depends on —
that only surfaces in run_checks."* Sequential delegation + contracts-first + `run_checks` is the
safety net against cross-file breakage. One-at-a-time is the simple, safe default.

**Tension worth noting:** the *architect* prompt (L203-206) already talks about *"CONTRACT-FIRST
(critical for **parallel teammates**)"* and "two teammates editing different files stay compatible."
So the design *anticipates* parallel teammates — the contracts-first discipline exists precisely to
make parallelism safe — but the PM orchestration never actually exploits it. The capability the
contracts were meant to unlock is left on the table.

---

## How to enable concurrent delegation (options, with trade-offs)

### Option A — parallelize independent tool calls in the backend loop (smallest change)
In `runTurn`, when a single assistant message contains multiple **independent** tool calls (e.g. two
`assign_task`), run them with `Promise.all` instead of `await` in a `for` loop.
- **Pros:** localized; no new tools; the PM can fan out by emitting two assigns at once.
- **Cons/risks:** must preserve `tool_result`/history ordering deterministically; only safe to
  parallelize side-effect-independent calls (assign_task to *different* teammates, list_agents) — must
  NOT parallelize writes through the same `WorkspaceTools`. File collisions between the two teammates
  are still bounded by the `FileCoordinator` (re-read + retry) and caught by `run_checks`, but cost and
  rate-limit pressure go up. Needs the PM prompt to actually emit batched assigns.

### Option B — scatter/gather tools (recommended, cleanest)
Add a non-blocking pair:
- `assign_task_async(agent, instruction)` → dispatches and returns a handle (correlationId).
- `await_tasks(handles[])` → blocks once, returns all results together.
Then update the PM prompt: *"for independent tasks on non-overlapping files, fan them out with
assign_task_async, then await_tasks to collect; only serialize when task B needs task A's output."*
- **Pros:** true scatter-gather, explicit control, keeps the safe contracts-first flow; the PM decides
  what's parallel vs sequential.
- **Cons:** more surface (two new tools + a pending-task registry in TeamTools); prompt rework; tests.

### Option C — leave it sequential, document as intentional
If safety/determinism is valued over wall-clock speed, keep it. Sequential delegation is genuinely
safer and simpler; parallelism mostly buys latency on independent subtasks.

---

## Recommendation
**Option B** if you want real multi-agent parallelism with the PM in control (best fit for "run
architect + senior-dev together when their files don't overlap"). **Option A** is a quick first step
if you just want to prove the speedup before investing in the tool surface. Either way, gate it behind
the existing contracts-first + `run_checks` discipline so parallel teammates can't silently break each
other — and update the PM prompt, because today it would still choose to go one-at-a-time even if the
plumbing allowed parallel.

**Suggested assignee:** this is orchestration-core + safety-sensitive (touches `TeamTools`,
`OpenAICompatBackend.runTurn`, PM prompt). I'd scope it tightly and review hard regardless of who
implements; Option A is small enough to hand to DeepSeek with a precise brief, Option B I'd want to
spec carefully first.
