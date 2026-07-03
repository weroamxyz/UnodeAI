# TASK — Codex · Context injection: host-side gather (Cline #2)

**Owner**: Codex · **Reviewer**: Claude · **Target**: last v0.5.x feature (next version)
**Goal**: stop agents "starting blind." At turn start, gather the **active editor file (capped) + workspace diagnostics** and hand it to the backend, which injects it ephemerally. Codex owns the **host gather**; Claude owns the **backend inject point** (the `workspaceContext` contract).

> ⚠️ Grounded against real plumbing — reuse, don't invent. This mirrors how `projectContext` already flows host→attachments→backend.

---

## The contract (so we build in parallel)
Claude adds `workspaceContext?: string` to `TurnAttachments` ([AgentBackend.ts:115](../src/backend/AgentBackend.ts#L115)) and injects it at `runTurn` start (ephemeral, token-capped). **You populate that field on the host side.** Build against this field; if the type isn't there yet, add a local `as any` shim and remove it after Claude's backend merges (backend merges first).

---

## What to build (host side)
Where turns are dispatched (the path that builds `TurnAttachments` / calls `sendUserTurn` — grep `projectContext` in [extension.ts](../src/extension.ts) and [SessionManager.ts](../src/session/SessionManager.ts) and mirror it), assemble a bounded "workspace orientation" string **only when the setting is on**:

1. **Setting**: new `roam.engine.workspaceContext` (boolean, **default `false`** — opt-in until RoamClaw's R5 measures the token cost).
2. **Active file**: `vscode.window.activeTextEditor` → relative path + a **capped** content slice (≤ ~150 lines or a fixed char cap; if larger, head + a note `"(truncated — use read_file for the rest)"`).
3. **Diagnostics**: `vscode.languages.getDiagnostics()` → filter **Error/Warning only**, cap the count, format compactly (reuse the `formatPostWriteDiagnostics` style if it helps).
4. Pass the assembled string on `TurnAttachments.workspaceContext`.

**Bounds are the whole game**: injecting a huge file every turn is the failure mode. Cap hard on the host (Claude also caps backend-side as a backstop). Don't persist anything — it's gathered fresh per turn.

---

## Files you may touch
- `extension.ts` (the turn-dispatch path that builds attachments), `src/session/SessionManager.ts` (if the attachment plumbing lives there), `package.json` (the new setting).
- **Do NOT touch** `src/backend/*` — the inject point + backstop cap are Claude's lane.

## Tests
1. **Off by default** → attachments carry no `workspaceContext` (turn body unchanged).
2. **On, with an active file + diagnostics** → `workspaceContext` contains the capped file slice + the error/warning summary; an over-long file is truncated with the read_file note.
3. Setting toggles live (responds to `onDidChangeConfiguration`).

## DoD
- [ ] `roam.engine.workspaceContext` setting (default off).
- [ ] Host gather: active file (capped) + Error/Warning diagnostics (capped), on `TurnAttachments.workspaceContext`.
- [ ] 3 tests + `npm test` + `npm run build` green.
- [ ] No `src/backend` edits. Diff stays in host/UI/settings.
- [ ] PR references this card; integrates after Claude's backend merges (then remove any `as any` shim).
