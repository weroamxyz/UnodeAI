# Codex Team — v0.2.0 Implementation Guidance

> **You (Codex) implement v0.2.0. Claude supervises and reviews. The user (`[A]`) does networked/key/Marketplace steps.**
> Authoritative scope: [PRD_v0.2.0_Product_Brief.md](PRD_v0.2.0_Product_Brief.md) (what) · [DevPlan_v0.2.0.md](DevPlan_v0.2.0.md) (how, per-file/per-task).
> Baseline: `main` @ v0.1.2 (Marketplace `RoamAI.roam-crew`), `npm test` 224 green.

## 0. How to start

1. Read the PRD + DevPlan in full. Owner tags `[C]`/`[X]` are **yours** to implement; `[A]` is the user.
2. Work **one Epic per branch**. Run `npm run build && npm run lint && npm test` green **before every merge** — no exceptions.
3. Keep a running log at `docs/CODEX_V0.2.0_COMPLETION_LOG.md` (one entry per task: files changed, what, verification). This is how Claude reviews without re-deriving intent from diffs — mirror `CODEX_V0.1.1_COMPLETION_LOG.md`.

## 1. Non-negotiable constraints (lessons already paid for in v0.1.x)

1. **Don't break the security model.** CommandPolicy (exec off by default), FileCoordinator sandbox, MCP default-deny + approval must hold in every new path. Secrets stay in SecretStorage — never in logs, disk, or webviews.
2. **Injection over singletons.** Follow `SessionManagerDeps` / `SettingsPanelDeps` / `DialogDeps`. New logic cores (`Summarizer`, `LocalMcpServer`) are **vscode-free + unit-tested**; VS Code I/O is injected.
3. **Webview input is hostile.** Any user/agent-controlled string rendered in a webview must go through `textContent`/DOM APIs or `esc`/`escAttr` — **never `innerHTML` string concatenation** (this exact bug shipped and was hot-fixed in v0.1.1; don't repeat it).
4. **English-only for everything a user sees** — UI strings, README/USAGE/CHANGELOG, settings/command titles, notifications. Code comments may stay as-is. (v0.1.2 was a whole patch to undo Chinese leaking into the Marketplace page — don't reintroduce it.)
5. **Don't force model params that gateways reject.** `reasoning_effort`/`response_format` are opt-in (global default empty). Don't add forced defaults that 400 on non-supporting models.
6. **Don't double-compact Claude.** E1 summarization and E7 streaming apply to the **OpenAI-compat backend only**. Claude headless manages its own window/compaction/MCP — only bridge what it lacks (TeamTools, Chat UI).
7. **Concurrency invariants.** `pendingOrigin` is 1:1 with the in-flight turn (deliver only when idle). A turn-level error must **not** free a concurrency slot (only a dead backend does). Don't regress these — they were P0 blockers in v0.1.1.
8. **Commit discipline.** One Epic/Task per branch, descriptive messages, gates green, co-author trailer. Don't bundle unrelated changes.

## 2. Corrections already applied to the plan (read before coding the affected Epics)

- **Base URL default (user requirement):** every "pick provider + enter API key" flow must pre-fill Base URL = `https://www.unodetech.xyz/v1` (the `roam.baseUrl` default). Add-Agent already does this; the **Onboarding Provider step (E6a/E6.1 ②) must too.**
- **E7 streaming is a BUILD, not "already there".** `OpenAICompatBackend.chat()` hardcodes `stream:false`, and `FetchFn` returns `text()` only (no streaming body). You must extend the fetch abstraction for a streaming path, and keep the **tool-loop turns non-streaming** (they need a complete response to parse `tool_calls`). Do a feasibility probe on day 1 of E7. The PRD/DevPlan E7 entries now say this.
- **E2 `LocalMcpServer` transport risk.** streamable-http on Windows may hit firewall/binding issues. Do a protocol probe on day 1 of M2; stdio is the documented fallback. Bind `127.0.0.1` only, random port, random bearer token, lazy start / stop on last PM agent.
- **E5b esbuild** is blocked by `ajv` dynamic requires — the safe path (external `ajv`/`ajv-formats` + `.vscodeignore` allowlist + **MCP smoke on the packaged VSIX**) is in [PUBLISH_CHECKLIST_v0.1.1.md](PUBLISH_CHECKLIST_v0.1.1.md). Treat the packaged-MCP smoke as part of E5b's DoD, not optional.

## 3. Workflow & review checkpoints

Per milestone (M1–M5), in order:

1. Implement the milestone's Epics on a branch (gates green per merge).
2. Update `CODEX_V0.2.0_COMPLETION_LOG.md`.
3. **Request Claude review at the milestone boundary.** Do not start the next milestone's risky Epic before the current one is reviewed. (E3/E4 may proceed in parallel per the plan.)
4. Address review findings before the milestone is marked ✅.

**What Claude will scrutinize (design your code to pass these):**
- **E1 Summarizer:** incremental (cost doesn't grow with history); only OpenAI-compat; anchor + recent-K still kept verbatim; a probe for an early decision is answerable; hard-limit safety valve remains.
- **E2 LocalMcpServer:** loopback-only, token auth enforced (401 without it), port released on stop, shared single instance across PM agents, no secret leakage; graceful when a PM agent has no TeamMcpBridge.
- **E7 streaming:** tool-loop turns stay non-streaming; abort actually cancels (AbortController / child kill); chat history persistence bounded; **agent-name/role/message rendering uses DOM APIs, not innerHTML.**
- **E4/E6 webviews:** CSP nonce, no `innerHTML` with dynamic data, English-only.
- **All:** no security-model bypass, unit tests for pure cores, gates green.

## 4. Definition of Done

Per Epic: the PRD's acceptance bullets met + unit tests + build/lint/test green + completion-log entry.

Release (the user `[A]` runs publish): all PRD §6 gates, `npm test` ≥ 250 green, E2/E3/E6 manual validations done, `CHANGELOG.md` updated, `npm version minor` → `0.2.0`, packaged VSIX MCP-smoked, then `vsce publish` + tag `v0.2.0`.

## 5. Escalate to Claude/user when

- A plan assumption turns out wrong against the code (like E7 streaming was) — flag it, don't silently work around.
- A change would touch the security model or break an existing invariant.
- `[A]` work is needed (keys, network, Marketplace, browser) — hand it to the user with exact steps.

## 6. Adjustment — 2026-06-05 (after M1/E1 + M2/E2 review)

**Status:** ✅ M1/E1 (context compaction) and ✅ M2/E2 (PM→Claude local MCP bridge) both reviewed and
merged to `main`. Good work — both passed with thorough tests. E2's only open item is a manual live
Claude PM→Dev run (a user `[A]` task).

**New priority — Chat Experience Parity (supersedes E7).** User feedback: per-agent chat is far below
Cline. The real gap is **streaming + in-conversation tool/action visibility + Markdown rendering**, not
Plan/Act. The DevPlan E7 is replaced/expanded by a dedicated track C1–C4; spec:
[FeatureSpec_Chat_PlanAct_Mode.md](FeatureSpec_Chat_PlanAct_Mode.md). Treat this as **high priority**
(above E3/E4/E6) — it's the user's top pain. Key requirements that differ from the first draft:

1. **Placement = sidebar WebviewView** in the UnodeAi container — **not** an editor WebviewPanel, and
   **not** the per-agent OutputChannel ("don't mix with the terminal"). One Chat view with an agent
   switcher = "a conversation per agent" (VS Code can't spawn N dynamic sidebar views). The existing
   editor `ChatPanel` is replaced by this sidebar view.
2. **Rich rendering is in scope** (Markdown + code blocks + tool/action cards with collapsible diffs) — the
   first draft deferred this; it's the #2 gap. Approval UI for diffs is still later.
3. **Streaming is a BUILD** (FetchFn returns text() only; chat() is non-streaming). Day-1 probe; keep
   tool-loop turns non-streaming.
4. **Plan mode = hard tool gating** at the tool layer (strip write/execute from the model's toolset +
   CommandPolicy reject), not a prompt prefix. Prompt note is defense-in-depth only.

Order within the track: **C1 → C2 → C3 → C4**. Same non-negotiables as §1 (no `innerHTML` with model/tool
data, English-only, no security-model bypass, pure cores unit-tested, gates green per merge, one epic per
branch, update the completion log). Bring each C-task to me for review at its boundary, as before.

**Suggested next step:** start **C1** (sidebar rich chat + Markdown + per-agent persistence) so the user can
feel the upgrade early, then C2 (streaming) and C3 (tool cards).

## 7. Doc governance

The planning docs (this file, STATUS, PRD, DevPlan, FeatureSpec, task cards, backlog) are **Claude-maintained**.
If a doc looks wrong or you (or any other assistant — DeepSeek included) want a different direction, **add a
proposal to [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md)** — do not rewrite the authoritative docs in place.
Claude triages proposals into the plan so it stays consistent with merged code and doesn't disrupt in-flight
work. Build from the **task cards** (`CODEX_TASK_*.md`); if a card disagrees with a spec, trust the card and
flag it.
