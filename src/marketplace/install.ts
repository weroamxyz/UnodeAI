/*---------------------------------------------------------------------------------------------
 *  UnodeAi - Marketplace install converters (M4)
 *  Pure: turn a catalog entry into the config the rest of the app already understands. The
 *  side effects (sessionManager.create, mount, persist, approval) live in extension.ts where the
 *  singletons are — these converters stay testable with no vscode dependency.
 *--------------------------------------------------------------------------------------------*/

import { AgentConfig, MCPServerConfig } from '../types';
import { AgentCatalogEntry, McpCatalogEntry, SkillCatalogEntry } from './catalog';
import { AgentConfigBuilder, modelForRole } from '../roles/RoleConfig';

/** Heading that marks the injected playbook block — also the idempotency guard. */
const PLAYBOOKS_HEADING = '\n\n## Playbooks\n';

/** Agent Builder: max skill playbooks a user can attach to one agent. Kept bounded so the system
 *  prompt stays focused and context/cost in check; one constant, easy to tune. */
export const MAX_AGENT_PLAYBOOKS = 5;

/** Remove a previously-injected `## Playbooks` block (everything from the heading to the end of the
 *  prompt). Safe to call on a prompt that has none. Used before re-mounting on an EDIT so the block is
 *  replaced, not stacked. The heading is framework-authored, so the prompt body never contains it. */
export function stripPlaybooks(systemPrompt: string): string {
  const at = systemPrompt.indexOf(PLAYBOOKS_HEADING);
  return at === -1 ? systemPrompt : systemPrompt.slice(0, at);
}

/**
 * Agent Builder save path: set an agent's attached playbooks to exactly `playbookIds` (capped at
 * MAX_AGENT_PLAYBOOKS). Strips any existing `## Playbooks` block, then mounts the (bodied) skills —
 * so editing replaces rather than appends, and removing all of them cleans the prompt. Returns the
 * new system prompt. Pure; unknown/bodiless ids are skipped (never throws).
 */
export function applyPlaybooks(systemPrompt: string, playbookIds: string[] | undefined, catalog: SkillCatalogEntry[]): string {
  const base = stripPlaybooks(systemPrompt);
  const capped = (playbookIds ?? []).slice(0, MAX_AGENT_PLAYBOOKS);
  return mountSkillPlaybooks(base, capped, catalog);
}

/**
 * B2 "members come equipped": mount a member's skills as standing playbooks. Each of the agent's
 * skill ids is resolved against the skill catalog; those that carry a `body` (the granular,
 * market-proven skills in skills.json) are appended to the system prompt under a `## Playbooks`
 * section so the agent treats them as standing procedure. Ids that are pure capabilities (in
 * SKILL_LIBRARY for tool-gating but with no body) are skipped — never throws on an unknown id.
 * Idempotent: a prompt that already carries the block is returned unchanged. Pure (no vscode).
 */
export function mountSkillPlaybooks(
  systemPrompt: string,
  skillIds: string[] | undefined,
  catalog: SkillCatalogEntry[]
): string {
  if (!skillIds || skillIds.length === 0 || systemPrompt.includes(PLAYBOOKS_HEADING)) {
    return systemPrompt;
  }
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const blocks: string[] = [];
  for (const id of skillIds) {
    const skill = byId.get(id);
    if (skill?.body) {
      blocks.push(`### ${skill.name}\n${skill.body}`);
    }
  }
  if (blocks.length === 0) {
    return systemPrompt;
  }
  return `${systemPrompt}${PLAYBOOKS_HEADING}` +
    'These playbooks were installed with this member — apply them when the work matches.\n\n' +
    blocks.join('\n\n');
}

/**
 * Convert a marketplace agent preset into a runnable AgentConfig. Installs on Roam (the default
 * provider, like every other team-creation flow); the tier maps to the concrete Roam model.
 * Caller supplies a team-unique `name` + working dir and sets `backend` afterwards.
 */
export function toAgentConfig(entry: AgentCatalogEntry, opts: { name: string }): AgentConfig {
  // No workingDirectory is pinned: the runtime resolves the root per session
  // (SessionInfo.runtimeWorkingDirectory). Pinning it here went stale across folders.
  const builder = new AgentConfigBuilder(entry.role)
    .setName(opts.name)
    .setProviderById('roam')
    .setModel(modelForRole({ tier: entry.tier, model: entry.model }, 'roam'))
    .setSystemPrompt(entry.systemPrompt)
    .setSkills(entry.skills) // derives allowedTools from the skill ids
    .setAutoApprove(false);
  const config = builder.build();
  if (entry.icon) {
    config.icon = entry.icon;
  }
  if (entry.color) {
    config.color = entry.color;
  }
  if (entry.modelParams) {
    config.modelParams = { ...entry.modelParams }; // clone so installs don't share one params object
  }
  if (entry.mcpServers) {
    config.mcpServers = [...entry.mcpServers];
  }
  return config;
}

/** Convert a marketplace MCP entry into the MCPServerConfig the team registry + Hub consume. */
export function toMcpServerConfig(entry: McpCatalogEntry): MCPServerConfig {
  const cfg: MCPServerConfig = {
    id: entry.id,
    name: entry.name,
    transport: entry.transport,
  };
  if (entry.command !== undefined) {
    cfg.command = entry.command;
  }
  if (entry.args !== undefined) {
    cfg.args = entry.args;
  }
  if (entry.url !== undefined) {
    cfg.url = entry.url;
  }
  if (entry.env !== undefined) {
    cfg.env = entry.env;
  }
  if (entry.requiresApproval !== undefined) {
    cfg.requiresApproval = entry.requiresApproval;
  }
  return cfg;
}
