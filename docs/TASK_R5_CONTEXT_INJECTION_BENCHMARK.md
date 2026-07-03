# TASK — RoamClaw · R5: measure context injection (Cline #2)

**Owner**: RoamClaw (DeepSeek via UnodeAi) · **Analyst**: Claude · **Type**: measurement, decides a default
**Goal**: decide whether `roam.engine.workspaceContext` should flip **default-on**. It's shipped **off by default** precisely because we don't yet know if the token cost is worth the saved tool calls. R5 answers that with data.

**Protocol home**: [UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md) — this is the R5 round; record results there.

> ⚠️ **Prerequisite**: you need a build that HAS context injection (it's unreleased). Ask Claude for a dev VSIX (or run via F5). Confirm the setting exists: **Settings → `roam.engine.workspaceContext`**.

---

## The question
Context injection puts the **active editor file + workspace diagnostics** into every turn's system message. Does that **reduce "orientation" work** (the agent calling `read_file` just to see the file it's already looking at, or running checks just to find errors) enough to justify the **extra input tokens per turn**?

## Setup
- Sandbox: `c:\AI_Program\ux-scratch` (reset between runs: `git reset --hard -q; git clean -fdq`).
- Model: DeepSeek flash (cheap tier — the case where token cost matters most).
- Two arms, **same tasks, same prompts**:
  - **OFF**: `roam.engine.workspaceContext = false` (current default).
  - **ON**: `roam.engine.workspaceContext = true`.
- Make the active file **relevant**: before each task, open the file the task is about in the editor (so injection actually has something useful to provide). For diagnostics tasks, leave a known error in the file so diagnostics are non-empty.

## Tasks (pick 3–4 where "knowing the open file / current errors" should help)
1. "Fix the failing test" — with the failing file already open in the editor (does ON skip the initial read_file?).
2. "Add validation to the function in the open file" — file open, no path given (does ON let it act without asking which file?).
3. "There's a type error in this file — fix it" — with a real diagnostic present (does ON see the error without running checks?).
4. A control task that does NOT involve the open file (does ON waste tokens with no benefit? — measure the downside).

## Metrics (per task, ON vs OFF)
| Metric | Why |
|---|---|
| **Orientation tool calls** (read_file/run_checks done *just to see the open file or its errors*) | The thing injection should reduce |
| **Turn Count to First Correct** | Did injection get it acting sooner? |
| **Input tokens / turn** (and total) | The cost of injection |
| **Task completion** (success/partial/fail) | Did it help or hurt? |

## Deliverable → `docs/R5_CONTEXT_INJECTION.md` + a row in UX_BENCHMARK
A table (ON vs OFF per task) and a **one-line recommendation**:
- **Flip default-ON** if injection clearly cuts orientation calls / turns and the token overhead is modest (rule of thumb: saves ≥1 tool round-trip on relevant tasks, costs < ~1500 extra input tokens/turn).
- **Keep default-OFF** (opt-in) if the token cost outweighs the savings, or it only helps narrow cases.
- Note any **downside on the control task** (tokens spent for no benefit).

## DoD
- [ ] 3–4 tasks run ON vs OFF on DeepSeek flash, sandbox reset between runs.
- [ ] `docs/R5_CONTEXT_INJECTION.md` with the ON/OFF table + the default-on/off recommendation + the control-task downside.
- [ ] No code changes (measurement only). Claude makes the final flip call from your data.
