# UnodeAi — DevPlan v0.3.0 & v0.4.0 (three-team)

> Claude-maintained · 2026-06-09 · The authoritative plan. Supersedes ROADMAP_v0.3_v0.4.md (which was
> baselined at v0.2.5 and is now historical). Forward list cross-ref: [BACKLOG.md](BACKLOG.md).

## 0. Teams & operating rules
| Team | Role |
|---|---|
| **Claude** | Planning + architecture (DevPlans, task cards, file scopes), implements the **critical / security-sensitive / core-orchestration** path, the **review gate** (independent review of all work — implementer never self-signs), and the **sole publisher** (version bump / CHANGELOG / package:bundle / smoke / vsce publish / tag). |
| **Codex** | **Main implementation workhorse** — well-specified features off the critical-security path. Proven reliable on complex specified work. Gets task cards with explicit file scopes. |
| **DeepSeek + UnodeAi** | **Real-time testing + dogfooding** — runs the product on real tasks, surfaces bugs (it found the agent-robustness + vitest/env issues). Verifies its own work with `npm run build` + `npm run lint` **+ `npm test`** — the full suite now runs via run_command since #13 terminal execution shipped (validated v0.2.30: 59 files green). Bug reports become Codex/Claude task cards; Claude still independently reviews + runs gates before merge. |

**Coordination (hard rules):**
- **Isolation:** Codex and DeepSeek each work in their **own git worktree + branch** (`git worktree add ../roam-crew-<who> -b <who>/<task>` → `npm install` there). Claude works on `main`. Claude **reviews + merges**; nobody self-merges or self-publishes.
- **No collisions:** Claude (architect) assigns each task an explicit **allowed-files scope**; non-overlapping. Shared file → serialize (first merges, other rebases).
- **Cadence:** ship small `v0.2.x`/`v0.3.x` patches frequently; a `v0.3.0` / `v0.4.0` **tag** marks the milestone when its set lands. DeepSeek dogfoods every 2–3 patches.

## 1. Current state (2026-06-09)
- **Shipped (Marketplace):** … v0.2.27 = Solo/Fast mode (M1+M2), specialist roles, (env-fix attempt).
- **On `main`, unreleased:** D1 knowledge-work teams **+ one-click Create-Team picker UI**, PM self-diagnosis rules (reviewed), **vitest 1.6.1→4.x**, terminal-exec DevPlan.
- **Known limitation:** agents can't run vitest via `run_command` (no PTY) → **#13 terminal execution** is the real fix; interim = build+lint + Claude runs tests.
- **Next release:** bundle the unreleased `main` work as **v0.2.28** (Claude publishes when ready).

---

## 2. v0.3.0 — "Cline-class daily experience + reach"
Goal: a new user is immediately as smooth as Cline/Kilo (solo fast loop, real terminal, @-context), **plus** the optional AI team with a real review gate and cost routing.

| # | Item | Owner | Pri | Status |
|---|------|-------|-----|--------|
| S | **Solo / Fast mode** (single-agent full loop, onboarding two-door) | Claude | P0 | ✅ shipped v0.2.27 |
| T1 | **D1 knowledge-work teams + Create-Team picker** | DeepSeek→Claude | P1 | ✅ shipped v0.2.28 |
| **#13-1** | **Terminal execution Phase 1** (run_command/run_checks → VS Code integrated terminal + shell integration, PTY; spawn fallback). Closes the agent-can't-run-vitest gap + command visibility = core Cline parity. | **Claude** | **P0** | ✅ shipped v0.2.29 (+ Phase 2 per-agent terminals/reveal v0.2.31, terminal-on-every-agent v0.2.32) |
| G | **OpenRouter + more providers + provider picker UX** (one key → hundreds of models) | **Codex** | P0 | ✅ shipped v0.2.29–30 (provider-picker UX polish still open) |
| C1 | **@-context extension**: `@folder` / `@problems` / `@url` (`@file` already shipped) | **Codex** | P1 | ✅ merged to main (ContextMentions.ts) — in v0.3.0 RC |
| C2 | **IDE diagnostics → agent** (`languages.getDiagnostics`, auto-attach after writes — faster than run_checks; VS Code-only lever) | **Codex** | P1 | ⬜ **(v0.3.0 gate — C2 or C3)** |
| C3 | **Real-time Todo list** (agent decomposes multi-step work into a live checklist rendered in chat) — strong differentiator | **Claude** | P1 | ✅ shipped v0.2.33 — `update_todos` tool + pinned live checklist |
| C4 | **MCP Setup Wizard** (GitHub/Playwright/Filesystem templates; keep default-deny) | **Codex** + Claude security review | P2 | ⬜ |
| C5 | **Solo M3 polish** (Solo selectable with zero agents; Team-panel card) | Claude | P2 | ⬜ |
| EI | **Chat/Messages export + import** (save conversation to JSON → edit → re-import to view; Tier 1 = displayed transcript only) | **Codex** | P2 | ✅ shipped v0.2.32 (Tier 1; Messages import view-only) |
| Q | Quick-wins: discounted-price bug (unode group_ratio), per-agent context % in Dashboard | Codex | P2 | ⬜ verify |

**v0.3.0 ships when:** Solo + Terminal-Phase-1 + OpenRouter + @-context + (Todo or diagnostics) are in and green. The rest can trail into v0.3.x.

> **Status:** v0.3.0 gate **MET** — Solo ✅ · Terminal ✅ · OpenRouter ✅ · @-context C1 ✅ · Todo C3 ✅.
> A **v0.3.0 release candidate** is committed on main (`cef1706`, version bumped, CHANGELOG written,
> bundle built, 516 tests green). `vsce publish` + tag are **held for Codex's final check**; once
> cleared, Claude publishes + tags. (C2 IDE diagnostics is now optional polish for v0.3.x, not a gate.)

---

## 3. v0.4.0 — "Trust + the team actually parallel"
Goal: users dare to let agents write code (one-click undo) and the multi-agent team visibly delivers parallel speed.

| # | Item | Owner | Pri |
|---|------|-------|-----|
| V1 | **Checkpoints / Restore** (per-write before/after snapshot; restore file to pre-edit content) — biggest trust gap | **Claude** | P0 ✅ on main (`cebf2d1`) — MVP: WorkspaceTools writes; restore via `roam.restoreCheckpoint`. |
| V2 | **Write-file approval** (preview diff → approve/deny, symmetric with command approval; pairs with checkpoints) | **Claude** | P0 ✅ on main (`2aee5ed`) — `roam.writeApproval: none\|ask`; diff preview + Approve/Approve-all/Deny. |
| V3 | **Parallel console / Worktree Lite** (visible: which agent owns which files/branch, status, diff, result — Kilo Agent Manager parity) | **Claude** lead + **Codex** assist | P0 — **Phase 1 ✅ on main** (Codex; live status board `ParallelConsoleProvider` + pure `parallelConsoleModel`). Phase 2 (file activity + diffs from CheckpointStore) = Claude next. |
| V4 | **Terminal Phase 2/3** (per-agent named terminals + visibility; background/long-running + terminal observer: dev server stays up, agent reacts to new errors) | **Codex** | P1 |
| V5 | **Agent browser-use** (launch/click/type/scroll + screenshots; local web-app test loop) | **Codex** | P1 |
| V6 | **Shared work memory / project KB** (agents query shared state; reduce PM hand-carrying) | DeepSeek research → **Claude** arch → **Codex** impl | P1 — **v0.5 headline.** research ✅ + **arch ✅ + Codex card ✅** ([task](CODEX_TASK_V6_shared_memory.md)): MVP = append-only `.roam/memory/notes.md` + `memory_note` tool + `<shared_memory>` prompt injection. Codex building (`codex/shared-memory`). |
| V7 | **Semantic codebase indexing** (`semantic_search` for large repos — Kilo parity) | **Codex** | P2 |
| V8 | **Smarter file coordination** (merge/conflict-detect vs hard lock+retry) | **Codex** | P2 |
| EI2 | **Export/Import Tier 2 — load as context** (reset an agent's backend conversation from an edited transcript so it continues from there; builds on snapshot/restore) | Claude | P2 |
| V9 | **L4 escalate-to-user on deadlock** (system-triggered structured choice when L2/L3 exhaust — not LLM-dependent) | Claude | P2 |

**v0.4.0 ships when:** Checkpoints + write-approval + a visible parallel console are in and green.

> ✅ **SHIPPED 2026-06-10 (`v0.4.0`, commit `6572855`).** Checkpoints (V1) + write-approval (V2) +
> live agent metrics in the Team panel (V3, folded in) + interactive command approval by default +
> weak-model robustness (required-arg validation, repeat-failure breaker, **leaked tool-call recovery**)
> + XML tool-calling option (C). 553 tests green; Codex review clean. Marketplace indexing the new build.

> **Gate MET (as of `2aee5ed`):** V1 Checkpoints ✅ · V2 Write-approval ✅ · V3 Parallel Console Phase 1 ✅ —
> 532 tests green. The minimum v0.4.0 bar is reached. Holding the cut to fold in more of the wave (C XML
> tool-calling, V4 terminal Phase 3, V3 Phase 2 diffs) and let the trust features soak via DeepSeek dogfood
> before tagging v0.4.0. Publish decision = user's.

---

### Weak-model robustness (cross-cutting — the cost-arbitrage differentiator)
Surfaced by DeepSeek dogfooding (empty/looping `write_file`). See [[agent-robustness-insight]].
- **A — required-arg validation** (reject missing-param tool calls up front) — ✅ on main (`5174c8f`).
- **B — repeat-failure circuit breaker** (block identical failing calls, end turn) — ✅ on main (`5174c8f`).
- **C — XML/prompt tool-calling mode** (Cline parity; native fn-calling is weak models' weak path) —
  ✅ **shipped on main (`d2493e2`)**. XmlToolProtocol (Codex) + NativeToolProtocol + backend wiring +
  `AgentConfig.toolProtocol: native|xml` + Edit-Agent "Tool calling" dropdown. XML parser hardened to
  accept only declared params (no spurious-arg injection from XML/HTML in a value). 546 tests green.
  **Phase 2 polish (open):** in XML mode the `<use_tool>` markup currently shows in the chat transcript
  (the tool card also renders) — strip/hide it for a clean view. **Next:** DeepSeek dogfoods xml vs native
  on the same task to validate the reliability hypothesis (set an agent to XML in Edit-Agent → Tool calling).

## 4. Backlog / later
- **#9 Marketplace** (Agents / MCP / Skills tabs) — large; design + scope decision first (v0.4 tail / v0.5).
- **#10b ③** split `fetch_url` into its own capability · **#11** lifecycle hooks (PreToolUse/PostToolUse/Stop) · status-bar/output-style polish · i18n/a11y.

## 5. v0.4.0 execution plan (collision-aware waves)

**Gate:** Checkpoints (V1) + write-file approval (V2) + a visible parallel console (V3) — in and green.

**Hot-file rule (avoids the recurring collisions):** **Claude owns `WorkspaceTools.ts` for the whole
V1/V2 window.** Codex's tasks that need a *new tool spec* either land their non-WorkspaceTools mechanics
first (Claude adds the 1–2 specs at merge) or wait. `TerminalManager.ts` = Codex. New view files = Codex.
`extension.ts` = shared, additive-only, Claude merges.

### Wave 1 — start now
- **Claude (on main / `claude/checkpoints`):** **V1 Checkpoints / Restore** — shadow snapshot per
  file-mutating tool use (records *which agent wrote which file* + before/after), compare + restore
  files/restore-task. Touches `WorkspaceTools` (write/edit hook) + new `Checkpoints` module + persistence.
  This also becomes the data source for V3 Phase 2 and for V2's diff preview.
- **Codex (worktree `codex/parallel-console`):** **V3 Parallel Console — Phase 1** (live status board
  from `SessionManager.getAll()`; new `ParallelConsoleProvider`; no WorkspaceTools). → [task card](CODEX_TASK_V3_parallel_console.md)
- **DeepSeek + UnodeAi:** rolling dogfood of v0.3.0 (@-context / Todo / real terminal) + **V6 shared-memory
  research** doc. → [task card](DEEPSEEK_TASK_v04_dogfood_research.md)

> **Rebase note:** V1 landed on main (`cebf2d1`). It touched `WorkspaceTools.ts` + `OpenAICompatBackend.ts`
> + `extension.ts` + `package.json`. Codex (`codex/parallel-console`) should `git rebase main` — its V3 work
> is in new files, so the only overlap is additive `extension.ts`/`package.json` (trivial). Then V3 Phase 2
> can read checkpoint data from `CheckpointStore.list()` (per-agent file edits).

### Wave 2 — after V1 lands (now)
- **Claude:** **V2 Write-file approval** (preview diff → approve/deny, symmetric with command approval;
  reuses V1's diff infra).
- **Codex:** **V4 Terminal Phase 3** (long-running/observer: dev server stays up, agent reacts to new
  errors) — TerminalManager mechanics; Claude adds the 1–2 tool specs at merge.
- **Claude:** **V3 Phase 2** — feed per-agent file activity + diffs (from Checkpoints) into the Console.

### Wave 3 — trust core shipped, then breadth
- **Codex:** **V5 browser-use**, **V7 semantic_search** (build as a separate tool seam / MCP to avoid the
  WorkspaceTools hot file). **Claude:** **EI2 load-as-context**, **V9 L4 escalate-to-user**.
- **V6 shared memory:** DeepSeek research → Claude arch → Codex impl.

> Task cards live in `docs/` (`CODEX_TASK_*.md`, `DEEPSEEK_TASK_*.md`); Claude issues them per task with
> explicit file scopes. This plan + BACKLOG are the only authoritative forward docs. Claude reviews +
> merges every branch to main and is the sole publisher.
