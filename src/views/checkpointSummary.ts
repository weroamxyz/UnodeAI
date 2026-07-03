import { Checkpoint } from '../backend/Checkpoints';

export interface ChangedFileSummary {
  path: string;
  checkpointId: number;
  ts: number;
}

const MAX_FILES_PER_AGENT = 8;

export function groupChangedFilesByAgent(checkpoints: Checkpoint[]): Map<string, ChangedFileSummary[]> {
  const grouped = new Map<string, ChangedFileSummary[]>();
  const seenPathsByAgent = new Map<string, Set<string>>();

  const newestFirst = [...checkpoints].sort((a, b) => (b.ts - a.ts) || (b.id - a.id));

  for (const checkpoint of newestFirst) {
    const existing = grouped.get(checkpoint.agentId) ?? [];
    if (existing.length >= MAX_FILES_PER_AGENT) {
      continue;
    }

    let seenPaths = seenPathsByAgent.get(checkpoint.agentId);
    if (!seenPaths) {
      seenPaths = new Set<string>();
      seenPathsByAgent.set(checkpoint.agentId, seenPaths);
    }
    if (seenPaths.has(checkpoint.path)) {
      continue;
    }

    seenPaths.add(checkpoint.path);
    existing.push({
      path: checkpoint.path,
      checkpointId: checkpoint.id,
      ts: checkpoint.ts,
    });
    grouped.set(checkpoint.agentId, existing);
  }

  return grouped;
}
