# UnodeAi — Security Model, Policy & Audit

This document describes exactly what UnodeAi does with your code, your machine, and the network, and the
controls that constrain it. It is intended for security-conscious users and for registry reviewers. Every
claim below is verifiable against the source in this public repository.

**Summary:** UnodeAi is an in-editor AI coding-agent extension. It runs models *you* choose against your
code, and — *with your consent* — can run shell commands, edit files, and call tools. It has **no servers
of its own, no telemetry, and no network destination other than the AI provider you configure.** Every
high-risk capability is off or gated by default.

---

## 1. Network egress — what leaves your machine, and where

UnodeAi makes outbound requests to exactly three categories of host:

| Destination | What is sent | When |
|---|---|---|
| **The AI provider/gateway you configure** (`api.openai.com`, `api.anthropic.com`, `openrouter.ai`, `generativelanguage.googleapis.com`, or a gateway URL you set) | Your prompt + any workspace files the agent includes + the model name | Only when an agent runs, **and only after you approve the destination host** (see §2) |
| **Provider billing/model-metadata endpoints** (`/v1/models`, `/api/pricing`, balance) on a gateway you've stored a key for | Your API key in the `Authorization` header — **no workspace content** | To populate the model picker and show prices/balance; only if a key is stored |
| **Opt-in hosted skill catalog** (a URL you set) | Nothing (a GET request) | Only if you set a catalog URL **and** enable `unode.marketplace.fetchCatalog` (default **off**) |

There is **no telemetry, analytics, crash reporting, or phone-home endpoint.** UnodeAi operates no backend
service. Your code is transmitted only to the model provider you select — which can be a self-hosted /
in-VPC endpoint for provable zero-retention, since UnodeAi works with any OpenAI-compatible API.

**The `web_fetch` agent tool is SSRF-hardened.** It refuses loopback, link-local / cloud-metadata
(`169.254.169.254`), and RFC1918 ranges — including decimal/hex/octal-encoded bypasses of `127.0.0.1` —
and disables automatic redirects. See [`src/backend/webFetch.ts`](src/backend/webFetch.ts).

---

## 2. Egress consent — no code leaves until you approve the destination

Before **any** model request is sent, UnodeAi shows a one-time modal per gateway host: *"UnodeAi is about
to send this agent's prompt — and any workspace files it includes — to `<host>` … Allow?"* Nothing is
transmitted unless you click **Allow**; the decision is remembered per host. Enforced at every egress
point — the OpenAI-compatible request path
([`OpenAICompatBackend`](src/backend/OpenAICompatBackend.ts) `fetchOnce`/`fetchStreamOnce`), the chat
summarizer, and before the Claude CLI is spawned ([`ClaudeHeadlessBackend.start`](src/backend/ClaudeHeadlessBackend.ts)) —
via the `onBeforeEgress` hook. Declining aborts the turn with "no prompt or code was sent."

---

## 3. Code execution — off or gated by default

| Capability | Default | Control |
|---|---|---|
| **Shell commands** | *Ask / deny* | `unode.commandApproval` prompts per command; catastrophic patterns are always blocked. Gated identically for both backends ([`CommandPolicy`](src/backend/CommandPolicy.ts), [`commandPermission`](src/backend/commandPermission.ts)). |
| **File writes / edits / deletes** | Checkpointed | Every write is a restorable checkpoint; `unode.writeApproval` can require per-write diff approval; writes cannot escape the workspace root (path-traversal blocked). |
| **MCP servers** (local `stdio` subprocess / remote) | **Default-deny** | Any subprocess/remote/env server requires explicit one-time approval before mounting ([`shouldRequireApproval`](src/mcp/McpApproval.ts)); an agent sees only servers it was granted. |
| **Plan mode** | Tool-layer enforced | A planning turn has *no* write/run/delegate/MCP tools — analysis cannot mutate anything. |

---

## 4. VS Code Workspace Trust

UnodeAi declares `capabilities.untrustedWorkspaces: "limited"`. In an **untrusted** workspace it runs
**read-only**: agents can chat, plan, read, and search, but shell commands, file writes/edits/deletes, MCP
servers, and the verify command are all disabled until you trust the workspace. Security-sensitive
settings (`unode.allowedCommands`, `unode.commandApproval`, `unode.verifyCommand`, gateway URLs, catalog
settings) are `restrictedConfigurations`, so a repository's own settings cannot silently re-enable them.
Virtual workspaces are unsupported. Enforcement is at every chokepoint and checked live.

---

## 5. Secrets

API keys are stored **only** in VS Code SecretStorage — never in `.unode/team.json`, settings, chat
exports, logs, or source control. `${VAR}` placeholders in MCP configs are resolved from SecretStorage at
spawn time, never from arbitrary process env. The Claude team-bridge MCP config carries a local loopback
token written to `.unode/mcp.json` (a **gitignored** directory) and cleaned up on teardown.

---

## 6. What the extension does *not* contain

- **No install hooks** — no `postinstall`/`preinstall` scripts.
- **No dynamic code execution** — no `eval` / `new Function`.
- **No bundled binaries** — the shipped VSIX contains zero `.exe`/`.node`/`.dll`/`.wasm`. Native modules in
  the dev tree (esbuild, vsce-sign, keytar) are devDependencies, excluded from the package.
- **No obfuscation** — the shipped `extension.js` is standard esbuild output; full readable source is here.
- **Minimal runtime deps** — the bundled package ships only a JSON-schema validator (`ajv` + small helpers).

---

## 7. Why an automated scanner may still flag it (and why that isn't malice)

UnodeAi's *legitimate* capability profile — read workspace files, send them to a model endpoint, run shell
commands, spawn MCP subprocesses — overlaps with the behavioral signature classifiers use to detect
exfiltration and remote-code execution. That overlap is intrinsic to *any* AI coding agent (Copilot,
Cursor, Cline, Continue share it). The controls above exist specifically to keep every one of those
behaviors user-consented and auditable rather than silent — in particular, the egress-consent gate (§2)
means the "reads files → sends to a remote host" pattern cannot occur without an explicit, per-host
approval.

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.** Email **yan.huohua.zhang@gmail.com**
with a description and impact, steps to reproduce (or a PoC), and the extension / OS / VS Code versions.
We aim to acknowledge within **3 business days** and to ship a fix or mitigation for confirmed exploitable
issues as quickly as the severity warrants. Please allow a reasonable window before public disclosure.

## Good practice

- Review agent diffs before finalizing a merge — you are the backstop.
- Approve shell commands and MCP servers only from task sources you trust.
- Never paste real secrets into task instructions or MCP configs.
