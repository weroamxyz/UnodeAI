# TASK — M3 · Author the marketplace catalog content

**Owner:** DeepSeek / UnodeAi (RoamClaw) · **Reviewer:** Claude · **Type:** content authoring (pure data — zero core code)
**Authoring contract:** [`marketplace/README.md`](../marketplace/README.md) · **Schema (frozen):** [`src/marketplace/catalog.ts`](../src/marketplace/catalog.ts) · **Design:** [V0.6.0_MARKETPLACE_AND_HEADER_IA.md](V0.6.0_MARKETPLACE_AND_HEADER_IA.md) §4

> **Branch `feat/m3-catalog-content`.** You edit **only** `marketplace/agents.json`, `marketplace/mcp.json`, `marketplace/skills.json`. Do not touch any `.ts` file. `npm test` validates your JSON — a bad entry fails with the exact field + reason; fix it until green.

---

## Goal
Fill the three (currently empty) catalog files with high-quality, **schema-valid** entries. This is what the Marketplace shows. Validation runs in CI via `src/marketplace/__tests__/catalog.test.ts` — your only definition of "correct shape" is: **`npx vitest run src/marketplace` passes.**

## What to produce

### `agents.json` — 6–8 agent presets (`AgentCatalogEntry[]`)
Each is a usable specialist. Required fields: `id, name, role, summary, skills, model, tier, systemPrompt` (`icon`/`color` recommended).
- **`role`** must be one of: `architect`, `developer`, `reviewer`, `qa`, `pm`, `product-manager`, `devops`, `tech-writer`, `security`, `data-engineer`, `senior-dev`, `tester`.
- **`skills`** must be ids from the skill library: `code-generation`, `code-review`, `debugging`, `architecture`, `testing`, `documentation`, `project-management`, `security-audit`, `performance`, `devops`, `data-engineering`, `ui-ux`, `business-analysis`, `strategy`, `financial-modeling`, `market-research`.
- **`tier`**: `premium` | `standard` | `economy`.
- **`model`**: a Claude model id (e.g. `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`) — match the tier (premium→opus, standard→sonnet, economy→haiku).
- Suggested set (pick 6–8, vary roles): Security Auditor, API Designer (architect), Test Engineer (qa), Performance Optimizer, DevOps Engineer, Technical Writer, Data Engineer, Code Reviewer. Write a real, specific `systemPrompt` for each (2–5 sentences, role-focused).

### `mcp.json` — 6–8 MCP servers (`McpCatalogEntry[]`)
**Real, well-known servers only.** Required: `id, name, summary, transport` (+ `command` for stdio / `url` for remote). Add `args`, `env` (`${VAR}` placeholders — **never real secrets**), `requiresApproval: true` for anything that touches the filesystem/network/credentials, and **`source`** (the homepage/repo URL — required for provenance in your DoD).
- Good candidates (verify each against its docs): `@modelcontextprotocol/server-filesystem`, `server-git`, `server-github`, `server-fetch`, `server-memory`, `server-sqlite`, `server-puppeteer`/`playwright`, `brave-search`. Most run via `npx -y <pkg>`.
- Cite where each came from in `source`. If you can't confirm a server's command/package, **drop it** — don't guess.

### `skills.json` — 4–6 skill packages (`SkillCatalogEntry[]`)
Required: `id, name, summary, category, capabilities`. `body` (inline SKILL.md markdown) optional but nice.
- **`category`**: `development`, `design`, `documentation`, `management`, `security`, `infrastructure`, `data`, `external`.
- **`capabilities`**: builtin tool tokens — from `read`, `write`, `search`, `execute`.
- Suggested: API Contract Review, Accessibility Audit, Commit Message Quality, Test Coverage Gap, Dependency Risk Triage.

## Rules
- **Schema-valid above all** — run `npx vitest run src/marketplace` after every edit; it tells you exactly what's wrong.
- Unique `id`s within each file (duplicates fail validation).
- No secrets anywhere. `env` uses `${VAR}` placeholders only.
- Don't edit `.ts`, don't edit `catalog.test.ts`, don't touch other M-tasks' files.

## Definition of Done
- [ ] `agents.json` (6–8), `mcp.json` (6–8), `skills.json` (4–6) authored.
- [ ] `npx vitest run src/marketplace` **green** (the bundled-file test parses all three).
- [ ] Every MCP entry has a real `source` URL and a verified package/command.
- [ ] Only `marketplace/*.json` changed — `git diff --stat` shows nothing else.
- [ ] Ping Claude to review content quality (Claude gatekeeps + merges).

## Why you (and what we're watching)
This is bounded, genuinely valuable, and **can't break core code** — ideal for accumulating dogfooding data. We're specifically watching: does the 0.5.12 context-injection feature + this card's inlined conventions (the role/skill/category lists above) let you produce schema-valid JSON **without** the "environment is broken" flailing? Author straight against the lists; the test is your ground truth.
