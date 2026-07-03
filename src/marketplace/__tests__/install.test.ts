import { describe, it, expect } from 'vitest';
import { toAgentConfig, toMcpServerConfig, mountSkillPlaybooks, stripPlaybooks, applyPlaybooks, MAX_AGENT_PLAYBOOKS } from '../install';
import { AgentCatalogEntry, McpCatalogEntry, SkillCatalogEntry } from '../catalog';

describe('applyPlaybooks (Agent Builder save path)', () => {
  const skill = (id: string): SkillCatalogEntry => ({
    id, name: id, summary: '', category: 'development', capabilities: ['read'], body: `do ${id}`,
  });
  const catalog = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(skill);

  it('strips a previous block before re-mounting (edit replaces, never stacks)', () => {
    const first = applyPlaybooks('Base.', ['a'], catalog);
    const edited = applyPlaybooks(first, ['b'], catalog);
    expect(edited.match(/## Playbooks/g)?.length).toBe(1);
    expect(edited).toContain('do b');
    expect(edited).not.toContain('do a');
    expect(stripPlaybooks(edited)).toBe('Base.');
  });

  it('caps at MAX_AGENT_PLAYBOOKS', () => {
    const out = applyPlaybooks('Base.', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], catalog);
    expect(MAX_AGENT_PLAYBOOKS).toBe(5);
    expect(out).toContain('do a');
    expect(out).toContain('do e'); // 5th kept
    expect(out).not.toContain('do f'); // 6th dropped
  });

  it('removing all playbooks restores the clean prompt', () => {
    const withPb = applyPlaybooks('Base.', ['a'], catalog);
    expect(applyPlaybooks(withPb, [], catalog)).toBe('Base.');
  });

  it('stripPlaybooks is a no-op on a prompt with no block', () => {
    expect(stripPlaybooks('Just a prompt.')).toBe('Just a prompt.');
  });
});

describe('mountSkillPlaybooks', () => {
  const skill = (id: string, over: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry => ({
    id, name: id, summary: '', category: 'development', capabilities: ['read'], body: `do ${id}`, ...over,
  });
  const catalog = [skill('dependency-risk-triage'), skill('owasp-top10-review'), skill('code-review', { body: undefined })];

  it('appends a Playbooks section with the bodies of skills that have one', () => {
    const out = mountSkillPlaybooks('Base prompt.', ['dependency-risk-triage', 'owasp-top10-review'], catalog);
    expect(out).toContain('## Playbooks');
    expect(out).toContain('do dependency-risk-triage');
    expect(out).toContain('do owasp-top10-review');
    expect(out.startsWith('Base prompt.')).toBe(true);
  });

  it('skips ids that are pure capabilities (no body) and unknown ids — never throws', () => {
    const out = mountSkillPlaybooks('Base.', ['code-review', 'does-not-exist'], catalog);
    expect(out).toBe('Base.'); // nothing had a body → unchanged
  });

  it('is idempotent (no duplicate Playbooks block on a second mount)', () => {
    const once = mountSkillPlaybooks('Base.', ['dependency-risk-triage'], catalog);
    const twice = mountSkillPlaybooks(once, ['dependency-risk-triage'], catalog);
    expect(twice).toBe(once);
    expect(twice.match(/## Playbooks/g)?.length).toBe(1);
  });

  it('leaves the prompt unchanged when the member declares no skills', () => {
    expect(mountSkillPlaybooks('Base.', [], catalog)).toBe('Base.');
    expect(mountSkillPlaybooks('Base.', undefined, catalog)).toBe('Base.');
  });
});

describe('toAgentConfig', () => {
  const entry: AgentCatalogEntry = {
    id: 'security-auditor',
    name: 'Security Auditor',
    role: 'security',
    summary: 'Audits code for vulnerabilities.',
    skills: ['security-audit', 'code-review'],
    model: 'claude-opus-4-8',
    tier: 'premium',
    systemPrompt: 'You audit code.',
    icon: '🔒',
    color: '#78909C',
    mcpServers: ['hermes-bridge'],
  };

  it('builds a runnable AgentConfig from a catalog entry', () => {
    const cfg = toAgentConfig(entry, { name: 'Security Auditor' });
    expect(cfg.role).toBe('security');
    expect(cfg.name).toBe('Security Auditor');
    expect(cfg.systemPrompt).toBe('You audit code.');
    expect(cfg.provider.providerId).toBe('roam');
    expect(cfg.workingDirectory).toBeUndefined(); // never pinned — runtime resolves the root per session
    expect(cfg.icon).toBe('🔒');
    expect(cfg.color).toBe('#78909C');
    expect(cfg.mcpServers).toEqual(['hermes-bridge']);
    expect(cfg.autoApprove).toBe(false);
  });

  it('derives skills + allowedTools and resolves a model from the tier', () => {
    const cfg = toAgentConfig(entry, { name: 'Security Auditor' });
    expect(cfg.skills?.map((s) => s.id)).toEqual(['security-audit', 'code-review']);
    expect(cfg.allowedTools.length).toBeGreaterThan(0); // derived, not empty
    expect(cfg.model).toBeTruthy(); // tier → a concrete Roam model, never blank
  });
});

describe('toMcpServerConfig', () => {
  it('maps stdio fields and drops catalog-only metadata', () => {
    const entry: McpCatalogEntry = {
      id: 'git',
      name: 'Git',
      summary: 'Local git ops',
      icon: 'git-branch',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git'],
      requiresApproval: true,
      prerequisite: 'uv',
      source: 'https://example.com',
    };
    expect(toMcpServerConfig(entry)).toEqual({
      id: 'git',
      name: 'Git',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git'],
      requiresApproval: true,
    });
  });

  it('drops install-time URL prompt metadata', () => {
    const entry: McpCatalogEntry = {
      id: 'hermes-bridge',
      name: 'Hermes Bridge',
      summary: 'Connect a local Hermes-compatible bridge.',
      transport: 'streamable-http',
      urlPrompt: {
        title: 'Hermes Bridge MCP URL',
        prompt: 'Enter the bridge endpoint.',
        placeHolder: 'http://127.0.0.1:8765/mcp',
      },
      requiresApproval: true,
    };
    expect(toMcpServerConfig(entry)).toEqual({
      id: 'hermes-bridge',
      name: 'Hermes Bridge',
      transport: 'streamable-http',
      requiresApproval: true,
    });
  });

  it('omits absent optional fields', () => {
    const cfg = toMcpServerConfig({ id: 'm', name: 'M', summary: 's', transport: 'stdio', command: 'npx' });
    expect(cfg.env).toBeUndefined();
    expect(cfg.url).toBeUndefined();
    expect(cfg.requiresApproval).toBeUndefined();
  });
});
