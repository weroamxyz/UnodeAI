import { describe, expect, it } from 'vitest';
import { summarizeToolResult, summarizeToolUse, toolCategory } from '../toolSummary';

describe('toolSummary', () => {
  it('classifies built-in tools for chat cards', () => {
    expect(toolCategory('read_file')).toBe('read');
    expect(toolCategory('write_file')).toBe('edit');
    expect(toolCategory('apply_edit')).toBe('edit'); // a targeted edit shows as a file edit, not generic tool activity
    expect(toolCategory('run_command')).toBe('run');
    expect(toolCategory('github__create_pr')).toBe('mcp');
  });

  it('builds a readable pending title', () => {
    expect(summarizeToolUse('write_file', { path: 'src/app.ts' })).toMatchObject({
      category: 'edit',
      title: 'Edit src/app.ts',
    });
  });

  it('marks blocked/error outputs as not ok and caps detail', () => {
    const result = summarizeToolResult('run_command', { command: 'npm test' }, `Error: ${'x'.repeat(5000)}`);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Error:');
    expect(result.detail?.length).toBeLessThan(4100);
  });
});
