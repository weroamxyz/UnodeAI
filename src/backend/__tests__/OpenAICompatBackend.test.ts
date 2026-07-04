import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ChatMessage, OpenAICompatBackend, FetchFn, StreamFetchFn, sanitizeToolCallPairing, normalizeEmptyContent, splitParallelToolCalls, toolPairingTrace } from '../OpenAICompatBackend';
import { AgentConfig } from '../../types';
import { BackendEvent } from '../AgentBackend';
import { MCPHub } from '../../mcp/MCPHub';
import { TeamTools } from '../TeamTools';
import { MessageBus } from '../../bus/MessageBus';
import { TurnAttachments } from '../AgentBackend';
import { TaskClaimRegistry } from '../TaskClaimRegistry';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'a1',
    name: 'Worker',
    role: 'senior-dev',
    skill: '',
    provider: { providerId: 'custom', apiKeySecretName: 'CUSTOM_API_KEY' },
    model: 'deepseek-chat',
    systemPrompt: 'Be terse.',
    autoApprove: true,
    allowedTools: [],
    baseUrl: 'https://gateway.example/v1',
    ...overrides,
  };
}

/** Builds a fake fetch that returns scripted JSON bodies in order, recording each request. */
function scriptedFetch(bodies: unknown[]): { fetchFn: FetchFn; requests: any[]; urls: string[] } {
  const requests: any[] = [];
  const urls: string[] = [];
  let i = 0;
  const fetchFn: FetchFn = async (url, init) => {
    urls.push(url);
    requests.push(JSON.parse(init.body));
    const body = bodies[Math.min(i++, bodies.length - 1)];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchFn, requests, urls };
}

function scriptedStreamFetch(chunks: string[][]): { streamFetchFn: StreamFetchFn; requests: any[] } {
  const requests: any[] = [];
  const encoder = new TextEncoder();
  let i = 0;
  const streamFetchFn: StreamFetchFn = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const bodyChunks = chunks[Math.min(i++, chunks.length - 1)];
    return {
      ok: true,
      status: 200,
      body: (async function* () {
        for (const chunk of bodyChunks) {
          yield encoder.encode(chunk);
        }
      })(),
    };
  };
  return { streamFetchFn, requests };
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function runOneTurn(
  backend: OpenAICompatBackend,
  instruction: string,
  attachments?: TurnAttachments
): Promise<BackendEvent[]> {
  const events: BackendEvent[] = [];
  const done = new Promise<void>((resolve) => {
    backend.onEvent((e) => {
      events.push(e);
      if (e.kind === 'turn_complete') { resolve(); }
    });
  });
  await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
  backend.sendUserTurn(instruction, attachments);
  await done;
  return events;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('OpenAICompatBackend', () => {
  it('sends Roam-provider agents to the Roam gateway even when a legacy OpenAI base URL is persisted', async () => {
    const { fetchFn, urls } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(
      makeConfig({
        provider: { providerId: 'roam', apiKeySecretName: 'ROAM_API_KEY' },
        baseUrl: 'https://api.openai.com/v1',
      }),
      fetchFn
    );

    await backend.start({ ROAM_API_KEY: 'sk-roam' });
    const done = new Promise<void>((resolve) => {
      backend.onEvent((e) => {
        if (e.kind === 'turn_complete') { resolve(); }
      });
    });
    backend.sendUserTurn('hello');
    await done;

    expect(urls[0]).toBe('https://ai.weroam.xyz/v1/chat/completions');
  });

  it('returns a plain answer and reports token usage', async () => {
    const { fetchFn, requests } = scriptedFetch([
      {
        choices: [{ message: { role: 'assistant', content: 'hello there' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    const events = await runOneTurn(backend, 'hi');

    const assistant = events.find((e) => e.kind === 'assistant');
    const complete = events.find((e) => e.kind === 'turn_complete');
    expect(assistant).toMatchObject({ text: 'hello there' });
    expect(complete).toMatchObject({ result: { isError: false, usage: { inputTokens: 7, outputTokens: 3 } } });
    // System prompt + user turn were sent.
    expect(requests[0].messages[0].role).toBe('system');
    expect(requests[0].messages.at(-1)).toMatchObject({ role: 'user' });
  });

  it('gates network egress: onBeforeEgress runs with the request URL before any fetch, and declining sends nothing', async () => {
    // Allow: the gate is invoked with the /chat/completions URL, then the request proceeds normally.
    const allow = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }]);
    const seen: string[] = [];
    const okBackend = new OpenAICompatBackend(makeConfig(), allow.fetchFn, undefined, undefined, undefined, {
      retryBaseMs: 0,
      onBeforeEgress: async (url) => { seen.push(url); },
    });
    await runOneTurn(okBackend, 'hi');
    expect(seen[0]).toContain('/chat/completions');
    expect(allow.urls.length).toBeGreaterThan(0);

    // Decline: the gate throws → the request is never issued (nothing leaves the machine).
    const denied = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'nope' } }] }]);
    const denyBackend = new OpenAICompatBackend(makeConfig(), denied.fetchFn, undefined, undefined, undefined, {
      retryBaseMs: 0,
      onBeforeEgress: async () => { throw new Error('user declined egress'); },
    });
    const events = await runOneTurn(denyBackend, 'hi');
    expect(denied.urls.length).toBe(0); // no request was sent
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({ result: { isError: true } });
  });

  it('omits temperature when reasoning/thinking is active (Claude thinking models reject temp != 1)', async () => {
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'go', { modelParams: { temperature: 0.7, reasoning_effort: 'high' } } as any);
    expect(requests[0].reasoning_effort).toBe('high');
    expect(requests[0].temperature).toBeUndefined(); // dropped — would otherwise 400 with thinking on
  });

  it('keeps temperature when reasoning is active but temperature is exactly 1', async () => {
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'go', { modelParams: { temperature: 1, reasoning_effort: 'high' } } as any);
    expect(requests[0].temperature).toBe(1);
  });

  it('sends temperature normally when there is no reasoning/thinking', async () => {
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'go', { modelParams: { temperature: 0.3 } } as any);
    expect(requests[0].temperature).toBe(0.3);
  });

  // P2: a write-capable worker that ends a turn claiming "already done / no changes needed" WITHOUT
  // having used any tool gets one nudge to read-and-verify before concluding (the stale-memory bug).
  it('nudges a write-capable worker that claims "already done" with no tool calls', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: "That's already done — no changes needed." } }] },
      { choices: [{ message: { role: 'assistant', content: 'Read src/math.js (was a+b); changed it to a-b.' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'write'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'change add to a-b');
    expect(requests.length).toBe(2); // the no-op claim triggered a re-verify nudge → a second request
    const lastUser = requests[1].messages.at(-1);
    expect(lastUser.role).toBe('user');
    expect(lastUser.content).toMatch(/READ the relevant file/i);
  });

  it('executes a flat-XML tool call a reasoning model leaks into content (Kimi-on-native stall fix)', async () => {
    // First turn: the model emits a </think> block then a flat-XML <read_file> call in CONTENT (no
    // native tool_calls) — exactly the shape that stalled the architect. It must be recovered + run,
    // and the loop must continue to a second request, not end with the markup as a "final answer".
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'I need to read it.</think>\n<read_file>\n<path>README.md</path>\n</read_file>' } }] },
      { choices: [{ message: { role: 'assistant', content: 'Done — the file says hi.' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'read the readme');

    const toolUse = events.find((e) => e.kind === 'tool_use');
    expect(toolUse).toMatchObject({ name: 'read_file' }); // the leaked call was recovered + executed
    expect(requests.length).toBe(2);                       // and the loop continued (didn't stall/end)

    // Regression (Codex): a RECOVERED call has no assistant tool_calls entry, so its result must NOT be
    // fed back as a native role:'tool' message (strict OpenAI APIs reject the orphan). The follow-up
    // request must carry it as a user message instead.
    const followup = requests[1].messages;
    expect(followup.every((m: { role: string }) => m.role !== 'tool')).toBe(true);
    expect(followup.some((m: { role: string; content?: string }) => m.role === 'user' && /\[Tool result: read_file\]/.test(m.content ?? ''))).toBe(true);
  });

  it('falls back to the XML protocol for an agent that leaks a tool call on native (Option 4)', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: '<read_file><path>README.md</path></read_file>' } }] }, // turn 1: leak (recovered)
      { choices: [{ message: { role: 'assistant', content: 'done turn one' } }] },                                   // turn 1: end
      { choices: [{ message: { role: 'assistant', content: 'done turn two' } }] },                                   // turn 2: end (XML now)
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await backend.start({ CUSTOM_API_KEY: 'sk-test' });
    const runTurn = () => new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
      backend.sendUserTurn('go');
    });
    await runTurn(); // leaks on native → switches to XML for next turn
    await runTurn();

    expect(requests[0].tools).toBeTruthy();         // turn 1 advertised native tools
    expect(requests.at(-1).tools).toBeUndefined();  // turn 2 switched to XML — no native tools field
  });

  it('starts a known leaker (Kimi) in XML from turn one; explicit native overrides', async () => {
    const reply = [{ choices: [{ message: { role: 'assistant', content: 'done' } }] }];

    // Kimi is an always-leaker → XML from the start: NO native tools advertised on the first request.
    const a = scriptedFetch(reply);
    const kimi = new OpenAICompatBackend(makeConfig({ model: 'kimi-k2.7-code', allowedTools: ['read'] }), a.fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(kimi, 'go');
    expect(a.requests[0].tools).toBeUndefined();

    // Same model but explicit toolProtocol:'native' WINS → native tools advertised.
    const b = scriptedFetch(reply);
    const kimiNative = new OpenAICompatBackend(makeConfig({ model: 'kimi-k2.7-code', allowedTools: ['read'], toolProtocol: 'native' }), b.fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(kimiNative, 'go');
    expect(b.requests[0].tools).toBeTruthy();

    // A non-leaker (the deepseek-chat default) stays native.
    const c = scriptedFetch(reply);
    const ds = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), c.fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(ds, 'go');
    expect(c.requests[0].tools).toBeTruthy();
  });

  it('flags a restored cross-session conversation as stale (re-read, don\'t quote memory)', async () => {
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    // A prior-session snapshot whose history "remembers" an old version.
    backend.restore({ version: 1, messages: [
      { role: 'system', content: 'You are an agent.' },
      { role: 'user', content: 'what version?' },
      { role: 'assistant', content: 'It is 0.7.2.' },
    ] } as never);
    await runOneTurn(backend, 'what version now?');
    const banner = requests[0].messages.find(
      (m: { content?: unknown }) => typeof m.content === 'string' && m.content.includes('Session restored from a previous session')
    );
    expect(banner).toBeTruthy();
    expect(banner.content).toMatch(/re-read the file/i);
  });

  it('does not stack staleness markers across repeated restores (idempotent)', () => {
    const backend = new OpenAICompatBackend(makeConfig(), scriptedFetch([]).fetchFn);
    backend.restore({ version: 1, messages: [{ role: 'user', content: 'hi' }] } as never);
    backend.restore({ version: 1, messages: backend.snapshot().messages } as never); // restore its own snapshot
    const markers = backend.snapshot().messages.filter(
      (m) => typeof m.content === 'string' && m.content.startsWith('[Session restored')
    );
    expect(markers.length).toBe(1);
  });

  it('does NOT nudge a normal substantive answer (no false positive)', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'Changed add to a-b and reran the tests — all green.' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'write'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'change add to a-b');
    expect(requests.length).toBe(1);
  });

  it('does NOT nudge a read-only worker (no write capability) for a "no changes needed" verdict', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'No changes needed; the code is already correct.' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'review src/math.js');
    expect(requests.length).toBe(1);
  });

  // Solo mode (v0.3.0): the tool-loop cap is configurable (solo raises it since one agent has no
  // teammates to spread work across).
  it('respects a custom maxToolIterations cap', async () => {
    const toolTurn = {
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"nope.txt"}' } }] },
        finish_reason: 'tool_calls',
      }],
    };
    const { fetchFn, requests } = scriptedFetch([toolTurn]); // repeats forever -> only the cap stops it
    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['read'] }),
      fetchFn, undefined, undefined, undefined, { retryBaseMs: 0, maxToolIterations: 2 }
    );
    await runOneTurn(backend, 'loop please');
    expect(requests.length).toBe(2); // capped at maxToolIterations, not the default 12
  });

  // PM-stall auto-advance: a coordinator that delegated work but ends the turn WITHOUT verifying (run_checks)
  // or finalizing gets nudged once to continue — instead of stopping half-done and handing back to the user.
  it('nudges a coordinator that delegated but ended without verifying, then lets it finish', async () => {
    const assignCall = {
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'd1', type: 'function', function: { name: 'assign_task', arguments: '{"agentId":"dev","instruction":"build it"}' } }] },
        finish_reason: 'tool_calls',
      }],
    };
    const prematureStop = { choices: [{ message: { role: 'assistant', content: 'I handed the task to the developer.' } }] };
    const finalDone = { choices: [{ message: { role: 'assistant', content: 'Verified and complete.' } }] };
    const { fetchFn, requests } = scriptedFetch([assignCall, prematureStop, finalDone]);

    const fakeTeam = {
      specs: () => [{ type: 'function', function: { name: 'assign_task', description: 'delegate', parameters: { type: 'object', properties: { agentId: { type: 'string' }, instruction: { type: 'string' } }, required: ['agentId', 'instruction'] } } }],
      has: (n: string) => n === 'assign_task',
      run: async () => 'dev: done — added the route + test.',
      hasTeammates: () => true,
      cancelPending: () => {},
    } as unknown as TeamTools;

    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'delegate'] }), fetchFn, fakeTeam, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'add a /status endpoint, delegate it');

    // delegation → premature stop (nudged) → final. Without the nudge the turn would have ended at 2 requests.
    expect(requests.length).toBe(3);
    const nudged = requests[2].messages.some((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[orchestration]'));
    expect(nudged).toBe(true);
  });

  // The coordinator nudge is bounded: it must not fire a second time in the same turn (no infinite loop).
  it('nudges the coordinator at most once per turn', async () => {
    const assignCall = {
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'd1', type: 'function', function: { name: 'assign_task', arguments: '{"agentId":"dev","instruction":"x"}' } }] },
        finish_reason: 'tool_calls',
      }],
    };
    const stop = { choices: [{ message: { role: 'assistant', content: 'done-ish.' } }] }; // repeats forever
    const { fetchFn, requests } = scriptedFetch([assignCall, stop]);
    const fakeTeam = {
      specs: () => [{ type: 'function', function: { name: 'assign_task', description: 'delegate', parameters: { type: 'object', properties: { agentId: { type: 'string' }, instruction: { type: 'string' } }, required: ['agentId', 'instruction'] } } }],
      has: (n: string) => n === 'assign_task',
      run: async () => 'dev: done.',
      hasTeammates: () => true,
      cancelPending: () => {},
    } as unknown as TeamTools;
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'delegate'] }), fetchFn, fakeTeam, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'go');
    // delegate → stop (nudge #1) → stop again (no 2nd nudge) → done. Bounded, not an infinite loop.
    expect(requests.length).toBe(3);
  });

  // Compatibility: a stricter OpenAI-compatible gateway can reject the parallel_tool_calls field. Drop it
  // for the session and retry once (splitParallelToolCalls still guarantees valid pairing without it).
  it('drops parallel_tool_calls and retries when the gateway rejects it as an unknown field', async () => {
    const requests: any[] = [];
    let n = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      requests.push(JSON.parse((init as any).body));
      n += 1;
      if (n === 1) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'unknown field: parallel_tool_calls' } }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }) };
    };
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'hi');
    expect(requests.length).toBe(2);              // 400 → drop → retry
    expect(requests[0].parallel_tool_calls).toBe(false); // first attempt sent it
    expect('parallel_tool_calls' in requests[1]).toBe(false); // retry omits it
  });

  // A custom gateway can reject several incompatible fields in sequence — recovery must LOOP, not retry once.
  it('recovers from sequential gateway rejections (parallel_tool_calls, THEN reasoning_effort)', async () => {
    const requests: any[] = [];
    let n = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      requests.push(JSON.parse((init as any).body));
      n += 1;
      if (n === 1) { return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'unknown field: parallel_tool_calls' } }) }; }
      if (n === 2) { return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'invalid value for reasoning_effort' } }) }; }
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }) };
    };
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'hi', { modelParams: { reasoning_effort: 'high' } } as any);
    expect(requests.length).toBe(3);                                 // 400 → drop parallel → 400 → drop effort → ok
    expect(requests[0].parallel_tool_calls).toBe(false);
    expect(requests[0].reasoning_effort).toBe('high');
    expect('parallel_tool_calls' in requests[1]).toBe(false);        // dropped after the 1st 400
    expect(requests[1].reasoning_effort).toBe('high');               // still tried on the 2nd attempt
    expect('reasoning_effort' in requests[2]).toBe(false);           // dropped after the 2nd 400
  });

  // Last-resort self-heal: a wedged tool-call history (e.g. an old snapshot) that the gateway 400s on with
  // "no corresponding tool_use … immediately-preceding message" is flattened to text and the turn retries.
  it('self-heals a tool-pairing 400 by flattening tool history and retrying', async () => {
    const ok200 = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const bodies: any[] = [];
    let n = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      bodies.push(JSON.parse((init as any).body));
      n += 1;
      if (n === 1) {
        return ok200({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"nope.txt"}' } }] }, finish_reason: 'tool_calls' }] });
      }
      if (n === 2) { return ok200({ choices: [{ message: { role: 'assistant', content: 'done1' } }] }); }
      if (n === 3) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'unexpected tool_use_id "t1" — this tool_result has no corresponding tool_use block in the immediately-preceding message' } }) };
      }
      return ok200({ choices: [{ message: { role: 'assistant', content: 'done2' } }] });
    };
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'turn 1'); // populates history with a tool call + result
    await runOneTurn(backend, 'turn 2'); // 400 on first request → flatten + retry
    expect(bodies.length).toBe(4);
    const retry = bodies[3].messages;
    expect(retry.some((m: any) => m.role === 'tool')).toBe(false);        // tool results dropped
    expect(retry.some((m: any) => Array.isArray(m.tool_calls))).toBe(false); // tool_calls flattened to text
  });

  // Some gateways/models (e.g. claude-sonnet-4-6 via the translation) reject a conversation that ends with
  // a tool_result/assistant turn ("no assistant prefill; must end with a user message"). Self-heal by
  // appending a user message so the convo ends with user, then retry.
  it('self-heals an assistant-prefill 400 by ending the conversation with a user message', async () => {
    const ok200 = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const bodies: any[] = [];
    let n = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      bodies.push(JSON.parse((init as any).body));
      n += 1;
      if (n === 1) {
        return ok200({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"nope.txt"}' } }] }, finish_reason: 'tool_calls' }] });
      }
      if (n === 2) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'model claude-sonnet-4-6 does not support assistant message prefill; the conversation must end with a user message' } }) };
      }
      return ok200({ choices: [{ message: { role: 'assistant', content: 'done' } }] });
    };
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'go');
    expect(bodies.length).toBe(3); // tool call → continue 400 → self-heal → retry
    const retry = bodies[2].messages;
    expect(retry[retry.length - 1].role).toBe('user');               // conversation now ends with a user message
    expect(retry.some((m: any) => m.role === 'tool')).toBe(false);   // tool history flattened (no trailing tool_result)
    // No two consecutive same-role turns (valid Anthropic alternation after the merge).
    for (let k = 1; k < retry.length; k++) { expect(retry[k].role).not.toBe(retry[k - 1].role); }
  });

  // Thinking-model gateways 400 when a prior assistant turn's reasoning_content is missing — same flatten
  // recovery as the prefill case (the reviewer hit this on unodetech).
  it('self-heals a "reasoning_content must be passed back" 400 by flattening + retrying', async () => {
    const ok200 = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const bodies: any[] = [];
    let n = 0;
    const fetchFn: FetchFn = async (_url, init) => {
      bodies.push(JSON.parse((init as any).body));
      n += 1;
      if (n === 1) {
        return ok200({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"nope.txt"}' } }] }, finish_reason: 'tool_calls' }] });
      }
      if (n === 2) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'The `reasoning_content` in the thinking mode must be passed back to the API.' } }) };
      }
      return ok200({ choices: [{ message: { role: 'assistant', content: 'reviewed: PASS' } }] });
    };
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'review it');
    expect(bodies.length).toBe(3); // tool call → reasoning_content 400 → flatten self-heal → retry
    expect(bodies[2].messages.some((m: any) => m.role === 'tool')).toBe(false); // flattened
  });

  // Model-variance: a Claude model calls its native `Edit` (file_path/old_string/new_string) tool name,
  // which doesn't exist here. The alias shim maps it to apply_edit + args so the edit just lands.
  it('aliases a Claude-style Edit tool call to apply_edit and edits the real file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-alias-'));
    await fs.writeFile(path.join(root, 'README.md'), 'line one\nlast line\n', 'utf8');
    const editTurn = {
      choices: [{
        message: {
          role: 'assistant', content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Edit', arguments: JSON.stringify({ file_path: 'README.md', old_string: 'last line', new_string: 'last line — Canada vs Qatar' }) } }],
        },
        finish_reason: 'tool_calls',
      }],
    };
    const doneTurn = { choices: [{ message: { role: 'assistant', content: 'Edited.' } }] };
    const { fetchFn } = scriptedFetch([editTurn, doneTurn]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'write'], workingDirectory: root }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'add Canada vs Qatar to the last line');
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('line one\nlast line — Canada vs Qatar\n');
  });

  // The PM is a pure orchestrator: with teammates, its own write tools are gated → it must delegate (Solo
  // mode is the self-do path). The tool stays in its set (so an aliased Edit doesn't "unknown tool"), but
  // using it is bounced to assign_task and the file is NOT changed.
  it('gates the PM\'s own write tools when it has teammates (must delegate)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-gate-'));
    await fs.writeFile(path.join(root, 'README.md'), 'hello\n', 'utf8');
    const editTurn = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_edit', arguments: JSON.stringify({ path: 'README.md', old_string: 'hello', new_string: 'hi' }) } }] }, finish_reason: 'tool_calls' }] };
    const { fetchFn, requests } = scriptedFetch([editTurn, { choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const team = new TeamTools('pm', { list: () => [{ id: 'pm', role: 'pm', name: 'PM', status: 'idle' }, { id: 'dev', role: 'senior-dev', name: 'Dev', status: 'idle' }], resolve: () => ({ id: 'dev' }) }, new MessageBus());
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'write'], workingDirectory: root }), fetchFn, team, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'edit it');
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('hello\n'); // gated → file unchanged
    expect(JSON.stringify(requests[1].messages.find((m: any) => m.role === 'tool'))).toMatch(/DELEGATE/);
  });

  it('lets the PM\'s write tools execute as a fallback when it has NO teammates', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-gate-solo-'));
    await fs.writeFile(path.join(root, 'README.md'), 'hello\n', 'utf8');
    const editTurn = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_edit', arguments: JSON.stringify({ path: 'README.md', old_string: 'hello', new_string: 'hi' }) } }] }, finish_reason: 'tool_calls' }] };
    const { fetchFn } = scriptedFetch([editTurn, { choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const team = new TeamTools('pm', { list: () => [{ id: 'pm', role: 'pm', name: 'PM', status: 'idle' }], resolve: () => undefined }, new MessageBus()); // only self → no teammates
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read', 'write'], workingDirectory: root }), fetchFn, team, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'edit it');
    expect(await fs.readFile(path.join(root, 'README.md'), 'utf8')).toBe('hi\n'); // no teammate → executes
  });

  // Model-variance: a Claude model calling `Bash`/`Read` gets mapped to run_command/read_file (the args
  // key `command`/`file_path` is shimmed) instead of an "unknown tool" error.
  it('aliases Read (file_path arg) to read_file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-alias-r-'));
    await fs.writeFile(path.join(root, 'note.txt'), 'secret-token-42', 'utf8');
    const readTurn = {
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 'note.txt' }) } }] },
        finish_reason: 'tool_calls',
      }],
    };
    const { fetchFn, requests } = scriptedFetch([readTurn, { choices: [{ message: { role: 'assistant', content: 'done' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'], workingDirectory: root }), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'read note.txt');
    // The tool result fed back to the model contains the file content (alias resolved + executed).
    const toolMsg = requests[1].messages.find((m: any) => m.role === 'tool');
    expect(JSON.stringify(toolMsg)).toContain('secret-token-42');
  });

  // Robustness: a model that keeps re-issuing the SAME failing tool call (e.g. write_file with empty
  // args) is circuit-broken — executed a couple of times, then blocked, then the turn ends, instead of
  // burning every tool iteration on the same dead end.
  it('circuit-breaks a repeated identical failing tool call instead of looping to the iteration cap', async () => {
    const failing = {
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{}' } }] },
        finish_reason: 'tool_calls',
      }],
    };
    const { fetchFn, requests } = scriptedFetch([failing]); // model re-emits the same bad call forever
    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['write'] }),
      fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 } // default maxToolIterations = 12
    );
    const events = await runOneTurn(backend, 'go');

    // Runs it twice (fail, fail), blocks the next two, then ends the turn — well short of the 12 cap.
    expect(requests.length).toBe(4);
    expect(events.some((e) => e.kind === 'tool_result' && (e as { summary?: string }).summary === 'blocked: repeated failing call')).toBe(true);
  });

  // Anti-spin: a model that keeps re-issuing the SAME *succeeding* call (the PM looping list_dir/list_agents
  // instead of delegating) used to burn all 12 iterations and stall. Now it's blocked after REPEAT_CALL_LIMIT.
  it('stops a repeated identical SUCCEEDING tool call instead of looping to the iteration cap', async () => {
    const spin = {
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_dir', arguments: '{"path":"."}' } }] },
        finish_reason: 'tool_calls',
      }],
    };
    const { fetchFn, requests } = scriptedFetch([spin]); // model re-emits the same succeeding call forever
    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['read'] }),
      fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 } // default cap = 12
    );
    const events = await runOneTurn(backend, 'spin please');

    expect(requests.length).toBeLessThan(12); // stopped well before the cap
    expect(events.some((e) => e.kind === 'tool_result' && (e as { summary?: string }).summary === 'blocked: repeated identical call')).toBe(true);
  });

  // Robustness: reasoning_effort is model-specific (e.g. 'max' on deepseek vs Kimi's xhigh/…/none).
  // If the gateway rejects the value, drop it and retry instead of failing the whole turn.
  it('drops reasoning_effort and retries when the model rejects the value', async () => {
    const requests: any[] = [];
    const fetchFn: FetchFn = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (body.reasoning_effort) {
        return {
          ok: false, status: 400,
          text: async () => JSON.stringify({ error: { message: '***.effort: Invalid option: expected one of "xhigh"|"high"|"medium"|"low"|"minimal"|"none"', code: 400 } }),
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }) };
    };
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'hi', { modelParams: { reasoning_effort: 'max' } });

    expect(requests[0].reasoning_effort).toBe('max');     // first try sent it
    expect(requests[1].reasoning_effort).toBeUndefined();  // retry dropped it
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({ result: { text: 'ok', isError: false } });
  });

  // Weak-model robustness: a model that announces an action ("let me check:") but issues no tool call
  // is nudged to follow through in the same turn, instead of stopping half-done.
  it('nudges the model to follow through when it announces an action but calls no tool', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-announce-'));
    await fs.writeFile(path.join(dir, 'foo.txt'), 'BODY', 'utf8');

    const announce = { choices: [{ message: { role: 'assistant', content: '让我查一下 foo.txt：' } }], usage: { prompt_tokens: 2, completion_tokens: 2 } };
    const toolCall = { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"foo.txt"}' } }] }, finish_reason: 'tool_calls' }] };
    const finalAnswer = { choices: [{ message: { role: 'assistant', content: 'It says BODY.' } }] };
    const { fetchFn, requests } = scriptedFetch([announce, toolCall, finalAnswer]);
    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['read'], workingDirectory: dir }),
      fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 }
    );
    const events = await runOneTurn(backend, 'what version');

    // Instead of stopping after the announcement, it was nudged → made the tool call → answered.
    expect(requests.length).toBe(3);
    expect(requests[1].messages.some((m: { role: string; content?: string }) => m.role === 'user' && String(m.content).includes('did not perform it'))).toBe(true);
    expect(events.find((e) => e.kind === 'tool_use')).toMatchObject({ name: 'read_file' });

    await fs.rm(dir, { recursive: true, force: true });
  });

  // Design C: with toolProtocol 'xml', the model calls tools as XML in its content. The backend must
  // parse it, run the tool, feed the result back as a user message, and NOT advertise native tools —
  // instead injecting the tool guide into the system prompt.
  it('XML tool protocol: parses an XML tool call, runs it, sends no native tools + a prompt guide', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-xml-proto-'));
    await fs.writeFile(path.join(dir, 'foo.txt'), 'XMLBODY', 'utf8');

    const xmlCall = {
      choices: [{ message: { role: 'assistant', content: '<use_tool>\n<tool>read_file</tool>\n<path>foo.txt</path>\n</use_tool>' } }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    };
    const finalAnswer = {
      choices: [{ message: { role: 'assistant', content: 'I read it.' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    };
    const { fetchFn, requests } = scriptedFetch([xmlCall, finalAnswer]);
    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['read'], toolProtocol: 'xml', workingDirectory: dir }),
      fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 }
    );
    const events = await runOneTurn(backend, 'read foo');

    // The XML call was parsed and executed.
    expect(events.find((e) => e.kind === 'tool_use')).toMatchObject({ name: 'read_file' });
    // No native tools advertised; the XML tool guide rode in the system prompt instead.
    expect(requests[0].tools).toBeUndefined();
    const sys = requests[0].messages.find((m: { role: string }) => m.role === 'system');
    expect(sys.content).toContain('XML tool calling protocol');
    // The tool result was fed back as a user text block (not a role:'tool' message).
    expect(requests[1].messages.some(
      (m: { role: string; content?: string }) => m.role === 'user' && String(m.content).includes('[Tool result: read_file]\nXMLBODY')
    )).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });

  // F8: empty cold-start turn (200 OK, no content, no tool_calls) is retried once.
  it('retries once when the first response is an empty turn, then returns the real answer', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] },
      { choices: [{ message: { role: 'assistant', content: 'real answer' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'hi');

    expect(requests).toHaveLength(2); // empty -> retry -> success
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({ result: { text: 'real answer', isError: false } });
  });

  it('does NOT retry when the first response already has content', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'straight answer' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    await runOneTurn(backend, 'hi');
    expect(requests).toHaveLength(1);
  });

  it('retries an empty turn at most once (a second empty is accepted, not looped)', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] },
      { choices: [{ message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'hi');
    expect(requests).toHaveLength(2); // one retry only, then accept the empty result
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({ result: { isError: false } });
  });

  it('streams assistant deltas and returns the final reconstructed answer', async () => {
    const { streamFetchFn, requests } = scriptedStreamFetch([[
      sse({ choices: [{ delta: { role: 'assistant' } }] }),
      sse({ choices: [{ delta: { content: 'hel' } }] }),
      sse({ choices: [{ delta: { content: 'lo' } }] }),
      sse({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
      'data: [DONE]\n\n',
    ]]);
    const textFetch = scriptedFetch([]).fetchFn;
    const backend = new OpenAICompatBackend(makeConfig(), textFetch, undefined, undefined, undefined, { retryBaseMs: 0 }, undefined, streamFetchFn);
    const events = await runOneTurn(backend, 'hi');

    expect(requests[0].stream).toBe(true);
    expect(requests[0].stream_options).toEqual({ include_usage: true });
    expect(events.filter((e) => e.kind === 'assistant_delta').map((e: any) => e.delta)).toEqual(['hel', 'lo']);
    expect(events.find((e) => e.kind === 'assistant')).toMatchObject({ text: 'hello' });
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({
      result: { text: 'hello', isError: false, usage: { inputTokens: 5, outputTokens: 2 } },
    });
  });

  it('streams tool call chunks without breaking the tool loop', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-stream-'));
    await fs.writeFile(path.join(dir, 'foo.txt'), 'STREAMFILE', 'utf8');
    const { streamFetchFn, requests } = scriptedStreamFetch([
      [
        sse({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"' },
              }],
            },
          }],
        }),
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'foo.txt"}' } }] } }] }),
        sse({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 3 } }),
        'data: [DONE]\n\n',
      ],
      [
        sse({ choices: [{ delta: { content: 'saw STREAMFILE' } }] }),
        sse({ choices: [], usage: { prompt_tokens: 6, completion_tokens: 2 } }),
        'data: [DONE]\n\n',
      ],
    ]);
    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['read'], workingDirectory: dir }),
      scriptedFetch([]).fetchFn,
      undefined,
      undefined,
      undefined,
      { retryBaseMs: 0 },
      undefined,
      streamFetchFn
    );

    const events = await runOneTurn(backend, 'read foo');

    expect(requests).toHaveLength(2);
    expect(requests[1].messages.find((m: any) => m.role === 'tool').content).toContain('STREAMFILE');
    expect(events.find((e) => e.kind === 'tool_use')).toMatchObject({ name: 'read_file' });
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({
      result: { text: 'saw STREAMFILE', usage: { inputTokens: 10, outputTokens: 5 } },
    });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('falls back to non-streaming chat when streaming fails before any delta', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'fallback answer' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
    ]);
    const streamFetchFn: StreamFetchFn = async () => {
      throw new Error('stream unavailable');
    };
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 }, undefined, streamFetchFn);
    const events = await runOneTurn(backend, 'hi');

    expect(requests[0].stream).toBe(false);
    expect(events.some((e) => e.kind === 'assistant_delta')).toBe(false);
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({
      result: { text: 'fallback answer', isError: false },
    });
  });

  it('aborts an in-flight streaming turn and resets for the next turn', async () => {
    const encoder = new TextEncoder();
    let firstSignal: AbortSignal | undefined;
    let calls = 0;
    const streamFetchFn: StreamFetchFn = async (_url, init) => {
      calls++;
      if (calls === 1) {
        firstSignal = init.signal;
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield encoder.encode(sse({ choices: [{ delta: { content: 'partial' } }] }));
            if (init.signal?.aborted) {
              throw new Error('aborted');
            }
            await new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
          })(),
        };
      }
      return {
        ok: true,
        status: 200,
        body: (async function* () {
          yield encoder.encode(sse({ choices: [{ delta: { content: 'next ok' } }] }));
          yield encoder.encode('data: [DONE]\n\n');
        })(),
      };
    };
    const backend = new OpenAICompatBackend(makeConfig(), scriptedFetch([]).fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 }, undefined, streamFetchFn);
    const events: BackendEvent[] = [];
    backend.onEvent((e) => {
      events.push(e);
      if (e.kind === 'assistant_delta' && e.delta === 'partial') {
        backend.abort();
      }
    });

    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    backend.sendUserTurn('stop me');
    await new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => {
        if (e.kind === 'turn_complete') { off(); resolve(); }
      });
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({
      result: { text: '[Stopped by user]', isError: true },
    });

    const secondDone = new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => {
        events.push(e);
        if (e.kind === 'turn_complete') { off(); resolve(); }
      });
    });
    backend.sendUserTurn('next');
    await secondDone;

    expect(calls).toBe(2);
    expect(events.at(-1)).toMatchObject({ result: { text: 'next ok', isError: false } });
  });

  it('passes resolved modelParams into the request body, omitting unset fields (F1)', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    await new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
      backend.sendUserTurn('hi', {
        modelParams: {
          temperature: 1, // must be 1 here: thinking is enabled below, and temp != 1 is dropped (see thinking-temp tests)
          top_p: 0.9,
          max_tokens: 8000,
          presence_penalty: 0.5,
          frequency_penalty: -0.5,
          reasoning_effort: 'high',
          response_format: { type: 'json_object' },
          thinking: { type: 'enabled', budget_tokens: 1200 },
          stop: ['END'],
        },
      });
    });

    const body = requests[0];
    expect(body.temperature).toBe(1);
    expect(body.top_p).toBe(0.9);
    expect(body.max_tokens).toBe(8000);
    expect(body.presence_penalty).toBe(0.5);
    expect(body.frequency_penalty).toBe(-0.5);
    expect(body.reasoning_effort).toBe('high');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1200 });
    expect(body.stop).toEqual(['END']);
    expect(body.stream).toBe(false); // tool loop is always non-streaming
    // Unset fields must not appear.
    expect('tool_choice' in body).toBe(false);
  });

  it('uses a per-turn model override without mutating the configured model', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'smart' } }] },
      { choices: [{ message: { role: 'assistant', content: 'base' } }] },
    ]);
    const config = makeConfig({ model: 'base-model' });
    const backend = new OpenAICompatBackend(config, fetchFn);

    await runOneTurn(backend, 'smart turn', { model: 'smart-model' });
    backend.sendUserTurn('base turn');
    await new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => {
        if (e.kind === 'turn_complete') {
          off();
          resolve();
        }
      });
    });

    expect(requests[0].model).toBe('smart-model');
    expect(requests[1].model).toBe('base-model');
    expect(config.model).toBe('base-model');
  });

  it('passes tool_choice only when tools are available', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn);
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    await new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
      backend.sendUserTurn('hi', { modelParams: { tool_choice: 'none' } });
    });

    expect(requests[0].tools.length).toBeGreaterThan(0);
    expect(requests[0].tool_choice).toBe('none');
  });

  it('abort cancels pending team delegations even when no model request is in flight', async () => {
    const bus = new MessageBus();
    const claims = new TaskClaimRegistry();
    const team = new TeamTools(
      'a1',
      {
        list: () => [
          { id: 'a1', role: 'pm', name: 'PM', status: 'idle' },
          { id: 'dev', role: 'developer', name: 'Dev', status: 'idle' },
        ],
        resolve: (ref) => ref === 'dev' ? { id: 'dev' } : undefined,
      },
      bus,
      { timeoutMs: 60_000, claims }
    );
    await team.run('assign_task_async', { agent: 'dev', instruction: 'work', files: ['src/auth/**'] });
    expect(claims.activeClaims()).toHaveLength(1);

    const backend = new OpenAICompatBackend(makeConfig(), scriptedFetch([]).fetchFn, team);
    backend.abort();

    expect(claims.activeClaims()).toEqual([]);
    await expect(team.run('assign_task_async', { agent: 'dev', instruction: 'again', files: ['src/auth/x.ts'] }))
      .resolves.toMatch(/Dispatched/);
  });

  it('hard-gates Plan mode by filtering offered tools and refusing forced write/run/delegation calls', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-plan-'));
    const hub = new MCPHub(async () => ({
      async listTools() { return [{ name: 'create_pr', description: 'create a PR' }]; },
      async callTool() { return 'should not run'; },
      async close() {},
    }));
    await hub.register({ id: 'github', name: 'GitHub', transport: 'stdio', command: 'npx' });
    const team = new TeamTools(
      'a1',
      {
        list: () => [{ id: 'dev', role: 'developer', name: 'Dev', status: 'idle' }],
        resolve: () => ({ id: 'dev' }),
      },
      new MessageBus(),
      { verifyCommand: 'npm test', runCommand: async () => ({ code: 0, output: 'should not run' }) }
    );

    const { fetchFn, requests } = scriptedFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"pwn.txt","content":"bad"}' } },
              { id: 'c2', type: 'function', function: { name: 'run_command', arguments: '{"command":"npm test"}' } },
              { id: 'c3', type: 'function', function: { name: 'assign_task', arguments: '{"agent":"dev","instruction":"change files"}' } },
              { id: 'c4', type: 'function', function: { name: 'github__create_pr', arguments: '{"title":"bad"}' } },
            ],
          },
        }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
      {
        choices: [{ message: { role: 'assistant', content: 'plan only' } }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      },
    ]);

    const backend = new OpenAICompatBackend(
      makeConfig({ allowedTools: ['read', 'write', 'execute'], workingDirectory: dir }),
      fetchFn,
      team,
      undefined,
      undefined,
      {},
      { hub, grants: [{ serverId: 'github', toolFilter: 'all' }] }
    );
    const events = await runOneTurn(backend, 'make a plan', { mode: 'plan' });

    expect(requests[0].messages.at(-1).content).toContain('[PLAN MODE]');
    expect(requests[0].tools.map((t: any) => t.function.name)).toEqual(['read_file', 'list_dir', 'list_agents']);
    expect(await exists(path.join(dir, 'pwn.txt'))).toBe(false);
    const toolMessages = requests[1].messages.filter((m: any) => m.role === 'tool').map((m: any) => m.content);
    expect(toolMessages).toEqual([
      "[Plan mode] 'write_file' is disabled. Switch to Act mode to make changes.",
      "[Plan mode] 'run_command' is disabled. Switch to Act mode to make changes.",
      "[Plan mode] 'assign_task' is disabled. Switch to Act mode to make changes.",
      "[Plan mode] 'github__create_pr' is disabled. Switch to Act mode to make changes.",
    ]);
    expect(events.filter((e) => e.kind === 'tool_result').map((e: any) => e.ok)).toEqual([false, false, false, false]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('executes a sandboxed tool call and feeds the result back', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-'));
    await fs.writeFile(path.join(dir, 'foo.txt'), 'FILECONTENT', 'utf8');

    const { fetchFn, requests } = scriptedFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"foo.txt"}' } }],
          },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      },
      {
        choices: [{ message: { role: 'assistant', content: 'the file says FILECONTENT' } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      },
    ]);

    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'], workingDirectory: dir }), fetchFn);
    const events = await runOneTurn(backend, 'read foo.txt');

    const toolUse = events.find((e) => e.kind === 'tool_use');
    expect(toolUse).toMatchObject({ name: 'read_file' });

    // The second request must contain the tool result with the file content.
    const toolMsg = requests[1].messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.content).toContain('FILECONTENT');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.text).toBe('the file says FILECONTENT');
    // Usage accumulates across both calls.
    expect(complete.result.usage).toEqual({ inputTokens: 22, outputTokens: 10 });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('emits tool_result cards with an edit diff while preserving the tool-loop message', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-diff-'));
    await fs.writeFile(path.join(dir, 'foo.txt'), 'old line\n', 'utf8');

    const { fetchFn, requests } = scriptedFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'c1',
              type: 'function',
              function: { name: 'write_file', arguments: '{"path":"foo.txt","content":"new line\\n"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      },
      {
        choices: [{ message: { role: 'assistant', content: 'updated' } }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      },
    ]);

    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['write'], workingDirectory: dir }), fetchFn);
    const events = await runOneTurn(backend, 'update foo');

    const result = events.find((e) => e.kind === 'tool_result');
    expect(result).toMatchObject({ name: 'write_file', ok: true });
    expect((result as any).diff).toContain('-old line');
    expect((result as any).diff).toContain('+new line');
    expect(requests[1].messages.find((m: any) => m.role === 'tool').content).toBe('Wrote 9 bytes to foo.txt.');

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports real context usage on turn_complete', async () => {
    const { fetchFn } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ contextWindowTokens: 1000 }), fetchFn);
    const events = await runOneTurn(backend, 'hello');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.context.window).toBe(1000);
    expect(complete.result.context.tokens).toBeGreaterThan(0);
    expect(complete.result.context.ratio).toBeGreaterThan(0);
  });

  it('blocks path traversal outside the sandbox and ends the turn terminally (G-003)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-'));
    const { fetchFn, requests } = scriptedFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"../../etc/passwd"}' } }],
          },
        }],
      },
      { choices: [{ message: { role: 'assistant', content: 'should not be reached' } }] },
    ]);

    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'], workingDirectory: dir }), fetchFn);
    const events = await runOneTurn(backend, 'read secrets');

    // Terminal block: the turn ends after the boundary violation — no second LLM round-trip, no flailing.
    expect(requests.length).toBe(1);
    const complete = events.find((e) => e.kind === 'turn_complete') as Extract<BackendEvent, { kind: 'turn_complete' }>;
    expect(complete.result.text).toMatch(/outside my working folder/);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('tells the agent its workspace root in the system prompt (G-003)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roam-root-'));
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig({ workingDirectory: dir }), fetchFn);
    await runOneTurn(backend, 'hi');

    const sys = requests[0].messages.find((m: any) => m.role === 'system');
    expect(sys.content).toContain('Your workspace root is');
    expect(sys.content).toContain(dir);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('errors clearly when no API key is present', async () => {
    const backend = new OpenAICompatBackend(makeConfig(), scriptedFetch([{}]).fetchFn);
    await expect(backend.start({} as NodeJS.ProcessEnv)).rejects.toThrow(/No API key/);
  });

  it('bounds conversation history at a valid turn boundary as turns accumulate', async () => {
    // The fake returns the same simple answer for every turn (index is clamped).
    const fetchFn = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]).fetchFn;
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);

    for (let i = 0; i < 70; i++) {
      await new Promise<void>((resolve) => {
        const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
        backend.sendUserTurn(`turn ${i}`);
      });
    }

    const msgs = backend.snapshot().messages as any[];
    // system + at most the cap; never unbounded growth from 70 two-message turns.
    expect(msgs.length).toBeLessThanOrEqual(61);
    expect(msgs[0].role).toBe('system');
    // The first retained non-system message is a clean user turn (no orphaned tool result).
    expect(msgs[1].role).toBe('user');
    // ANCHOR preserved: the original task ("turn 0") is still present, not dropped by the window.
    expect(msgs[1].content).toContain('turn 0');
    // …and the most recent turn is retained somewhere in the kept tail.
    expect(JSON.stringify(msgs)).toContain('turn 69');
  });

  it('emergency-trims by TOKENS down to the hard budget, keeping the anchor', async () => {
    const fetchFn = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]).fetchFn;
    // Tiny context window so a handful of long messages blow past the soft (70%) limit by tokens.
    const backend = new OpenAICompatBackend(makeConfig({ contextWindowTokens: 2000 }), fetchFn);
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);

    const big = 'x'.repeat(4000); // ~1000 tokens each — only a few fit under 70% of 2000
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((resolve) => {
        const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
        backend.sendUserTurn(`task ${i} ${big}`);
      });
    }

    const msgs = backend.snapshot().messages as any[];
    const tokens = msgs.reduce((n, m) => n + Math.ceil((typeof m.content === 'string' ? m.content.length : 0) / 4), 0);
    expect(tokens).toBeLessThanOrEqual(Math.floor(2000 * 0.8)); // under the hard budget
    expect(msgs[1].content).toContain('task 0'); // anchor (original goal) preserved
  });

  it('compacts soft-limit history into a rolling summary before a new turn', async () => {
    const backend = new OpenAICompatBackend(makeConfig({ contextWindowTokens: 2000 }), scriptedFetch([]).fetchFn);
    backend.restore({
      version: 1,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'anchor: use strict TypeScript' },
        { role: 'assistant', content: 'old answer ' + 'x'.repeat(2000) },
        { role: 'user', content: 'old task ' + 'y'.repeat(2000) },
        { role: 'assistant', content: 'old result ' + 'z'.repeat(2000) },
        { role: 'user', content: 'recent task' },
        { role: 'assistant', content: 'recent result' },
      ] as ChatMessage[],
    });

    const dropped: ChatMessage[][] = [];
    await backend.compactHistory(
      {
        summarize: async (_io, toDrop) => {
          dropped.push(toDrop as ChatMessage[]);
          return 'Summary: strict TypeScript decision retained; old task finished.';
        },
      },
      { chatCompletion: async () => 'unused' },
      'deepseek-v4-flash'
    );

    const msgs = backend.snapshot().messages as ChatMessage[];
    expect(dropped[0].some((m) => m.content?.includes('old answer'))).toBe(true);
    expect(msgs[0]).toMatchObject({ role: 'system', content: 'system prompt' });
    expect(msgs[1].content).toContain('Rolling summary');
    expect(msgs[1].content).toContain('strict TypeScript decision');
    expect(msgs[2].content).toContain('anchor: use strict TypeScript');
    expect(JSON.stringify(msgs)).toContain('recent task');
    expect(JSON.stringify(msgs)).not.toContain('old answer');
  });

  it('emits a structured compaction event when soft-limit summarization runs', async () => {
    const backend = new OpenAICompatBackend(makeConfig({ contextWindowTokens: 2000 }), scriptedFetch([]).fetchFn);
    const events: BackendEvent[] = [];
    backend.onEvent((event) => events.push(event));
    backend.restore({
      version: 1,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'anchor' },
        { role: 'assistant', content: 'old ' + 'x'.repeat(7000) },
        { role: 'user', content: 'recent' },
      ] as ChatMessage[],
    });

    await backend.compactHistory(
      { summarize: async () => 'Compressed old work.' },
      { chatCompletion: async () => 'unused' },
      'cheap-model'
    );

    expect(events).toContainEqual({ kind: 'compacted', dropped: 1, model: 'cheap-model' });
  });

  it('passes an existing rolling summary into the next incremental compaction', async () => {
    const backend = new OpenAICompatBackend(makeConfig({ contextWindowTokens: 2000 }), scriptedFetch([]).fetchFn);
    const firstHistory = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'anchor task' },
      { role: 'assistant', content: 'first old ' + 'x'.repeat(6000) },
      { role: 'user', content: 'recent one' },
    ] as ChatMessage[];
    backend.restore({ version: 1, messages: firstHistory });

    await backend.compactHistory(
      { summarize: async () => 'First summary.' },
      { chatCompletion: async () => 'unused' },
      'cheap'
    );

    const withMoreHistory = [
      ...(backend.snapshot().messages as ChatMessage[]),
      { role: 'assistant', content: 'second old ' + 'y'.repeat(6000) },
      { role: 'user', content: 'recent two' },
    ] as ChatMessage[];
    backend.restore({ version: 1, messages: withMoreHistory });

    let existing: string | undefined;
    await backend.compactHistory(
      {
        summarize: async (_io, _toDrop, existingSummary) => {
          existing = existingSummary;
          return `${existingSummary}\n---\nSecond summary.`;
        },
      },
      { chatCompletion: async () => 'unused' },
      'cheap'
    );

    expect(existing).toBe('First summary.');
    const compacted = JSON.stringify(backend.snapshot().messages);
    expect(compacted).toContain('First summary');
    expect(compacted).toContain('Second summary');
    expect(compacted).not.toContain('first old');
  });

  it('preserves the rolling summary when hard-limit trimming runs', async () => {
    const { fetchFn } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ contextWindowTokens: 1000 }), fetchFn);
    backend.restore({
      version: 1,
      messages: [
        { role: 'system', content: 'system prompt' },
        {
          role: 'system',
          content:
            '[Rolling summary of older conversation turns. Use it as memory; recent messages below remain authoritative.]\n' +
            'Early decision: keep strict TypeScript.',
        },
        { role: 'user', content: 'anchor task' },
        { role: 'assistant', content: 'middle answer ' + 'x'.repeat(3000) },
        { role: 'user', content: 'recent task' },
        { role: 'assistant', content: 'recent answer' },
      ] as ChatMessage[],
    });

    await runOneTurn(backend, 'one more turn');

    const compacted = backend.snapshot().messages as ChatMessage[];
    expect(compacted[0]).toMatchObject({ role: 'system', content: 'system prompt' });
    expect(compacted[1].content).toContain('Early decision: keep strict TypeScript.');
    expect(JSON.stringify(compacted)).toContain('anchor task');
    expect(JSON.stringify(compacted)).not.toContain('middle answer');
  });

  it('snapshots conversation and restores it without duplicating the system message', async () => {
    const first = new OpenAICompatBackend(makeConfig(), scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'remembered' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]).fetchFn);
    await runOneTurn(first, 'remember this');

    const snap = first.snapshot();
    // system + user + assistant
    expect(snap.messages).toHaveLength(3);
    expect((snap.messages[0] as any).role).toBe('system');

    // A fresh backend restores the snapshot, then starts — must not add a 2nd system message.
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'still here' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const second = new OpenAICompatBackend(makeConfig(), fetchFn);
    second.restore(snap);
    await runOneTurn(second, 'are you still there?');

    const systemCount = requests[0].messages.filter((m: any) => m.role === 'system').length;
    expect(systemCount).toBe(1);
    // Prior turn's content is present in the restored context.
    expect(JSON.stringify(requests[0].messages)).toContain('remembered');
  });

  it('refreshes project context in the system message on each turn (F4)', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'one' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      { choices: [{ message: { role: 'assistant', content: 'two' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ systemPrompt: 'Be terse.\n\n<project_context>\nold\n</project_context>' }), fetchFn);
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);

    for (const ctx of ['new rules', 'newer rules']) {
      await new Promise<void>((resolve) => {
        const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
        backend.sendUserTurn('hi', { projectContext: ctx });
      });
    }

    const firstSystem = requests[0].messages[0].content;
    expect(firstSystem).toContain('<project_context>\nnew rules\n</project_context>');
    expect(firstSystem).not.toContain('<project_context>\nold\n</project_context>');

    const secondSystem = requests[1].messages[0].content;
    expect(secondSystem).toContain('<project_context>\nnewer rules\n</project_context>');
    expect(secondSystem).not.toContain('new rules');
  });

  it('completion-gates a forever-red coordinator, then emits terminal handoff and stops', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'Initial done claim.' } }] },
      { choices: [{ message: { role: 'assistant', content: 'Retry done claim.' } }] },
      { choices: [{ message: { role: 'assistant', content: 'Escalated done claim.' } }] },
      { choices: [{ message: { role: 'assistant', content: 'should not be requested' } }] },
    ]);
    const run = vi.fn(async () => ({ ok: false, output: 'FAIL src/app.ts' }));
    const backend = new OpenAICompatBackend(
      makeConfig({ id: 'pm', role: 'pm' }),
      fetchFn,
      undefined,
      undefined,
      undefined,
      { retryBaseMs: 0, maxToolIterations: 10 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { completionGate: { command: 'npm test', run, cfg: { maxSelfRetries: 1, maxRedelegations: 1 } } }
    );

    const events = await runOneTurn(backend, 'finish the goal');

    expect(requests).toHaveLength(3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(requests[1].messages.at(-1).content).toContain('Verification gate');
    expect(requests[2].messages.at(-1).content).toContain('STILL failing');
    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.text).toContain('Blocked');
    expect(complete.result.text).toContain('needs a human');
  });

  it('completion gate passes a green coordinator normally', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'All done.' } }] },
    ]);
    const run = vi.fn(async () => ({ ok: true, output: 'PASS' }));
    const backend = new OpenAICompatBackend(
      makeConfig({ id: 'pm', role: 'pm' }),
      fetchFn,
      undefined,
      undefined,
      undefined,
      { retryBaseMs: 0 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { completionGate: { command: 'npm test', run, cfg: { maxSelfRetries: 1, maxRedelegations: 0 } } }
    );

    const events = await runOneTurn(backend, 'finish the goal');

    expect(requests).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.kind === 'turn_complete')).toMatchObject({ result: { text: 'All done.', isError: false } });
  });

  it('resets completion gate attempts between user turns', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'first red' } }] },
      { choices: [{ message: { role: 'assistant', content: 'first green' } }] },
      { choices: [{ message: { role: 'assistant', content: 'second red' } }] },
      { choices: [{ message: { role: 'assistant', content: 'second green' } }] },
    ]);
    const verdicts = [false, true, false, true];
    const run = vi.fn(async () => ({ ok: verdicts.shift() ?? true, output: 'status' }));
    const backend = new OpenAICompatBackend(
      makeConfig({ id: 'pm', role: 'pm' }),
      fetchFn,
      undefined,
      undefined,
      undefined,
      { retryBaseMs: 0, maxToolIterations: 10 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { completionGate: { command: 'npm test', run, cfg: { maxSelfRetries: 1, maxRedelegations: 0 } } }
    );
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);
    const turn = (instruction: string) => new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => {
        if (e.kind === 'turn_complete') {
          off();
          resolve();
        }
      });
      backend.sendUserTurn(instruction);
    });

    await turn('first goal');
    await turn('second goal');

    expect(requests).toHaveLength(4);
    expect(requests[1].messages.at(-1).content).toContain('Verification gate');
    expect(requests[3].messages.at(-1).content).toContain('Verification gate');
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('does not gate when the verification command is blocked/unrunnable', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'Done despite blocked checks.' } }] },
      { choices: [{ message: { role: 'assistant', content: 'should not be requested' } }] },
    ]);
    const run = vi.fn(async () => ({ ok: false, blocked: true, output: 'command not approved' }));
    const backend = new OpenAICompatBackend(
      makeConfig({ id: 'pm', role: 'pm' }),
      fetchFn,
      undefined,
      undefined,
      undefined,
      { retryBaseMs: 0 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { completionGate: { command: 'npm test', run, cfg: { maxSelfRetries: 1, maxRedelegations: 0 } } }
    );

    const events = await runOneTurn(backend, 'finish the goal');

    expect(requests).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.text).toContain('Done despite blocked checks.');
    // A policy-blocked verify command must read as NOT verified (not a silent skip) — but still end the
    // turn without looping (no deadlock) since the gate can't run the command or prompt mid-turn.
    expect(complete.result.text).toContain('NOT verified');
    expect(complete.result.text).toMatch(/blocked by your command policy/i);
  });
});

/** A successful chat-completion body the loop treats as a finished turn. */
function okBody(content: string): string {
  return JSON.stringify({
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
}

describe('OpenAICompatBackend network resilience', () => {
  it('retries a 5xx response and then succeeds', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls++;
      return calls < 3
        ? { ok: false, status: 503, text: async () => 'overloaded' }
        : { ok: true, status: 200, text: async () => okBody('recovered') };
    };
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'hi');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.text).toBe('recovered');
    expect(complete.result.isError).toBe(false);
    expect(calls).toBe(3); // two 503s + one success
  });

  it('retries a network error and then succeeds', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls++;
      if (calls < 2) { throw new Error('ECONNRESET'); }
      return { ok: true, status: 200, text: async () => okBody('back online') };
    };
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'hi');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.text).toBe('back online');
    expect(calls).toBe(2);
  });

  it('does not retry a 4xx and surfaces it as a turn error', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => { calls++; return { ok: false, status: 400, text: async () => 'bad request' }; };
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0 });
    const events = await runOneTurn(backend, 'hi');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.isError).toBe(true);
    expect(complete.result.text).toMatch(/HTTP 400/);
    expect(calls).toBe(1); // fail fast, no retry on a caller error
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => { calls++; return { ok: false, status: 500, text: async () => 'err' }; };
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, { retryBaseMs: 0, maxRetries: 2 });
    const events = await runOneTurn(backend, 'hi');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.isError).toBe(true);
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('aborts a hung request after timeoutMs and reports a timeout', async () => {
    let calls = 0;
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        calls++;
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn, undefined, undefined, undefined, {
      retryBaseMs: 0,
      timeoutMs: 20,
      maxRetries: 1,
    });
    const events = await runOneTurn(backend, 'hi');

    const complete = events.find((e) => e.kind === 'turn_complete') as any;
    expect(complete.result.isError).toBe(true);
    expect(complete.result.text).toMatch(/timed out/);
    expect(calls).toBe(2); // initial attempt + one retry, both timed out
  });
});

describe('OpenAICompatBackend MCP integration', () => {
  async function hubWith(toolName: string, onCall: (args: any) => Promise<string>): Promise<MCPHub> {
    const hub = new MCPHub(async () => ({
      async listTools() { return [{ name: toolName, description: 'a tool' }]; },
      async callTool(_name, args) { return onCall(args); },
      async close() {},
    }));
    await hub.register({ id: 'github', name: 'GitHub', transport: 'stdio', command: 'npx' });
    return hub;
  }

  it('exposes granted MCP tools to the model and routes the call to the Hub', async () => {
    const hub = await hubWith('create_pr', async (args) => `PR created: ${args.title}`);
    const { fetchFn, requests } = scriptedFetch([
      {
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'github__create_pr', arguments: '{"title":"Add MCP"}' } }],
          },
        }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
      { choices: [{ message: { role: 'assistant', content: 'opened the PR' } }], usage: { prompt_tokens: 6, completion_tokens: 3 } },
    ]);

    const backend = new OpenAICompatBackend(
      makeConfig(), fetchFn, undefined, undefined, undefined, {},
      { hub, grants: [{ serverId: 'github', toolFilter: 'all' }] }
    );
    const events = await runOneTurn(backend, 'open a PR');

    // The namespaced MCP tool was advertised to the model.
    expect(requests[0].tools.map((t: any) => t.function.name)).toContain('github__create_pr');
    // It was invoked and its result fed back as a tool message.
    const toolUse = events.find((e) => e.kind === 'tool_use') as any;
    expect(toolUse.name).toBe('github__create_pr');
    const toolMsg = requests[1].messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.content).toBe('PR created: Add MCP');
    expect((events.find((e) => e.kind === 'turn_complete') as any).result.text).toBe('opened the PR');
  });

  it('default-deny: with no grants, MCP tools are neither advertised nor routed', async () => {
    const hub = await hubWith('create_pr', async () => 'should not happen');
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ]);
    const backend = new OpenAICompatBackend(
      makeConfig(), fetchFn, undefined, undefined, undefined, {},
      { hub, grants: [] }
    );
    await runOneTurn(backend, 'hi');
    // No MCP tools advertised; memory_note is a global workspace tool even with no grants.
    expect(requests[0].tools.map((t: any) => t.function.name)).toEqual(['memory_note']);
  });

  // ─── G-001 mid-run steering (interject) ─────────────────────────────────
  it('folds an interjection into the running turn at the next iteration, after the tool result', async () => {
    const toolCall = (id: string, p: string) => ({
      id, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: p }) },
    });
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'reading', tool_calls: [toolCall('t1', 'a.txt')] } }] },
      { choices: [{ message: { role: 'assistant', content: 'again', tool_calls: [toolCall('t2', 'b.txt')] } }] },
      { choices: [{ message: { role: 'assistant', content: 'done' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig({ allowedTools: ['read'] }), fetchFn);
    let interjected = false;
    backend.onEvent((e) => {
      if (e.kind === 'tool_result' && !interjected) {
        interjected = true;
        backend.interject('use read_file on c.txt instead');
      }
    });

    await runOneTurn(backend, 'read the files');

    // The 2nd gateway request (turn 2) carries the steer as a user message...
    const msgs = requests[1].messages as ChatMessage[];
    const idxSteer = msgs.findIndex(
      (m) => typeof m.content === 'string' && m.content.includes('[User interjected mid-task] use read_file on c.txt instead')
    );
    expect(idxSteer).toBeGreaterThan(-1);
    // ...and it sits AFTER a tool answer — the ordering invariant (tool_calls answered before a user turn).
    expect(msgs.slice(0, idxSteer).some((m) => m.role === 'tool')).toBe(true);
  });

  it('interject is a no-op when the agent is idle (logged, never throws)', async () => {
    const { fetchFn } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    const events: BackendEvent[] = [];
    backend.onEvent((e) => events.push(e));

    expect(() => backend.interject('nobody is running')).not.toThrow();
    expect(events.find((e) => e.kind === 'log' && e.line.includes('idle'))).toBeTruthy();
  });

  it('keeps the turn alive for a steer that arrives on the final (no-tool) response', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'all done' } }] },
      { choices: [{ message: { role: 'assistant', content: 'ok, adjusted' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    let interjected = false;
    backend.onEvent((e) => {
      if (e.kind === 'assistant' && e.text === 'all done' && !interjected) {
        interjected = true;
        backend.interject('one more thing');
      }
    });

    await runOneTurn(backend, 'do it');

    // The first response had no tool call (would normally end the turn); the steer kept it alive for a
    // second request, which carries the interjected message instead of dropping it.
    expect(requests.length).toBe(2);
    const carried = (requests[1].messages as ChatMessage[]).some(
      (m) => typeof m.content === 'string' && m.content.includes('one more thing')
    );
    expect(carried).toBe(true);
  });

  // ─── Cline #2: proactive workspace context injection ────────────────────
  const sysOf = (req: any): string =>
    (req.messages as ChatMessage[]).find((m) => m.role === 'system')?.content as string ?? '';

  it('injects workspaceContext into the system message, then drops it next turn (ephemeral)', async () => {
    const { fetchFn, requests } = scriptedFetch([
      { choices: [{ message: { role: 'assistant', content: 'a' } }] },
      { choices: [{ message: { role: 'assistant', content: 'b' } }] },
    ]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    await backend.start({ CUSTOM_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);

    const turn = () => new Promise<void>((resolve) => {
      const off = backend.onEvent((e) => { if (e.kind === 'turn_complete') { off(); resolve(); } });
    });
    let done = turn();
    backend.sendUserTurn('one', { workspaceContext: 'ACTIVE FILE src/foo.ts\nexport const x = 1;' });
    await done;
    done = turn();
    backend.sendUserTurn('two'); // no workspaceContext this time
    await done;

    expect(sysOf(requests[0])).toContain('Workspace state');
    expect(sysOf(requests[0])).toContain('ACTIVE FILE src/foo.ts');
    // Ephemeral: it must NOT carry over into the next turn's request.
    expect(sysOf(requests[1])).not.toContain('ACTIVE FILE src/foo.ts');
  });

  it('does not inject workspace state when workspaceContext is absent', async () => {
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    await runOneTurn(backend, 'do it');
    expect(sysOf(requests[0])).not.toContain('Workspace state');
  });

  it('caps an oversized workspaceContext (backstop)', async () => {
    const { fetchFn, requests } = scriptedFetch([{ choices: [{ message: { role: 'assistant', content: 'ok' } }] }]);
    const backend = new OpenAICompatBackend(makeConfig(), fetchFn);
    await runOneTurn(backend, 'do it', { workspaceContext: 'x'.repeat(20000) });
    const sys = sysOf(requests[0]);
    expect(sys).toContain('[workspace context truncated]');
    expect(sys.length).toBeLessThan(20000);
  });
});

// Regression: a Stop/cancel mid tool-loop (or a snapshot restored at that moment) can leave an
// assistant `tool_calls` message with unanswered tool_call_ids — the gateway then 400s with
// HTTP 400 "messages: text content blocks must be non-empty" — an Anthropic-translating gateway rejects
// an assistant tool-call turn carrying content "" (and an empty tool result). normalizeEmptyContent fixes it.
describe('normalizeEmptyContent', () => {
  const toolCall = { id: 't1', type: 'function', function: { name: 'list_agents', arguments: '{}' } } as any;

  it('nulls empty content on an assistant message that carries tool_calls (no empty text block)', () => {
    const out = normalizeEmptyContent([
      { role: 'assistant', content: '', tool_calls: [toolCall] },
      { role: 'tool', content: 'roster', tool_call_id: 't1' },
    ]);
    expect(out[0].content).toBeNull();
    expect(out[0].tool_calls).toHaveLength(1);
    expect(out[1].content).toBe('roster'); // non-empty tool result untouched
  });

  it('gives an empty tool result a marker so its tool_result block is non-empty', () => {
    const out = normalizeEmptyContent([{ role: 'tool', content: '', tool_call_id: 't1' }]);
    expect(out[0].content).toBe('(no output)');
  });

  it('leaves real content and plain text turns alone, and is idempotent', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'It will be a neobanking project' },
      { role: 'assistant', content: 'Sure, here is the plan' },
      { role: 'assistant', content: '', tool_calls: [toolCall] },
      { role: 'tool', content: 'ok', tool_call_id: 't1' },
    ];
    const once = normalizeEmptyContent(msgs);
    expect(once[0].content).toBe('It will be a neobanking project');
    expect(once[1].content).toBe('Sure, here is the plan');
    expect(once[2].content).toBeNull();
    expect(normalizeEmptyContent(once)).toEqual(once); // idempotent
  });
});

// "insufficient tool messages following tool_calls message". sanitizeToolCallPairing backfills the gap.
describe('sanitizeToolCallPairing', () => {
  const asst = (ids: string[]): ChatMessage => ({
    role: 'assistant',
    content: null,
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'read_file', arguments: '{}' } })) as any,
  });
  const toolMsg = (id: string): ChatMessage => ({ role: 'tool', content: 'result', tool_call_id: id });

  it('backfills a fully-unanswered assistant tool_calls message (interrupted before any ran)', () => {
    const out = sanitizeToolCallPairing([
      { role: 'user', content: 'go' },
      asst(['call_A', 'call_B']),
      // interrupted here — no tool results at all
    ]);
    const tools = out.filter((m) => m.role === 'tool');
    expect(tools.map((t) => t.tool_call_id)).toEqual(['call_A', 'call_B']);
    expect(tools.every((t) => typeof t.content === 'string' && t.content.includes('interrupted'))).toBe(true);
  });

  it('backfills only the MISSING id and preserves the real result', () => {
    const out = sanitizeToolCallPairing([
      asst(['call_A', 'call_B']),
      toolMsg('call_A'), // A answered; B was interrupted
    ]);
    const tools = out.filter((m) => m.role === 'tool');
    expect(tools.map((t) => t.tool_call_id)).toEqual(['call_A', 'call_B']);
    expect(tools.find((t) => t.tool_call_id === 'call_A')!.content).toBe('result'); // untouched
    expect(tools.find((t) => t.tool_call_id === 'call_B')!.content).toContain('interrupted');
  });

  it('is a no-op on an already-valid history (idempotent)', () => {
    const valid: ChatMessage[] = [
      { role: 'user', content: 'go' },
      asst(['call_A']),
      toolMsg('call_A'),
      { role: 'assistant', content: 'done' },
    ];
    const once = sanitizeToolCallPairing(valid);
    expect(once).toEqual(valid);
    expect(sanitizeToolCallPairing(once)).toEqual(once);
  });

  it('drops an ORPHAN tool result (id with no matching tool_use) — the "unexpected tool_use_id" 400', () => {
    const out = sanitizeToolCallPairing([
      asst(['call_A']),
      toolMsg('call_A'),
      toolMsg('call_GHOST'), // orphan: no assistant tool_use has this id
    ]);
    const ids = out.filter((m) => m.role === 'tool').map((t) => t.tool_call_id);
    expect(ids).toEqual(['call_A']); // ghost dropped, A kept
  });

  it('drops a tool result that is not preceded by an assistant tool_calls run', () => {
    const out = sanitizeToolCallPairing([
      { role: 'user', content: 'hi' },
      toolMsg('call_ORPHAN'), // a tool message with no preceding tool_use at all
      { role: 'assistant', content: 'ok' },
    ]);
    expect(out.some((m) => m.role === 'tool')).toBe(false); // orphan removed
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('toolPairingTrace', () => {
  it('renders the role/tool_use_id sequence and flags an orphan tool_result', () => {
    const trace = toolPairingTrace([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'toolu_A', type: 'function', function: { name: 'read_file', arguments: '{}' } }] } as any,
      { role: 'tool', content: 'r', tool_call_id: 'toolu_A' },
      { role: 'tool', content: 'r', tool_call_id: 'toolu_GHOST' },
    ]);
    expect(trace).toContain('asst[tool_use:toolu_A]');
    expect(trace).toContain('tool_result(toolu_A)');
    expect(trace).toContain('tool_result(toolu_GHOST) ⚠ORPHAN');
    expect(trace).not.toContain('tool_result(toolu_A) ⚠ORPHAN'); // the paired one is not flagged
  });
});

describe('splitParallelToolCalls', () => {
  const asst = (ids: string[], content: string | null = null): ChatMessage => ({
    role: 'assistant',
    content,
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'read_file', arguments: '{}' } })) as any,
  });
  const toolMsg = (id: string): ChatMessage => ({ role: 'tool', content: `result-${id}`, tool_call_id: id });

  it('splits a parallel turn into sequential assistant→result pairs (strict adjacency)', () => {
    const out = splitParallelToolCalls([
      { role: 'user', content: 'go' },
      asst(['A', 'B', 'C'], 'doing three things'),
      toolMsg('A'), toolMsg('B'), toolMsg('C'),
    ]);
    // Each tool_result is now IMMEDIATELY preceded by an assistant carrying exactly its tool_use.
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool']);
    for (let k = 2; k < out.length; k += 2) {
      const result = out[k];
      const prev = out[k - 1];
      expect(prev.role).toBe('assistant');
      expect((prev.tool_calls ?? []).map((c: any) => c.id)).toEqual([result.tool_call_id]);
    }
    // Assistant text rides on the FIRST split message only.
    const assts = out.filter((m) => m.role === 'assistant');
    expect(assts[0].content).toBe('doing three things');
    expect(assts[1].content).toBeNull();
  });

  it('preserves reasoning_content on EVERY split segment (thinking-model gateways require it)', () => {
    const thinking = { ...asst(['A', 'B'], 'doing two'), reasoning_content: 'because X' } as ChatMessage;
    const out = splitParallelToolCalls([{ role: 'user', content: 'go' }, thinking, toolMsg('A'), toolMsg('B')]);
    const assts = out.filter((m) => m.role === 'assistant');
    expect(assts).toHaveLength(2);
    expect(assts.every((m) => (m as any).reasoning_content === 'because X')).toBe(true);
  });

  it('leaves a single-call turn unchanged (idempotent)', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'go' }, asst(['A']), toolMsg('A')];
    const once = splitParallelToolCalls(msgs);
    expect(once).toEqual(msgs);
    expect(splitParallelToolCalls(once)).toEqual(once);
  });
});
