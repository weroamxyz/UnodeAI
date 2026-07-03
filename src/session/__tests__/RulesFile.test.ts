import { describe, it, expect } from 'vitest';
import {
  RulesFile,
  projectContextBlock,
  replaceProjectContextBlock,
  rulesFilePath,
  stripProjectContextBlock,
} from '../RulesFile';

describe('RulesFile (F4)', () => {
  it('returns the file content after load', async () => {
    const rf = new RulesFile('/ws/.unode/rules.md', async () => '# Rules\nUse strict TS');
    expect(rf.get()).toBe(''); // before load
    await rf.load();
    expect(rf.get()).toBe('# Rules\nUse strict TS');
  });

  it('returns empty string when the file is missing (no throw)', async () => {
    const rf = new RulesFile('/ws/.unode/rules.md', async () => { throw new Error('ENOENT'); });
    await rf.load();
    expect(rf.get()).toBe('');
  });

  it('reloads updated content on a second load', async () => {
    let body = 'v1';
    const rf = new RulesFile('/ws/.unode/rules.md', async () => body);
    await rf.load();
    expect(rf.get()).toBe('v1');
    body = 'v2';
    await rf.load();
    expect(rf.get()).toBe('v2');
  });

  it('builds the path under .unode', () => {
    expect(rulesFilePath('/ws')).toMatch(/[\\/]ws[\\/]\.unode[\\/]rules\.md$/);
  });

  it('creates an empty rules file when missing', async () => {
    const writes: Array<{ file: string; content: string }> = [];
    const mkdirs: string[] = [];
    const rf = new RulesFile(
      '/ws/.unode/rules.md',
      async () => '',
      async (file, content) => { writes.push({ file, content }); },
      async (dir) => { mkdirs.push(dir); }
    );

    await rf.ensureExists();

    expect(mkdirs[0]).toMatch(/[\\/]ws[\\/]\.unode$/);
    expect(writes).toEqual([{ file: '/ws/.unode/rules.md', content: '' }]);
  });

  it('does not throw when the rules file already exists', async () => {
    const rf = new RulesFile(
      '/ws/.unode/rules.md',
      async () => 'existing',
      async () => { throw new Error('EEXIST'); },
      async () => undefined
    );

    await expect(rf.ensureExists()).resolves.toBeUndefined();
  });

  // Regression: an unwritable directory (e.g. no workspace open → path under `/` on macOS launched
  // from the Dock) must NOT throw out of ensureExists, or it aborts extension activation and the
  // webview panels render only their titles with no content.
  it('does not throw when mkdir fails (unwritable location)', async () => {
    const rf = new RulesFile(
      '/.unode/rules.md',
      async () => '',
      async () => { throw new Error('should not be reached'); },
      async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); }
    );

    await expect(rf.ensureExists()).resolves.toBeUndefined();
  });
});

describe('projectContextBlock (F4)', () => {
  it('wraps non-empty content in <project_context>', () => {
    expect(projectContextBlock('be terse')).toBe('\n\n<project_context>\nbe terse\n</project_context>');
  });

  it('returns empty string for blank/whitespace content', () => {
    expect(projectContextBlock('')).toBe('');
    expect(projectContextBlock('   \n  ')).toBe('');
  });

  it('strips and replaces an existing project context block', () => {
    const oldPrompt = 'Role first' + projectContextBlock('old rules');
    expect(stripProjectContextBlock(oldPrompt)).toBe('Role first');
    expect(replaceProjectContextBlock(oldPrompt, 'new rules')).toBe(
      'Role first' + projectContextBlock('new rules')
    );
  });
});
