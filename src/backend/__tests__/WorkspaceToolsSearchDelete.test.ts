import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceTools } from '../WorkspaceTools';

async function tmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('WorkspaceTools.delete_file', () => {
  it('deletes a file and reports it (checkpointed)', async () => {
    const root = await tmp('roam-del-');
    await fs.writeFile(path.join(root, 'junk.js'), 'scratch', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['write']));

    const out = await tools.run('delete_file', { path: 'junk.js' });
    expect(out).toBe('Deleted junk.js.');
    await expect(fs.stat(path.join(root, 'junk.js'))).rejects.toBeTruthy(); // gone
    await fs.rm(root, { recursive: true, force: true });
  });

  it('refuses a missing file and a directory with a clear message', async () => {
    const root = await tmp('roam-del2-');
    await fs.mkdir(path.join(root, 'adir'));
    const tools = new WorkspaceTools(root, new Set(['write']));

    expect(await tools.run('delete_file', { path: 'nope.txt' })).toMatch(/does not exist/);
    expect(await tools.run('delete_file', { path: 'adir' })).toMatch(/not a directory/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('requires write permission', async () => {
    const root = await tmp('roam-del3-');
    await fs.writeFile(path.join(root, 'x.txt'), 'y', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['read']));
    expect(await tools.run('delete_file', { path: 'x.txt' })).toMatch(/write not permitted/);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('WorkspaceTools.search_files', () => {
  it('finds a regex across files and returns relpath:line: text', async () => {
    const root = await tmp('roam-search-');
    await fs.writeFile(path.join(root, 'a.ts'), 'const worktreeCoordinator = make();\n// other\n', 'utf8');
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', 'b.ts'), 'use worktreeCoordinator here\n', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['read']));

    const out = await tools.run('search_files', { query: 'worktreeCoordinator' });
    expect(out).toMatch(/a\.ts:1:/);
    expect(out).toMatch(/sub\/b\.ts:1:/);
    expect(out).toMatch(/2 matches/);
  });

  it('skips ignored dirs (node_modules) and reports no matches cleanly', async () => {
    const root = await tmp('roam-search2-');
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'dep.js'), 'needle', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['read']));

    expect(await tools.run('search_files', { query: 'needle' })).toMatch(/No matches/);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('falls back to literal search on an invalid regex', async () => {
    const root = await tmp('roam-search3-');
    await fs.writeFile(path.join(root, 'c.txt'), 'a (b literal\n', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['read']));
    // "(b" is an invalid regex (unclosed group) → treated as a literal substring.
    expect(await tools.run('search_files', { query: '(b' })).toMatch(/c\.txt:1:/);
    await fs.rm(root, { recursive: true, force: true });
  });
});
