# TASK v0.8.2 — Codex: Worktree review board, Phase 2 (UI)

**Owner:** Codex (you built this panel in 0.7.0 — you own the UI layer).
**Gatekeeper / integrator / publisher:** Claude (do **not** bump version or publish).
**Runs in parallel with:** DeepSeek (backend data + lane actions) and Kimi (audit).
**Type:** patch (0.8.2) — finishing the "review the PR from your crew" moment. No new headline capability.

## Context

The verifier-as-gate badges already ship: [WorktreePanel.ts](../src/views/WorktreePanel.ts)
renders per-lane Verified / Verified·review-tests / Failing(+output) / Unverified, plus the
staged-files list and a Finalize button. Three things are still stubbed or missing — that's this task:

1. **Per-lane diffs** — the file header literally says *"Phase 2: per-file/inline diffs in the lanes."*
   Today a lane shows agent + branch + verify badge, but **not what changed**. A review board you
   can't read the diff in is half a feature.
2. **Live refresh** — the panel renders only on open and after Finalize. While the crew is working,
   it's a stale snapshot. It should update as lanes change state (start / verify pass / verify fail).
3. **Failed-lane actions** — a failing lane is shown "held," but the only button anywhere is Finalize.
   The reviewer needs **Re-verify** and **Hand back to agent** on a held/failing lane.

## Scope (you own the webview + the panel↔extension message wiring)

### In
- **Per-lane changed files:** render `lane.changedFiles` (new field, see contract) as a compact list
  under each lane; each file is a clickable link that posts `{ command: 'openLaneDiff', agent, file }`.
  Also a lane-level "View diff" that posts `{ command: 'openLaneDiff', agent }` (whole-lane diff).
- **Live refresh:** add `WorktreePanel.current?.update(review)` that re-renders from a pushed snapshot
  (extension will call it on coordinator events — Claude/DeepSeek provide the event hook). Preserve
  scroll position and any open `<details>` where reasonable.
- **Failed/held lane actions:** on `failed` (and the `tampered` "review tests") lanes, render
  **Re-verify** → posts `{ command: 'reverifyLane', agent }`, and **Hand back** → posts
  `{ command: 'handBackLane', agent }`. Disable while in-flight; the push refresh re-enables.
- Keep CSP/nonce discipline (`webviewSecurity`); all dynamic text stays `esc()`/`escAttr()`'d.

### Out (DeepSeek's half — don't implement, just call via the contract)
- Computing the diff text, listing changed files, the re-verify / hand-back coordinator logic, and the
  event the extension subscribes to. You consume them through the contract below.

## Interface contract (frozen — code against this so we parallelize)

```ts
// WorktreePanel.ts — add to the lane shape:
lanes: { agent; branch; path; verification?; changedFiles?: string[] }[]

// webview → extension messages (extension side handled by DeepSeek/Claude):
{ command: 'openLaneDiff', agent: string, file?: string }   // open VS Code diff for lane (or one file)
{ command: 'reverifyLane', agent: string }                   // re-run the verify command on the lane
{ command: 'handBackLane', agent: string }                   // return the lane to its agent to fix

// extension → webview (live refresh): WorktreePanel.current.update(review: WorktreeReview)
```

## Files
- [src/views/WorktreePanel.ts](../src/views/WorktreePanel.ts) — render + messages + `update()`.
- [src/views/__tests__/WorktreePanel.test.ts](../src/views/__tests__/WorktreePanel.test.ts) — extend:
  renders changedFiles; emits each new message; `update()` re-renders without recreating the panel.

## Acceptance
- `npm run build && npm run lint && npm test` green; new render/message paths covered.
- No GUI smoke from you — Claude/张 run the panel by hand. Deliver code + tests + a 5-line summary of
  what you changed and any contract friction.

## Constraints
- Renderer-only mindset: no git/process calls in the panel — everything via messages/contract.
- Don't touch versioning, CHANGELOG, or publish. Hand back to Claude to integrate as 0.8.2.
