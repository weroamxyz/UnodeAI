import { describe, it, expect } from 'vitest';
import { SharedMemory, memoryFilePath, oneLine } from '../SharedMemory';

describe('SharedMemory', () => {
  it('appends a timestamped one-line note', async () => {
    const appends: Array<{ file: string; content: string }> = [];
    const mkdirs: string[] = [];
    const sm = new SharedMemory(
      '/ws/.unode/memory/notes.md',
      async () => '',
      async (file, content) => { appends.push({ file, content }); },
      async (dir) => { mkdirs.push(dir); }
    );

    await sm.append('agent-a', 'first line\nsecond line');

    expect(mkdirs[0]).toMatch(/[\\/]ws[\\/]\.unode[\\/]memory$/);
    expect(appends).toHaveLength(1);
    expect(appends[0].file).toBe('/ws/.unode/memory/notes.md');
    expect(appends[0].content).toMatch(/^- \[\d{4}-\d{2}-\d{2}T.*Z\] \[agent-a\] first line second line\n$/);
  });

  it('loads empty string when the file is missing or unreadable', async () => {
    const sm = new SharedMemory('/ws/.unode/memory/notes.md', async () => { throw new Error('ENOENT'); });

    await expect(sm.load()).resolves.toBe('');
    expect(sm.block()).toBe('');
  });

  it('wraps the most recent notes and returns empty for no content', async () => {
    const sm = new SharedMemory(
      '/ws/.unode/memory/notes.md',
      async () => [
        '- [2026-01-01T00:00:00.000Z] [a] one',
        '- [2026-01-02T00:00:00.000Z] [b] two',
        '- [2026-01-03T00:00:00.000Z] [c] three',
      ].join('\n')
    );

    expect(sm.block()).toBe('');
    await sm.load();
    expect(sm.block(0)).toBe('');
    expect(sm.block(2)).toBe(
      '\n\n<shared_memory>\n' +
      '- [2026-01-02T00:00:00.000Z] [b] two\n' +
      '- [2026-01-03T00:00:00.000Z] [c] three\n' +
      '</shared_memory>'
    );
  });

  it('returns false (not throw) when append IO fails, true on success', async () => {
    const failing = new SharedMemory(
      '/ws/.unode/memory/notes.md',
      async () => '',
      async () => { throw new Error('EACCES'); },
      async () => undefined
    );
    await expect(failing.append('agent-a', 'note')).resolves.toBe(false);

    const ok = new SharedMemory('/ws/.unode/memory/notes.md', async () => '', async () => undefined, async () => undefined);
    await expect(ok.append('agent-a', 'note')).resolves.toBe(true);
  });

  it('builds the memory path under .unode/memory', () => {
    expect(memoryFilePath('/ws')).toMatch(/[\\/]ws[\\/]\.unode[\\/]memory[\\/]notes\.md$/);
  });

  it('collapses text to one line', () => {
    expect(oneLine('  alpha\n\tbeta   gamma  ')).toBe('alpha beta gamma');
  });
});
