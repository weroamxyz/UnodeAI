# UnodeAi — Release Smoke Checklist (manual, human-run)

> Run this against the **bundled VSIX** (`npm run package:bundle` → install the `roam-crew-<v>-bundled.vsix`)
> before a commercial/GA publish. CI already gates lint/build/unit/audit/package + a headless activation
> smoke; this covers the **interactive paths CI can't drive** (provider switching, CLI auth, MCP grants,
> Smart Mode, the verifier gate). Tick each box; note the build under test + OS.
>
> Build: `roam-crew-______-bundled.vsix`  ·  OS: ☐ Windows ☐ macOS ☐ Linux  ·  Date: __________
>
> A few checks need `roam.verifyCommand` set (e.g. `npm test` or `npx tsc --noEmit`) — set it first.

## 0. Install & activate
- [ ] Install the bundled VSIX; reload. Extension activates with no error toast.
- [ ] The **UnodeAi** activity-bar icon shows Team / Chat in the sidebar and **Activity** in the bottom Panel.
- [ ] First-run **Setup** page: clicking each of the three cards navigates (no dead clicks).

## 1. Providers & keys (provider switching + CLI auth)
- [ ] Settings → **Providers**: cards show **Roam / OpenAI / Anthropic / OpenRouter / Custom** only (no Google/Ollama).
- [ ] **OpenRouter** shows an **API-key** field (not "CLI auth"); set `OPENROUTER_API_KEY` and it reads "set".
- [ ] **Anthropic** is the only provider marked **CLI auth** (uses the Claude CLI's own login).
- [ ] **Sign up / Top up** buttons open `ai.weroam.xyz` (Roam) and `unodetech.xyz` (Unode) in the browser.
- [ ] Set `ROAM_API_KEY`; create a team on Roam; an agent answers a trivial prompt (gateway reachable).

## 2. Teams, chat, solo
- [ ] Create the default crew (PM + Architect + Developer + Reviewer); all start.
- [ ] Chat with one agent: **streaming** tokens, **Stop** interrupts, **Plan** mode removes tools, **Act** works.
- [ ] Solo toggle creates/uses a single generalist; a one-file edit task completes.

## 3. Agent Builder (create + EDIT-applies-live + custom icon)
- [ ] Build a custom agent (e.g. CEO): pick model from the live list, attach ≤5 playbooks, grant an MCP server. It joins the team.
- [ ] **Edit a RUNNING agent**: change its model (and/or add an MCP grant) → save → the change takes effect on the **next turn** (the agent restarts; conversation context preserved). *(U4)*
- [ ] **Tool-calling = Auto** by default; a Kimi/GLM/etc. agent starts in XML and doesn't stall on the first tool call.
- [ ] **Upload image** icon: pick a small PNG → shows in the builder preview, Team card, and chat avatar. Oversize (>64 KB) is rejected with a clear message; emoji/codicon still work. *(U3)*

## 4. MCP (marketplace install → grant → use)
- [ ] Settings → **MCP Servers** → **Browse MCP Marketplace** opens the Marketplace **on its MCP tab**.
- [ ] Install an MCP server (approve the mount prompt if shown); the **Add** button shows **Added ✓** (and **Retry** if you cancel a URL prompt). It appears in the MCP Servers tab.
- [ ] Grant it to an agent (Agent Builder → MCP grants); the agent can call its tool in Act mode.

## 5. Smart Mode
- [ ] Enable Smart Mode; a task runs on the tier-selected model for that turn.
- [ ] After the turn, the agent's **configured** model is unchanged (per-turn only); cost reflects the model actually used.

## 6. Verifier-as-gate (the moat) — needs `roam.verifyCommand`
- [ ] **Optimistic mode:** give the PM a goal that ends red (failing tests). The PM does **not** report "done" — it loops a bounded number of fix cycles, then emits **🚧 Blocked — needs a human** with options. It never loops forever.
- [ ] A goal whose checks pass completes normally (no spurious gate).
- [ ] With **no** `roam.verifyCommand` set, the PM completes without the gate (no trap).
- [ ] **Worktree mode** (`roam.concurrencyStrategy = worktree`): a lane whose checks fail is **not merged**; a passing lane merges.

## 7. Orchestration visibility & Router audit
- [ ] Delegating in chat shows a live **delegation chain**; a fan-out shows **done/total** progress; Team status reads clearly (Idle/Working/Blocked/Done) in compact + full.
- [ ] **Output channel "UnodeAi"** logs a `[route] …: Routed "<role>" → <id> (<reason>)` line per delegation — and **no** route line for a delegation rejected by a file conflict.
- [ ] With two same-role teammates and one stopped, delegation goes to the **live** one.

## 8. Safety defaults (spot-check)
- [ ] Command approval prompts in Act mode (Run / Always-allow / Deny); MCP mount asks before mounting a sensitive server.
- [ ] Stored keys never appear in `.roam/team.json`, chat exports, or the Output channel.

## Sign-off
- [ ] All boxes ticked (or deviations noted below). Safe to `npm run publish:bundle`.

Notes / deviations:
```
```
