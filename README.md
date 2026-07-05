# UnodeAi — Multi-Model AI Team for VS Code

Build a team of AI agents inside VS Code. Each agent runs in its own session with its own role, skill, and model — route heavy reasoning to top models and routine work to cheaper ones, and let agents hand off through a shared message bus. A **PM agent** orchestrates: it breaks down the goal, delegates to teammates, runs verification gates, and drives the fix loop.

> 💸 **One crew, 50+ models, one bill.** The default **Roam gateway** serves **50+ leading models** (DeepSeek, Claude, GPT, Qwen and more) at **exclusive, deeply-discounted rates with a dependable SLA** — so running a whole multi-agent crew costs less than a single premium seat. Browse live models & pricing at **[ai.weroam.xyz/pricing](https://ai.weroam.xyz/pricing?lang=en)**.

> 📖 **New here?** Read the **[User Guide](USAGE.md)** (full walkthrough) or the **[Graphical Walkthrough](docs/GRAPHICAL_USER_GUIDE.md)** (screenshots).

## Features

- **Rich chat with every agent** — a full conversation panel per agent in the sidebar: Markdown & code rendering, **live token streaming** with a Stop button, **tool-call cards** (with unified diffs for file edits), a **context-usage bar**, and compaction markers. Switch between agents from one view.
- **Plan / Act mode** — a per-agent toggle. **Plan mode is enforced at the tool layer** (the agent gets read-only tools only; file writes, commands, delegation, and MCP tools are refused — not just discouraged by a prompt), so a planning turn is genuinely safe.
- **PM orchestration** — a coordinator agent delegates tasks, runs build/type-check/test gates, and routes fixes back to the right teammate. Agents collaborate over an in-process message bus you can follow in the Activity Feed.
- **Verified worktree fan-out — a crew only lands work that passes your checks.** Each agent works in its **own git worktree** (true isolation); on every turn UnodeAi runs your `verifyCommand` (build/lint/test) in that worktree and merges to a `unode/integration` branch **only if it passes** — failing work is held on its branch and handed back to fix. The review board shows per-lane ✓ verified / ✗ failing / ⚠ unverified, and **flags any lane that passed by editing the tests instead of fixing the code**. Land it all with one **Finalize**. Neither Cline nor Kilo gate the *team* merge on verification — this is the moat. (Opt-in: `unode.concurrencyStrategy: "worktree"`.)
- **Multi-model team (cost arbitrage)** — assign a different provider and model per role: premium models for reasoning, cheaper Roam-hosted models for routine work. And because the **default Roam gateway is deeply discounted**, even premium models run at price-competitive rates. **Smart Mode** can auto-pick a tier (economy / standard / premium) per task.
- **Reliable on cheap & open models** — the whole point of running DeepSeek / Kimi / Qwen instead of a premium seat is that they actually finish the job. UnodeAi makes them: it **recovers malformed or mis-formatted tool calls**, adapts the **tool-calling format per model**, retries empty/stuck turns, **escalates a refusing model to its fallback**, and injects your project's conventions — so weak models complete tasks instead of stalling.
- **Visual workflow editor** — design multi-step pipelines with **conditional branches** (jump to a step when a result matches), drag-to-reorder, and built-in templates. Saved to `.unode/team.json`.
- **MCP servers** — connect real tools (GitHub, Playwright, filesystem, …). Default-deny per agent, with approval before mounting; tools appear inline in chat as cards.
- **Advanced model tuning, per agent** — temperature, top_p, max tokens, reasoning effort, penalties, stop sequences, response format, thinking, and a per-agent context window — all from a Settings UI, no JSON editing.
- **Session memory** — a `.unode/rules.md` project memory is shared into every agent's context (à la `.clinerules`).
- **30-seconds-to-value onboarding** — a first-run setup wizard (provider + key, one-click team, demo task) and a built-in demo-task library.
- **Safe by default** — workspace file sandbox, command-execution policy (off by default), per-provider secret storage, and MCP default-deny + approval.

## Quick start

1. Install **UnodeAi** from the Marketplace and reload VS Code. On first run, the **Setup Wizard** opens automatically — it walks you through the steps below.
2. Set your key: **“UnodeAi: Set Provider API Key”** → select your provider and paste its API key. The default provider is the **Unode** gateway at `https://www.unodetech.xyz/v1` (OpenAI-compatible, `Authorization: Bearer <key>`, `UNODE_API_KEY`). You can also pick the **Roam** partner gateway, OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible endpoint.
3. Create a team: **“UnodeAi: Create Default Team”** spins up a PM + Architect + Developer + Reviewer crew.
4. Put them to work: open the **Chat** panel (or **“UnodeAi: Run Demo Task”**), give the PM a goal, and watch the crew collaborate — streaming replies, tool cards, and the Activity Feed.

See **[USAGE.md](USAGE.md)** for the full guide.

## Providers & models

- **Unode Gateway (default)** — the OpenAI-compatible **Unode** gateway (`https://www.unodetech.xyz/v1`), built for enterprise scale and the largest corporate customers; assign any of 50+ leading models per role, with its own API key (`UNODE_API_KEY`).
- **Roam (partner gateway)** — the OpenAI-compatible **weroam** gateway (`https://ai.weroam.xyz/v1`), a partner provider; same 50+‑model per‑role routing with `ROAM_API_KEY`. Live prices at **[ai.weroam.xyz/pricing](https://ai.weroam.xyz/pricing?lang=en)**.
- **Any OpenAI-compatible endpoint** — OpenAI, Anthropic, OpenRouter, or your own base URL, set per agent.
- **Claude (headless)** — uses the `claude` CLI’s own authentication (no key stored here).

## Configure without editing JSON

Open **“UnodeAi: Open Settings”**:

- **Providers** — see which API keys are set (values are never shown).
- **Model Tuning** — per-agent sampling parameters + context window, with inline guidance.
- **Smart Mode** — enable per-task tier auto-selection and edit the tier → model matrix.
- **MCP Servers** — view mounted servers and which agents are granted them.

## Security by default — you stay in control

Most "AI agents" ask you to trust them. UnodeAi is **locked down out of the box** and opens up only
when you say so — the safe defaults *are* the product, not a settings page you have to find:

- **Honors VS Code Workspace Trust.** In an **untrusted** workspace UnodeAi runs **read-only**: agents can
  chat, plan, read, and search, but shell commands, file writes/edits/deletes, MCP servers, and the verify
  command are all disabled until *you* trust the workspace — so opening an unfamiliar repo can't execute or
  modify anything. Security-sensitive settings (allowed commands, verify command, gateway URLs, …) are
  marked `restrictedConfigurations`, so a repo's own settings can't quietly re-enable them. Virtual
  workspaces are unsupported (a real filesystem + git are required).
- **No network by default.** Nothing is fetched from the internet unless you opt in: the marketplace
  catalog is bundled offline, and `unode.marketplace.fetchCatalog` is **off** by default. The only network
  calls UnodeAi makes are to the model/gateway provider **you** configure with a key.
- **Workspace sandbox.** File reads/writes can't escape your project folder; path traversal is blocked.
- **Commands are off until you allow them.** `unode.commandApproval` defaults to *ask/deny* — an agent
  can't run a shell command without your say-so. Risky writes can require diff approval too.
- **Plan mode is enforced at the tool layer, not the prompt.** A planning turn literally has no
  write/run/delegate/MCP tools — so "just analyze this" can't change a single file, even if the model
  tries.
- **MCP is default-deny.** New MCP servers mount only after explicit approval, and an agent only sees the
  servers it was granted.
- **Keys never touch disk.** API keys live in VS Code SecretStorage — never in `.unode/team.json`,
  settings, chat exports, or git.
- **Verified-only landing.** Worktree-isolated agents merge only after your `verifyCommand` passes, and
  the PM can't report a goal "done" while the build/tests are red — a deadlock-safe gate, not a vibe.
- **Zero data retention — and no telemetry.** UnodeAi itself keeps **no copy of your code or prompts**
  and has **no analytics, tracking, or phone-home** of any kind — chat history, team config, and keys all
  stay on your machine. Your code is sent **only** to the model provider *you* configure (nothing else),
  so end-to-end retention is entirely your call: UnodeAi works with **any** OpenAI-compatible endpoint,
  including a **self-hosted / in-VPC model**, for provable, contractual zero-retention.

📋 **Full security audit** — every network destination, execution surface, secret-handling detail, and
what the extension does *not* contain: **[SECURITY.md](https://github.com/weroamxyz/UnodeAI/blob/main/SECURITY.md)**.

## Links

- **[User Guide](USAGE.md)** — full walkthrough
- **[Graphical Walkthrough](docs/GRAPHICAL_USER_GUIDE.md)** — screenshots
- **[Changelog](CHANGELOG.md)**
- **[Models & pricing](https://ai.weroam.xyz/pricing?lang=en)**

## License

MIT
