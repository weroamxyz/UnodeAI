# DISPATCH — v0.5.3 + R2 start now (3 parallel lanes, conflict-free)

**Date**: 2026-06-11 · **Owner**: Claude (coordination)
**🟢 STATUS: GREEN-LIT (2026-06-11).** Lane C (R2) **✅ complete** — results in [UX_BENCHMARK §四/§五](UX_BENCHMARK_vs_Cline.md); R2 validated the v0.5.2 reliability floor and confirmed interject (G-001) is the right v0.5.3 priority. Lanes A (backend) + B (UI) are **cleared to start**.

Three lanes start **simultaneously**. They touch **disjoint files / directories** — verified below. The only cross-lane link is one interface contract (not a shared file).

---

## Conflict-free file ownership (the guarantee)

| Lane | Recipient | Working area | Files it may edit |
|------|-----------|--------------|-------------------|
| **A — Backend** | DeepSeek (coding) | `RoamCrew/src/backend`, `src/session` | `AgentBackend.ts`, `OpenAICompatBackend.ts` (+ its test), `SessionManager.ts` |
| **B — UI** | Codex | `RoamCrew/src/views`, `extension.ts`, webview | `ChatViewProvider.ts` (+ its test), `extension.ts`, webview html/css/js |
| **C — R2 benchmark** | DeepSeek (dogfood) + 张 | `c:\AI_Program\ux-scratch` (**separate dir**) + scorecard | sandbox files only; results → `docs/UX_BENCHMARK_vs_Cline.md` §四/§五 |
| (Claude/me) | — | `docs/` + review | contract, R2 analysis, gap→card conversion |

**Why there's no collision:**
- `extension.ts` is **Codex-only**; `SessionManager.ts` is **DeepSeek-only** — they don't share a file.
- `AgentBackend.ts` (interface) is **DeepSeek-only**; Codex never opens it.
- Lane C runs entirely in **`ux-scratch`** (a different directory/repo) against the **already-installed v0.5.2 VSIX** — it doesn't read or write RoamCrew source at all.

---

## The one cross-lane contract (so A and B build in parallel)

```ts
// DeepSeek (Lane A) creates this on SessionManager, mirroring the existing interrupt():
interjectAgent(agentId: string, text: string): void   // -> backend.interject?.(text)

// Codex (Lane B) consumes it in extension.ts, mirroring the existing interrupt wiring (line 375):
interject: (agentId, text) => sessionManager.interjectAgent(agentId, text)
```

- Both cards already encode this identically — no ambiguity.
- **Merge order**: Lane A (backend) merges **first** (it defines `interjectAgent` + the interface). Then Lane B (UI) merges against it.
- **Parallel dev is fine**: Codex unit-tests its routing with a **mocked** `interject` dep, so it never blocks on A's merge. Integration happens after both land.

---

## Lane cards

- **Lane A — Backend** → [TASK_DEEPSEEK_v0.5.3_G001_BACKEND.md](TASK_DEEPSEEK_v0.5.3_G001_BACKEND.md)
  interject-only, one message kind, wait-don't-preempt, inject only at loop top (tool_call-ordering invariant). ~30–40 lines prod + 3 tests.
- **Lane B — UI** → [TASK_CODEX_v0.5.3_G001_UI.md](TASK_CODEX_v0.5.3_G001_UI.md)
  composer stays enabled while busy; Send routes to `interject`; `Steer ⚡` label + hint. No modal. ~40–60 lines + 3 tests.
- **Lane C — R2** → [TASK_R2_v0.5.2_BENCHMARK.md](TASK_R2_v0.5.2_BENCHMARK.md)
  rerun T1/T3 on installed v0.5.2, focus U5; fill scorecard. Startable **right now**.

---

## Critical rule for Lane C (don't contaminate the benchmark)

R2 measures the **published v0.5.2** VSIX that's installed in VS Code. While Lanes A/B edit RoamCrew source, **do not rebuild/reinstall a dev build of the extension until R2 is done** — a mid-R2 reinstall changes the thing being measured. R2 reads only `ux-scratch`; A/B never touch `ux-scratch`. Independent by construction.

---

## "Go" checklist
- [ ] 张 hands Lane A card to DeepSeek-coding, Lane B card to Codex, Lane C card to DeepSeek-dogfood (or runs C himself).
- [ ] A and B branch from `main` independently (`feat/g001-interject-backend`, `feat/g001-interject-ui`).
- [ ] C copies `bench/ux-sandbox` → `ux-scratch` fresh, runs against installed v0.5.2.
- [ ] Claude reviews A first (merge), then B, then runs the integration check; folds C's gaps into the scorecard.
