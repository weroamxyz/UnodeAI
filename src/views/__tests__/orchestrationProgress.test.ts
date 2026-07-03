import { describe, expect, it } from 'vitest';

import { MessageBus } from '../../bus/MessageBus';
import { OrchestrationProgressTracker } from '../orchestrationProgress';

describe('OrchestrationProgressTracker', () => {
  it('tracks coordinator fan-out as done/total progress', () => {
    const bus = new MessageBus();
    const tracker = new OrchestrationProgressTracker((id) => ({ pm: 'PM', dev: 'Developer', qa: 'QA' }[id] ?? id));

    bus.on('message.sent', (msg) => tracker.recordMessage(msg));

    const dev = bus.send('pm', 'dev', 'task.assign', { instruction: 'Build the fix' }, 'high', 'dev-task');
    const qa = bus.send('pm', 'qa', 'task.assign', { instruction: 'Test the fix' }, 'high', 'qa-task');

    let [summary] = tracker.snapshot();
    expect(summary.total).toBe(2);
    expect(summary.working).toBe(2);
    expect(summary.done).toBe(0);
    expect(summary.items.map((item) => item.agentName)).toEqual(['Developer', 'QA']);

    bus.send('dev', 'pm', 'task.complete', { instruction: 'done' }, 'normal', dev.correlationId);
    bus.send('qa', 'pm', 'system.error', { instruction: 'tests failed' }, 'normal', qa.correlationId);

    [summary] = tracker.snapshot();
    expect(summary.working).toBe(0);
    expect(summary.done).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.completedAt).toBeDefined();

    const states = tracker.agentStates();
    expect(states.find((state) => state.agentId === 'dev')?.status).toBe('done');
    expect(states.find((state) => state.agentId === 'qa')?.status).toBe('blocked');

    bus.dispose();
  });

  it('ignores direct user assignments because they are not crew delegation', () => {
    const bus = new MessageBus();
    const tracker = new OrchestrationProgressTracker((id) => id);
    bus.on('message.sent', (msg) => tracker.recordMessage(msg));

    bus.send('user', 'dev', 'task.assign', { instruction: 'Do this' }, 'normal');

    expect(tracker.snapshot()).toEqual([]);
    bus.dispose();
  });
});
