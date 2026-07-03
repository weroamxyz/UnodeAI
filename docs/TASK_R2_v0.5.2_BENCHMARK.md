# TASK — Lane C · R2 benchmark on v0.5.2 (startable now)

**Runner**: DeepSeek via UnodeAi (autonomous parts) + 张 (UI-feel parts) · **Analyst**: Claude
**Protocol (authoritative)**: [UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md) — do not start a new doc; results go into its §四 scorecard / §五 gap list.
**This is the R2 increment** defined in [DEEPSEEK_TASK_ux_benchmark_round1.md](DEEPSEEK_TASK_ux_benchmark_round1.md): after each release, rerun only the tasks that release touched.

> Runs entirely in `c:\AI_Program\ux-scratch` against the **installed v0.5.2 VSIX**. Touches **no RoamCrew source** → zero conflict with the backend/UI lanes. Don't reinstall a dev build until R2 is done (it would change what you're measuring).

---

## Scope: rerun T1 + T3, measure U5

v0.5.2 shipped the write→feedback hooks (post-write diagnostics + verification obligation) + the P0 PowerShell fix. R2's job is to verify those actually improved **U5 (error-recovery feel)** and the **turn count / tool-call success** on the two tasks that exercise them.

| T | Task | Why it's in R2 | Dimensions |
|---|------|----------------|------------|
| **T1** | Small change to one file (edit a function + run tests to verify) | Exercises P0 (PowerShell atomic cmd), post-write diagnostics, verify obligation | U1 U3 **U5** U7 |
| **T3** | Fix a bug from a failing test (make it green) | Exercises the edit→check→fix loop the v0.5.2 hooks target | **U5** U7 U9 |

Run **same model, same prompt** on both UnodeAi (Solo mode) and Cline. Cheap tier (deepseek/kimi flash). Same params both sides.

---

## Setup (once)
```powershell
# fresh sandbox copy, git-init for one-command reset between runs
Remove-Item -Recurse -Force c:\AI_Program\ux-scratch -ErrorAction SilentlyContinue
Copy-Item -Recurse c:\AI_Program\RoamCrew\bench\ux-sandbox c:\AI_Program\ux-scratch
cd c:\AI_Program\ux-scratch
git init -q; git add -A; git commit -q -m baseline
node --test    # expect 5/5 green before you start
```
Reset before **each** task / each tool: `git reset --hard -q; git clean -fdq`.

Confirm the Extensions panel shows **roam-crew 0.5.2** (not a dev build).

---

## What to record per task (into §四 scorecard)
- **Completion**: success / fail / partial.
- **Turn Count to First Correct** — turns until the first tool call that lands correctly.
- **Tool-call success rate** — non-rejected calls / total.
- **Tokens / cost / wall-time**, both sides.
- **U5 evidence** (the headline metric): when a command fails or a test is red, does the agent read the error and fix it **without** looping or blaming "环境坏了"? Capture the raw trace. Compare UnodeAi vs Cline.
- Score U1/U3/U5/U7/U9 (0–3) for both sides with concrete evidence (screens/trace), per protocol §二.

## 🤖 autonomous (DeepSeek) vs 👤 manual (张)
- 🤖 DeepSeek drives T1/T3 functional completion + error-recovery behavior + token/turn counts (these are visible in the run).
- 👤 张 eyeballs the **feel** bits: U1 streaming smoothness, U3 diff/approval, U7 terminal visibility.

---

## Deliverable → Claude
1. T1/T3 rows filled in [UX_BENCHMARK §四](UX_BENCHMARK_vs_Cline.md) (cheap tier).
2. Answer the 3 scope questions (these decide v0.5.4 scope):
   - Did P0 move PowerShell tool-call success? By how much (vs R1/v0.5.1)?
   - Did the v0.5.2 write→feedback hooks improve U5 — fewer wrong-then-uncorrected turns?
   - Is **Turn Count to First Correct** actually down toward Cline's 1–2, or still 4–6?
3. Any remaining UnodeAi < Cline on T1/T3 → §五 gap list, with评 priority.

> Claude uses (2) to confirm whether the v0.5.4 reliability levers (#1 tool_choice force, C3 knob-tuning) are still needed or can be trimmed. **Measure before we build more.**

---

## Ready-to-run runbook (sandbox verified 2026-06-11)

Sandbox `c:\AI_Program\ux-scratch` is reset to pristine baseline, **5/5 green**, tree clean. Both fixtures verified (T3 bug → 3 pass / 2 fail; revert → 5/5).

### Standard prompts — paste the SAME text into both UnodeAi (Solo) and Cline
**T1 prompt:**
> In `src/mathUtils.js`, make `add(a, b)` throw a `TypeError` with a clear message if either argument is not a number. Add a test for the new behavior in `test/math.test.js`, then run the tests and confirm everything passes.

**T3 prompt:**
> The test suite is failing. Run the tests, find the bug in the source, fix it, and confirm all tests pass. Do not edit the tests — fix the source.

### Per-task sequence (run each tool from the SAME start state)
```powershell
cd c:\AI_Program\ux-scratch

# --- before EVERY run (both T1 and T3, both tools): reset to green baseline ---
git reset --hard -q; git clean -fdq; node --test   # expect 5/5

# --- T3 ONLY: introduce the bug so there's a red test for the agent to fix ---
node -e "const fs=require('fs');let s=fs.readFileSync('src/mathUtils.js','utf8');fs.writeFileSync('src/mathUtils.js',s.replace('return a - b;','return a + b;'))"
node --test   # expect 3 pass / 2 fail  -> THIS is the T3 start state
```

### Order of runs (4 total)
1. Reset → **T1 on UnodeAi Solo** (record turns / tool-call success / U5 trace).
2. Reset → **T1 on Cline** (same prompt).
3. Reset → apply T3 bug → **T3 on UnodeAi Solo**.
4. Reset → apply T3 bug → **T3 on Cline**.

> UnodeAi side: open `ux-scratch` as the VS Code workspace folder, Solo mode, cheap-tier model. Cline side: same model/params. Don't reinstall a dev VSIX — keep it on the installed **v0.5.2**.

### 🤖 vs 👤
- 🤖 DeepSeek runs steps 1 & 3 (and can run 2 & 4 if it drives Cline) — captures completion, turns, tokens, and the raw error-recovery trace (U5).
- 👤 张 watches U1 streaming / U3 diff / U7 terminal feel and scores 0–3 per side.

Results → [UX_BENCHMARK §四/§五](UX_BENCHMARK_vs_Cline.md). Then Claude answers the 3 scope questions above.
