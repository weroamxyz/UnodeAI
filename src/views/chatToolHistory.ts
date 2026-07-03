// Durable tool cards (0.6.13): persist an agent's finalized tool activity — write diffs and command
// output especially — so they survive a window reload and aren't lost like before (they used to live
// only in a transient in-memory map). Mirrors chatHistory.ts. Cline keeps the full transcript; this
// brings the diff/output half of it to parity.

export const CHAT_TOOLS_LIMIT = 60;
export const CHAT_TOOLS_KEY_PREFIX = 'roam.chat.tools.';

export type ChatToolPhase = 'use' | 'result';
export type ChatToolCategory = 'read' | 'edit' | 'run' | 'mcp' | 'tool';

export interface ChatToolActivity {
  kind: 'tool';
  id: string;
  ts: string;
  phase: ChatToolPhase;
  name: string;
  title: string;
  summary: string;
  category: ChatToolCategory;
  input?: string;
  ok?: boolean;
  detail?: string;
  diff?: string;
}

const CATEGORIES = new Set<ChatToolCategory>(['read', 'edit', 'run', 'mcp', 'tool']);

export function chatToolsKey(agentId: string): string {
  return `${CHAT_TOOLS_KEY_PREFIX}${agentId}`;
}

/**
 * What we persist: only FINALIZED tool cards (phase 'result'). A still-pending ('use') card would
 * otherwise be restored as a forever-"Running" card after a reload mid-turn. Trimmed to the most
 * recent CHAT_TOOLS_LIMIT to bound workspaceState size.
 */
export function serializeToolActivities(items: ChatToolActivity[], limit = CHAT_TOOLS_LIMIT): ChatToolActivity[] {
  return trim(items.filter((t) => t.phase === 'result').map(normalize), limit);
}

export function deserializeToolActivities(value: unknown, limit = CHAT_TOOLS_LIMIT): ChatToolActivity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: ChatToolActivity[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed) {
      out.push(parsed);
    }
  }
  return trim(out, limit);
}

function trim(items: ChatToolActivity[], limit: number): ChatToolActivity[] {
  const n = Math.max(0, Math.floor(limit));
  return n === 0 ? [] : items.slice(-n);
}

function parse(value: unknown): ChatToolActivity | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const c = value as Partial<ChatToolActivity>;
  if (typeof c.name !== 'string') {
    return undefined;
  }
  return normalize({
    kind: 'tool',
    id: typeof c.id === 'string' ? c.id : `tool-${Math.random().toString(36).slice(2)}`,
    ts: typeof c.ts === 'string' ? c.ts : new Date(0).toISOString(),
    phase: 'result',
    name: c.name,
    title: typeof c.title === 'string' ? c.title : c.name,
    summary: typeof c.summary === 'string' ? c.summary : '',
    category: (c.category && CATEGORIES.has(c.category)) ? c.category : 'tool',
    input: typeof c.input === 'string' ? c.input : undefined,
    ok: typeof c.ok === 'boolean' ? c.ok : undefined,
    detail: typeof c.detail === 'string' ? c.detail : undefined,
    diff: typeof c.diff === 'string' ? c.diff : undefined,
  });
}

function normalize(t: ChatToolActivity): ChatToolActivity {
  return {
    kind: 'tool',
    id: String(t.id),
    ts: t.ts || new Date(0).toISOString(),
    // Persisted cards are always finalized — render them as done, never as a phantom "Running".
    phase: 'result',
    name: String(t.name),
    title: String(t.title ?? t.name),
    summary: String(t.summary ?? ''),
    category: CATEGORIES.has(t.category) ? t.category : 'tool',
    input: typeof t.input === 'string' ? t.input : undefined,
    ok: typeof t.ok === 'boolean' ? t.ok : undefined,
    detail: typeof t.detail === 'string' ? t.detail : undefined,
    diff: typeof t.diff === 'string' ? t.diff : undefined,
  };
}
