import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceTools } from '../WorkspaceTools';

async function sandbox(content: string): Promise<{ tools: WorkspaceTools; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-edit-'));
  await fs.writeFile(path.join(root, 'README.md'), content, 'utf8');
  return { tools: new WorkspaceTools(root, new Set(['read', 'write']), 'test'), root };
}

describe('apply_edit (targeted edit + Edit-alias target)', () => {
  it('replaces an exact unique snippet and writes the file', async () => {
    const { tools, root } = await sandbox('# Title\nhello\n');
    const out = await tools.run('apply_edit', { path: 'README.md', old_string: 'hello', new_string: 'hello\nCanada vs Qatar' });
    expect(out).toMatch(/Wrote/);
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('# Title\nhello\nCanada vs Qatar\n');
  });

  it('errors when old_string is not found (and does not change the file)', async () => {
    const { tools, root } = await sandbox('one\ntwo\n');
    const out = await tools.run('apply_edit', { path: 'README.md', old_string: 'three', new_string: 'x' });
    expect(out).toMatch(/not found/i);
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('one\ntwo\n'); // untouched
  });

  it('errors on an ambiguous match unless replace_all is set', async () => {
    const { tools, root } = await sandbox('a\na\n');
    const ambiguous = await tools.run('apply_edit', { path: 'README.md', old_string: 'a', new_string: 'b' });
    expect(ambiguous).toMatch(/appears 2 times/i);
    const all = await tools.run('apply_edit', { path: 'README.md', old_string: 'a', new_string: 'b', replace_all: true });
    expect(all).toMatch(/Wrote/);
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('b\nb\n');
  });

  it('errors when the file does not exist (points to write_file)', async () => {
    const { tools } = await sandbox('x');
    const out = await tools.run('apply_edit', { path: 'nope.md', old_string: 'x', new_string: 'y' });
    expect(out).toMatch(/file not found/i);
    expect(out).toMatch(/write_file/);
  });

  it('refuses without the write capability', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-edit-ro-'));
    await fs.writeFile(path.join(root, 'README.md'), 'hi', 'utf8');
    const readOnly = new WorkspaceTools(root, new Set(['read']), 'test');
    expect(await readOnly.run('apply_edit', { path: 'README.md', old_string: 'hi', new_string: 'bye' })).toMatch(/write not permitted/i);
  });

  it('advertises apply_edit only with the write capability', () => {
    const names = (s: Set<string>) => new WorkspaceTools('/tmp', s, 't').specs().map((x) => x.function.name);
    expect(names(new Set(['write']))).toContain('apply_edit');
    expect(names(new Set(['read']))).not.toContain('apply_edit');
  });
});
