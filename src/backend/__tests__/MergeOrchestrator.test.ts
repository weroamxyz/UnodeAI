import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { GitMergeOrchestrator } from '../MergeOrchestrator';
import { WorktreeManager } from '../WorktreeManager';

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-merge-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 't@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(root, 'README.md'), 'hi\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout;
}

function gitStatus(cwd: string): string {
  return git(cwd, ['status', '--porcelain']).trim();
}

async function readLf(file: string): Promise<string> {
  return (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
}

describe('GitMergeOrchestrator', () => {
  it('merges different agent worktrees into the integration worktree', async () => {
    const root = await tempRepo();
    try {
      const wm = new WorktreeManager(root);
      const orchestrator = new GitMergeOrchestrator(root);
      const a = await wm.create({ name: 'agent-a', branch: 'roam/agent-a' });
      const b = await wm.create({ name: 'agent-b', branch: 'roam/agent-b' });

      await fs.writeFile(path.join(a.path, 'a.txt'), 'from a\n');
      await fs.writeFile(path.join(b.path, 'b.txt'), 'from b\n');

      expect(await orchestrator.commitWorktree(a, 'agent a')).toBe(true);
      expect(await orchestrator.commitWorktree(b, 'agent b')).toBe(true);

      expect((await orchestrator.mergeToIntegration(a)).status).toBe('merged');
      expect((await orchestrator.mergeToIntegration(b)).status).toBe('merged');

      const integration = path.join(root, '.roam', 'worktrees', '_integration');
      await expect(readLf(path.join(integration, 'a.txt'))).resolves.toBe('from a\n');
      await expect(readLf(path.join(integration, 'b.txt'))).resolves.toBe('from b\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000); // real-git: many spawns (init/worktree add/merge) — slow on Windows under parallel load

  it('aborts conflicts and leaves integration clean', async () => {
    const root = await tempRepo();
    try {
      const wm = new WorktreeManager(root);
      const orchestrator = new GitMergeOrchestrator(root);
      const a = await wm.create({ name: 'agent-a', branch: 'roam/conflict-a' });
      const b = await wm.create({ name: 'agent-b', branch: 'roam/conflict-b' });

      await fs.writeFile(path.join(a.path, 'README.md'), 'from a\n');
      await fs.writeFile(path.join(b.path, 'README.md'), 'from b\n');

      expect(await orchestrator.commitWorktree(a, 'agent a')).toBe(true);
      expect(await orchestrator.commitWorktree(b, 'agent b')).toBe(true);
      expect((await orchestrator.mergeToIntegration(a)).status).toBe('merged');

      const result = await orchestrator.mergeToIntegration(b);
      expect(result.status).toBe('conflict');
      expect(result.conflictedFiles).toContain('README.md');

      const integration = path.join(root, '.roam', 'worktrees', '_integration');
      expect(gitStatus(integration)).toBe('');
      await expect(readLf(path.join(integration, 'README.md'))).resolves.toBe('from a\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000); // real-git: many spawns (init/worktree add/merge) — slow on Windows under parallel load

  it('returns false when committing a clean worktree', async () => {
    const root = await tempRepo();
    try {
      const wm = new WorktreeManager(root);
      const orchestrator = new GitMergeOrchestrator(root);
      const wt = await wm.create({ name: 'clean-agent', branch: 'roam/clean-agent' });

      await expect(orchestrator.commitWorktree(wt, 'clean')).resolves.toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000); // real-git: many spawns (init/worktree add/merge) — slow on Windows under parallel load

  it('returns nothing when a branch has no new commits for integration', async () => {
    const root = await tempRepo();
    try {
      const wm = new WorktreeManager(root);
      const orchestrator = new GitMergeOrchestrator(root);
      const wt = await wm.create({ name: 'empty-agent', branch: 'roam/empty-agent' });

      const result = await orchestrator.mergeToIntegration(wt);
      expect(result.status).toBe('nothing');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000); // real-git: many spawns (init/worktree add/merge) — slow on Windows under parallel load

  it('finalizes integration by advancing the base branch', async () => {
    const root = await tempRepo();
    try {
      const wm = new WorktreeManager(root);
      const orchestrator = new GitMergeOrchestrator(root);
      const wt = await wm.create({ name: 'final-agent', branch: 'roam/final-agent' });

      await fs.writeFile(path.join(wt.path, 'final.txt'), 'approved\n');
      expect(await orchestrator.commitWorktree(wt, 'final work')).toBe(true);
      expect((await orchestrator.mergeToIntegration(wt)).status).toBe('merged');

      const result = await orchestrator.finalizeToBase('main');
      expect(result.status).toBe('merged');
      expect(git(root, ['show', 'main:final.txt'])).toBe('approved\n');
      expect(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe('main');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000); // real-git: many spawns (init/worktree add/merge) — slow on Windows under parallel load
});
