# DevPlan — Cline-class command execution (VS Code integrated terminal + shell integration)

> Claude-maintained · 2026-06-09 · Promotes BACKLOG #13 from a research item to a planned epic.
> Motivation: agents can't run vitest (and other TTY-needing tools) via `run_command` because it uses
> raw-pipe `child_process.spawn` (no controlling terminal). Cline/Claude Code/Codex give commands a
> REAL terminal (PTY), so those tools work AND the user can see what's running. Match that.

## 1. The gap (today)
- `WorkspaceTools.runCommand` and `TeamTools` run commands with `spawn(cmd, { stdio:['ignore','pipe','pipe'], shell:true })` — no PTY, no TTY, invisible to the user.
- Works for single-process tools (tsc/eslint/git/npm install). FAILS for tools that need a terminal / spawn a worker pool (vitest worker runtime won't init in the console-less Electron tree on Node 25; "No test suite found" / "failed to find the runner").
- Cline et al. don't hit this because they execute inside a VS Code integrated terminal (PTY-backed) via the Shell Integration API.

## 2. Target mechanism
VS Code **Shell Integration API** (stable since VS Code 1.93):
- `const term = vscode.window.createTerminal({ name, cwd, hideFromUser? })`
- Wait for `term.shellIntegration` to become available (event `window.onDidChangeTerminalShellIntegration`, with a timeout).
- `const exec = term.shellIntegration.executeCommand(commandLine)`
- Stream output: `for await (const chunk of exec.read()) { ... }` (assemble + cap like today's 16 KB).
- Exit code: `window.onDidEndTerminalShellExecution(e => e.execution === exec ? e.exitCode : ...)`.
- The child gets a real TTY → vitest workers initialize → tests run. The terminal tab is visible (visibility win).

## 3. Architecture
Keep `WorkspaceTools` / `TeamTools` vscode-free and unit-testable: execution stays behind an **injected runner**.
- Define `CommandRunner` (already exists in TeamTools: `(command, cwd) => Promise<{ code, output }>`). Reuse/standardize it; have `WorkspaceTools` accept the same injected runner instead of spawning directly.
- New **`TerminalCommandRunner`** (extension-side, vscode-dependent): implements `CommandRunner` using the shell-integration flow above.
- **Feature-detect + graceful fallback:** if shell integration isn't available (older VS Code, unsupported shell — cmd.exe is weak; bash/zsh/pwsh/fish are good) OR times out, fall back to the current `spawn` runner. So nothing regresses where terminals aren't usable.
- All existing layers run BEFORE execution, unchanged: `normalizeRunnerCommand` (npx→npm rewrite), `CommandPolicy` gating + `ask` approval, output cap. The runner is purely the "how it executes" swap.
- `engines.vscode`: bump `^1.85.0` → `^1.93.0` (shell integration stable). 1.93 = Aug 2024, universally adopted by 2026.

## 4. Terminal model
- **Per-agent terminal**, named `Roam: <agent>` (fits the multi-agent story + parallel visibility). Created lazily on first command, reused, disposed when the agent stops. A shared single terminal is the simpler fallback if per-agent proves heavy.
- Output still streams into the chat tool card as today (the terminal is the executor + a visible mirror, not the only surface).

## 5. Phases
- **Phase 1 — close the gap (MVP).** `TerminalCommandRunner` + feature-detect + spawn fallback; route `run_command` + `run_checks` through the injected runner; bump engine. DoD: an agent runs `npm test` and it PASSES (vitest workers init in the PTY); command shows in a visible terminal; CommandPolicy/approval/normalize unchanged; spawn fallback verified; build+lint+suite green.
- **Phase 2 — visibility/UX.** Per-agent named terminals, reveal-on-click from the chat tool card / Team panel; clean lifecycle (dispose on stop).
- **Phase 3 — background/long-running.** `run_in_background`, `check_command`, `kill_command` adapted to the terminal model (a long command keeps its terminal; check reads accumulated output; kill sends Ctrl-C / disposes).

## 6. Gotchas
- **Shell integration coverage:** great for bash/zsh/pwsh/fish; cmd.exe is limited → fallback to spawn there. Detect per-terminal.
- **Output fidelity:** shell-integration output is a stream; assemble, strip control sequences, cap to 16 KB (as today). Slightly less clean than a pure stdout pipe — handle ordering/partial chunks.
- **Exit code reliability:** depends on shell integration being active; if `exitCode` is undefined, treat as unknown and fall back / surface raw output.
- **Keep WorkspaceTools pure:** the terminal lives in the extension; inject the runner (don't import vscode into backend/).
- **Tests:** unit tests use a fake `CommandRunner`; the terminal path is covered by E2E (it needs a real VS Code host).

## 7. Effort & sequencing
Medium-large. Phase 1 is the meaningful chunk (the gap-closer); Phases 2–3 are incremental. Fits the v0.4 "trust + real terminal" bucket; given the dogfooding pain, Phase 1 is worth pulling earlier. Claude implements (core execution path); never delegate the spawn/security-sensitive layer.
