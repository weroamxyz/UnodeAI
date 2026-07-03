import { describe, it, expect } from 'vitest';
import { MessageBus } from '../MessageBus';

describe('MessageBus persistence (P1#5)', () => {
  it('exports the most recent messages bounded by limit', () => {
    const bus = new MessageBus();
    for (let i = 0; i < 10; i++) {
      bus.send('user', 'dev', 'task.assign', { instruction: `m${i}` });
    }
    const exported = bus.exportMessages(3);
    expect(exported).toHaveLength(3);
    expect(exported.map((m) => m.payload.instruction)).toEqual(['m7', 'm8', 'm9']);
  });

  it('imports persisted history into a fresh bus so the log survives a reload', () => {
    const source = new MessageBus();
    source.send('user', 'dev', 'task.assign', { instruction: 'before reload' });
    const saved = source.exportMessages();

    const restored = new MessageBus();
    expect(restored.getMessageCount()).toBe(0);
    restored.importMessages(saved);
    expect(restored.getMessageCount()).toBe(1);
    expect(restored.query({ type: 'task.assign' })[0].payload.instruction).toBe('before reload');
  });

  it('does NOT re-dispatch imported messages to subscribers', () => {
    const bus = new MessageBus();
    const got: string[] = [];
    bus.onType('task.assign', (m) => got.push(m.payload.instruction ?? ''));
    bus.importMessages([
      {
        id: 'x', from: 'user', to: 'dev', type: 'task.assign', priority: 'normal',
        payload: { instruction: 'replayed' }, timestamp: new Date().toISOString(),
      },
    ]);
    expect(got).toEqual([]); // restore is for the log only, not a replay
    expect(bus.getMessageCount()).toBe(1);
  });

  it('ignores empty/invalid imports', () => {
    const bus = new MessageBus();
    bus.importMessages([]);
    bus.importMessages(undefined as never);
    expect(bus.getMessageCount()).toBe(0);
  });
});
