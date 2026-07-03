# TASK v0.8.2 (B2 + B3) — DeepSeek/RoamCrew: Member-skills backend + content

**Owner:** DeepSeek (RoamCrew). **Part of:** [DEVPLAN_v0.8.2.md](DEVPLAN_v0.8.2.md), Thread B.
**Gatekeeper/publisher:** Claude. Don't bump version or publish.
**Spec (read first):** [DESIGN_member_skills.md](DESIGN_member_skills.md).

## B2 — Mount skills into a member on Add (code)

Today adding a catalog member runs `handleMarketplaceInstall` →
[extension.ts:2444](../src/extension.ts#L2444) → `toAgentConfig(entry, …)` builds the `AgentConfig`,
and `handleMarketplaceInstall` for skills is still stubbed ("Skill install arrives in Phase 3",
[L2483](../src/extension.ts#L2483)). Wire the fold-in:

1. **Schema:** add optional `skills?: string[]` to the agent catalog entry type (ids into the skill
   catalog). Update [marketplace/agents.json](../marketplace/agents.json) entries per the gap list (B3).
2. **Mount-on-Add:** in `toAgentConfig` (or right after, before `sessionManager.create`), resolve each
   declared skill id against the loaded skill catalog and **append the skill `body`s into the agent's
   `systemPrompt` under a delimited `## Playbooks` section.** Requirements:
   - Unknown id → skip + log, never throw.
   - **Idempotent:** re-adding / re-resolving must not duplicate the Playbooks block (guard on a marker).
   - Bounded: cap total injected length sanely (skills are short; don't blow the prompt).
3. **Tests:** a member with `skills` gets a `## Playbooks` block containing each resolved body; unknown
   ids are skipped; no duplicate block on a second mount; a member with no `skills` is unchanged.

### Contract (frozen — shared with Codex B1)
```ts
AgentCatalogEntry.skills?: string[]                 // ids into the skill catalog
// On Add: resolve ids → append skill.body into config.systemPrompt under "## Playbooks" (idempotent)
```

## B3 — Skill content (author the batch)

Per the [DESIGN gap list](DESIGN_member_skills.md): (a) attach the **6 existing** skills to the right
members in agents.json; (b) author the **top ~10 new** market-proven skills (one per member that has
none — prioritize security / testing / devops / pm), to the schema in
[marketplace/skills.json](../marketplace/skills.json) (`id, name, summary, category, capabilities, body`).

**Curation bar (hard rules):**
- Every new skill **maps to ≥1 member** (wire it in agents.json in the same change).
- **License-clean:** base on the *public standard* (OWASP Top 10, WCAG 2.1 AA, Conventional Commits,
  semver, 12-factor, OpenAPI conventions) — **write our own wording**, never paste proprietary text.
- Each `body` is an actionable, numbered playbook that makes a member's output measurably better
  (match the tone/shape of the existing 6).
- Keep ids kebab-case and stable.

> This authoring is itself a good crew dogfood — tech-writer + reviewer members can draft to schema;
> you (DeepSeek) finalize the JSON. Either way the content goes through Claude's gate.

## Files
- [src/extension.ts](../src/extension.ts) — schema field, mount-on-Add injection (`toAgentConfig`).
- Wherever `AgentCatalogEntry` is typed (catalog types) — add `skills?`.
- [marketplace/agents.json](../marketplace/agents.json) — add `skills` to members.
- [marketplace/skills.json](../marketplace/skills.json) — author the new batch.
- Tests alongside the install/agent-config code.

## Acceptance
- `build`+`lint`+`test` green; injection + skip + idempotency covered by tests.
- **Code/content only — you cannot drive the GUI** (headless coding agent): don't install the VSIX or
  click the Marketplace; 张/Claude run the GUI smoke. Verify via tests + reading the JSON.
- Deliver code + content + a short note on contract friction with Codex's B1.

## Constraints
- Reuse the existing catalog loader + skill schema; match style. Respect the curation bar.
- No version/CHANGELOG/publish — hand back to Claude to cut 0.8.2.
