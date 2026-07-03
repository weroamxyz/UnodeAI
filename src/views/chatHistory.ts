export const CHAT_HISTORY_LIMIT = 50;
export const CHAT_HISTORY_KEY_PREFIX = 'roam.chat.';

export type ChatHistoryRole = 'user' | 'agent';

export interface ChatHistoryMessage {
  role: ChatHistoryRole;
  text: string;
  ts: string;
  fromName?: string;
  isError?: boolean;
}

export function chatHistoryKey(agentId: string): string {
  return `${CHAT_HISTORY_KEY_PREFIX}${agentId}`;
}

export function appendChatMessage(
  history: ChatHistoryMessage[],
  message: ChatHistoryMessage,
  limit = CHAT_HISTORY_LIMIT
): ChatHistoryMessage[] {
  return trimChatHistory([...history, normalizeMessage(message)], limit);
}

export function serializeChatHistory(history: ChatHistoryMessage[], limit = CHAT_HISTORY_LIMIT): ChatHistoryMessage[] {
  return trimChatHistory(history.map(normalizeMessage), limit);
}

export function deserializeChatHistory(value: unknown, limit = CHAT_HISTORY_LIMIT): ChatHistoryMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const messages: ChatHistoryMessage[] = [];
  for (const item of value) {
    const parsed = parseMessage(item);
    if (parsed) {
      messages.push(parsed);
    }
  }
  return trimChatHistory(messages, limit);
}

function trimChatHistory(history: ChatHistoryMessage[], limit: number): ChatHistoryMessage[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return [];
  }
  return history.slice(-safeLimit);
}

function parseMessage(value: unknown): ChatHistoryMessage | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Partial<ChatHistoryMessage>;
  if ((candidate.role !== 'user' && candidate.role !== 'agent') || typeof candidate.text !== 'string') {
    return undefined;
  }
  return normalizeMessage({
    role: candidate.role,
    text: candidate.text,
    ts: typeof candidate.ts === 'string' ? candidate.ts : new Date(0).toISOString(),
    fromName: typeof candidate.fromName === 'string' ? candidate.fromName : undefined,
    isError: typeof candidate.isError === 'boolean' ? candidate.isError : undefined,
  });
}

function normalizeMessage(message: ChatHistoryMessage): ChatHistoryMessage {
  return {
    role: message.role,
    text: String(message.text),
    ts: message.ts || new Date(0).toISOString(),
    fromName: message.fromName,
    isError: message.isError === true ? true : undefined,
  };
}
