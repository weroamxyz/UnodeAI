# UnodeAi — v0.3 / v0.4 Roadmap & Competitive Plan

> Planning doc (Claude-maintained). Authority for "now/next" remains [STATUS.md](STATUS.md).
> Inputs: Codex Cline-parity analysis, DeepSeek multi-agent critique, user feedback (2026-06-07),
> and the Cline-family competitors (Cline, Roo Code, Kilo Code).
> Date: 2026-06-07 · Baseline shipped: v0.2.5.

---

## 1. Competitive positioning

| | UnodeAi | Cline | Roo Code | Kilo Code |
|---|---|---|---|---|
| Core model | **Parallel multi-agent team** + cost routing | Single autonomous coder | Single agent w/ **modes** | Single agent, Roo+Cline merge |
| "Roles" | Separate **concurrent** agents (PM/Arch/Dev/Reviewer) | n/a | Modes (Architect/Code/Ask/Debug, custom) | Modes + **Orchestrator** delegates subtasks |
| Review gate | Built-in independent reviewer | manual | manual | manual |
| Providers/gateways | Roam, OpenAI-compat, Claude | many | many incl. **OpenRouter** | many incl. **OpenRouter** |
| Browser use | validation only (Playwright MCP) | **native browser tool** | yes | yes |
| Checkpoints | ❌ | **per-step snapshot/restore** | yes | yes |
| @-context (@file/@url/@problems) | ❌ (rules/memory only) | ✅ | ✅ | ✅ |
| UX maturity | low | high | high | high |
| Installs | ~hundreds | ~4.2M | large | growing |

**The honest read.** Roo/Kilo's "Orchestrator/Boomerang" mode already does *sequential* sub-task
delegation inside one agent — so "multi-step delegation" is no longer unique. UnodeAi's genuine
differentiators are **(a) true parallel persistent agents** and **(b) an independent review gate the
implementer can't sign off**. But today the **serial PM bottleneck makes the team slower than even a
single-agent orchestrator on the 80% of everyday tasks** (DeepSeek P0). So our differentiator is
currently invisible to users.

**Strategic call (most important decision in this roadmap):**
> Ship a first-class **Solo mode** — one agent running the full Cline-style loop (read → edit → run →
> observe → iterate) — as the **default for simple asks**, with the multi-agent **Team mode** as an
> opt-in for complex, multi-file work. Then fix Team mode's parallelism so when it *is* used it
> actually delivers its theoretical advantage.

Positioning line (don't claim "better Cline"): **"Cline-class solo coding, plus an optional AI team
with real review gates and per-role cost routing."**

---

## 2. Triage — everything on the table

Buckets: 🐞 bug · ⚡ quick win · 🅥3 v0.3 · 🅥4 v0.4 · 🅑 backlog. P0/P1/P2 = urgency.

### Bugs / quick wins (fold into the next patch, v0.2.6/v0.3.0)
| Item | Source | Notes |
|---|---|---|
| 🐞 Quick Start label says "PM+Dev+QA" but creates PM+Arch+Dev+Reviewer | user #2 | Align label to the 4 real roles ("PM + Architect + Developer + Reviewer"). Fix command title + Team empty-state card + onboarding wizard text. |
| 🐞 Live price shows list price, not the user's discounted price | user #3 | `LivePriceService` converts `model_ratio×2` but never applies the new-api **group_ratio / user discount**. Needs: check if unode `/api/pricing` exposes group ratios; if discount is per-user, may need an authed endpoint. P1. |
| ⚡ "Thinking…" indicator + live status before first token | user #7 | Chat shows nothing until output starts → looks frozen. Show an animated "thinking…" state on turn start, stream status/tool steps. **High-impact UX, P0.** |
| ⚡ Per-agent context limit + usage in dashboard | user #5 | We have the context bar in chat (C3b); surface the same per-agent (limit + % used) in the Dashboard/Team panel. |
| ⚡ Quick Start should be PM+Arch+Dev+QA (label intent) | user #2 | same fix as the label bug. |

### v0.3.0 — "Cline-class parity + onboarding polish"
| Item | Source | Notes |
|---|---|---|
| 🅥3 **Solo / Fast mode** (single-agent full loop, default for simple tasks) | DeepSeek P0 #1/#2, Codex | The headline. A "fast path" that skips Arch→Review for small asks. |
| 🅥3 More gateways (OpenRouter + others) | user #1 | Add OpenRouter (huge model aggregator) + a few: Together, Groq, Fireworks, DeepSeek-direct, OpenAI, Anthropic, Gemini, Ollama/LM Studio (local). Provider registry + UX. |
| 🅥3 **MCP Setup Wizard** (GitHub / Playwright / Filesystem templates) | Codex, user #4 | Keep default-deny; add guided "Add MCP server": shows access, pick agents, Claude "whole-server" note, prompts for token, test connection. |
| 🅥3 @-context inputs (@file / @folder / @problems / @url) | Codex, Cline | Lightweight context attach in chat composer. |
| 🅥3 Streaming/thinking UX (full) | user #7 | Beyond the indicator: stream intermediate tool steps + reasoning summary. |
| 🅥3 More default teams (Business Planning / Business Analyst / Financial Analyst) | user #6 | Expands beyond coding → general "AI team" templates. Content + role templates. |
| 🅥3 Default MCP set? | user #4 | Decision: **do not auto-mount**; ship the wizard + curated templates instead (safety). |

### v0.4.0 — "Trust + the team actually parallel"
| Item | Source | Notes |
|---|---|---|
| 🅥4 **Checkpoints / restore** (per-step workspace snapshot, compare, one-click revert) | Codex, DeepSeek P2 #9, Cline | Biggest trust gap. |
| 🅥4 **Parallel task dispatch** (PM fans out independent tasks; agents stop idling) | DeepSeek P0 #1 | Make Team mode deliver its promise. |
| 🅥4 **Agent browser-use + terminal observer** (interactive, not just validation) | Codex, Cline | End-to-end dev loop: dev server stays up, agent reacts to new output/errors. |
| 🅥4 Shared work memory / context across tasks | DeepSeek P1 #5 | Reduce PM hand-carrying; agents query a shared project KB. |
| 🅥4 Agent-to-agent direct Q&A (PM arbitrates, not relays) | DeepSeek P1 #4 | |
| 🅥4 Smarter file-coordination (merge / conflict detect vs hard lock+retry) | DeepSeek P0 #3 | |

### Backlog
- File-level diff preview + one-click accept/reject (DeepSeek P2 #9) — partly subsumed by checkpoints.
- PM as single point of failure → review PM's contracts (DeepSeek P1 #6).
- Flexible/role-light teams; learning user style/preferences (DeepSeek P2 #7/#8).
- Enterprise (SSO, audit, policy, self-host), CLI/SDK/JetBrains — long-term ecosystem (Codex).

---

## 3. My opinions (where I agree / push back)

- **Agree (strongly):** the #1 problem is that every task pays multi-agent overhead. Solo mode is the
  single highest-leverage change. Without it, parity reviews will always rate us "slow."
- **Push back on positioning:** "multi-agent" alone is no longer a moat (Roo/Kilo Orchestrator does
  sequential delegation). Our moat is **parallelism + an enforced independent review**. Lead with
  *quality + speed via parallelism + cost routing*, not "we have many agents."
- **Agree:** keep MCP default-deny (Codex). Don't auto-mount GitHub/Playwright. The gap is *guidance*,
  not safety — ship the MCP Setup Wizard.
- **On user #7 (thinking indicator):** this is cheap and disproportionately important for perceived
  quality. It should jump the queue into v0.2.6 / early v0.3 — a frozen-looking chat reads as "broken"
  to first-time users regardless of how good the engine is.
- **On default teams (#6):** the Business/Analyst/Financial teams are a smart wedge — they push Roam
  Crew beyond "coding tool" into "AI team for knowledge work," where the multi-agent story is more
  naturally compelling and competitors (coding-only) don't play. Low effort, high differentiation.
- **On gateways (#1):** OpenRouter is the must-have (one key → hundreds of models); the rest are
  incremental. Prioritize OpenRouter + the provider-picker UX over breadth for breadth's sake.
- **Sequencing risk:** checkpoints, parallel dispatch, and browser/terminal are each real epics — do
  NOT cram them into v0.3. v0.3 = parity polish + Solo mode; v0.4 = trust + true parallelism.

---

## 4. Proposed immediate next step (v0.2.6 quick-wins patch)

Small, high-impact, low-risk — ship before the big epics:
1. 🐞 Quick Start label → "PM + Architect + Developer + Reviewer" (everywhere).
2. ⚡ "Thinking…" indicator + live status in chat (user #7).
3. ⚡ Per-agent context limit + usage in Dashboard/Team panel (user #5).
4. 🐞 Investigate the discounted-price bug (#3) — confirm what unode `/api/pricing` exposes.

Then v0.3.0 proper: Solo mode + OpenRouter + MCP Setup Wizard + @-context + more default teams.
