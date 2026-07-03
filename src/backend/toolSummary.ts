export interface ToolActivitySummary {
  title: string;
  summary: string;
  category: 'read' | 'edit' | 'run' | 'mcp' | 'tool';
}

export interface ToolResultSummary extends ToolActivitySummary {
  ok: boolean;
  detail?: string;
}

const DETAIL_LIMIT = 4000;

export function summarizeToolUse(name: string, input: unknown): ToolActivitySummary {
  const args = asRecord(input);
  const category = toolCategory(name);
  // Delegation reads more clearly as "waiting on a teammate" than as a generic tool call. The card
  // stays in the "Running" state while the teammate works, so it doubles as a live "waiting" badge —
  // the user can open that teammate's own chat to watch the detailed work.
  if (name === 'assign_task') {
    const who = String(args.agent ?? 'a teammate');
    return { category, title: `Waiting on ${who}`, summary: `Delegated to ${who} — open their chat to watch their work.` };
  }
  if (name === 'assign_task_async') {
    const who = String(args.agent ?? 'a teammate');
    return { category, title: `Dispatched to ${who}`, summary: `${who} is working in parallel — open their chat to watch.` };
  }
  if (name === 'await_tasks') {
    return { category, title: 'Awaiting teammates', summary: 'Waiting for dispatched tasks to finish…' };
  }
  const target = toolTarget(name, args);
  return {
    category,
    title: `${verbForCategory(category)}${target ? ` ${target}` : ` ${name}`}`,
    summary: target ? `${name} ${target}` : name,
  };
}

export function summarizeToolResult(name: string, input: unknown, output: string): ToolResultSummary {
  const base = summarizeToolUse(name, input);
  const ok = !isToolError(output);
  return {
    ...base,
    ok,
    summary: resultSummary(name, input, output, ok),
    detail: capDetail(output),
  };
}

export function isToolError(output: string): boolean {
  return /^(Error:|Write blocked:|Command blocked:|Verification command blocked|\[Plan mode\]|\[tasks FAILED\])/.test(output.trim());
}

export function capDetail(output: string, limit = DETAIL_LIMIT): string {
  const text = String(output);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n[detail truncated ${text.length - limit} chars]`;
}

export function toolCategory(name: string): ToolActivitySummary['category'] {
  if (name === 'read_file' || name === 'list_dir' || name === 'list_agents') {
    return 'read';
  }
  if (name === 'write_file' || name === 'apply_edit') {
    return 'edit';
  }
  if (name === 'run_command' || name === 'run_checks') {
    return 'run';
  }
  if (name.includes('__')) {
    return 'mcp';
  }
  return 'tool';
}

function resultSummary(name: string, input: unknown, output: string, ok: boolean): string {
  if (!ok) {
    return capOneLine(output.trim(), 140);
  }
  const args = asRecord(input);
  if (name === 'read_file') {
    return `read_file ${String(args.path ?? '')} (${formatBytes(output)})`;
  }
  if (name === 'list_dir') {
    const count = output.trim() && output.trim() !== '(empty)' ? output.trim().split(/\r?\n/).length : 0;
    return `list_dir ${String(args.path ?? '.')} (${count} entries)`;
  }
  if (name === 'write_file') {
    return capOneLine(output.trim(), 140);
  }
  if (name === 'apply_edit') {
    return `apply_edit ${String(args.path ?? '')}`;
  }
  if (name === 'run_command') {
    return `run_command ${String(args.command ?? '')}`;
  }
  if (name === 'run_checks') {
    return output.startsWith('[checks passed]') ? 'run_checks passed' : 'run_checks completed';
  }
  if (name === 'assign_task' || name === 'assign_task_async') {
    return `${String(args.agent ?? 'teammate')} finished`;
  }
  if (name === 'await_tasks') {
    return 'Delegated tasks finished';
  }
  return capOneLine(`${name} completed`, 140);
}

function toolTarget(name: string, args: Record<string, unknown>): string {
  if (name === 'read_file' || name === 'list_dir' || name === 'write_file' || name === 'apply_edit') {
    return String(args.path ?? '');
  }
  if (name === 'run_command') {
    return String(args.command ?? '');
  }
  if (name === 'assign_task') {
    return String(args.agent ?? '');
  }
  return '';
}

function verbForCategory(category: ToolActivitySummary['category']): string {
  switch (category) {
    case 'read': return 'Read';
    case 'edit': return 'Edit';
    case 'run': return 'Run';
    case 'mcp': return 'MCP';
    case 'tool': return 'Tool';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatBytes(text: string): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function capOneLine(text: string, limit: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= limit ? oneLine : `${oneLine.slice(0, limit)}...`;
}
