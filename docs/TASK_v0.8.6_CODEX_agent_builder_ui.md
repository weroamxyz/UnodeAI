# TASK v0.8.6 — Codex: Agent Builder webview (Build Your Own Crew)

**Owner:** Codex (UI — you own the panel surfaces). **Gatekeeper/integrator/publisher:** Claude (don't
bump version or publish). **Runs in parallel with:** Claude (backend — done, see contract) and
RoamCrew (skill-library content). **Spec:** [DESIGN_v0.8.6_agent_builder.md](DESIGN_v0.8.6_agent_builder.md).

## Goal
A form-style webview that lets a user **build/edit a custom agent**, **attach skill playbooks** from the
skill picker, and **grant MCP servers** — then it joins the team like any preset. Pattern after
[SettingsPanel.ts](../src/views/SettingsPanel.ts) (CSP/nonce, `webviewSecurity`, message bus).

## The backend contract is FROZEN and already in `main` — call it, don't reinvent
```ts
// src/marketplace/install.ts
applyPlaybooks(systemPrompt, playbookIds, catalog.skills) → systemPrompt   // strip old block, cap 3, mount
MAX_AGENT_PLAYBOOKS = 3                                                     // enforce in the UI too
// src/types.ts
AgentConfig.playbooks?: string[]   // the attached playbook ids (separate from capability `skills`)
// catalog: catalog.skills (bundled + hosted) is the skill source; each has { id, name, summary, category, body? }
```
On save, the host builds the `AgentConfig`, sets `config.playbooks`, runs
`config.systemPrompt = applyPlaybooks(basePrompt, config.playbooks, catalog.skills)`, and calls
`sessionManager.create` (new) or update (edit). **You produce the webview + the host message handlers;
the AgentConfig assembly + applyPlaybooks call is the host glue (coordinate the exact seam with Claude).**

## Scope (webview + its message handlers)
1. **Command + entry:** `roam.openAgentBuilder` (new) opens the panel; a "Build an agent" entry on the
   Team panel. Supports **new** and **edit existing** (prefill from the AgentConfig).
2. **Form sections:** Identity (name, role — template or **custom, e.g. "CEO"** — icon/color), Model
   (provider+model from the catalog), Instructions (editable system prompt; show it WITHOUT the
   `## Playbooks` block — that's derived), Tools (capability `skills`), MCP grant (pick registered
   servers or "Add MCP server…" → existing approval flow).
3. **Skill picker (the centerpiece):** browse `catalog.skills` as cards (name, summary, category);
   **search + filter by category/role + sort (relevant / newest / most-used)**; checkbox to attach;
   **enforce the 3-cap** (disable further checks at 3, show "3/3"); live "Includes: …" preview. A
   prominent **"Need more? Browse the full skill library →"** opens `roam.marketplace.skillLibraryUrl`.
4. **Save / Cancel.** Save posts the assembled fields to the host; the host applies playbooks + persists +
   refreshes the Team panel.

## Files
- `src/views/AgentBuilderPanel.ts` (new) + `roam.openAgentBuilder` command + Team-panel entry.
- `src/views/__tests__/AgentBuilderPanel.test.ts` — renders sections; skill picker enforces the 3-cap;
  search/filter/sort narrow the list; "Browse full library" posts the link command; emits the save
  payload (selected playbooks, skills, mcp, identity, model, prompt).

## Acceptance
- `build`+`lint`+`test` green; render + message paths covered. No GUI smoke from you — Claude/张 run it.
- Deliver code + tests + a 5-line summary and any contract friction with the host seam.

## Constraints
- Renderer + message-handler only; CSP/nonce intact; all dynamic text `esc()`/`escAttr()`'d.
- Enforce `MAX_AGENT_PLAYBOOKS` in the UI (backend also caps — belt and suspenders).
- Don't touch versioning/CHANGELOG/publish. Hand back to Claude to integrate as 0.8.6.
