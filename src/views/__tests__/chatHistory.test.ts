import { describe, expect, it } from 'vitest';
import {
  appendChatMessage,
  chatHistoryKey,
  deserializeChatHistory,
  serializeChatHistory,
  ChatHistoryMessage,
} from '../chatHistory';

describe('chatHistory', () => {
  it('keeps the newest messages within the cap', () => {
    let history: ChatHistoryMessage[] = [];
    for (let i = 0; i < 55; i++) {
      history = appendChatMessage(history, {
        role: i % 2 === 0 ? 'user' : 'agent',
        text: `message ${i}`,
        ts: new Date(i).toISOString(),
      });
    }

    expect(history).toHaveLength(50);
    expect(history[0].text).toBe('message 5');
    expect(history[49].text).toBe('message 54');
  });

  it('serializes only valid bounded chat records', () => {
    const serialized = serializeChatHistory([
      { role: 'user', text: 'hello', ts: '2026-06-05T00:00:00.000Z' },
      { role: 'agent', text: 'hi', ts: '2026-06-05T00:00:01.000Z', fromName: 'Dev', isError: false },
    ]);

    expect(serialized).toEqual([
      { role: 'user', text: 'hello', ts: '2026-06-05T00:00:00.000Z', fromName: undefined, isError: undefined },
      { role: 'agent', text: 'hi', ts: '2026-06-05T00:00:01.000Z', fromName: 'Dev', isError: undefined },
    ]);
  });

  it('deserializes workspaceState data defensively', () => {
    const restored = deserializeChatHistory([
      { role: 'user', text: 'safe', ts: '2026-06-05T00:00:00.000Z' },
      { role: 'agent', text: 123, ts: 'bad' },
      { role: 'system', text: 'skip', ts: 'bad' },
    ]);

    expect(restored).toEqual([
      { role: 'user', text: 'safe', ts: '2026-06-05T00:00:00.000Z', fromName: undefined, isError: undefined },
    ]);
  });

  it('uses the required workspaceState key prefix', () => {
    expect(chatHistoryKey('dev')).toBe('roam.chat.dev');
  });
});
