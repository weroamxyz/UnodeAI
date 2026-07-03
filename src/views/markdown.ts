export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type TableAlign = 'left' | 'center' | 'right' | null;

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; spans: MarkdownInline[] }
  | { type: 'paragraph'; spans: MarkdownInline[] }
  | { type: 'list'; items: MarkdownInline[][] }
  | { type: 'code'; language: string; code: string }
  | { type: 'table'; align: TableAlign[]; header: MarkdownInline[][]; rows: MarkdownInline[][][] };

const FENCE_RE = /^```([A-Za-z0-9_-]*)\s*$/;

export function renderMarkdown(source: string): MarkdownBlock[] {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const language = fence[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        i++;
      }
      blocks.push({ type: 'code', language, code: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: MarkdownInline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\s*[-*]\s+/, '').trim()));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // GFM table: a header row (contains a pipe) immediately followed by a separator row (| --- | :--: |).
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = parseTableRow(line);
      const cols = header.length;
      const align = fitColumns(parseTableAlign(lines[i + 1]), cols, () => null as TableAlign);
      i += 2;
      const rows: MarkdownInline[][][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|') && !isTableSeparator(lines[i])) {
        rows.push(fitColumns(parseTableRow(lines[i]), cols, () => [{ type: 'text', text: '' }]));
        i++;
      }
      blocks.push({ type: 'table', align, header, rows });
      continue;
    }

    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE_RE.test(lines[i]) &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

export function renderMarkdownToSafeHtml(source: string): string {
  return renderMarkdown(source).map(blockToHtml).join('');
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseInline(source: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = nextInline(rest);
    if (!match) {
      tokens.push({ type: 'text', text: rest });
      break;
    }
    if (match.index > 0) {
      tokens.push({ type: 'text', text: rest.slice(0, match.index) });
    }
    tokens.push(match.token);
    rest = rest.slice(match.index + match.length);
  }

  return tokens;
}

function nextInline(source: string): { index: number; length: number; token: MarkdownInline } | undefined {
  const patterns: Array<{ re: RegExp; toToken: (m: RegExpMatchArray) => MarkdownInline | undefined }> = [
    {
      re: /`([^`]+)`/,
      toToken: (m) => ({ type: 'code', text: m[1] }),
    },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      toToken: (m) => ({ type: 'link', text: m[1], href: sanitizeHref(m[2]) }),
    },
    {
      re: /\*\*([^*]+)\*\*/,
      toToken: (m) => ({ type: 'strong', text: m[1] }),
    },
    {
      re: /\*([^*]+)\*/,
      toToken: (m) => ({ type: 'em', text: m[1] }),
    },
  ];

  let best: { index: number; length: number; token: MarkdownInline } | undefined;
  for (const pattern of patterns) {
    const match = source.match(pattern.re);
    if (!match || match.index === undefined) {
      continue;
    }
    const token = pattern.toToken(match);
    if (!token) {
      continue;
    }
    if (!best || match.index < best.index) {
      best = { index: match.index, length: match[0].length, token };
    }
  }
  return best;
}

/** Split a table row into trimmed cells. Drops the optional leading/trailing border pipe, and — unlike a
 *  raw split('|') — does NOT split on an escaped pipe (\|) or a pipe inside an inline-code span (`a|b`). */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) { s = s.slice(1); }
  if (s.endsWith('|') && !/\\\|$/.test(s)) { s = s.slice(0, -1); } // trailing border pipe (not an escaped \|)
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; } // escaped pipe → literal in the cell
    if (ch === '`') { inCode = !inCode; cur += ch; continue; }            // toggle inline-code span
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Pad/truncate a row's cells to the table's column count so a short/long body row still aligns. */
function fitColumns<T>(cells: T[], cols: number, fill: () => T): T[] {
  const out = cells.slice(0, cols);
  while (out.length < cols) { out.push(fill()); }
  return out;
}

/** A GFM table separator row: contains a pipe, and every cell is dashes with optional colons (:--, :-:, --:). */
function isTableSeparator(line: string): boolean {
  if (!line.includes('|') || !line.includes('-')) {
    return false;
  }
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function parseTableRow(line: string): MarkdownInline[][] {
  return splitTableRow(line).map((cell) => parseInline(cell));
}

function parseTableAlign(separator: string): TableAlign[] {
  return splitTableRow(separator).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) { return 'center'; }
    if (right) { return 'right'; }
    if (left) { return 'left'; }
    return null;
  });
}

function sanitizeHref(href: string): string {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  return '#';
}

function blockToHtml(block: MarkdownBlock): string {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}>${inlineToHtml(block.spans)}</h${block.level}>`;
    case 'paragraph':
      return `<p>${inlineToHtml(block.spans)}</p>`;
    case 'list':
      return `<ul>${block.items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ul>`;
    case 'code':
      return `<pre><code data-language="${escapeHtml(block.language)}">${escapeHtml(block.code)}</code></pre>`;
    case 'table': {
      const alignAttr = (i: number) => (block.align[i] ? ` style="text-align:${block.align[i]}"` : '');
      const head = `<thead><tr>${block.header.map((c, i) => `<th${alignAttr(i)}>${inlineToHtml(c)}</th>`).join('')}</tr></thead>`;
      const body = `<tbody>${block.rows.map((r) => `<tr>${r.map((c, i) => `<td${alignAttr(i)}>${inlineToHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return `<table>${head}${body}</table>`;
    }
  }
}

function inlineToHtml(spans: MarkdownInline[]): string {
  return spans.map((span) => {
    switch (span.type) {
      case 'text':
        return escapeHtml(span.text);
      case 'strong':
        return `<strong>${escapeHtml(span.text)}</strong>`;
      case 'em':
        return `<em>${escapeHtml(span.text)}</em>`;
      case 'code':
        return `<code>${escapeHtml(span.text)}</code>`;
      case 'link':
        return `<a href="${escapeHtml(span.href)}">${escapeHtml(span.text)}</a>`;
    }
  }).join('');
}
