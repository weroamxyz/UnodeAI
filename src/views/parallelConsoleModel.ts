import { SessionInfo, SessionStatus } from '../types';

export interface ConsoleRow {
  id: string;
  name: string;
  role: string;
  status: SessionStatus;
  statusEmoji: string;
  statusLabel: string;
  currentTask: string;
  currentTaskTitle: string;
  contextPercent?: number;
  contextLabel?: string;
  costLabel?: string;
  turnsLabel?: string;
  tokenLabel?: string;
  errorMessage?: string;
  errorTitle?: string;
}

const TASK_LIMIT = 96;
const ERROR_LIMIT = 140;

export function toConsoleRows(sessions: SessionInfo[]): ConsoleRow[] {
  return sessions.map((session) => {
    const usage = session.usage;
    const contextPercent = session.contextUsage
      ? Math.round(session.contextUsage.ratio * 100)
      : undefined;
    const task = normalizeText(session.currentTask) || 'idle';
    const error = normalizeText(session.errorMessage);

    return {
      id: session.id,
      name: session.config.name,
      role: session.config.role,
      status: session.status,
      statusEmoji: stateEmoji(session.status),
      statusLabel: statusLabel(session.status),
      currentTask: truncate(task, TASK_LIMIT),
      currentTaskTitle: task,
      contextPercent,
      contextLabel: contextPercent === undefined ? undefined : `ctx ${contextPercent}%`,
      costLabel: usage ? formatCost(usage.costUsd) : undefined,
      turnsLabel: usage ? `${usage.turns} ${usage.turns === 1 ? 'turn' : 'turns'}` : undefined,
      tokenLabel: usage ? formatTokens(usage.inputTokens + usage.outputTokens) : undefined,
      errorMessage: error ? truncate(error, ERROR_LIMIT) : undefined,
      errorTitle: error || undefined,
    };
  });
}

export function stateEmoji(status: SessionStatus): string {
  switch (status) {
    case 'running': return '🏃';
    case 'idle': return '🧘';
    case 'stopped': return '😴';
    case 'error': return '🤒';
    case 'starting': return '🚦';
    case 'stopping': return '🚦';
    default: return '🧘';
  }
}

function statusLabel(status: SessionStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatCost(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k tok`;
  }
  return `${tokens} tok`;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
