/*---------------------------------------------------------------------------------------------
 *  UnodeAi - TokenCounter
 *  Deterministic context-window guard. Soft limit signals structured compaction; hard limit is
 *  the emergency safety valve that prevents provider-side truncation.
 *--------------------------------------------------------------------------------------------*/

export interface ContextAssessment {
  tokens: number;
  window: number;
  ratio: number;
  /** At/over the soft threshold: compaction is due. */
  soft: boolean;
  /** At/over the hard threshold: stop issuing new tool calls and force compaction/trimming. */
  hard: boolean;
}

export interface SoftLimitResult<T> {
  triggered: boolean;
  tokens: number;
  limit: number;
  toDrop: T[];
  keep: T[];
}

/** Rough token estimate without a tokenizer: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export class TokenCounter {
  constructor(
    private window = 128_000,
    private softRatio = 0.7,
    private hardRatio = 0.8
  ) {}

  /** Estimate the context tokens of a set of chat messages (content only). */
  estimateMessages(messages: Array<{ content?: string | null }>): number {
    let total = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') {
        total += estimateTokens(m.content);
      }
    }
    return total;
  }

  /** Token budget at the soft threshold. */
  softLimit(): number;
  /** Plan a soft-limit compaction while preserving system messages, the first user anchor, and a recent tail. */
  softLimit<T extends { role?: string; content?: string | null }>(messages: T[]): SoftLimitResult<T>;
  softLimit<T extends { role?: string; content?: string | null }>(messages?: T[]): number | SoftLimitResult<T> {
    const limit = Math.floor(this.window * this.softRatio);
    if (!messages) {
      return limit;
    }

    const tokens = this.estimateMessages(messages);
    if (tokens < limit) {
      return { triggered: false, tokens, limit, toDrop: [], keep: messages };
    }

    const systemPrefix: T[] = [];
    let idx = 0;
    while (idx < messages.length && messages[idx].role === 'system') {
      systemPrefix.push(messages[idx]);
      idx++;
    }

    const rest = messages.slice(idx);
    const anchorIdx = rest.findIndex((m) => m.role === 'user');
    const anchor = anchorIdx >= 0 ? rest[anchorIdx] : undefined;
    const body = anchorIdx >= 0 ? rest.slice(anchorIdx + 1) : rest.slice();
    const head = anchor ? [...systemPrefix, anchor] : systemPrefix.slice();
    const tail = body.slice();
    const toDrop: T[] = [];

    while (tail.length > 0 && this.estimateMessages([...head, ...tail]) > limit) {
      toDrop.push(tail.shift()!);
    }
    while (tail.length > 0 && tail[0].role !== 'user') {
      toDrop.push(tail.shift()!);
    }

    return {
      triggered: toDrop.length > 0,
      tokens,
      limit,
      toDrop,
      keep: [...head, ...tail],
    };
  }

  /** Token budget at the hard threshold. */
  hardLimit(): number {
    return Math.floor(this.window * this.hardRatio);
  }

  /** Classify a token count against the window's soft/hard thresholds. */
  assess(tokens: number): ContextAssessment {
    const ratio = this.window > 0 ? tokens / this.window : 0;
    return {
      tokens,
      window: this.window,
      ratio,
      soft: ratio >= this.softRatio,
      hard: ratio >= this.hardRatio,
    };
  }
}
