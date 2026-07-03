/*---------------------------------------------------------------------------------------------
 *  UnodeAi - commandNormalize  (agent robustness, structural backstop)
 *  Weak/cheap agents repeatedly run test/type/lint runners DIRECTLY (e.g. `npx vitest`) instead of
 *  the project's own scripts. That fails in two ways: bare `vitest` launches WATCH mode (never exits
 *  → run_command times out), and a direct call bypasses the flags the project script bakes in. The
 *  agent then misattributes the failure to "broken infrastructure".
 *
 *  This rewrites a direct runner invocation into the project's matching npm script (so it can't get it
 *  wrong), and — when there's no matching script — at least forces vitest out of watch mode. Pure and
 *  injectable; the project's package manager + scripts come from ProjectConventions.
 *--------------------------------------------------------------------------------------------*/

export interface ProjectCommandInfo {
  /** npm | pnpm | yarn | bun (defaults to npm). */
  packageManager: string;
  /** package.json scripts: name -> body. */
  scripts: Record<string, string>;
}

export interface NormalizedCommand {
  command: string;
  /** A short note to surface in the tool output so the agent learns to use the project's scripts. */
  note?: string;
}

/** Binaries agents tend to call directly (bypassing the project's scripts) and get wrong. */
const RUNNERS = new Set(['vitest', 'jest', 'mocha', 'tsc', 'eslint', 'playwright']);
const RUNNER_WRAPPERS = new Set(['npx', 'bunx']);      // <wrapper> <runner>
const PM_EXEC = new Set(['exec', 'dlx', 'x']);          // <pm> exec|dlx|x <runner>
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * Locate the runner program in a token list, peeling an npx/pnpm-exec style wrapper. Returns the
 * runner name and the index where its first argument would go, or undefined if this isn't a direct
 * runner invocation (e.g. `npm test`, `pnpm run build` — already going through the project scripts).
 */
function findRunner(tokens: string[]): { runner: string; argInsertIdx: number } | undefined {
  if (tokens.length === 0) {
    return undefined;
  }
  const t0 = tokens[0].toLowerCase();
  // bare: `vitest ...`
  if (RUNNERS.has(t0)) {
    return { runner: t0, argInsertIdx: 1 };
  }
  // `npx vitest`, `bunx vitest` (skip flags like -y / --yes)
  if (RUNNER_WRAPPERS.has(t0)) {
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) { i++; }
    const r = tokens[i]?.toLowerCase();
    return r && RUNNERS.has(r) ? { runner: r, argInsertIdx: i + 1 } : undefined;
  }
  // `pnpm exec vitest`, `yarn dlx vitest`, `bun x vitest`
  if (PACKAGE_MANAGERS.has(t0) && tokens[1] && PM_EXEC.has(tokens[1].toLowerCase())) {
    const r = tokens[2]?.toLowerCase();
    return r && RUNNERS.has(r) ? { runner: r, argInsertIdx: 3 } : undefined;
  }
  // `pnpm vitest`, `yarn vitest`, `bun vitest` (direct bin run). NOT `npm vitest` (invalid) and NOT
  // `<pm> test`/`<pm> run x` (those ARE the project scripts — leave them alone).
  if (PACKAGE_MANAGERS.has(t0) && t0 !== 'npm' && tokens[1] && RUNNERS.has(tokens[1].toLowerCase())) {
    return { runner: tokens[1].toLowerCase(), argInsertIdx: 2 };
  }
  return undefined;
}

/** Find the project script that invokes `runner`, preferring a one-shot (non-watch) script. */
function scriptForRunner(runner: string, scripts: Record<string, string>): string | undefined {
  const wordRe = new RegExp(`(^|[\\s&|])${runner}(\\s|$)`);
  const matches = Object.keys(scripts).filter((name) => wordRe.test((scripts[name] || '').toLowerCase()));
  if (matches.length === 0) {
    return undefined;
  }
  // Drop watch/dev variants (by name or a --watch/-w body) so we never rewrite into a hanging command.
  const oneShot = matches.filter(
    (n) => !/watch|dev|\bui\b/i.test(n) && !/--watch|(^|\s)-w(\s|$)/.test(scripts[n] || '')
  );
  const pool = oneShot.length ? oneShot : matches;
  for (const preferred of ['test', 'build', 'lint', 'typecheck', 'check']) {
    if (pool.includes(preferred)) {
      return preferred;
    }
  }
  return pool[0];
}

function scriptCommand(packageManager: string, scriptName: string): string {
  const pm = packageManager || 'npm';
  if (scriptName === 'test' && ['npm', 'pnpm', 'yarn'].includes(pm)) {
    return `${pm} test`;
  }
  return `${pm} run ${scriptName}`;
}

/**
 * Rewrite a direct runner invocation to the project's matching npm script, or (no script found) force
 * vitest out of watch mode. Returns the command unchanged when it's not a direct runner call, or when
 * it contains shell control characters (too risky to rewrite — let the command policy handle it).
 */
export function normalizeRunnerCommand(command: string, info: ProjectCommandInfo): NormalizedCommand {
  const trimmed = (command ?? '').trim();
  if (!trimmed || /[;&|<>`]|\$\(/.test(trimmed)) {
    return { command };
  }
  const tokens = trimmed.split(/\s+/);
  const found = findRunner(tokens);
  if (!found) {
    return { command };
  }
  const pm = info.packageManager || 'npm';
  const scriptName = scriptForRunner(found.runner, info.scripts);
  if (scriptName) {
    const rewritten = scriptCommand(pm, scriptName);
    if (rewritten === trimmed) {
      return { command };
    }
    return {
      command: rewritten,
      note: `[UnodeAi] Ran the project's \`${rewritten}\` instead of \`${trimmed}\`. Use the project's npm scripts — don't invoke \`${found.runner}\` directly.`,
    };
  }
  // No matching script: at least keep bare vitest from launching watch mode (it never exits → timeout).
  if (found.runner === 'vitest') {
    const hasOneShot = tokens.some((t) => t === 'run' || t === '--run' || t === '--watch' || t === '-w' || t === '--no-watch');
    if (!hasOneShot) {
      const parts = [...tokens];
      parts.splice(found.argInsertIdx, 0, 'run');
      const rewritten = parts.join(' ');
      return { command: rewritten, note: `[UnodeAi] Added \`run\` (\`${rewritten}\`) so vitest doesn't start watch mode and hang.` };
    }
  }
  return { command };
}
