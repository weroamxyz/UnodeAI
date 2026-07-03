import { Message } from '../types';

export type DelegationStatus = 'working' | 'done' | 'blocked';

export interface DelegationProgressItem {
  id: string;
  coordinatorId: string;
  coordinatorName: string;
  agentId: string;
  agentName: string;
  instruction: string;
  status: DelegationStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
}

export interface DelegationProgressSummary {
  id: string;
  coordinatorId: string;
  coordinatorName: string;
  startedAt: string;
  completedAt?: string;
  total: number;
  done: number;
  blocked: number;
  working: number;
  items: DelegationProgressItem[];
}

export interface DelegationAgentState {
  agentId: string;
  status: DelegationStatus;
  task: string;
  coordinatorName: string;
  updatedAt: string;
}

export type DelegationNameResolver = (id: string) => string;

export class OrchestrationProgressTracker {
  private readonly summaries: DelegationProgressSummary[] = [];
  private readonly itemToSummary = new Map<string, DelegationProgressSummary>();
  private readonly currentByCoordinator = new Map<string, DelegationProgressSummary>();
  private sequence = 0;

  constructor(private readonly resolveName: DelegationNameResolver) {}

  recordMessage(message: Message): boolean {
    if (message.type === 'task.assign') {
      return this.recordAssign(message);
    }
    if (message.type === 'task.complete' || message.type === 'system.error') {
      return this.recordCompletion(message);
    }
    return false;
  }

  snapshot(): DelegationProgressSummary[] {
    return this.summaries
      .slice(-12)
      .map((summary) => ({
        ...summary,
        items: summary.items.map((item) => ({ ...item })),
      }));
  }

  agentStates(): DelegationAgentState[] {
    const latest = new Map<string, DelegationAgentState>();
    for (const summary of this.summaries) {
      for (const item of summary.items) {
        const updatedAt = item.completedAt ?? item.startedAt;
        const previous = latest.get(item.agentId);
        if (previous && previous.updatedAt >= updatedAt) {
          continue;
        }
        latest.set(item.agentId, {
          agentId: item.agentId,
          status: item.status,
          task: item.instruction,
          coordinatorName: item.coordinatorName,
          updatedAt,
        });
      }
    }
    return Array.from(latest.values());
  }

  private recordAssign(message: Message): boolean {
    if (message.from === 'user' || message.to === '*' || message.from === message.to) {
      return false;
    }
    const id = message.correlationId ?? message.id;
    if (this.itemToSummary.has(id)) {
      return false;
    }

    let summary = this.currentByCoordinator.get(message.from);
    if (!summary || summary.working === 0) {
      summary = {
        id: `delegation-${++this.sequence}`,
        coordinatorId: message.from,
        coordinatorName: this.resolveName(message.from),
        startedAt: message.timestamp,
        total: 0,
        done: 0,
        blocked: 0,
        working: 0,
        items: [],
      };
      this.currentByCoordinator.set(message.from, summary);
      this.summaries.push(summary);
      this.trimSummaries();
    }

    const item: DelegationProgressItem = {
      id,
      coordinatorId: message.from,
      coordinatorName: summary.coordinatorName,
      agentId: message.to,
      agentName: this.resolveName(message.to),
      instruction: compactInstruction(message.payload?.instruction ?? message.payload?.message ?? ''),
      status: 'working',
      startedAt: message.timestamp,
    };
    summary.items.push(item);
    summary.total += 1;
    summary.working += 1;
    delete summary.completedAt;
    this.itemToSummary.set(id, summary);
    return true;
  }

  private recordCompletion(message: Message): boolean {
    const id = message.correlationId;
    if (!id) {
      return false;
    }
    const summary = this.itemToSummary.get(id);
    if (!summary) {
      return false;
    }
    const item = summary.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== 'working') {
      return false;
    }

    item.status = message.type === 'system.error' ? 'blocked' : 'done';
    item.completedAt = message.timestamp;
    item.result = compactInstruction(message.payload?.instruction ?? message.payload?.message ?? '');
    summary.working = Math.max(0, summary.working - 1);
    if (item.status === 'blocked') {
      summary.blocked += 1;
    } else {
      summary.done += 1;
    }
    if (summary.working === 0) {
      summary.completedAt = message.timestamp;
    }
    return true;
  }

  private trimSummaries(): void {
    while (this.summaries.length > 16) {
      const removed = this.summaries.shift();
      if (!removed) {
        break;
      }
      if (this.currentByCoordinator.get(removed.coordinatorId)?.id === removed.id) {
        this.currentByCoordinator.delete(removed.coordinatorId);
      }
      for (const item of removed.items) {
        this.itemToSummary.delete(item.id);
      }
    }
  }
}

function compactInstruction(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
