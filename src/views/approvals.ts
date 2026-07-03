/*---------------------------------------------------------------------------------------------
 *  UnodeAi - in-panel approvals (vscode-free core)
 *  The request/response queue behind the chat panel's approval cards (replacing native modals).
 *  Kept vscode-free so the queue logic is unit-tested without the editor.
 *--------------------------------------------------------------------------------------------*/

export type ApprovalKind = 'command' | 'write';

export interface ApprovalSettings {
  /** roam.commandApproval: none | ask | allowlist | all */
  command: string;
  /** roam.writeApproval: none | ask */
  write: string;
}

/** A pending action awaiting the user's in-panel approval. */
export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  agentName: string;
  /** command kind */
  command?: string;
  template?: string;
  /** write kind */
  path?: string;
  verb?: 'create' | 'overwrite';
  diff?: string;
}

/** The user's answer. `action` is kind-specific; `note` is an optional deny reason for the agent. */
export interface ApprovalDecision {
  action: string;
  note?: string;
}

/**
 * Queue of pending approvals, each tied to a promise resolved when the user decides. `onChange` fires
 * whenever the visible queue changes so the host can re-render. Disposing denies anything still pending
 * so a torn-down panel never hangs the agent waiting on it.
 */
export class ApprovalQueue {
  private queue: ApprovalRequest[] = [];
  private resolvers = new Map<string, (decision: ApprovalDecision) => void>();
  private seq = 0;

  constructor(private readonly onChange: () => void = () => {}) {}

  /** Enqueue a request and return the promise that resolves with the user's decision. */
  request(req: Omit<ApprovalRequest, 'id'>): Promise<ApprovalDecision> {
    const id = `appr-${++this.seq}-${Date.now()}`;
    const full = { ...req, id } as ApprovalRequest;
    return new Promise<ApprovalDecision>((resolve) => {
      this.resolvers.set(id, resolve);
      this.queue.push(full);
      this.onChange();
    });
  }

  /** Resolve a pending request by id. Returns true if it was pending (false if unknown/already done). */
  resolve(id: string, decision: ApprovalDecision): boolean {
    const resolver = this.resolvers.get(id);
    if (!resolver) {
      return false;
    }
    this.resolvers.delete(id);
    this.queue = this.queue.filter((a) => a.id !== id);
    resolver(decision);
    this.onChange();
    return true;
  }

  /** The current visible queue (for rendering). */
  list(): ApprovalRequest[] {
    return this.queue;
  }

  /** Count of still-unresolved requests. */
  pendingCount(): number {
    return this.resolvers.size;
  }

  /** Deny everything still pending (on dispose) so no awaiting agent hangs. */
  denyAll(): void {
    for (const [id, resolver] of this.resolvers) {
      resolver({ action: 'deny' });
      this.resolvers.delete(id);
    }
    this.queue = [];
    this.onChange();
  }
}
