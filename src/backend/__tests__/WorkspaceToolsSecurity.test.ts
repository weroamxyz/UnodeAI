import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceTools } from '../WorkspaceTools';

describe('WorkspaceTools sandbox hardening', () => {
  it('captures old and new content for write_file metadata without changing string output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-write-meta-'));
    await fs.writeFile(path.join(root, 'note.txt'), 'before\n', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['write']));

    const output = await tools.run('write_file', { path: 'note.txt', content: 'after\n' });
    const result = tools.takeLastRunResult();

    expect(output).toBe('Wrote 6 bytes to note.txt.');
    expect(result).toMatchObject({
      name: 'write_file',
      kind: 'write',
      path: 'note.txt',
      oldContent: 'before\n',
      newContent: 'after\n',
    });

    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects an empty/parameterless write_file without writing to the sandbox root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-empty-write-'));
    const tools = new WorkspaceTools(root, new Set(['write']));

    // Simulates a model emitting a write_file tool call with no/empty arguments (args -> {}).
    const noPath = await tools.run('write_file', { content: 'x' });          // missing-param validator
    const emptyPath = await tools.run('write_file', { path: '   ', content: 'x' }); // whitespace-path guard

    expect(noPath).toMatch(/missing required parameter\(s\): path/);
    expect(emptyPath).toMatch(/requires a non-empty 'path'/);
    // The sandbox root must be untouched (still a directory, not overwritten as a file).
    expect((await fs.stat(root)).isDirectory()).toBe(true);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects any tool called with missing required parameters, without executing it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-missing-args-'));
    const tools = new WorkspaceTools(root, new Set(['read', 'write', 'execute', 'message']));

    expect(await tools.run('read_file', {})).toMatch(/missing required parameter\(s\): path/);
    expect(await tools.run('run_command', {})).toMatch(/missing required parameter\(s\): command/);
    expect(await tools.run('send_message', { target: 'pm' })).toMatch(/missing required parameter\(s\): message/);
    // A legitimately-empty value is NOT "missing": write_file with empty content writes an empty file.
    expect(await tools.run('write_file', { path: 'empty.txt', content: '' })).toMatch(/Wrote 0 bytes/);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('blocks a catastrophic whole-file truncation, leaving the original intact', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-shrink-'));
    const big = 'x'.repeat(10000);
    await fs.writeFile(path.join(root, 'big.ts'), big, 'utf8');
    const tools = new WorkspaceTools(root, new Set(['write']));

    // Replacing a 10 KB file with a tiny fragment (a weak model treating write_file as a patch).
    const out = await tools.run('write_file', { path: 'big.ts', content: 'const x = 1;' });
    expect(out).toMatch(/Write blocked: this would shrink/);
    expect(out).toMatch(/read_file/);
    expect(await fs.readFile(path.join(root, 'big.ts'), 'utf8')).toBe(big); // untouched

    await fs.rm(root, { recursive: true, force: true });
  });

  it('allows normal edits and small files (the shrink guard only catches extreme truncation)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-shrink2-'));
    const tools = new WorkspaceTools(root, new Set(['write']));

    // A normal edit that removes ~20% of a 10 KB file — allowed.
    await fs.writeFile(path.join(root, 'a.ts'), 'a'.repeat(10000), 'utf8');
    expect(await tools.run('write_file', { path: 'a.ts', content: 'a'.repeat(8000) })).toMatch(/Wrote 8000 bytes/);
    // A small file shrunk hard — below the size floor, allowed (not the catastrophic case).
    await fs.writeFile(path.join(root, 'b.ts'), 'b'.repeat(1000), 'utf8');
    expect(await tools.run('write_file', { path: 'b.ts', content: 'b' })).toMatch(/Wrote 1 bytes/);

    await fs.rm(root, { recursive: true, force: true });
  });

  it('V2: blocks a write when the user denies it, and writes when approved (write approval)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-write-approval-'));
    const calls: Array<{ path: string; before: string | null }> = [];

    const deny = new WorkspaceTools(
      root, new Set(['write']), 'a1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      () => true, async (req) => { calls.push({ path: req.path, before: req.before }); return 'deny'; }
    );
    const denied = await deny.run('write_file', { path: 'blocked.txt', content: 'nope' });
    expect(denied).toMatch(/Write blocked/);
    expect(calls).toEqual([{ path: 'blocked.txt', before: null }]); // approver saw the pending write
    const wroteFile = await fs.access(path.join(root, 'blocked.txt')).then(() => true).catch(() => false);
    expect(wroteFile).toBe(false); // nothing written

    const allow = new WorkspaceTools(
      root, new Set(['write']), 'a1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      () => true, async () => 'once'
    );
    const wrote = await allow.run('write_file', { path: 'ok.txt', content: 'yes' });
    expect(wrote).toMatch(/Wrote 3 bytes/);
    expect(await fs.readFile(path.join(root, 'ok.txt'), 'utf8')).toBe('yes');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('V2: default (no approval mode) writes freely without invoking an approver', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-write-noapproval-'));
    let asked = false;
    // writeApprovalMode defaults to 'none' — approver should never be consulted.
    const tools = new WorkspaceTools(
      root, new Set(['write']), 'a1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, async () => { asked = true; return 'deny'; }
    );
    const out = await tools.run('write_file', { path: 'free.txt', content: 'hi' });
    expect(out).toMatch(/Wrote 2 bytes/);
    expect(asked).toBe(false);
    expect(await fs.readFile(path.join(root, 'free.txt'), 'utf8')).toBe('hi');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('blocks reads and writes through a symlink or junction that points outside the workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-root-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8');

    try {
      await fs.symlink(outside, path.join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }

    const tools = new WorkspaceTools(root, new Set(['read', 'write']));
    await expect(tools.run('read_file', { path: 'outside/secret.txt' })).resolves.toMatch(/escapes/);
    await expect(tools.run('write_file', { path: 'outside/new.txt', content: 'nope' })).resolves.toMatch(/escapes/);
    // apply_edit must run the sandbox check BEFORE reading, so it can't even probe the outside file's
    // contents (whether old_string is present / how often) before the write would be blocked.
    await expect(tools.run('apply_edit', { path: 'outside/secret.txt', old_string: 'secret', new_string: 'x' })).resolves.toMatch(/escapes/);
  });

  it('re-roots a hallucinated absolute path (foreign prefix) to the matching in-workspace file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-reroot-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'README.md'), 'hello', 'utf8');
    await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const x = 1;', 'utf8');
    const tools = new WorkspaceTools(root, new Set(['read', 'write']));

    // A Claude model prepends a fake sandbox prefix — recover by the longest in-sandbox suffix.
    expect(await tools.run('read_file', { path: '/Users/dev/workspace-0073b507/README.md' })).toContain('hello');
    expect(await tools.run('read_file', { path: '/Users/dev/workspace-0073b507/src/app.ts' })).toContain('export const x');
    // A genuine outside path with NO in-workspace twin still hits the boundary block (not recovered).
    expect(await tools.run('read_file', { path: '/etc/shadow' })).toMatch(/BLOCKED_OUTSIDE_WORKDIR/);
  });

  it('falls back to the shared read overlay without making writes touch the shared file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-own-'));
    const shared = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-shared-'));
    await fs.writeFile(path.join(shared, 'merged.txt'), 'from integration\n', 'utf8');

    const tools = workspaceToolsWithShared(root, shared);
    const read = await tools.run('read_file', { path: 'merged.txt' });
    expect(read).toContain('from integration');
    expect(read).toContain('shared integration view');

    const wrote = await tools.run('write_file', { path: 'merged.txt', content: 'local fork\n' });
    expect(wrote).toMatch(/Wrote/);
    expect(await fs.readFile(path.join(root, 'merged.txt'), 'utf8')).toBe('local fork\n');
    expect(await fs.readFile(path.join(shared, 'merged.txt'), 'utf8')).toBe('from integration\n');

    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(shared, { recursive: true, force: true });
  });

  it('merges list_dir entries from own and shared roots, with own entries winning', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-own-list-'));
    const shared = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-shared-list-'));
    await fs.writeFile(path.join(root, 'local.txt'), 'local', 'utf8');
    await fs.writeFile(path.join(root, 'same.txt'), 'own', 'utf8');
    await fs.writeFile(path.join(shared, 'same.txt'), 'shared', 'utf8');
    await fs.mkdir(path.join(shared, 'team-dir'));

    const listed = await workspaceToolsWithShared(root, shared).run('list_dir', { path: '.' });
    expect(listed.split(/\r?\n/)).toEqual(['local.txt', 'same.txt', 'team-dir/']);

    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(shared, { recursive: true, force: true });
  });
});

function workspaceToolsWithShared(root: string, shared: string): WorkspaceTools {
  return new WorkspaceTools(
    root,
    new Set(['read', 'write']),
    'a1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    shared
  );
}
