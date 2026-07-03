/**
 * F1: Unit tests for read_file pagination in WorkspaceTools.
 * Pagination is LINE-based (offset = 0-indexed start line, limit = max lines) — the convention
 * models expect; byte offsets used to confuse agents into reading tiny fragments.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceTools, formatPaginationFooter } from './WorkspaceTools';

// ─── formatPaginationFooter pure function ──────────────────────────────

describe('formatPaginationFooter', () => {
  it('formats correctly when reading from the start', () => {
    expect(formatPaginationFooter(0, 50, 818)).toBe(
      '…[showing lines 0–50 of 818 total. Use offset=50 to continue.]'
    );
  });

  it('formats correctly for a middle slice', () => {
    expect(formatPaginationFooter(50, 90, 818)).toBe(
      '…[showing lines 50–90 of 818 total. Use offset=90 to continue.]'
    );
  });

  it('points offset at the next line to continue', () => {
    expect(formatPaginationFooter(0, 100, 500)).toContain('Use offset=100 to continue.');
  });

  it('reports the total line count so the agent knows the full extent', () => {
    expect(formatPaginationFooter(0, 10, 818)).toContain('of 818 total');
  });
});

// ─── Real read_file behaviour against the filesystem ───────────────────

describe('read_file line pagination', () => {
  // 200 lines: "line0".."line199"
  const content = Array.from({ length: 200 }, (_, i) => `line${i}`).join('\n');

  async function withTools(run: (tools: WorkspaceTools) => Promise<void>): Promise<void> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-readfile-'));
    await fs.writeFile(path.join(root, 'big.txt'), content, 'utf8');
    const tools = new WorkspaceTools(root, new Set(['read']));
    try {
      await run(tools);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  it('reads a line window via offset + limit (not a byte fragment)', async () => {
    await withTools(async (tools) => {
      const out = await tools.run('read_file', { path: 'big.txt', offset: 10, limit: 3 });
      // Three whole lines, in order — the bug was returning a 3-BYTE fragment here.
      expect(out).toContain('line10\nline11\nline12');
      expect(out).not.toContain('line13');
      expect(out).toContain('…[showing lines 10–13 of 200 total. Use offset=13 to continue.]');
    });
  });

  it('returns the whole file with no footer when it fits', async () => {
    await withTools(async (tools) => {
      const out = await tools.run('read_file', { path: 'big.txt' });
      expect(out).toContain('line0\n');
      expect(out).toContain('line199');
      expect(out).not.toContain('showing lines');
    });
  });

  it('errors when offset is past the end (by line count, not byte count)', async () => {
    await withTools(async (tools) => {
      const out = await tools.run('read_file', { path: 'big.txt', offset: 5000 });
      expect(out).toMatch(/offset 5000 is beyond the end of the file \(200 lines\)/);
    });
  });

  it('reads to the end from an offset', async () => {
    await withTools(async (tools) => {
      const out = await tools.run('read_file', { path: 'big.txt', offset: 198 });
      expect(out).toContain('line198\nline199');
    });
  });

  it('gives an actionable hint (not a raw ENOENT) for a missing in-workspace path', async () => {
    await withTools(async (tools) => {
      const out = await tools.run('read_file', { path: 'src/marketplace/agents.json' });
      expect(out).toMatch(/not found/i);
      expect(out).toContain('list_dir');
      expect(out).not.toMatch(/ENOENT|realpath/); // the confusing raw error that caused flailing
    });
  });
});

// ─── Schema contract test ──────────────────────────────────────────────

describe('read_file tool spec', () => {
  it('declares offset and limit as optional LINE parameters', () => {
    const tools = new WorkspaceTools('/tmp/nonexistent', new Set(['read']));
    const spec = tools.specs().find((s) => s.function.name === 'read_file');
    expect(spec).toBeTruthy();
    const params = spec!.function.parameters as {
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
    expect(params.properties.offset.type).toBe('integer');
    expect(params.properties.limit.type).toBe('integer');
    expect(params.properties.offset.description.toLowerCase()).toContain('line');
    expect(params.properties.limit.description.toLowerCase()).toContain('line');
    expect(params.required).not.toContain('offset');
    expect(params.required).toContain('path');
  });
});
