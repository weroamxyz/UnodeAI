import { AgentConfig, MCPServerConfig, WorkflowConfig, WorkflowStep } from '../types';

export interface TeamFileDocument {
  version?: string;
  members: AgentConfig[];
  mcpServers: MCPServerConfig[];
  workflows: WorkflowConfig[];
}

export class TeamFileValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid .roam/team.json: ${issues.slice(0, 5).join('; ')}`);
  }
}

const ROLES = new Set([
  'architect', 'developer', 'reviewer', 'qa', 'pm', 'product-manager', 'devops', 'tech-writer',
  'security', 'data-engineer', 'senior-dev', 'tester', 'solo', 'custom',
]);
const TRANSPORTS = new Set(['stdio', 'streamable-http', 'sse']);

export function validateTeamFile(raw: unknown): TeamFileDocument {
  const issues: string[] = [];
  if (!isRecord(raw)) {
    throw new TeamFileValidationError(['root must be a JSON object']);
  }

  const membersRaw = Array.isArray(raw.members) ? raw.members : Array.isArray(raw.agents) ? raw.agents : [];
  if (raw.members !== undefined && !Array.isArray(raw.members)) {
    issues.push('members must be an array');
  }
  if (raw.agents !== undefined && !Array.isArray(raw.agents)) {
    issues.push('agents must be an array');
  }
  if (raw.mcpServers !== undefined && !Array.isArray(raw.mcpServers)) {
    issues.push('mcpServers must be an array');
  }
  if (raw.workflows !== undefined && !Array.isArray(raw.workflows)) {
    issues.push('workflows must be an array');
  }

  const members = Array.isArray(membersRaw)
    ? membersRaw.map((m, i) => validateAgent(m, `members[${i}]`, issues)).filter(Boolean) as AgentConfig[]
    : [];
  const mcpServersRaw = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];
  const mcpServers = mcpServersRaw
    .map((s, i) => validateMcpServer(s, `mcpServers[${i}]`, issues))
    .filter(Boolean) as MCPServerConfig[];
  const workflowsRaw = Array.isArray(raw.workflows) ? raw.workflows : [];
  const workflows = workflowsRaw
    .map((w, i) => validateWorkflow(w, `workflows[${i}]`, issues))
    .filter(Boolean) as WorkflowConfig[];

  if (issues.length > 0) {
    throw new TeamFileValidationError(issues);
  }
  return {
    version: typeof raw.version === 'string' ? raw.version : undefined,
    members,
    mcpServers,
    workflows,
  };
}

function validateAgent(raw: unknown, path: string, issues: string[]): AgentConfig | undefined {
  if (!isRecord(raw)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  requireString(raw, 'id', path, issues);
  requireString(raw, 'name', path, issues);
  requireString(raw, 'role', path, issues);
  if (typeof raw.role === 'string' && !ROLES.has(raw.role)) {
    issues.push(`${path}.role has unsupported value "${raw.role}"`);
  }
  requireString(raw, 'skill', path, issues);
  requireString(raw, 'model', path, issues);
  requireString(raw, 'systemPrompt', path, issues);
  if (!isRecord(raw.provider)) {
    issues.push(`${path}.provider must be an object`);
  } else {
    requireString(raw.provider, 'providerId', `${path}.provider`, issues);
    requireString(raw.provider, 'apiKeySecretName', `${path}.provider`, issues);
  }
  if (raw.allowedTools !== undefined && !isStringArray(raw.allowedTools)) {
    issues.push(`${path}.allowedTools must be an array of strings`);
  }
  if (raw.mcpServers !== undefined && !isStringArray(raw.mcpServers)) {
    issues.push(`${path}.mcpServers must be an array of strings`);
  }
  if (raw.backend !== undefined && raw.backend !== 'claude' && raw.backend !== 'openai-compat') {
    issues.push(`${path}.backend must be "claude" or "openai-compat"`);
  }
  return raw as unknown as AgentConfig;
}

function validateMcpServer(raw: unknown, path: string, issues: string[]): MCPServerConfig | undefined {
  if (!isRecord(raw)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  requireString(raw, 'id', path, issues);
  requireString(raw, 'name', path, issues);
  requireString(raw, 'transport', path, issues);
  if (typeof raw.transport === 'string' && !TRANSPORTS.has(raw.transport)) {
    issues.push(`${path}.transport has unsupported value "${raw.transport}"`);
  }
  if (raw.transport === 'stdio' && typeof raw.command !== 'string') {
    issues.push(`${path}.command is required for stdio MCP servers`);
  }
  if ((raw.transport === 'streamable-http' || raw.transport === 'sse') && typeof raw.url !== 'string') {
    issues.push(`${path}.url is required for remote MCP servers`);
  }
  if (raw.args !== undefined && !isStringArray(raw.args)) {
    issues.push(`${path}.args must be an array of strings`);
  }
  if (raw.env !== undefined && !isStringRecord(raw.env)) {
    issues.push(`${path}.env must be an object whose values are strings`);
  }
  if (raw.timeoutMs !== undefined && typeof raw.timeoutMs !== 'number') {
    issues.push(`${path}.timeoutMs must be a number`);
  }
  if (raw.requiresApproval !== undefined && typeof raw.requiresApproval !== 'boolean') {
    issues.push(`${path}.requiresApproval must be a boolean`);
  }
  return raw as unknown as MCPServerConfig;
}

function validateWorkflow(raw: unknown, path: string, issues: string[]): WorkflowConfig | undefined {
  if (!isRecord(raw)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  requireString(raw, 'id', path, issues);
  requireString(raw, 'name', path, issues);
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    issues.push(`${path}.description must be a string`);
  }
  if (!Array.isArray(raw.steps)) {
    issues.push(`${path}.steps must be an array`);
    return undefined;
  }
  const steps = raw.steps
    .map((s, i) => validateWorkflowStep(s, `${path}.steps[${i}]`, issues))
    .filter(Boolean) as WorkflowStep[];
  return { ...(raw as unknown as WorkflowConfig), steps };
}

function validateWorkflowStep(raw: unknown, path: string, issues: string[]): WorkflowStep | undefined {
  if (!isRecord(raw)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  requireString(raw, 'id', path, issues);
  requireString(raw, 'from', path, issues);
  requireString(raw, 'to', path, issues);
  requireString(raw, 'action', path, issues);
  if (raw.autoTransition !== undefined && typeof raw.autoTransition !== 'boolean') {
    issues.push(`${path}.autoTransition must be a boolean`);
  }
  if (raw.condition !== undefined && typeof raw.condition !== 'string') {
    issues.push(`${path}.condition must be a string`);
  }
  if (raw.branches !== undefined && !Array.isArray(raw.branches)) {
    issues.push(`${path}.branches must be an array`);
  } else if (Array.isArray(raw.branches)) {
    for (let i = 0; i < raw.branches.length; i++) {
      validateWorkflowBranch(raw.branches[i], `${path}.branches[${i}]`, issues);
    }
  }
  return { ...(raw as unknown as WorkflowStep), autoTransition: raw.autoTransition !== false };
}

function validateWorkflowBranch(raw: unknown, path: string, issues: string[]): void {
  if (!isRecord(raw)) {
    issues.push(`${path} must be an object`);
    return;
  }
  if (raw.whenResultContains !== undefined && typeof raw.whenResultContains !== 'string') {
    issues.push(`${path}.whenResultContains must be a string`);
  }
  requireString(raw, 'goto', path, issues);
}

function requireString(obj: Record<string, unknown>, key: string, path: string, issues: string[]): void {
  if (typeof obj[key] !== 'string' || obj[key] === '') {
    issues.push(`${path}.${key} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
}
