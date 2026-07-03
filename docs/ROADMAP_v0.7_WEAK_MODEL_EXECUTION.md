# Roadmap — Execution Engine for Weak Models (post-0.6.7)

> **Author:** Claude · **Date:** 2026-06-13 · **Trigger:** Codex's strategy analysis (weak-model tooling + Roam vs Kilo/Cline). The authoritative "what's next" for the execution-engine line. Pairs with [BACKLOG.md](BACKLOG.md).

## The thesis (Codex, endorsed)
**Weak model + strong execution framework > strong model + bare chat box.** What a weak model needs is *external structure*: bounded tools, small steps, automatic feedback (diagnostics/lint/test), a hard verification loop, structured output, convention injection, and failure recovery. UnodeAi's product instinct — treat weak models as *workers* the PM/engine decomposes, constrains, feeds context to, auto-checks, and retries — is the correct bet. So the lever to push isn't "more models," it's **Execution Engine + verifier loop + worktree isolation**.

## Competitive standing (honest)
| Dimension | UnodeAi | Kilo Code | Cline |
|---|---|---|---|
| Single-agent coding UX | catching up | strong | strongest |
| Weak-model execution loop | has a base, hardening | strong | strongest |
| **Multi-agent coordination** | **most ambitious: PM + roles + shared memory** | parallel but *independent* agents | teams in SDK/CLI/Kanban, not the VS Code ext |
| Worktree isolation | **shipped 0.6.7 (experimental)** | mature (Agent Manager) | per-card worktrees (Kanban) |
| Auto-merge / PM review | **the differentiator, in progress** | diff/review/apply/PR | checkpoints / human-driven |
| Maturity | early, fast-moving | more mature | most mature/largest ecosystem |

**Read:** UnodeAi isn't yet a mature replacement for Kilo/Cline on single-agent polish. Its **right to win is the orchestrated, *verified* multi-agent team runtime** — isolation **+** PM coordination **+** auto-merge **+** shared memory **+** a verifier gate. Kilo has isolation without coordination; Cline has the best single agent without in-editor teams. That lane is real and unclaimed.

## Prioritized plan

### P0 — Worktree fan-out (SHIPPED 0.6.7, experimental)
Isolation + merge-to-integration + review board + finalize, all wired. **Remaining gate:** the live extension-host smoke ([WORKTREE_FANOUT_SMOKE.md](WORKTREE_FANOUT_SMOKE.md)). Git mechanics already proven by a real-git integration test.

### P1 — Verifier-as-completion-gate ⭐ (the highest-leverage NEW item)
Today `roam.engine.verifyObligation` only *nudges* and marks "⚠ Changes not verified" — it never blocks. Codex's priority 3: **make project verification (build/lint/test via `ProjectConventions`) a completion condition, not a hint.** The framework should not accept unverified work.
- **Compose with worktree (the killer combo):** a worker's branch **does not merge to `roam/integration` unless it verified** (or the PM/user explicitly overrides). Surface per-lane verification status in the review board (✓ verified / ✗ failing / ⚠ unverified).
- **Shared mode:** a turn that wrote files but failed/skipped checks is reported to the PM as *blocked*, not silently `task.complete`.
- **Why #1:** it's the single biggest weak-model reliability lever AND it's the differentiator made concrete — "a Roam crew only lands work that passes your project's own checks." Neither Kilo nor Cline gate the *team* merge on verification.

### P2 — Tighter worker protocol for weak models (Codex priority 4)
Push tasks toward "small, constrained, verifiable": one-file/one-subtask steps, stronger tool-boundary prompts, a structured todo the worker must advance, and the existing failure-recovery (empty-retry, model up/down-shift, re-read-on-conflict). Extends `workerComplianceProtocol` + the command-normalizer + the not-found-hint already shipped (see [[agent-robustness-insight]]).

### P3 — Trust UI (Codex priority 5)
Make the safety legible: review-board **Phase 2** (per-file/inline diffs + verification status + conflict view per lane), **checkpoint** visibility/restore UX (toward Cline's shadow-git confidence), and clear terminal/merge-conflict surfacing. "Unleash a parallel crew and just review the result" only works if the result is one glance away.

### P4 — Continuous / lower
Solo fan-out (worktree sub-agents); hosted-catalog growth (0.6.1a vehicle); checkpoint parity with Cline's shadow-git model.

### Post-0.7.0 — UnodeAi in the VS Code **Chat panel** (`@roam`) — decided 2026-06-14, deferred until after 0.7.0
**The ask (张):** "VS Code 的 chat 面板里能选 Claude Code、Codex,为什么不能有 UnodeAi?" — i.e. UnodeAi should be a first-class entry in the native Chat panel, not only its own activity-bar view container.

**Decision:** worth doing as a **discoverability / acquisition** lever (meet users where they already are), but it does **not** deepen the moat — so it sequences **after P1 verifier-gate (0.7.0)**.

**How (path B from the Copilot analysis):** register a Chat Participant — `vscode.chat.createChatParticipant` + `contributes.chatParticipants` (`roam.crew`). The stable public API; Claude Code / Codex use VS Code's chat extension APIs (the newer agent/session-picker entry is a separate, less-stable API — participant is the baseline).

**Key design decisions (so we don't re-derive them):**
- **Route to Roam's OWN backend, not the chat's model.** The participant handler is just a callback — inside it we ignore the chat-provided model and dispatch to our `SessionManager` / PM (Roam gateway, cheap multi-agent). The Chat panel becomes pure I/O. → chat-panel presence **without** giving up the cost-arbitrage moat.
- **Front door, not replacement.** `@roam <goal>` starts the PM, streams progress + a consolidated summary inline, and offers an **"Open in UnodeAi"** action to jump to the full Team view. Don't try to cram the parallel/visual multi-agent richness (per-agent transcripts, worktree lanes) into one linear chat stream.
- **De-risk with a half-day spike first:** confirm (1) `@roam` appears + is invoked in the Chat panel, and (2) the handler can route to Roam's backend and stream results back — before building the full PM bridge.
- **Where:** new `src/chat/RoamChatParticipant.ts` + `contributes.chatParticipants`; bridge to `SessionManager` (reuse `ChatViewProvider` orchestration).

## Sequence
0.6.7 smoke → **P1 verifier-gate** (compose with worktree) → P2 worker protocol → P3 trust UI → **Post-0.7.0: `@roam` chat-panel participant** (discoverability). P1 is where I'd point the next focused build the moment the worktree smoke passes — it multiplies the value of everything already built; the chat-panel entry comes after the moat lever lands.
