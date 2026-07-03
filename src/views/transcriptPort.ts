import { ChatHistoryMessage, deserializeChatHistory, serializeChatHistory } from './chatHistory';

export interface ChatTranscriptAgent {
  id: string;
  name: string;
  role: string;
}

export interface MessageLogItem {
  time: string;
  from: string;
  to: string;
  type: string;
  priority: string;
  content: string;
}

export type TranscriptKind = 'chat' | 'messages';

export interface TranscriptPayload<TKind extends TranscriptKind, TMessage> {
  version: 1;
  kind: TKind;
  exportedAt: string;
  messages: TMessage[];
  agent?: ChatTranscriptAgent;
}

export type TranscriptParseResult<T> =
  | { ok: true; messages: T[] }
  | { ok: false; error: string };

export function createChatExportPayload(
  agent: ChatTranscriptAgent,
  messages: ChatHistoryMessage[],
  exportedAt = new Date().toISOString()
): TranscriptPayload<'chat', ChatHistoryMessage> {
  return {
    version: 1,
    kind: 'chat',
    agent,
    exportedAt,
    messages: serializeChatHistory(messages),
  };
}

export function createMessagesExportPayload(
  messages: MessageLogItem[],
  exportedAt = new Date().toISOString()
): TranscriptPayload<'messages', MessageLogItem> {
  return {
    version: 1,
    kind: 'messages',
    exportedAt,
    messages: normalizeMessageLogItems(messages),
  };
}

export function parseChatImportPayload(raw: unknown): TranscriptParseResult<ChatHistoryMessage> {
  const base = parseBasePayload(raw, 'chat');
  if (!base.ok) {
    return base;
  }
  return { ok: true, messages: deserializeChatHistory(base.messages) };
}

export function parseMessagesImportPayload(raw: unknown): TranscriptParseResult<MessageLogItem> {
  const base = parseBasePayload(raw, 'messages');
  if (!base.ok) {
    return base;
  }
  return { ok: true, messages: normalizeMessageLogItems(base.messages) };
}

function parseBasePayload(raw: unknown, kind: TranscriptKind): TranscriptParseResult<unknown> {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'Invalid JSON.' };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Import file must contain a JSON object.' };
  }
  const payload = parsed as { kind?: unknown; messages?: unknown };
  if (payload.kind !== kind) {
    return { ok: false, error: `Import file must have kind "${kind}".` };
  }
  if (!Array.isArray(payload.messages)) {
    return { ok: false, error: 'Import file must contain a messages array.' };
  }
  return { ok: true, messages: payload.messages };
}

function normalizeMessageLogItems(items: unknown[]): MessageLogItem[] {
  const out: MessageLogItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const candidate = item as Partial<MessageLogItem>;
    if (
      typeof candidate.time !== 'string' ||
      typeof candidate.from !== 'string' ||
      typeof candidate.to !== 'string' ||
      typeof candidate.type !== 'string'
    ) {
      continue;
    }
    out.push({
      time: candidate.time,
      from: candidate.from,
      to: candidate.to,
      type: candidate.type,
      priority: typeof candidate.priority === 'string' ? candidate.priority : 'normal',
      content: typeof candidate.content === 'string' ? candidate.content : '',
    });
  }
  return out.slice(-300);
}
