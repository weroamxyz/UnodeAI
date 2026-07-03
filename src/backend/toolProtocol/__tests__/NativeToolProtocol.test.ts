import { describe, expect, it } from 'vitest';
import { NativeToolProtocol } from '../NativeToolProtocol';

describe('NativeToolProtocol', () => {
  const p = new NativeToolProtocol();

  it('sends native tools and renders no prompt guide', () => {
    expect(p.sendsNativeTools).toBe(true);
    expect(p.renderToolGuide([])).toBe('');
  });

  it('parses structured tool_calls (with arg JSON) into ParsedToolCall[]', () => {
    const calls = p.parseCalls({
      content: null,
      tool_calls: [
        { id: 'c1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
        { id: 'c2', function: { name: 'run_command', arguments: '{"command":"npm test"}' } },
      ],
    });
    expect(calls).toEqual([
      { id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
      { id: 'c2', name: 'run_command', args: { command: 'npm test' } },
    ]);
  });

  it('tolerates empty/invalid argument JSON (-> {})', () => {
    const calls = p.parseCalls({
      content: null,
      tool_calls: [
        { id: 'c1', function: { name: 'write_file', arguments: '' } },
        { id: 'c2', function: { name: 'write_file', arguments: 'not json' } },
      ],
    });
    expect(calls).toEqual([
      { id: 'c1', name: 'write_file', args: {} },
      { id: 'c2', name: 'write_file', args: {} },
    ]);
  });

  it('returns [] when there are no tool_calls', () => {
    expect(p.parseCalls({ content: 'just text' })).toEqual([]);
    expect(p.parseCalls({ content: null, tool_calls: [] })).toEqual([]);
  });

  it('recovers a tool call leaked into content when tool_calls is absent (DeepSeek)', () => {
    const D = '<｜｜DSML｜｜';
    const content = `${D}invoke name="read_file">${D}parameter name="path" string="true">a.ts${D}/parameter>${D}/invoke>`;
    const calls = p.parseCalls({ content });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'read_file', args: { path: 'a.ts' } });
    expect(calls[0].id).toMatch(/^recovered-/);
  });

  it('recovers a FLAT-XML call leaked into content when given specs (reasoning-model stall fix)', () => {
    const readSpec = { type: 'function' as const, function: { name: 'read_file', description: '', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer' } }, required: ['path'] } } };
    const withSpecs = new NativeToolProtocol([readSpec]);
    const calls = withSpecs.parseCalls({ content: 'Let me look.</think>\n<read_file>\n<path>src/x.ts</path>\n<offset>10</offset>\n</read_file>' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'read_file', args: { path: 'src/x.ts', offset: 10 } });
    expect(calls[0].id).toMatch(/^recovered-/);
  });

  it('does NOT recover flat XML without specs (no tool names to match) — avoids false positives', () => {
    expect(p.parseCalls({ content: '<read_file><path>a.ts</path></read_file>' })).toEqual([]);
  });

  it('formats a result as a role:tool message keyed by call id', () => {
    expect(p.formatResult({ id: 'c1', name: 'read_file', args: {} }, 'file body')).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'file body',
    });
  });

  it('formats a RECOVERED call result as a user message (no orphaned role:tool)', () => {
    // A recovered call has no assistant tool_calls entry, so a native role:'tool' result would be an
    // orphan that strict OpenAI APIs reject. It must come back as a user message.
    const out = p.formatResult({ id: 'recovered-1', name: 'read_file', args: {}, recovered: true }, 'file body');
    expect(out.role).toBe('user');
    expect(out.tool_call_id).toBeUndefined();
    expect(out.content).toContain('[Tool result: read_file]');
    expect(out.content).toContain('file body');
  });
});
