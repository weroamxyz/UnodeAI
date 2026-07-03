# DESIGN — v0.8.6 "Build Your Own Crew" (Agent Builder)

**Type:** design / planning. Progress source stays [STATUS.md](STATUS.md). This is the shape + contracts
for the v0.8.6 theme. Claude integrates, gatekeeps, publishes.

## Theme

Turn UnodeAi from *use our presets* into *compose your own crew*. A single **Agent Builder** lets a
user create/edit a custom agent, **attach skill playbooks from a reference library**, and **grant it
MCP servers** — without touching JSON. This is the platform play before 1.0.

### Reconciliation with the "no standalone Skills store" decision
Still holds. The skills DB is a **reference library you pull from while building an agent**, surfaced as
a **picker inside the builder** — not a top-level store you install standalone skills from. Presets stay
"members come equipped" ([[DESIGN_member_skills.md]]); the builder is the power-user surface.

## What already exists (reuse, don't rebuild)
- **Add/Edit Agent** — quickpick chains in [dialogs.ts](../src/dialogs.ts) over `ROLE_TEMPLATES`.
- **Custom MCP** — registered via Settings / `.roam/team.json` / Marketplace MCP, approval-gated;
  `AgentConfig.mcpServers: string[]` references them.
- **Skill→prompt injection** — `mountSkillPlaybooks(systemPrompt, ids, skills)` in
  [install.ts](../src/marketplace/install.ts) (0.8.5). Idempotent; skips bodiless/unknown ids. Today
  it's only called on **Marketplace install** — the builder will call it too.
- **Webview pattern** — [SettingsPanel.ts](../src/views/SettingsPanel.ts) (CSP/nonce, message bus) is
  the template for the builder webview.
- **Skill catalog** — bundled + hosted `skills.json` via [catalog.ts](../src/marketplace/catalog.ts).

## Data model (one new field)
```ts
// types.ts — AgentConfig gains:
playbooks?: string[];   // skill ids (into skills.json) attached as ## Playbooks. SEPARATE from
                        // `skills` (capability tokens → allowedTools) to avoid the B2 collision.
```
- `skills` (capability tokens / allowedTools): **unchanged, load-bearing — do not overload.**
- `playbooks` (NEW): the reference-library skills the user attached. Injected into the system prompt
  via `mountSkillPlaybooks` whenever the agent is built/run; idempotent so editing doesn't duplicate.
- **Cap: `MAX_AGENT_PLAYBOOKS = 3` (configurable constant).** Enforced in the builder UI + backend.
  Rationale: keeps the system prompt focused and the context/cost bounded, and forces users to pick the
  *best* few rather than dumping a stack. Trivial to raise later (it's one constant) — start at 3.
- Persisted in `workspaceState` + `.roam/team.json` like the rest of `AgentConfig`.

### Custom agents join the team like any other
A builder-made agent (e.g. a **"CEO"** with a custom role) produces a normal `AgentConfig` and enters
the roster through the same `sessionManager.create` path — so it shows in the Team panel, can be
delegated to, and persists. Custom (non-template) roles need sane fallbacks: a default model tier and a
default capability-`skills` set when the role isn't in `ROLE_TEMPLATES`.

## The Agent Builder (webview)
A `roam.openAgentBuilder` command opens a form-style webview (new agent, or "Edit" on an existing one):

1. **Identity** — name, role (from `ROLE_TEMPLATES` or custom), icon/color.
2. **Model** — provider + model picker (reuse the model catalog).
3. **Instructions** — editable system prompt (prefilled from the role template; user can rewrite).
4. **Skill playbooks** — browse the **reference library** (`skills.json` cards: name, summary,
   category, "what it does"); checkbox to attach. Selected → `config.playbooks`. Shows a live
   "Includes: …" preview. Search/filter by category/role.
5. **Tools & MCP** — pick capability `skills` (→ tools) and **grant MCP servers** (from the registry,
   or "Add MCP server…" inline → existing approval gate).
6. **Save** → builds/updates the `AgentConfig` (running `mountSkillPlaybooks` for the attached
   playbooks), persists, refreshes the Team panel.

## The skill database: a LEAN active catalog + an external full library
Refined direction (2026-06-16): **don't ship a big in-app DB.** Keep the in-app/hosted catalog small and
relevant; link out to a full library for the long tail. This caps DB size, keeps the picker fast, and
sidesteps the "big DB = noise" problem.

**Two tiers:**
- **In-app active catalog (small, hosted + bundled):** the curated *popular* skills **plus every skill a
  user has actually attached** (so your picks stay one click away). This is what the builder's picker
  shows. Reuses the existing hosted-catalog plumbing (`roam.marketplace.catalogUrl` + `fetchCatalog`,
  [catalogSource.ts](../src/marketplace/catalogSource.ts)) with a **daily refresh** (refetch if cache >
  24h; offline → bundled fallback).
- **External full library (link-out):** a **GitHub repo** holding the long tail — **temporarily under the
  personal account (yanzhang79); moved to the weroam org and open-sourced before 1.0.** The picker shows a
  prominent **"Need more? Browse the full skill library →"** that opens it; users **download or copy-paste**
  a skill's JSON to add it. GitHub doubles as the diffable, community-contribution surface.

**Self-pruning (keeps the active catalog lean):**
- A skill that **no one has picked for over a year** is **removed from the hosted active catalog** — still
  fully available via the external library link, so nothing is lost.
- **Already-attached agents are unaffected:** `mountSkillPlaybooks` bakes the body into the agent's
  `systemPrompt` at attach time, so a pruned skill keeps working in agents that already use it (it just
  won't appear in the picker for *new* attachments — the link is the recovery path).

**Picker UX (small DB, but still tidy):** search (name/summary) + filter by category/role + sort by
relevant / newest / most-used; cards show name, summary, category.

**Decided — telemetry-free for 0.8.6.** SECURITY.md's "no telemetry" promise is kept:
- "popular" = **our editorial curation**; "skills the user picked" persist **locally** for that user
  (their own catalog), independent of any server. Pruning "dormant > 1yr" is our **editorial/ops** call on
  the hosted set, not aggregated user data.
- *True global popularity* would require **opt-in anonymous usage signals** — a separate trust decision,
  **deferred** (not 0.8.6).
- License bar still holds ([[DESIGN_member_skills.md]]): base on the public practice, our own wording.

## Contracts / integration points
- `types.ts`: add `playbooks?`.
- `install.ts`: `mountSkillPlaybooks` already pure — also call it from the builder save path; ensure
  re-edit re-mounts cleanly (idempotent guard already there; for an EDIT that changes the set, strip
  the old `## Playbooks` block before re-injecting — add a `stripPlaybooks()` helper).
- New `src/views/AgentBuilderPanel.ts` (webview) + `roam.openAgentBuilder` command + Team-panel entry
  ("Build an agent").
- Skill list comes from the loaded catalog (`catalog.skills`), so it grows with bundled/hosted JSON.
- MCP grant reuses the registry + `mountMcpServer` approval path.

## Open decisions
- **Edit re-mount:** changing attached playbooks on an existing agent must replace, not append — needs
  `stripPlaybooks(systemPrompt)` (delimited block, safe to remove) before re-injecting.
- **Capability skills vs playbooks in the UI:** keep them as two clearly-labeled sections so users
  aren't confused (tools vs procedures).
- **Reference library entry point:** picker-in-builder only (recommended), or also a read-only
  "browse skills" view? Default: picker-only, to honor the no-standalone-store decision.

## Workstream split (proposed)
- **Builder webview UI** (AgentBuilderPanel + form + skill picker + MCP grant): Codex — it owns the
  panel surfaces and shipped the Marketplace/review-board UIs cleanly.
- **Backend** (`playbooks` field, `stripPlaybooks`, builder save/persist wiring, mount-on-edit):
  Claude — load-bearing, touches AgentConfig + install + persistence.
- **Reference content:** keep growing `skills.json` per the [member-skills gap list](DESIGN_member_skills.md).
- Claude integrates + gatekeeps + publishes. (Given the dogfood agents' recent struggles on
  search/large-file tasks, keep backend wiring with Claude.)

## Acceptance
- A user can build a brand-new agent end-to-end in the webview: name/role/model/prompt + attach ≥1
  reference playbook (it appears in the agent's instructions) + grant an MCP server, then it runs.
- Editing an agent's attached playbooks replaces the `## Playbooks` block (no duplication/staleness).
- `skills` (tools) and `playbooks` (procedures) stay separate; catalog validation unaffected.
- build + lint + test green; the builder's pure logic (mount/strip/save-mapping) is unit-tested.

## Out of scope (later)
Sharing/exporting custom agents to the Marketplace, a hosted user-skill authoring flow, per-skill
versioning. v0.9.0 is local build-your-own.
