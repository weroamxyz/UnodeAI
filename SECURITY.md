# Security Policy

## Supported versions

UnodeAi ships from a single release line on the VS Code Marketplace
(`roamai.roam-crew`). Security fixes land in the latest published version; please
upgrade before reporting.

| Version | Supported |
| ------- | --------- |
| Latest published (0.8.x) | ✅ |
| Older   | ❌ — upgrade first |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **yan.huohua.zhang@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- the extension version and your OS / VS Code version.

We aim to acknowledge within **3 business days** and to ship a fix or mitigation
for confirmed, exploitable issues as quickly as the severity warrants. Please
give us a reasonable window to remediate before any public disclosure.

## Scope & trust model

UnodeAi orchestrates AI coding agents that **run commands and edit files in
your workspace**. A few things worth understanding:

- **Agent commands run with your privileges.** In `acceptEdits` mode the
  extension surfaces an approval/ask gate; `bypassPermissions` (opt-in) runs
  agent-issued commands without prompting. Treat untrusted task input the way
  you'd treat untrusted code.
- **Worktree fan-out** runs each agent in an isolated git worktree under
  `.roam/` and merges to an integration branch. The verifier-as-gate
  (`roam.worktree.verifyBeforeMerge`) runs your configured verify command in the
  worktree before merging; a passing lane that also edited test files is flagged
  for human review rather than silently trusted.
- **Secrets.** API keys are read from your VS Code settings / environment. MCP
  server configs should reference secrets via `${VAR}` placeholders — never
  commit real keys. The Claude backend's team-bridge MCP config carries a
  local loopback token; it is written to `.roam/mcp.json` (a **gitignored**
  directory) and cleaned up on teardown, so an abnormal-exit leftover can never
  be committed.
- **Network.** Model traffic goes to the provider you configure (the Roam
  gateway by default, or any OpenAI-compatible endpoint / Anthropic). No
  telemetry is sent to us.

## Good practice

- Review agent diffs before finalizing a merge — the human is the backstop.
- Keep `bypassPermissions` off unless you trust the task source.
- Don't paste real secrets into task instructions or MCP configs.
