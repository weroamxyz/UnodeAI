# Gap Analysis: Kilo Code & Roo Code vs. UnodeAi

> **Research date:** 2026-06-16  
> **Method:** Public documentation and repo READMEs only (`fetch_url`). No UnodeAi source code was read.  
> **Note:** Roo Code's VS Code extension was shut down on May 15, 2026; the analysis below reflects its documented feature set at shutdown. Kilo Code remains actively developed.

---

## 1. MODES & ORCHESTRATION

| What Kilo/Roo does | What UnodeAi has today | Gap / opportunity | Worth absorbing? (Y/N + why) |
|---|---|---|---|
| **Kilo Code built-in modes:** README lists `Architect` (plan), `Coder` (code), `Debugger` (debug), plus user-defined custom modes. No public docs describe an in-chat "Orchestrator" mode. (Source: github.com/Kilo-Org/kilocode README, "Key Features") | UnodeAi uses a fixed Project Manager (PM) role that assigns tasks to specialized agents (Developer, QA, Technical Writer, etc.) via `assign_task`. Roles are chosen at crew startup; there is no in-session mode switch. | Kilo exposes lightweight, user-switchable personas inside a single chat. UnodeAi's orchestration is heavier and less interactive for the end user. | **Y** — Allowing users to switch an agent's mode mid-session (e.g., plan → code → debug) with sticky model preferences reduces context rebuild cost and improves UX. |
| **Roo Code built-in modes:** `Code`, `Architect`, `Ask`, `Debug`, and `Orchestrator` (🪃 Boomerang Mode). Each mode has a pinned tool-access group (`read`, `edit`, `command`, `mcp`) and sticky model selection. Users switch via dropdown, slash commands (`/code`, `/architect`, `/debug`, `/orchestrator`), or keyboard shortcut. (Source: roocodeinc.github.io/Roo-Code/basic-usage/using-modes) | Same as above: PM-led crew with fixed roles and shared workspace. | Roo's mode system is more granular than UnodeAi's role system. Ask mode is read-only; Architect can edit only markdown. These safety boundaries are enforced by tool-group permissions. | **Y** — Per-mode tool restrictions (e.g., read-only reviewer, markdown-only architect) are a low-cost safety layer UnodeAi could add on top of its agent roles. |
| **Roo Orchestrator / Boomerang:** The Orchestrator mode has **no direct tool access** by design. It breaks complex work into subtasks and delegates them to other modes using the `new_task` tool. The parent task pauses; the subtask runs in an isolated context and returns only a completion summary via `attempt_completion` → `result`. (Source: roocodeinc.github.io/Roo-Code/features/boomerang-tasks) | UnodeAi agents share a single workspace and conversation context; subtasks are assigned by the PM and communicate via `send_message`. There is no formal pause/resume subtask boundary. | Roo's boomerang pattern keeps the parent context clean ("context poisoning" prevention) but requires explicit hand-offs. UnodeAi's shared context is simpler but risks stale or noisy state. | **Y** — A "boomerang" fast path for self-contained subtasks would reduce PM overhead without breaking the shared-workspace model. |
| **Kilo in-chat orchestrator:** **UNCONFIRMED** — Kilo's public docs do not describe a single-chat orchestrator that delegates and resumes. The Agent Manager runs parallel sessions, but they are independent (no parent/child task hierarchy, no shared memory). (Source: kilo.ai/docs/automate/agent-manager) | UnodeAi's PM maintains a global plan and coordinates the whole crew lifecycle. | If Kilo lacks orchestrated delegation, UnodeAi's PM model remains a differentiator. | **N** — No feature to absorb until Kilo documents it. Continue investing in the PM coordinator. |
| **Custom modes:** Both Kilo and Roo let users define custom modes/agents via config files. Roo uses `.roomodes` / `custom_modes.yaml` with `roleDefinition`, `whenToUse`, `groups`, and `customInstructions`. Kilo uses `.kilo/agents/*.md` with YAML frontmatter. (Sources: roocodeinc.github.io/Roo-Code/features/custom-modes; github.com/Kilo-Org/kilocode repo tree) | UnodeAi defines agents/roles in `agents.json` and maps skills via capability tokens. | Markdown + YAML frontmatter for agent definitions is more version-control-friendly and readable than JSON metadata. | **Y** — Adopt markdown-based agent/skill definitions (frontmatter for config, body for prompt) to make roles easier to author and review. |

---

## 2. PARALLEL AGENTS & GIT WORKTREES (CRITICAL — cite exact sources)

| What Kilo/Roo does | What UnodeAi has today | Gap / opportunity | Worth absorbing? (Y/N + why) |
|---|---|---|---|
| **Kilo Code — Agent Manager (CONFIRMED):** Kilo's Agent Manager runs "multiple parallel sessions, each in its own git worktree" under `.kilo/worktrees/` on separate branches. It supports Multi-Version Mode: up to 4 parallel implementations of the same prompt across separate worktrees, optionally with different models. (Source: kilo.ai/docs/automate/agent-manager) | UnodeAi can assign tasks to multiple agents concurrently, but all agents work on the **same git branch** in the same workspace. | Kilo has filesystem-level isolation for parallel agents; UnodeAi agents can overwrite each other's files or create merge conflicts on the shared branch. | **Y** — This is UnodeAi's biggest safety gap. Per-agent git worktrees are essential before scaling parallel crews. |
| **Who creates worktrees:** Kilo's extension creates managed worktrees automatically when the user clicks "New Worktree" or invokes the `agent_manager` tool in `worktree` mode. Roo's worktrees are created by the user through Settings → Worktrees. (Sources: kilo.ai/docs/automate/agent-manager; roocodeinc.github.io/Roo-Code/features/worktrees) | UnodeAi does not create worktrees or branches for agents. | UnodeAi can automate worktree creation as part of `assign_task`, not leave it to the user. | **Y** — Auto-provisioning a worktree per agent/task-group fits the PM-led automation model. |
| **Merge-back & conflicts:** Kilo provides a diff/review panel and an **"Apply to local"** button to copy a worktree's changes onto the base branch; conflicts surface in a resolution dialog. Closing a managed worktree deletes its checkout directory and local branch. **No auto-merge.** (Source: kilo.ai/docs/automate/agent-manager) | UnodeAi has no automated merge-back because all agents share one branch. | Kilo stops at manual merge. UnodeAi could go further: agent completes → auto-merge worktree → PM verifies → commit to main. | **Y** — Automated merge loop is a natural extension of UnodeAi's PM orchestrator and would leapfrog Kilo. |
| **Roo Code worktrees (CONFIRMED):** Roo supports git worktrees as a first-class feature. Each worktree opens in its own VS Code window with its own Roo instance, enabling "parallel development on different branches." `.worktreeinclude` copies untracked files (e.g., `node_modules`, `.env`) across worktrees. (Source: roocodeinc.github.io/Roo-Code/features/worktrees) | Same as above: no worktree isolation. | Roo's worktrees are user-driven and window-based, not agent-orchestrated. | **N for Roo's exact UX** — UnodeAi should not copy the "new VS Code window per worktree" model; it should keep worktrees invisible and managed by the PM. |
| **Isolation if not worktrees:** Both Kilo and Roo **do** use git worktrees as the isolation mechanism. Kilo also runs each session with its own integrated terminal and can auto-copy root-level `.env` files via setup scripts. (Source: kilo.ai/docs/automate/agent-manager) | UnodeAi relies on social convention and PM coordination to avoid conflicts. | There is no fallback isolation mechanism today. | **Y** — Adopt worktree isolation as the primary mechanism; do not invent a lighter alternative. |

---

## 3. MCP MARKETPLACE

| What Kilo/Roo does | What UnodeAi has today | Gap / opportunity | Worth absorbing? (Y/N + why) |
|---|---|---|---|
| **Kilo Code advertises an MCP Server Marketplace** as a headline feature: "Kilo can easily find, and use MCP servers to extend the agent capabilities." (Source: github.com/Kilo-Org/kilocode README, "Key Features") | UnodeAi has an MCP approval model: servers must be explicitly approved before an agent can invoke them. There is no discovery layer or marketplace UI. | Kilo signals one-click discovery + install, which lowers friction versus typing JSON configs. | **Y** — A marketplace/catalog would materially improve tool onboarding. |
| **Kilo marketplace mechanics:** **UNCONFIRMED** — No public docs fetched explain how discovery, hosting, or one-click install works. It may be a curated in-extension list, a community index, or simply marketing language. Until docs are available, treat the implementation as unknown. (Source: github.com/Kilo-Org/kilocode README only) | UnodeAi requires manual configuration of MCP servers (command/args/env) and per-tool approval. | Without confirmed details, UnodeAi should not blindly copy Kilo. A simple curated JSON registry with auto-generated configs is a defensible, low-risk implementation. | **Y (lightweight version)** — Ship a curated MCP catalog with one-click "add to crew" and auto-generated config; avoid building a full hosted registry until Kilo's approach is clearer. |
| **Roo Code MCP:** Roo supports MCP servers via manual JSON configuration (global settings or `.roo/mcp.json`). It publishes a "Recommended MCP Servers" page (e.g., Context7) with copy-paste config snippets, but no one-click install or marketplace. (Source: roocodeinc.github.io/Roo-Code/features/mcp/recommended-mcp-servers) | Same as above: manual config + approval. | Roo is weaker than Kilo's advertised marketplace and only slightly ahead of UnodeAi in curation. | **Y** — A curated catalog would put UnodeAi ahead of Roo and on par with or beyond Kilo's advertised experience. |

---

## 4. SKILLS / RULES / MEMORY

| What Kilo/Roo does | What UnodeAi has today | Gap / opportunity | Worth absorbing? (Y/N + why) |
|---|---|---|---|
| **Roo Code — Rules layering:** Global rules (`~/.roo/rules/`), project rules (`.roo/rules/`), and mode-specific rules (`.roo/rules-{modeSlug}/`). Files are loaded recursively, sorted alphabetically, and appended to the system prompt. Also supports `.roorules` fallback and `AGENTS.md`. (Source: roocodeinc.github.io/Roo-Code/features/custom-modes) | UnodeAi uses a single `.roam/rules.md` file for project-wide rules. There is no global or role-specific rule layering. | Roo's hierarchy lets teams enforce global standards while allowing project and mode overrides. | **Y** — Replace the single `.roam/rules.md` with a layered rules directory (`.roam/rules/` + `.roam/rules-{role}/`) for better scalability. |
| **Roo Code — Skills (progressive disclosure):** Skills are instruction packages in `.roo/skills/{skill-name}/SKILL.md` (project) or `~/.roo/skills/` (global). Only the frontmatter (`name`, `description`) is indexed at startup; the full skill body is loaded on-demand when the user request matches the description. Mode-specific skills via `skills-{mode}/`. (Source: roocodeinc.github.io/Roo-Code/features/skills) | UnodeAi maps Skills → capability tokens in `skills.json`/`agents.json`. Rules appear to be loaded broadly rather than matched on-demand per request. | Roo's progressive disclosure keeps the system prompt lean. In a multi-agent crew, loading every skill into every agent context is expensive. | **Y** — On-demand skill loading directly supports UnodeAi's cost-arbitrage moat by reducing token burn. |
| **Kilo Code — Skills / rules:** The repo contains a `.kilocode/skills/vscode-visual-regression` directory, and the README mentions custom modes. KiloClaw links to Clawhub for skill search. **UNCONFIRMED** — no public docs fetched explain Kilo Code's skill-loading model, progressive disclosure, or rules directory structure. (Sources: github.com/Kilo-Org/kilocode repo tree; kilo.ai/docs/kiloclaw/overview) | Same as above: skills.json marketplace + capability tokens. | Until Kilo documents its model, UnodeAi should lead by implementing progressive disclosure itself rather than copying an unknown design. | **N** — No confirmed Kilo model to absorb. Build the progressive disclosure pattern independently. |
| **Roo Code — Checkpoints:** Roo uses a **shadow Git repository** to snapshot workspace state before file modifications during a task. Users can view diffs and restore to any checkpoint (files only, or files + conversation). Checkpoints are task-scoped and automatic. (Source: roocodeinc.github.io/Roo-Code/features/checkpoints) | UnodeAi has no automatic checkpointing. Agents edit files directly; rollback is manual (`git revert`) or absent. | In a multi-agent shared workspace, a rogue or conflicting edit is more dangerous than in single-agent tools. Checkpoints are a safety net. | **Y** — Shadow-git checkpoints before agent edits are a must-have for multi-agent safety. |
| **Memory:** UnodeAi uses `memory_note` and a shared team memory file (`.roam/memory/notes.md`). Kilo docs do not describe an equivalent shared memory system for Agent Manager sessions (they are isolated). Roo does not document a shared memory bank beyond checkpoints and rules. | UnodeAi's explicit shared memory is already a coordination advantage. | Shared memory is a differentiator when combined with worktree isolation. | **N** — Do not replace shared memory; keep it and make it available across worktrees. |

---

## Top-3 Recommendations

> Ranked by **(user impact × fit with UnodeAi's multi-agent / cost-arbitrage moat)**

### 1. Add git worktree isolation for parallel agents, then automate the merge loop
**Rationale:** This is UnodeAi's clearest capability gap. Kilo's Agent Manager already proves the value of running parallel agents each in their own worktree (`.kilo/worktrees/`), and Roo documents the same primitive. However, both tools stop at **manual** merge-back: the user must click "Apply to local" or open a PR. UnodeAi's PM-led architecture is uniquely positioned to go further: spawn a worktree per agent or task-group, let agents work in isolation, then have the PM auto-merge results, resolve conflicts, and commit to main. That combination — **isolation + coordination + auto-merge** — is something neither Kilo nor Roo ships today. It is high user impact (prevents agents from stomping on each other) and high moat fit (leverages the PM orchestrator that single-agent tools cannot easily replicate).

### 2. Implement on-demand skill loading (progressive disclosure)
**Rationale:** Roo Code's Skills architecture indexes only `name` + `description` at startup and loads the full `SKILL.md` only when the user's request matches. In a multi-agent crew where every role may carry dozens of skills, loading all rules into every context is prohibitively expensive. Progressive disclosure lets UnodeAi support a large skill library without ballooning token costs. This is a direct fit with the cost-arbitrage moat: cheaper, faster, more focused agents. It is medium-to-high user impact (agents stay on-task) and very high moat fit.

### 3. Ship a lightweight MCP registry / marketplace
**Rationale:** Kilo advertises an MCP marketplace but provides no public implementation details; Roo has only manual config and a recommended-servers page. UnodeAi can leapfrog both with a curated MCP catalog — even a simple JSON index with metadata, auto-generated server config, and per-crew approval. This is medium user impact (saves setup time for power users) but high moat fit: in a multi-agent system, the PM needs to know which agents have which tools, and a registry with cost/rate-limit metadata enables smarter task assignment. It also differentiates UnodeAi from single-agent tools that do not need centralized tool governance.

---

## Sources

- Kilo Code repository: https://github.com/Kilo-Org/kilocode
- Kilo Code docs homepage: https://kilo.ai/docs
- Kilo Code Agent Manager: https://kilo.ai/docs/automate/agent-manager
- KiloClaw overview: https://kilo.ai/docs/kiloclaw/overview
- Roo Code repository: https://github.com/RooCodeInc/Roo-Code
- Roo Code docs: https://roocodeinc.github.io/Roo-Code/
- Roo Code "Using Modes": https://roocodeinc.github.io/Roo-Code/basic-usage/using-modes
- Roo Code "Customizing Modes": https://roocodeinc.github.io/Roo-Code/features/custom-modes
- Roo Code "Boomerang Tasks": https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks
- Roo Code "Worktrees": https://roocodeinc.github.io/Roo-Code/features/worktrees
- Roo Code "Skills": https://roocodeinc.github.io/Roo-Code/features/skills
- Roo Code "Checkpoints": https://roocodeinc.github.io/Roo-Code/features/checkpoints
- Roo Code "MCP Overview": https://roocodeinc.github.io/Roo-Code/features/mcp/overview
- Roo Code "Recommended MCP Servers": https://roocodeinc.github.io/Roo-Code/features/mcp/recommended-mcp-servers
