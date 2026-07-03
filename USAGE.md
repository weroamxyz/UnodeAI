# UnodeAi User Manual

Version covered: UnodeAi 0.9.11

Product: Multi-model AI team extension for VS Code

UnodeAi lets you run a team of AI agents inside VS Code. Each agent has its own role, model, tools, chat history, and safety policy. You can work with one agent directly, run a coordinated PM-led crew, or use deterministic workflows for repeatable processes.

The default **Roam** provider uses the OpenAI-compatible Roam gateway (weroam) at `https://ai.weroam.xyz/v1`, with its own API key (`ROAM_API_KEY`). Live model and pricing information is at `https://ai.weroam.xyz/pricing?lang=en`.

## 1. Install UnodeAi

### From the VS Code Marketplace

1. Open VS Code.
2. Open Extensions.
3. Search for `UnodeAi`.
4. Install the extension.
5. Reload VS Code if prompted.

### From a VSIX

1. Open Extensions.
2. Choose `Install from VSIX...`.
3. Select the UnodeAi `.vsix` file.
4. Reload VS Code.

### From source

For contributors:

```bash
npm install
npm run build
```

Then press `F5` in VS Code to launch an Extension Development Host.

UnodeAi requires VS Code 1.93 or newer.

## 2. First-Time Setup

### Run the setup wizard

Open the Command Palette and run:

```text
UnodeAi: Run Setup Wizard
```

The wizard helps you set a provider key, create a starter crew, and run a demo task.

### Store your API key

Run:

```text
UnodeAi: Set Provider API Key
```

Choose the secret name for your provider:

| Provider | Secret name |
|---|---|
| Roam gateway (weroam, default) | `ROAM_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic / Claude | `ANTHROPIC_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Custom OpenAI-compatible gateway | `CUSTOM_API_KEY` |

Secrets are stored in VS Code SecretStorage. They are not written to `.roam/team.json`, settings files, chat exports, or source control.

**Zero data retention & no telemetry.** UnodeAi itself keeps no copy of your code or prompts and has no analytics, tracking, or phone-home of any kind. Chat history, team config, and keys all stay on your machine; your code is sent only to the model provider you configure (nothing else). Because UnodeAi works with any OpenAI-compatible endpoint, you can point it at a self-hosted / in-VPC model for provable, end-to-end zero-retention.

**Don't have an account or credits yet?** The **Providers** tab of UnodeAi Settings has a sign-up / top-up button that opens registration in your browser — **Roam Gateway** ([ai.weroam.xyz](https://ai.weroam.xyz/login?lang=en)). Create an account, top up, then paste your key above.

## 3. Create a Team

Open the UnodeAi sidebar from the Activity Bar.

If the workspace is empty, choose `Create a Team`. You can also run:

```text
UnodeAi: Create or Switch Team
```

### Default software crew

The default crew is:

| Agent | Main purpose |
|---|---|
| Project Manager | Breaks down work, delegates tasks, tracks progress, runs checks, and coordinates review |
| System Architect | Designs public contracts, architecture, boundaries, and ownership maps |
| Senior Developer | Implements production code and tests |
| Reviewer | Independently reviews work and returns PASS or FAIL |

### Additional built-in roles

You can add individual agents with:

```text
UnodeAi: Add Agent
```

Common roles include Product Manager, QA Engineer, DevOps Engineer, Technical Writer, Security Engineer, Data Engineer, Reviewer, and Solo.

### Knowledge-work presets

The team picker also includes presets for business planning, business analysis, and financial analysis. These use the same PM orchestration model with non-code specialist roles.

### Build your own agent

Run `UnodeAi: Build an Agent` (or use the Team panel) to open the **Agent Builder** — a form where you create or edit a custom agent without touching JSON:

- **Identity** — name, role (a built-in template or a custom one like *CEO*), and an icon (preset or any `$(codicon)`).
- **Model** — pick from the **full live model list with prices** (on the Roam gateway these show your **discounted** rate); set a **backup model** and the **tool-calling method** (Native / XML).
- **Model fine-tuning** — per-agent sampling/reasoning settings (temperature, top-P, max output tokens, reasoning effort, presence/frequency penalty). Leave a field blank to use the global default. These are the same values the Settings panel shows for this agent, so the two stay in sync.
- **Smart Mode tier** — a per-agent tier override (Premium / Standard / Economy, or "Use role default"). When Smart Mode is on, this agent runs on the model mapped to its tier — so two same-role agents can run at different tiers. The tier→model mapping itself is global (Settings → Smart Mode).
- **Instructions** — write the agent's system prompt.
- **Skill playbooks** — attach up to **5** market-proven playbooks from the skill library; they're folded into the agent's instructions so it arrives knowing how to do the job. Need more than the in-app set? The builder links out to the full skill library.
- **MCP grants** — give the agent access to registered MCP servers (or add a new one).

Save, and the agent joins your team like any preset — ready to chat with or be delegated to by the PM.

## 4. Use Solo Mode

Solo mode is the fast path for simple tasks where a full team would be too much overhead. It creates or selects one generalist agent that works directly with you.

Run:

```text
UnodeAi: Solo Agent (toggle)
```

Use Solo for small edits, quick explanations, one-file fixes, or focused code tasks. Use a full team when you want planning, parallel specialists, independent review, or a verification loop.

## 5. Chat With Agents

Open the Chat panel or run:

```text
UnodeAi: Open Chat with Agent
```

Pick an agent from the selector, type your request, and send it.

The Chat panel supports:

| Feature | What it does |
|---|---|
| Live streaming | Shows replies as they arrive |
| Stop | Interrupts a running turn |
| Steer | Sends an extra instruction to a running agent |
| Plan / Act mode | Controls whether tools are available |
| Tool cards | Shows file reads, writes, commands, MCP calls, diffs, and outputs |
| Analysis cards | Shows model reasoning streams when available |
| Context meter | Shows approximate context use |
| Todo panel | Shows PM task plans from `update_todos` |
| Command/write approvals | Lets you approve risky actions in the chat |
| Export/import | Saves or restores a selected agent's chat transcript |
| Compact mode | Compresses the chat view for dense workflows |

### Plan mode

Plan mode is for analysis only. The extension removes write, command, delegation, and MCP tools at the tool layer for OpenAI-compatible agents. This is stronger than a prompt instruction.

Use Plan when you want a review, estimate, architecture discussion, implementation plan, or risk analysis without changes.

### Act mode

Act mode lets an agent use its allowed tools. Depending on your settings, it may read files, write files, run approved commands, delegate to teammates, or use approved MCP tools. Agents can also **`apply_edit`** (a targeted edit — replace an exact snippet instead of resending the whole file; goes through the same checkpoint/approval safety path), **`search_files`** (regex/text → `file:line`, so they find code instead of writing scratch scripts) and **`delete_file`** (sandboxed and checkpointed, so a removal is restorable) — all stay inside the working folder.

**Works with any model's tool names.** Roam runs many models, and each is trained on its own harness's tool names. When a model calls `Read` / `Bash` / `Write` / `Edit` / `LS` / `Grep` / `Task` (from Claude Code, Cursor, GPT, and others), Roam transparently maps it to the matching Roam tool and arguments — so a model's muscle memory just works rather than failing with "unknown tool".

Use Act when you want the agent to do the work.

### Use @roam in the VS Code Chat panel

UnodeAi also appears in the native VS Code **Chat panel** as `@roam`, in addition to its own sidebar — both run at the same time. In the Chat panel, type:

```text
@roam add a password-reset flow with tests
```

Your crew's Project Manager picks up the goal, delegates, and streams the run back into the chat. Use the **Open in UnodeAi** button to jump to the full team view (per-agent transcripts, worktree lanes, the review board).

`@roam` runs on **your configured UnodeAi agents and models** — not the Chat panel's model — so you keep the multi-agent orchestration and cheap-model cost arbitrage. You need at least one team (run `UnodeAi: Create Default Team` first).

Turn it off with the setting `roam.chatParticipant.enabled` if you want UnodeAi only in its sidebar.

## 6. Run a PM-Led Crew

For complex work, chat with the Project Manager.

A strong PM prompt includes:

```text
Goal: Add password reset to the app.
Scope: Backend route, email token model, UI form, tests.
Constraints: Do not change auth providers. Use the existing email service.
Verification: Run npm test and npm run build.
```

The PM can:

1. Create a task plan.
2. Ask the Architect for public contracts and file ownership.
3. Assign work to specialists.
4. Run independent tasks in parallel when files do not overlap.
5. Run `run_checks` using `roam.verifyCommand`.
6. Route failures back to the right teammate.
7. Ask the Reviewer for a final PASS or FAIL.
8. Summarize the outcome for you.

The Messages panel shows cross-agent activity such as assignments, completions, broadcasts, and workflow events.

## 7. Run Workflows

Workflows are deterministic role-to-role pipelines. They are useful when you want a repeatable process instead of dynamic PM planning.

Run:

```text
UnodeAi: Run Workflow
```

Built-in workflows include:

| Workflow | Steps |
|---|---|
| Code Review Pipeline | Senior Developer -> Tester -> Security |
| Feature Implementation | Architect -> Senior Developer -> QA |
| Bug Fix Pipeline | Senior Developer -> Tester |
| Documentation Generation | Senior Developer -> Technical Writer |
| Feature (Gated, cost-optimized) | Architect -> Senior Developer -> `run_checks` gate -> QA |

To customize workflows, run:

```text
UnodeAi: Edit Workflow
```

Custom workflows are saved with the team configuration.

## 8. Marketplace

Open the Marketplace with:

```text
UnodeAi: Open Marketplace
```

The Marketplace has two tabs:

| Tab | Purpose |
|---|---|
| Agents | Add curated agent presets to a team |
| MCP | Add Model Context Protocol servers and route them through approval |

**Members come equipped.** Skills aren't a separate store — each agent preset carries its own skill **playbooks** (e.g. the Security Auditor ships with OWASP Top 10 review and dependency-risk triage). An agent card shows what it **Includes**, and when you add the member those playbooks are folded into its instructions automatically.

The bundled catalog lives in `marketplace/agents.json`, `marketplace/mcp.json`, and `marketplace/skills.json`.

If `roam.marketplace.catalogUrl` is set and `roam.marketplace.fetchCatalog` is enabled, UnodeAi can merge a hosted catalog with the bundled catalog. If the hosted fetch fails, the bundled catalog still works.

## 9. Team Rules and Memory

Team Rules are saved in:

```text
.roam/rules.md
```

Open the editor with:

```text
UnodeAi: Edit Team Rules
```

Rules are injected into every agent's instructions and refreshed every turn. Use them for project conventions, non-negotiable constraints, coding standards, review requirements, and known architecture facts.

Example:

```markdown
# Team rules

- Follow the existing project style.
- Do not add dependencies without asking.
- Run npm test before reporting code work complete.
- Keep PM tasks scoped to non-overlapping file sets when using parallel agents.
```

## 10. Settings

Open the UnodeAi settings panel with:

```text
UnodeAi: Open Settings
```

### Provider settings

Use the Providers tab to see which provider keys are set. Secret values are never displayed.

Important provider settings:

| Setting | Default | Purpose |
|---|---|---|
| `roam.defaultProvider` | `roam` | Provider used for new agents |
| `roam.baseUrl` | `https://ai.weroam.xyz/v1` | Roam OpenAI-compatible gateway URL |
| `roam.modelCatalogUrl` | empty | Optional hosted model catalog |
| `roam.modelPrices` | `{}` | Manual price overrides |
| `roam.pricingSources` | `[]` | Extra pricing sources |
| `roam.priceGroup` | empty | Billing group for displayed prices |

### Model tuning

Each agent can have its own model parameters:

| Parameter | Notes |
|---|---|
| Temperature | Lower for code/review, higher for writing/brainstorming |
| Top P | Nucleus sampling control |
| Max tokens | Output budget |
| Reasoning effort | Optional; leave blank unless the model supports it |
| Response format | Optional `text` or `json_object` for compatible models |
| Stop sequences | Optional custom stopping strings |
| Context window | Per-agent context budget hint |

Some parameters are not available for all backends. The UI disables fields that do not apply.

### Smart Mode

Smart Mode lets UnodeAi choose a model tier per task.

| Tier | Typical use |
|---|---|
| Premium | PM coordination, architecture, hard reasoning |
| Standard | implementation, security review, documentation quality |
| Economy | routine tests, DevOps patterns, lower-risk work |

Relevant settings:

| Setting | Purpose |
|---|---|
| `roam.smartMode.enabled` | Turn Smart Mode on or off |
| `roam.smartMode.defaultTier` | Fallback tier |
| `roam.smartMode.roleTiers` | Per-role tier overrides |
| `roam.smartMode.taskTierHints` | Per-message-type tier hints |
| `roam.modelTiers` | Provider/model matrix for tiers |
| `roam.modelTierParams` | Tier-level model parameters |

## 11. Safety and Approvals

UnodeAi is designed to keep powerful agents observable and permissioned.

### Command approval

Setting:

```text
roam.commandApproval
```

Modes:

| Mode | Behavior |
|---|---|
| `none` | Agents cannot run shell commands |
| `ask` | Prompt before unapproved commands; default in current builds |
| `allowlist` | Only commands matching `roam.allowedCommands` can run |
| `all` | Allows most commands except catastrophic patterns; use only in a sandbox |

Allowed command prefixes are configured with:

```text
roam.allowedCommands
```

Default prefixes include `npm test`, `npm run build`, `npm run compile`, `npx tsc`, `git status`, `git diff`, and `git log`.

### Write approval

Setting:

```text
roam.writeApproval
```

Modes:

| Mode | Behavior |
|---|---|
| `none` | Agents can write files, with checkpoints recorded |
| `ask` | Prompt before writes with a diff preview |

### File sandbox

Agents can only work inside the configured workspace or agent worktree. Path traversal and outside-root access are blocked.

### MCP approval

MCP servers are default-deny. Servers that touch files, credentials, networks, browsers, or external systems should require approval before mounting.

## 12. Verification

Set:

```text
roam.verifyCommand
```

Examples:

```text
npm test
npm run build
npx tsc --noEmit
```

The PM's `run_checks` tool uses this command to verify the whole project. This is the main backstop for cross-file breakage caused by parallel work.

The command still obeys `roam.commandApproval`.

## 13. Worktree Fan-Out

Setting:

```text
roam.concurrencyStrategy
```

Modes:

| Mode | Behavior |
|---|---|
| `optimistic` | Shared workspace with conflict detection |
| `worktree` | Eligible agents work in isolated git worktrees under `.roam/worktrees/` |

Worktree mode requires a git repository with a clean tree. Each eligible agent works in its own worktree; when its turn finishes, its work is committed and merged into a Roam **integration branch** (`roam/integration`). Review it with:

```text
UnodeAi: Crew Worktrees (Review)
```

Land accumulated integration work onto your branch with:

```text
UnodeAi: Finalize Worktree Merges to Branch
```

### Verifier-as-gate (0.7.0)

In worktree mode, before an agent's work merges into the integration branch, UnodeAi runs your **verify command** (`roam.verifyCommand` — e.g. `npm test`, `npx tsc --noEmit`) **inside that agent's worktree**:

- **Pass →** the work merges to the integration branch.
- **Fail →** the work is **held on the agent's own branch (not merged)** and the failing output is handed back to the agent to fix and finish again. Only verified work lands.

So a crew only lands work that passes your project's own checks. The **Crew Worktrees (Review)** board shows each lane's status — **✓ verified / ✗ failing / ⚠ unverified** — and **flags any lane that passed by editing the test files** (a weak model can make checks green by weakening a test instead of fixing the code), so you can review those before finalizing.

The gate requires `roam.verifyCommand` to be set **and** approved to run (common build/test commands like `npm test` / `npx tsc` are in `roam.allowedCommands` by default; a non-approved command is skipped rather than auto-run). With no verify command there's nothing to gate on, so merges proceed unchanged.

Additional worktree settings:

| Setting | Default | Purpose |
|---|---|---|
| `roam.worktree.verifyBeforeMerge` | `true` | Gate merges on `roam.verifyCommand` passing in the agent's worktree (the verifier-as-gate) |
| `roam.worktree.verifyTimeoutSeconds` | `300` | Hard timeout for the verify command (10–3600); on timeout it's killed and treated as a failure |
| `roam.worktree.autoMerge` | `false` | Automatically land clean integration work into the base branch |
| `roam.worktree.maxParallel` | `4` | Maximum isolated worktrees at once |

## 14. Dashboard and Activity

Open the dashboard with:

```text
UnodeAi: Show Dashboard
```

The dashboard summarizes agents, message activity, workflow state, token use, and estimated cost where usage data is available.

The **Latest tasks** panel shows your most recent tasks, each broken down by the agents that worked on it (a token bar per agent, plus the task's total tokens and cost) — so you can see exactly where the tokens went across a PM-led, multi-agent run. Use the **Show last: 3 · 5 · 10 · 20** control in the panel header to choose how many tasks to display.

Use the Messages panel for the live team event stream. You can export, import, clear, or compact message history from the Messages view toolbar.

## 15. Import, Export, and Reset

Chat and message histories can be exported or imported from their view toolbars.

Useful commands:

| Command | Purpose |
|---|---|
| `UnodeAi: Export Chat` | Export selected agent chat |
| `UnodeAi: Import Chat` | Import selected agent chat |
| `UnodeAi: Archive Chat` | Hide the selected chat without deleting it (recoverable) |
| `UnodeAi: View Archived Chats` | Browse and restore an archived chat |
| `UnodeAi: Export Messages` | Export message log |
| `UnodeAi: Import Messages` | Import message log |
| `UnodeAi: Reset Workspace State` | Clear roster, chats, message log, saved conversations, workflows, and approved MCP servers for this workspace |

**Clear vs. Archive.** The Chat panel's title bar has both. **Clear** (`$(clear-all)`) permanently deletes the selected agent's transcript. **Archive** (`$(archive)`) saves it first, then hides it from the live view — the conversation disappears but isn't deleted. Restore it anytime via **View Archived Chats** (the title-bar `…` overflow menu or the Command Palette); archives survive reloads.

`Reset Workspace State` is destructive. Use it only when you want a clean UnodeAi workspace.

## 16. Command Reference

| Command | Purpose |
|---|---|
| `UnodeAi: Run Setup Wizard` | First-run setup |
| `UnodeAi: Set Provider API Key` | Store provider credentials |
| `UnodeAi: Show Team Panel` | Reveal the Team panel |
| `UnodeAi: Create Default Team (PM + Architect + Developer + Reviewer)` | Create the default software crew |
| `UnodeAi: Create or Switch Team` | Pick a team preset or switch teams |
| `UnodeAi: Add Agent` | Add one agent |
| `UnodeAi: Solo Agent (toggle)` | Toggle Solo mode |
| `UnodeAi: Start All Agents` | Start all team agents |
| `UnodeAi: Stop All Agents` | Stop all team agents |
| `UnodeAi: Open Chat with Agent` | Open the Chat panel |
| `UnodeAi: Chat with Agent` | Chat with a specific agent from a card |
| `UnodeAi: Send Message to Agent` | Send a one-off task |
| `UnodeAi: Run Workflow` | Run a workflow template |
| `UnodeAi: Edit Workflow` | Edit custom workflows |
| `UnodeAi: Run Demo Task` | Send a demo task to the PM |
| `UnodeAi: Show Dashboard` | Open dashboard |
| `UnodeAi: Open Settings` | Open settings panel |
| `UnodeAi: Open Marketplace` | Open marketplace |
| `UnodeAi: Edit Team Rules` | Edit `.roam/rules.md` |
| `UnodeAi: Restore File Checkpoint` | Restore a checkpointed file |
| `UnodeAi: Crew Worktrees (Review)` | Review worktree integration state |
| `UnodeAi: Finalize Worktree Merges to Branch` | Land worktree integration branch |

## 17. Troubleshooting

### Agent says no API key is configured

Run `UnodeAi: Set Provider API Key` and store the right secret for the provider.

### A command was blocked

Check `roam.commandApproval`. If using `allowlist`, add the command prefix to `roam.allowedCommands`. If using `ask`, approve the command from the Chat approval card.

### A write is waiting for approval

If `roam.writeApproval` is `ask`, approve or deny the diff in the Chat panel.

### PM cannot run checks

Set `roam.verifyCommand` and make sure `roam.commandApproval` allows that command.

### A model rejects `reasoning_effort` or `response_format`

Clear that field for the agent or tier. Many gateways reject optional model parameters they do not support.

### Agents made conflicting edits

Use the error message to re-read and retry the affected file. For larger parallel jobs, consider `roam.concurrencyStrategy = worktree`.

### Team state feels stale

Use `UnodeAi: Reset Workspace State` only if you want to remove the current roster, histories, workflows, and approvals from the workspace.

## 18. Recommended Operating Patterns

For small changes:

1. Use Solo or one Senior Developer.
2. Keep Act mode on only when edits are needed.
3. Run the project's own test/build scripts.

For complex features:

1. Ask the PM.
2. Require the Architect to publish contracts first.
3. Partition files before parallel work.
4. Set `roam.verifyCommand`.
5. Require an independent Reviewer PASS before considering work done.

For sensitive codebases:

1. Use Plan mode for initial review.
2. Set `roam.commandApproval = ask`.
3. Set `roam.writeApproval = ask`.
4. Keep MCP servers default-deny.
5. Store project constraints in `.roam/rules.md`.
