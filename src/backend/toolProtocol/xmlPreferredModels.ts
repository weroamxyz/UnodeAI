/*---------------------------------------------------------------------------------------------
 *  UnodeAi - xmlPreferredModels
 *  Which models should START on the XML tool protocol (instead of native function-calling).
 *
 *  These cheap/weak models reliably emit their tool calls as TEXT instead of the OpenAI `tool_calls`
 *  field — DeepSeek's `<｜｜DSML｜｜invoke…>`, Kimi's `<|tool_call_begin|>…` tokens — which makes the
 *  native protocol parse nothing, treat the markup as the final answer, and STALL. Option 4 already
 *  recovers by flipping to XML after the first such leak, but that costs a wasted/stalled turn every
 *  time. Starting these models in XML from turn one gives them a format guide immediately and skips the
 *  stall entirely. Frontier models (Claude/GPT/Gemini) do native cleanly and are left on native.
 *
 *  This is only the DEFAULT — an explicit AgentConfig.toolProtocol ('native' or 'xml') always wins.
 *  Tunable: add/remove substrings as dogfooding shows which model families need it.
 *--------------------------------------------------------------------------------------------*/

/** Model-id substrings (case-insensitive) whose native tool-calling is unreliable enough to default
 *  to XML. Matched as substrings so version suffixes (e.g. `kimi-k2.7-code`) hit. NOTE: DeepSeek is
 *  deliberately NOT here — it's the high-volume gateway default and newer DeepSeek handles native
 *  acceptably; Option 4 still flips it to XML on an actual leak. These are the always-leakers. */
export const XML_PREFERRED_MODEL_HINTS = ['kimi', 'k2', 'moonshot', 'glm', 'minimax'];

/** True when this model should default to the XML tool protocol (a known tool-call leaker). */
export function prefersXmlByDefault(model: string | undefined): boolean {
  const m = (model || '').toLowerCase();
  if (!m) {
    return false;
  }
  return XML_PREFERRED_MODEL_HINTS.some((hint) => m.includes(hint));
}
