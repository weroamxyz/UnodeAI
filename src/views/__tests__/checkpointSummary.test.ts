import { describe, expect, it } from 'vitest';
import { Checkpoint } from '../../backend/Checkpoints';
import { groupChangedFilesByAgent } from '../checkpointSummary';

function checkpoint(overrides: Partial<Checkpoint>): Checkpoint {
  return {
    id: 1,
    agentId: 'dev',
    agentName: 'Dev',
    path: 'src/a.ts',
    before: 'before',
    after: 'after',
    ts: 100,
    ...overrides,
  };
}

describe('groupChangedFilesByAgent', () => {
  it('returns an empty map for empty input', () => {
    expect(groupChangedFilesByAgent([]).size).toBe(0);
  });

  it('groups changed files by agent', () => {
    const grouped = groupChangedFilesByAgent([
      checkpoint({ id: 1, agentId: 'dev', path: 'src/a.ts', ts: 100 }),
      checkpoint({ id: 2, agentId: 'reviewer', path: 'src/b.ts', ts: 101 }),
    ]);

    expect(grouped.get('dev')).toEqual([{ path: 'src/a.ts', checkpointId: 1, ts: 100 }]);
    expect(grouped.get('reviewer')).toEqual([{ path: 'src/b.ts', checkpointId: 2, ts: 101 }]);
  });

  it('keeps only the newest checkpoint for the same agent and file', () => {
    const grouped = groupChangedFilesByAgent([
      checkpoint({ id: 1, agentId: 'dev', path: 'src/a.ts', ts: 100 }),
      checkpoint({ id: 2, agentId: 'dev', path: 'src/a.ts', ts: 200 }),
      checkpoint({ id: 3, agentId: 'dev', path: 'src/b.ts', ts: 150 }),
    ]);

    expect(grouped.get('dev')).toEqual([
      { path: 'src/a.ts', checkpointId: 2, ts: 200 },
      { path: 'src/b.ts', checkpointId: 3, ts: 150 },
    ]);
  });

  it('sorts each agent newest-first even when checkpoints arrive unordered', () => {
    const grouped = groupChangedFilesByAgent([
      checkpoint({ id: 1, agentId: 'dev', path: 'src/old.ts', ts: 100 }),
      checkpoint({ id: 3, agentId: 'dev', path: 'src/new.ts', ts: 300 }),
      checkpoint({ id: 2, agentId: 'dev', path: 'src/mid.ts', ts: 200 }),
    ]);

    expect(grouped.get('dev')?.map((item) => item.path)).toEqual([
      'src/new.ts',
      'src/mid.ts',
      'src/old.ts',
    ]);
  });

  it('keeps the newer id first when timestamps tie', () => {
    const grouped = groupChangedFilesByAgent([
      checkpoint({ id: 1, agentId: 'dev', path: 'src/a.ts', ts: 100 }),
      checkpoint({ id: 2, agentId: 'dev', path: 'src/b.ts', ts: 100 }),
    ]);

    expect(grouped.get('dev')?.map((item) => item.checkpointId)).toEqual([2, 1]);
  });

  it('truncates each agent to the eight newest unique files', () => {
    const grouped = groupChangedFilesByAgent(
      Array.from({ length: 10 }, (_, i) =>
        checkpoint({
          id: i + 1,
          agentId: 'dev',
          path: `src/file-${i + 1}.ts`,
          ts: i + 1,
        })
      )
    );

    expect(grouped.get('dev')?.map((item) => item.path)).toEqual([
      'src/file-10.ts',
      'src/file-9.ts',
      'src/file-8.ts',
      'src/file-7.ts',
      'src/file-6.ts',
      'src/file-5.ts',
      'src/file-4.ts',
      'src/file-3.ts',
    ]);
  });
});
