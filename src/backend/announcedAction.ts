/*---------------------------------------------------------------------------------------------
 *  UnodeAi - announcedAction  (weak-model robustness)
 *  Weaker models often end a turn by ANNOUNCING an action ("let me check the package.json:", "让我查
 *  一下：") without actually emitting the tool call, then stop and wait for the user to prompt again.
 *  This detects that "announced but didn't act" shape so the backend can nudge the model to follow
 *  through in the same turn (bounded to one auto-continue). Pure / language-tolerant.
 *--------------------------------------------------------------------------------------------*/

// Intent-to-act phrases (English + Chinese) that, near the end of a message with no tool call, signal
// the model was about to do something and stopped.
const ANNOUNCE_RE =
  /\b(?:let me|let'?s|i'?ll|i will|i'?m going to|i am going to|i'?m about to|going to|gonna|i plan to|i need to|i'?m about|next i|first,? i|now i'?ll|now let me)\b|让我|我来|我会|我将|我要|我打算|我需要|我去|我现在|现在(?:我)?(?:来|就|去|开始|切到?|调用)|接下来|下一步|首先|稍等|先(?:让|用|去|调|读|写|看|跑|创建|检查|验证)|然后(?:我)?(?:来|去|会|要|调|读|写|创建)/i;

/**
 * True when `text` looks like the model announced an imminent action but stopped (no tool call).
 * Strong signals: the message ends with a colon (about to do/list something), or an intent-to-act
 * phrase appears near the end.
 */
export function looksLikeAnnouncedAction(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) {
    return false;
  }
  // Ends with a colon → "I'm about to …:" with nothing after = announced-and-stopped.
  if (/[:：]\s*$/.test(t)) {
    return true;
  }
  // Or an intent-to-act phrase in the last stretch of the message.
  return ANNOUNCE_RE.test(t.slice(-100));
}

// P2: phrases that assert a task is ALREADY satisfied / needs no work. When a write-capable worker
// ends a turn with one of these AND has used no tools, it concluded without checking (the stale-memory
// "it's already a-b, no changes needed" failure). English + Chinese; language-tolerant.
const COMPLETION_CLAIM_RE =
  /\b(?:already (?:done|complete|completed|correct|implemented|in place|has|returns|set)|no changes? (?:needed|necessary|required|are needed)|nothing (?:to (?:do|change|fix|update)|needs? (?:to be )?chang)|no (?:action|edit|modification|work) (?:is )?(?:needed|required)|is already|that'?s already)\b|已经(?:完成|做(?:好|完)|是|有|实现|正确|改|存在)|无需(?:更改|修改|改动|更动)|不需要(?:更改|修改|改|做)|没有(?:需要|必要)(?:更改|修改|改)|不用(?:改|修改)/i;

/**
 * True when `text` asserts the task is already done / needs no changes. Used (only together with
 * "made no tool calls this turn") to nudge a worker that concluded without actually looking.
 */
export function looksLikeUnverifiedCompletion(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) {
    return false;
  }
  return COMPLETION_CLAIM_RE.test(t);
}

// A Claude model that believes it's "Claude Code" sometimes refuses by claiming its tool results are
// faked by a hook / a "prompt injection", or insists its real tools are Edit/Write/Bash. These phrases are
// UNAMBIGUOUS refusals — they never appear in a normal helpful answer.
const STRONG_DISTRUST_RE =
  /prompt[\s-]?injection|check your (?:claude code )?hooks?|hooks?[\s-]?(?:configuration|settings|config)|intercept(?:ing|s|ed)? my tool|fak(?:e|ing|ed) (?:error|tool|result)|returning (?:a )?fake|(?:isn'?t|aren'?t|not) part of my (?:defined )?toolset|my (?:actual|real) tools (?:are|include)/i;

// "run it in your terminal / manually" is also how a model deflects — BUT it's the correct answer to
// "how do I run the tests?" too. So it only counts as a refusal when paired with an inability/deflection
// signal, to avoid nudging a legitimate instructional answer (Codex review).
const MANUAL_RUN_RE = /you (?:could|can|should|'?ll need to|need to|have to) (?:manually )?run|run (?:this|that|the following|it) (?:in your )?(?:terminal|manually)|manually (?:run|add|edit|append)|in your terminal/i;
const REFUSAL_CONTEXT_RE = /\bi can(?:'?t| '?t| not|not)\b|\bunable to\b|\binstead\b|\bnot part of my\b|\bmy (?:actual|real|defined|own)? ?tools?\b|\byou (?:need|have|'?ll need) to\b|\bi'?m not able\b|\bcan'?t (?:edit|write|do|run)\b/i;

/**
 * True when `text` looks like a "your tools are fake / it's a hook / run it yourself" refusal — used (with
 * "made no tool call this turn") to nudge the model back to using its real tools instead of giving up.
 * Strong phrases match outright; the "run it in your terminal" deflection only matches alongside a refusal
 * signal, so a normal "to run the tests, use `npm test`" answer is NOT flagged.
 */
export function looksLikeToolDistrustRefusal(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) {
    return false;
  }
  if (STRONG_DISTRUST_RE.test(t)) {
    return true;
  }
  return MANUAL_RUN_RE.test(t) && REFUSAL_CONTEXT_RE.test(t);
}
