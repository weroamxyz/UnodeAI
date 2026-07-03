# TASK v0.8.2 — DeepSeek (RoamCrew): lane diffs + re-verify / hand-back (backend)

**Owner:** DeepSeek (RoamCrew team). **Gatekeeper/publisher:** Claude (don't bump version/publish).
**Runs in parallel with:** Codex (panel UI) and Kimi (audit).
**Type:** patch (0.8.2) — backend data + actions behind the Phase-2 review board.

## Context

The review panel (Codex) is getting per-lane diffs, live refresh, and Re-verify / Hand-back buttons.
Those need backend support. Most primitives already exist — **reuse, don't reinvent:**

- [extension.ts](../src/extension.ts) `changedFilesInWorktree(path)` (L1007) — `git diff --name-only base...HEAD`.
- [extension.ts](../src/extension.ts) `gatherWorktreeReview()` (L1014) — builds the `WorktreeReview` snapshot.
- `createUnifiedDiff` (imported at [extension.ts:34](../src/extension.ts#L34)) — produce diff text.
- [WorktreeCoordinator.ts](../src/backend/WorktreeCoordinator.ts) — owns lanes, `verification(agentId)`,
  the `changedFiles` dep (L42), and the merge/hold logic.
- [Verifier.ts](../src/backend/Verifier.ts) — `verify(cwd)`.

## Scope (backend only — no webview, no GUI)

1. **Put changed files in the snapshot.** In `gatherWorktreeReview()`, populate
   `lane.changedFiles` via `changedFilesInWorktree(wt.path)` (the field Codex renders).
2. **Lane diff provider.** Add `laneDiff(agent: string, file?: string): Promise<string>` (extension
   helper) returning a unified diff of that lane's worktree vs base (`git diff base...HEAD`, optionally
   scoped to one file). Used by the `openLaneDiff` message handler to open a VS Code diff/virtual doc.
   Handle: no changes (empty), binary files, renames — degrade gracefully, never throw to the UI.
3. **Re-verify a lane.** On `reverifyLane`, re-run the verify command on that lane via the coordinator
   and refresh its stored verification state (reuse `Verifier`; respect the same allow/ask gate that
   the merge path uses — **never auto-run an unapproved command**, mirror the existing Verifier skip).
4. **Hand back a lane.** On `handBackLane`, send the agent a fix-it instruction (via `messageBus`,
   same mechanism PM→worker uses) and mark the lane held; the agent's next turn works the lane again.
5. **Live-refresh hook.** The panel needs to re-render when a lane's state changes. If the
   `WorktreeCoordinator` doesn't already emit on verify-state change, add a **minimal** emitter
   (e.g. an `onDidChange` callback / tiny EventEmitter) the extension can subscribe to and then call
   `WorktreePanel.current?.update(await gatherWorktreeReview())`. Keep it small and debounced.

## Interface contract (frozen — same doc Codex has)

```ts
lane.changedFiles?: string[]                                   // you populate in gatherWorktreeReview
laneDiff(agent, file?) : Promise<string>                       // you implement
onMessage: 'openLaneDiff' | 'reverifyLane' | 'handBackLane'    // you implement the ext-side handlers
WorktreeCoordinator change event → extension pushes update()   // you add the emitter if missing
```

## Files
- [src/extension.ts](../src/extension.ts) — snapshot field, `laneDiff`, message handlers, event sub.
- [src/backend/WorktreeCoordinator.ts](../src/backend/WorktreeCoordinator.ts) — re-verify / hand-back
  + change emitter.
- Tests: [WorktreeCoordinator.test.ts](../src/backend/__tests__/WorktreeCoordinator.test.ts) and/or the
  integration test — cover re-verify flips state, hand-back holds + notifies, emitter fires once per change.

## Acceptance
- `npm run build && npm run lint && npm test` green; new logic has unit/integration coverage.
- **Code-level only — you cannot drive the GUI** (you're a headless coding agent). Do not try to open
  the panel, install the VSIX, or click anything; 张/Claude run the GUI smoke. Verify via tests.
- Deliver code + tests + a short note on any contract friction with Codex's half.

## Constraints
- Reuse existing helpers; match surrounding style. Respect the command-approval gate on re-verify.
- Don't touch versioning/CHANGELOG/publish — hand back to Claude.
