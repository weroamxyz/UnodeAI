# TASK v0.8.6 — DeepSeek + Kimi (RoamCrew): author the skill library

**Owners:** DeepSeek + Kimi. **Gatekeeper:** Claude reviews & merges every entry. **Runs in parallel
with:** Claude (backend) + Codex (builder UI). **Spec:** [DESIGN_v0.8.6_agent_builder.md](DESIGN_v0.8.6_agent_builder.md).

## What this is — and what it is NOT
You are **writing skill *playbook* content** — pure JSON files, to a schema. This is content authoring,
your strength. It is **NOT** a code task:
- ❌ Do **not** edit `src/**`, `marketplace/agents.json`, or `RoleConfig.ts` / `SKILL_LIBRARY`. (Those
  are *capability tokens* — a different thing. Conflating them is exactly what broke the catalog before.)
- ❌ Do **not** go spelunking in the codebase or run searches. You only write skill JSON.
- ✅ You author **skill playbooks** for the library repo: **github.com/weroamxyz/roam-skills** (the
  external "full skill library"; will move to weroam + open-source before 1.0).

## The schema (each skill is one object)
```jsonc
{
  "id": "kebab-case-stable-id",          // unique, stable
  "name": "Human Title",
  "summary": "One sentence: what it does.",
  "category": "development | design | documentation | management | security | infrastructure | data | external",
  "capabilities": ["read", "search"],    // which tool kinds the playbook assumes (read/search/execute)
  "body": "# Title\n\nA numbered, actionable playbook (markdown). Steps an agent follows. End with what to RETURN."
}
```
Match the tone/shape of the existing entries in [marketplace/skills.json](../marketplace/skills.json).

## Hard rules (curation bar)
1. **License-clean.** Base each playbook on the *public practice* (OWASP Top 10, WCAG 2.1, Conventional
   Commits, semver, 12-factor, OpenAPI conventions, REST, test-pyramid…). **Write our own wording — never
   paste proprietary prompts or copyrighted docs.** Cite the standard by name in the body if helpful.
2. **Actionable & specific.** Numbered steps an agent can actually execute; end with "Return: …".
   If a member wouldn't produce visibly better work with it on, don't write it.
3. **Maps to a role.** Every skill should plausibly belong to one of the member roles
   (security / testing / a11y / docs / api / devops / data / review / pm / frontend / backend).
4. **Small batches.** ~8–10 skills per batch, as a JSON array, so Claude can review and merge quickly.
   Don't dump 200 at once.

## Where to start (the gap list)
Use the per-member gap list in [DESIGN_member_skills.md](DESIGN_member_skills.md) — author the ➕ items,
prioritizing security / testing / devops / pm / data first. Avoid duplicating ids already in skills.json.

## Deliverable
Per batch: a JSON array of new skill objects (valid schema, license-clean) + a one-line note per skill on
which standard it's based on. Claude validates (schema + license + quality), merges into the library, and
promotes the best into the lean in-app catalog.

## Split (suggested)
- **DeepSeek:** development / api / backend / data / devops playbooks.
- **Kimi:** security / testing / docs / a11y / pm / review playbooks (and it may also do competitive
  research deliverables if asked).
Coordinate ids so you don't collide.
