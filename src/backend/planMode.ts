const PLAN_ALLOWED_TOOLS = new Set(['read_file', 'list_dir', 'list_agents']);

export function isToolAllowedInPlan(name: string): boolean {
  return PLAN_ALLOWED_TOOLS.has(name);
}

export function planModeRefusal(name: string): string {
  return `[Plan mode] '${name}' is disabled. Switch to Act mode to make changes.`;
}
