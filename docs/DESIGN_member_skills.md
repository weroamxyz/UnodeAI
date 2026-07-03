# DESIGN — Member Skills (skills folded into team members)

**Decision (2026-06-15):** UnodeAi does **not** ship a standalone "Skills store." A skill is a
reusable, market-proven playbook that a **team member carries**. Members are the unit users install;
skills are how each member is made reliable and differentiated ("our members come equipped with
verified playbooks"). This is the capability layer behind the "weak model + strong execution
framework" thesis and merges with the 0.9 project-conventions injection.

## Data model

Skills already have a schema — [marketplace/skills.json](../marketplace/skills.json):
`{ id, name, summary, category, capabilities[], body }`. The `body` is the playbook (markdown).

**New:** a member catalog entry ([marketplace/agents.json](../marketplace/agents.json)) may declare the
skills it ships with:

```jsonc
{ "id": "security-auditor", "role": "security", "name": "Security Auditor",
  "systemPrompt": "...",
  "skills": ["dependency-risk-triage", "owasp-top10-review"] }   // ← new, optional, ids into skills.json
```

## Mounting contract (frozen)

When a catalog member that declares `skills` is **Added**:
1. Resolve each id against the skill catalog (bundled + hosted). Unknown id → skip + log, never throw.
2. Append the resolved skill `body`s into the new agent's system prompt under a clearly delimited
   **`## Playbooks`** section (the agent treats them as standing procedures). Keep it idempotent —
   re-adding doesn't duplicate the block.
3. The member card surfaces an **"Includes: <skill names>"** line so the buyer sees what they get.

> MVP for 0.8.2: mount-on-add by injecting bodies into the system prompt. Out of scope (later):
> standalone skill install, attach-arbitrary-skill-to-any-agent, hosted skill-only catalog.

## Curation bar (so "more" doesn't become noise)

- **Every skill maps to ≥1 member.** We collect a skill because a member needs it, not to pad a store.
- **License-clean:** market-proven means the *practice* (OWASP, WCAG 2.1, Conventional Commits, semver,
  12-factor, REST/OpenAPI conventions). Cite the public standard; **write our own wording** — never
  paste proprietary prompts/docs.
- **Must measurably improve output.** If a member doesn't produce visibly better work with the skill
  on, it's noise — cut it. Prefer ~30 curated over 300 padded.
- **Categorize by member role** (security / testing / a11y / docs / api / devops / data / review / pm).

## Per-member skill gap list (the content roadmap)

13 members today; 6 skills authored. ✅ = exists in skills.json, ➕ = author next (market-proven).

| Member (role) | Has ✅ | Author next ➕ |
| --- | --- | --- |
| security-auditor (security) | dependency-risk-triage | owasp-top10-review, secrets-scanning, authz-check |
| api-designer (architect) | api-contract-review | openapi-lint, api-versioning-semver, error-shape-design |
| test-engineer (tester) | test-coverage-gap | flaky-test-triage, test-pyramid-review |
| performance-optimizer (developer) | — | perf-budget-audit, n+1-query-detection, bundle-size-analysis |
| devops-engineer (devops) | — | ci-pipeline-review, dockerfile-best-practices, iac-secret-hygiene |
| technical-writer (tech-writer) | documentation-lint | readme-quickstart-quality, changelog-hygiene |
| hermes-operator (pm) | — | task-decomposition, acceptance-criteria-authoring, delegate-verify-discipline |
| data-engineer (data-engineer) | — | schema-migration-safety, data-quality-checks, pii-handling |
| debugger (developer) | — | root-cause-analysis, repro-minimization, regression-test-first |
| code-reviewer (reviewer) | commit-message-quality | pr-review-checklist, diff-risk-triage |
| frontend-developer (developer) | accessibility-audit | component-a11y, state-management-review |
| backend-developer (developer) | — | api-error-handling, idempotency, transaction-boundaries |
| qa-analyst (qa) | test-coverage-gap | acceptance-test-authoring, edge-case-enumeration |

**0.8.2 content MVP:** wire the 6 existing onto their members + author the **highest-value ~10 ➕**
(one per member that has none, prioritizing security/testing/devops/pm). The rest accrue continuously
(not version-gated). Authoring is a good crew dogfood (tech-writer + reviewer members draft to schema,
verified through our gate).
