# TASK — 0.6.1b · Marketplace Starter Pack expansion (Kilo-adapted)

**Owner:** RoamClaw / DeepSeek · **Reviewer + launch-verifier:** Claude · **Type:** content authoring (pure data)
**Schema (frozen):** [`src/marketplace/catalog.ts`](../src/marketplace/catalog.ts) · **Authoring contract:** [`marketplace/README.md`](../marketplace/README.md) · **Design:** [V0.6.1_STARTER_PACK_AND_HOSTED_CATALOG.md](V0.6.1_STARTER_PACK_AND_HOSTED_CATALOG.md)

> **Branch `feat/starter-pack` from CURRENT `main`, in your OWN worktree** (not the shared primary checkout — repeated collisions). `main` already includes the **Hermes Bridge** (MCP) and **Hermes Operator** (agent) entries from 0.6.5 — **append after them, don't collide or remove them.** You edit **only** `marketplace/*.json` and add `THIRD_PARTY_NOTICES.md`. No `.ts` changes. `npm test` validates your JSON — fix until green. **Commit your work on the branch before pinging** (don't leave it uncommitted).

---

## Goal
Expand the curated catalog (currently **8 agents** incl. Hermes Operator / **9 MCP** incl. Hermes Bridge / 6 skills) into a fuller "Starter Pack," adapting the **public, MIT-licensed** Kilo/Roo ecosystem (repo files only — NOT their online API). Target the **in-repo** `marketplace/*.json` (ships in a later patch, and/or via the hosted catalog once a URL is live). **Do not bulk-copy** — extract and rewrite into Roam's own entries.

## What to produce

### `agents.json` — ADD 5 presets (keep the existing 7; append, unique ids)
Kilo "modes" → Roam Agent presets. Suggested: **Debugger**, **Frontend Developer**, **Backend Developer**, **Docs Writer** (distinct id from existing `technical-writer` — or skip if redundant), **Planner/Orchestrator**.
- `role` ∈ `architect, developer, reviewer, qa, pm, product-manager, devops, tech-writer, security, data-engineer, senior-dev, tester`.
- `skills[]` MUST be ids from SKILL_LIBRARY: `code-generation, code-review, debugging, architecture, testing, documentation, project-management, security-audit, performance, devops, data-engineering, ui-ux, business-analysis, strategy, financial-modeling, market-research`. **(The M0 backstop fails CI on any other id.)**
- `model`/`tier`: `claude-opus-4-8`/premium, `claude-sonnet-4-6`/standard, `claude-haiku-4-5-20251001`/economy. Match tier→model.
- Real, specific `systemPrompt` (2–5 sentences). `icon` (emoji) + `color` recommended.
- **Optional (0.6.5 schema):** a preset may bind a marketplace MCP server via `"mcpServers": ["<mcp-id>"]` (like the Hermes Operator binds `hermes-bridge`). Only reference an MCP `id` that exists in `mcp.json`.

### `mcp.json` — ADD 8–12 well-known servers (keep the existing 8; append, unique ids)
**This is where past attempts failed — read carefully:**
- **Runtime matters.** The reference `@modelcontextprotocol/*` servers split by language:
  - **npx (Node/TS):** filesystem, memory, everything, sequentialthinking — and the archived TS servers: github, gitlab, postgres, slack, brave-search, puppeteer, google-maps, gdrive, redis, sentry, everart, aws-kb-retrieval.
  - **uvx (Python):** git, fetch, time, sqlite. → use `"command": "uvx", "args": ["mcp-server-<name>", …]` (NOT `npx @modelcontextprotocol/server-<name>` — those npm packages don't exist).
- **Placeholders:** in `args`, use ONLY `${WORKDIR}` (the workspace root — the only token the runtime substitutes). Secrets go in `env` as `${VAR}` (resolved from SecretStorage). **Any other `${...}` in args launches literally and is broken.**
- `requiresApproval: true` for anything touching filesystem / network / credentials (i.e. almost all).
- **`source`** (the repo URL) is REQUIRED. Current servers: `…/servers/tree/main/src/<name>`; archived: `…/servers-archived/tree/main/src/<name>`.
- **If you cannot confirm a server's real package name + runtime from its repo, DROP it.** Do not guess. (Past runs invented `example.com` URLs and non-existent packages — that fails review.)
- **Bridge / self-hosted servers (0.6.5 schema):** if a server's endpoint is user-specific (a remote/self-hosted HTTP service), don't hardcode a fake `url` — use `"transport": "streamable-http"` with a `"urlPrompt": { "title", "prompt", "placeHolder" }` so the user supplies their endpoint at install (like `hermes-bridge`). Don't duplicate `hermes-bridge` itself.
- Good candidates to research: postgres, redis, slack, gitlab, google-maps, sentry, time, sequentialthinking, everything, notion (if a maintained MIT server exists).

### `skills.json` — leave as-is (Phase 3)
Skills install is deferred until the on-demand loader. Don't expand `skills.json` in this task.

### `THIRD_PARTY_NOTICES.md` (new, repo root)
Add Kilo Code's MIT attribution: copyright line + a note that MCP/mode catalog entries were adapted from the public MIT-licensed Kilo Code repository, with the repo URL. (MIT requires preserving the copyright + license notice.)

## Rules
- **Schema-valid above all:** run `npx vitest run src/marketplace` after every edit — it tells you the exact field + reason on failure.
- Unique `id`s within each file. No secrets (only `${VAR}` placeholders in `env`).
- Append to the existing arrays; don't remove or renumber current entries.
- Don't edit `.ts`, don't edit the tests, don't touch other tasks' files.

## Definition of Done
- [ ] `agents.json`: **+5 new** appended (the existing 8 incl. Hermes Operator untouched), all skill ids valid, `npx vitest run src/marketplace` green.
- [ ] `mcp.json`: **+8–12 new** appended (the existing 9 incl. Hermes Bridge untouched), each with correct runtime (npx/uvx) or a `urlPrompt` for bridge-style servers, `${WORKDIR}`/secret placeholders only, `requiresApproval` set, real `source`.
- [ ] `THIRD_PARTY_NOTICES.md` added with Kilo MIT attribution.
- [ ] `git diff --stat` shows only `marketplace/*.json` + `THIRD_PARTY_NOTICES.md`.
- [ ] **Commit on `feat/starter-pack`** (don't leave uncommitted), then ping Claude. **Claude will LAUNCH-VERIFY each new MCP server** (npx/uvx resolves, server starts) before merge — entries that don't launch get dropped or fixed. This gate is non-negotiable: a broken "Add" erodes trust.

## Why you (and what we're watching)
Agent presets are your strength (the 0.6.0 set was high quality). MCP runtime is where you've slipped (npx-vs-uvx, fake URLs) — the explicit runtime table above is there to fix that. We're watching whether, with the rules inlined, you produce launch-correct MCP entries on the first pass.
