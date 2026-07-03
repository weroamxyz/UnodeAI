import { describe, it, expect } from 'vitest';
import { normalizeRunnerCommand, ProjectCommandInfo } from '../commandNormalize';

const info: ProjectCommandInfo = {
  packageManager: 'npm',
  scripts: {
    build: 'tsc -p ./',
    lint: 'eslint src --ext ts',
    test: 'vitest run',
    'test:watch': 'vitest',
  },
};

const n = (cmd: string, i: ProjectCommandInfo = info) => normalizeRunnerCommand(cmd, i);

describe('normalizeRunnerCommand', () => {
  it('rewrites a direct runner call to the matching project script', () => {
    expect(n('npx vitest').command).toBe('npm test');
    expect(n('vitest').command).toBe('npm test');
    expect(n('npx -y vitest').command).toBe('npm test');
    expect(n('pnpm exec vitest', { ...info, packageManager: 'pnpm' }).command).toBe('pnpm test');
    expect(n('yarn vitest', { ...info, packageManager: 'yarn' }).command).toBe('yarn test');
  });

  it('prefers the one-shot script over a watch variant', () => {
    // matches both `test` (vitest run) and `test:watch` (vitest) — must pick `test`.
    expect(n('npx vitest').command).toBe('npm test');
  });

  it('maps tsc -> build and eslint -> lint via the script bodies', () => {
    expect(n('npx tsc --noEmit').command).toBe('npm run build');
    expect(n('npx eslint src').command).toBe('npm run lint');
  });

  it('includes a note telling the agent to use the project scripts', () => {
    const r = n('npx vitest');
    expect(r.note).toMatch(/Use the project's npm scripts/i);
    expect(r.note).toContain('npm test');
  });

  it('leaves the command alone when it already goes through the project scripts', () => {
    expect(n('npm test')).toEqual({ command: 'npm test' });
    expect(n('npm run build')).toEqual({ command: 'npm run build' });
    expect(n('pnpm test', { ...info, packageManager: 'pnpm' })).toEqual({ command: 'pnpm test' });
  });

  it('leaves unrelated commands alone', () => {
    expect(n('git status')).toEqual({ command: 'git status' });
    expect(n('node server.js')).toEqual({ command: 'node server.js' });
    expect(n('ls -la')).toEqual({ command: 'ls -la' });
  });

  it('does not rewrite chained/shell commands (too risky)', () => {
    expect(n('npx vitest && echo done')).toEqual({ command: 'npx vitest && echo done' });
  });

  it('forces vitest out of watch mode when no test script exists', () => {
    const noScripts: ProjectCommandInfo = { packageManager: 'npm', scripts: {} };
    expect(n('npx vitest', noScripts).command).toBe('npx vitest run');
    expect(n('vitest', noScripts).command).toBe('vitest run');
    // already one-shot or explicit watch → leave as-is
    expect(n('vitest run', noScripts)).toEqual({ command: 'vitest run' });
    expect(n('vitest --watch', noScripts)).toEqual({ command: 'vitest --watch' });
  });
});
