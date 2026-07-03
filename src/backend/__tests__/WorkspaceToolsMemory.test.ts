import { describe, it, expect } from 'vitest';
import { MemoryWriter, WorkspaceTools } from '../WorkspaceTools';

describe('WorkspaceTools memory_note', () => {
  const root = process.cwd();

  function toolsWithMemory(writer?: MemoryWriter): WorkspaceTools {
    return new WorkspaceTools(
      root,
      new Set(),
      'alice',
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
      writer
    );
  }

  it('exposes memory_note to every agent', () => {
    const tools = new WorkspaceTools(root, new Set());
    expect(tools.specs().some((s) => s.function.name === 'memory_note')).toBe(true);
  });

  it('calls the injected writer and returns its confirmation', async () => {
    const calls: Array<{ agentId: string; note: string }> = [];
    const tools = toolsWithMemory(async (agentId, note) => {
      calls.push({ agentId, note });
      return 'Noted.';
    });

    await expect(tools.run('memory_note', { note: 'Use X, not Y' })).resolves.toBe('Noted.');
    expect(calls).toEqual([{ agentId: 'alice', note: 'Use X, not Y' }]);
  });

  it('validates note is non-empty', async () => {
    const tools = toolsWithMemory(async () => 'should not run');

    await expect(tools.run('memory_note', { note: '   ' })).resolves.toBe(
      "Error: memory_note requires a non-empty 'note'."
    );
  });

  it('degrades gracefully without a writer', async () => {
    const tools = toolsWithMemory();

    await expect(tools.run('memory_note', { note: 'remember this' })).resolves.toBe(
      'Shared memory is not available in this context.'
    );
  });
});
