import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderMarkdownToSafeHtml } from '../markdown';

describe('markdown renderer', () => {
  it('renders headings, emphasis, lists, links, inline code, and fenced code', () => {
    const blocks = renderMarkdown([
      '## Update',
      'This is **bold**, *kind*, `code`, and [Roam](https://example.com).',
      '',
      '- first',
      '- second',
      '',
      '```ts',
      'const value: string = "ok";',
      '```',
    ].join('\n'));

    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
    expect(blocks[2]).toMatchObject({ type: 'list' });
    expect(blocks[3]).toEqual({ type: 'code', language: 'ts', code: 'const value: string = "ok";' });
  });

  it('escapes XSS payloads in the safe HTML output', () => {
    const html = renderMarkdownToSafeHtml('Hello <img src=x onerror=alert(1)> and [bad](javascript:alert(1))');

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:alert');
  });

  it('escapes fenced code instead of treating it as markup', () => {
    const html = renderMarkdownToSafeHtml(['```html', '<script>alert(1)</script>', '```'].join('\n'));

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('parses a GFM table (header, alignment, rows, inline spans in cells)', () => {
    const blocks = renderMarkdown([
      '| Feature | Cursor | UnodeAi |',
      '|---|:---:|---:|',
      '| Single agent | ✅ | ✅ |',
      '| **PM → delegate** | ❌ | ✅ |',
    ].join('\n'));
    expect(blocks).toHaveLength(1);
    const t = blocks[0] as Extract<ReturnType<typeof renderMarkdown>[number], { type: 'table' }>;
    expect(t.type).toBe('table');
    expect(t.header.map((c) => c.map((s) => (s as any).text).join(''))).toEqual(['Feature', 'Cursor', 'UnodeAi']);
    expect(t.align).toEqual([null, 'center', 'right']);
    expect(t.rows).toHaveLength(2);
    expect((t.rows[1][0][0] as any).type).toBe('strong'); // **PM → delegate** stays bold in the cell
  });

  it('renders a table to safe HTML (thead/tbody, alignment)', () => {
    const html = renderMarkdownToSafeHtml(['| A | B |', '|:--|--:|', '| 1 | 2 |'].join('\n'));
    expect(html).toContain('<table>');
    expect(html).toContain('<th style="text-align:left">A</th>');
    expect(html).toContain('<th style="text-align:right">B</th>');
    expect(html).toContain('<td style="text-align:left">1</td>');
  });

  it('does NOT treat a stray pipe in prose as a table', () => {
    const blocks = renderMarkdown('Use the a | b operator for bitwise or.');
    expect(blocks[0].type).toBe('paragraph');
  });

  it('does not split on an escaped pipe or a pipe inside inline code (Codex review)', () => {
    const blocks = renderMarkdown([
      '| Expr | Meaning |',
      '|---|---|',
      '| a \\| b | escaped pipe |',
      '| `x|y` | code pipe |',
    ].join('\n'));
    const t = blocks[0] as Extract<ReturnType<typeof renderMarkdown>[number], { type: 'table' }>;
    expect(t.header).toHaveLength(2);
    // Each body row must still have exactly 2 cells — the pipe in the first cell is NOT a delimiter.
    expect(t.rows[0]).toHaveLength(2);
    expect(t.rows[1]).toHaveLength(2);
    expect((t.rows[0][0][0] as any).text).toBe('a | b');         // \| became a literal pipe
    expect((t.rows[1][0][0] as any)).toMatchObject({ type: 'code', text: 'x|y' }); // code span kept its pipe
  });

  it('normalizes short/long body rows to the header column count', () => {
    const blocks = renderMarkdown(['| A | B | C |', '|---|---|---|', '| 1 |', '| 1 | 2 | 3 | 4 |'].join('\n'));
    const t = blocks[0] as Extract<ReturnType<typeof renderMarkdown>[number], { type: 'table' }>;
    expect(t.rows[0]).toHaveLength(3); // padded
    expect(t.rows[1]).toHaveLength(3); // truncated
  });
});
