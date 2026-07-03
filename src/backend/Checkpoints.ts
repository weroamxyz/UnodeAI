/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Checkpoints  (V1: per-write snapshot + restore — the v0.4 "trust" core)
 *  Every file-mutating tool use already produces before/after content (WorkspaceTools sets
 *  oldContent/newContent on its run result, used today to render the chat diff). We tap that here:
 *  each successful write records a Checkpoint holding the file's content BEFORE the edit, so the user
 *  can one-click restore a file to any earlier point — no shadow-git needed.
 *
 *  The store is pure/dependency-free (in-memory + a serialize/restore round-trip for persistence) so
 *  it's unit-testable without vscode. The extension injects the recorder into WorkspaceTools, persists
 *  the serialized state, and applies a restore by writing `before` back to disk.
 *
 *  Scope (MVP): covers writes that go through WorkspaceTools (openai-compat / Roam agents). Claude
 *  native-tool writes aren't captured yet — see BACKLOG (needs a workspace file watcher).
 *--------------------------------------------------------------------------------------------*/

export interface Checkpoint {
  /** Monotonic id, unique within a store instance. */
  id: number;
  agentId: string;
  agentName: string;
  /** Workspace-relative path as reported by the tool (display + restore target). */
  path: string;
  /** File content BEFORE this edit (null = file did not exist → restore deletes it). */
  before: string | null;
  /** File content AFTER this edit (for diff/preview; not needed to restore). */
  after: string;
  /** ms epoch when recorded. */
  ts: number;
  /** True when before/after were too large to retain — listed but not restorable. */
  truncated?: boolean;
}

/** What the caller passes when a write succeeds (ids/timestamps are assigned by the store). */
export interface CheckpointInput {
  agentId: string;
  agentName: string;
  path: string;
  before: string | null;
  after: string;
}

export interface SerializedCheckpoints {
  version: 1;
  nextId: number;
  items: Checkpoint[];
}

/** Don't retain huge blobs: a file larger than this (either side) is logged but marked non-restorable. */
const MAX_CONTENT_BYTES = 200_000;
/** Keep memory/persistence bounded — oldest checkpoints fall off. */
const DEFAULT_MAX_ENTRIES = 200;

export class CheckpointStore {
  private items: Checkpoint[] = [];
  private nextId = 1;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  /** Record a write. Returns the stored Checkpoint. A no-op edit (before === after) is skipped. */
  record(input: CheckpointInput): Checkpoint | undefined {
    if (input.before === input.after) {
      return undefined; // nothing changed — not worth a restore point
    }
    const tooBig =
      (input.before != null && input.before.length > MAX_CONTENT_BYTES) ||
      input.after.length > MAX_CONTENT_BYTES;
    const cp: Checkpoint = {
      id: this.nextId++,
      agentId: input.agentId,
      agentName: input.agentName,
      path: input.path,
      before: tooBig ? null : input.before,
      after: tooBig ? '' : input.after,
      ts: Date.now(),
      ...(tooBig ? { truncated: true } : {}),
    };
    this.items.push(cp);
    if (this.items.length > this.maxEntries) {
      this.items.splice(0, this.items.length - this.maxEntries);
    }
    return cp;
  }

  /** All checkpoints, newest first. */
  list(): Checkpoint[] {
    return [...this.items].reverse();
  }

  get(id: number): Checkpoint | undefined {
    return this.items.find((c) => c.id === id);
  }

  /** Restorable checkpoints only (have retained content), newest first. */
  restorable(): Checkpoint[] {
    return this.list().filter((c) => !c.truncated);
  }

  clear(): void {
    this.items = [];
  }

  serialize(): SerializedCheckpoints {
    return { version: 1, nextId: this.nextId, items: [...this.items] };
  }

  /** Replace state from a persisted blob. Tolerant of missing/garbage input (keeps current state). */
  restoreFrom(data: SerializedCheckpoints | undefined): void {
    if (!data || data.version !== 1 || !Array.isArray(data.items)) {
      return;
    }
    this.items = data.items.slice(-this.maxEntries);
    this.nextId = Math.max(data.nextId ?? 1, ...this.items.map((c) => c.id + 1), 1);
  }
}
