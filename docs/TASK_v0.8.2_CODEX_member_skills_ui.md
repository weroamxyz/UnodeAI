# TASK v0.8.2 (B1) — Codex: Member-skills UI (Marketplace)

**Owner:** Codex (UI). **Part of:** [DEVPLAN_v0.8.2.md](DEVPLAN_v0.8.2.md), Thread B.
**Gatekeeper/publisher:** Claude. Don't bump version or publish.
**Spec:** [DESIGN_member_skills.md](DESIGN_member_skills.md).

## Context

Decision: skills are **folded into members**, not a standalone store. Today
[MarketplacePanel.ts:231](../src/views/MarketplacePanel.ts#L231) ships a **disabled "Coming in Phase 3"
Skills tab** and `skillCards()` prints "Skills arrive in Phase 3" — a dead tab in users' faces. And
member (agent) cards don't show which skills a member brings.

## Scope (webview/UI only)

1. **Remove the dead Skills tab.** Delete the disabled `Skills` tab button + the `#skills` section +
   `skillCards()` + the now-unused skills plumbing in the renderer. The Marketplace shows **Agents** and
   **MCP** only. (Keep `catalog.skills` data flowing — the backend/cards still read it; just don't
   render a standalone tab.)
2. **Member cards show what's included.** On each agent card, if the entry declares `skills`, render a
   compact **"Includes: <skill name>, <skill name>"** line (resolve ids → names from `catalog.skills`;
   unknown id → skip). Keep it subtle (meta styling), `esc()`'d, no layout breakage when absent.
3. Tests: extend [MarketplacePanel.test.ts](../src/views/__tests__/MarketplacePanel.test.ts) — no Skills
   tab rendered; an agent entry with `skills` renders the Includes line with resolved names; an entry
   without `skills` renders no line.

## Contract (frozen — shared with DeepSeek B2)

```ts
// Agent catalog entry gains an optional field (DeepSeek defines the type; you only read it):
AgentCatalogEntry.skills?: string[]   // ids into catalog.skills
// Resolve id → name via catalog.skills for the "Includes:" line. No install button for skills.
```

## Files
- [src/views/MarketplacePanel.ts](../src/views/MarketplacePanel.ts) — drop Skills tab; add Includes line.
- [src/views/__tests__/MarketplacePanel.test.ts](../src/views/__tests__/MarketplacePanel.test.ts).

## Acceptance
- `build`+`lint`+`test` green. No standalone Skills tab anywhere; member cards show includes.
- No GUI smoke from you — deliver code + tests + 5-line summary. Claude/张 run the panel by hand.

## Constraints
- Renderer-only; CSP/nonce intact; all dynamic text escaped. No version/CHANGELOG/publish.
