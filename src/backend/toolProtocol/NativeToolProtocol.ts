/*---------------------------------------------------------------------------------------------
 *  UnodeAi - NativeToolProtocol
 *  The default protocol: OpenAI-style native function calling. Tools are advertised via the API's
 *  `tools` field and the model returns structured `tool_calls`; results go back as role:'tool'
 *  messages. This is exactly the behaviour OpenAICompatBackend had before design C — extracted behind
 *  the ToolProtocol seam so an alternative (XmlToolProtocol) can be swapped in for weaker models.
 *--------------------------------------------------------------------------------------------*/

import type { ToolSpec } from '../WorkspaceTools';
import {
  AssistantMessageView,
  ParsedToolCall,
  ProtocolHistoryMessage,
  ToolProtocol,
} from './ToolProtocol';
import { recoverLeakedToolCalls } from './leakedToolCalls';
import { parseFlatXmlToolCall } from './flatXmlToolCall';

export class NativeToolProtocol implements ToolProtocol {
  public readonly sendsNativeTools = true;
  private recoveredCount = 0;

  /** Tool specs, so a flat-XML call leaked into content can be matched against known tool names. */
  constructor(private readonly specs: ToolSpec[] = []) {}

  /** Native advertises tools through the API's `tools` field, so no prompt guide is needed. */
  renderToolGuide(_specs: ToolSpec[]): string {
    return '';
  }

  parseCalls(msg: AssistantMessageView): ParsedToolCall[] {
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      return msg.tool_calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        args: safeParseArgs(call.function.arguments),
      }));
    }
    const content = msg.content ?? '';
    // Robustness: some models (e.g. DeepSeek) leak the tool call into `content` as text instead of the
    // tool_calls field (DSML/antml invoke, Kimi tokens). Recover those so they execute instead of
    // dead-ending in chat.
    const leaked = recoverLeakedToolCalls(content);
    if (leaked.length > 0) {
      return leaked.map((c) => ({ id: `recovered-${++this.recoveredCount}`, name: c.name, args: c.args, recovered: true }));
    }
    // And a reasoning model (e.g. Kimi) on native function-calling may emit a FLAT-XML call after a
    // </think> block — <read_file><path>…</path></read_file>. Recover that too (keyed on known tool
    // names) so the turn doesn't stall with an unexecuted call inside it.
    const flat = parseFlatXmlToolCall(content, this.specs);
    return flat ? [{ id: `recovered-${++this.recoveredCount}`, name: flat.name, args: flat.args, recovered: true }] : [];
  }

  formatResult(call: ParsedToolCall, output: string): ProtocolHistoryMessage {
    // A recovered call has no matching assistant `tool_calls` entry in history, so a native role:'tool'
    // message would be an orphan that strict OpenAI-compatible APIs reject. Feed it back as a plain user
    // message instead (the model still sees the result; the next request stays valid).
    if (call.recovered) {
      return { role: 'user', content: `[Tool result: ${call.name}]\n${output}` };
    }
    return { role: 'tool', tool_call_id: call.id, content: output };
  }
}

/** Tolerant parse of a native tool call's `arguments` JSON string ('' / invalid -> {}). */
function safeParseArgs(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
