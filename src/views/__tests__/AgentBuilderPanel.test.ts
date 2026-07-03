import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  canSelectPlaybook,
  describeAgentBuilderSaveProblem,
  parseAgentBuilderSavePayload,
  renderAgentBuilderHtml,
  selectVisibleSkills,
  AgentBuilderViewModel,
} from '../AgentBuilderPanel';

const view: AgentBuilderViewModel = {
  mode: 'new',
  roles: [{
    id: 'senior-dev',
    name: 'Senior Developer',
    role: 'senior-dev',
    systemPrompt: 'Write production code.',
    skillIds: ['code-generation', 'testing'],
    providerId: 'roam',
    model: 'deepseek-v4-pro',
  }, {
    id: 'reviewer',
    name: 'Reviewer',
    role: 'reviewer',
    systemPrompt: 'Review independently.',
    skillIds: ['code-review'],
    providerId: 'roam',
    model: 'deepseek-v4-pro',
  }],
  providers: [{
    id: 'roam',
    name: 'Roam',
    baseUrl: 'https://www.unodetech.xyz/v1',
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', price: '$0.12/$0.24 per 1M' }],
  }],
  capabilities: [{
    id: 'code-generation',
    name: 'Code Generation',
    description: 'Write code',
    category: 'development',
  }, {
    id: 'testing',
    name: 'Testing',
    description: 'Write tests',
    category: 'development',
  }],
  mcpServers: [{
    id: 'github',
    name: 'GitHub',
    transport: 'stdio',
    connected: false,
    requiresApproval: true,
  }],
  catalog: {
    agents: [],
    mcp: [],
    skills: [{
      id: 'code-generation',
      name: 'Implementation Playbook',
      summary: 'Builds features carefully',
      category: 'development',
      capabilities: ['read', 'write'],
      body: '# Implement',
    }, {
      id: 'code-review',
      name: 'Review Playbook',
      summary: 'Checks changes for regressions',
      category: 'development',
      capabilities: ['read'],
      body: '# Review',
    }, {
      id: 'accessibility-audit',
      name: 'Accessibility Audit',
      summary: 'Checks labels and keyboard flow',
      category: 'design',
      capabilities: ['read', 'write', 'search'],
    }, {
      id: 'ci-pipeline-review',
      name: 'CI Pipeline Review',
      summary: 'Reviews release automation',
      category: 'infrastructure',
      capabilities: ['read', 'execute'],
    }],
  },
  skillLibraryUrl: 'https://github.com/weroamxyz/roam-skills',
};

describe('renderAgentBuilderHtml', () => {
  it('renders the required builder sections and message hooks', () => {
    const html = renderAgentBuilderHtml({ cspSource: 'vscode-resource:' } as never, view);

    expect(html).toContain('Identity');
    expect(html).toContain('Model');
    expect(html).toContain('Instructions');
    expect(html).toContain('Skill Playbooks');
    expect(html).toContain('Tools');
    expect(html).toContain('MCP Grants');
    expect(html).toContain('Backup model');
    expect(html).toContain('Tool calling method');
    expect(html).toContain('data-icon="$(robot)"');
    expect(html).toContain('id="iconPreview"');
    expect(html).toContain('data-command="agentBuilderPickIcon"');
    expect(html).toContain("command === 'iconPicked'");
    expect(html).toContain('data-command="browseSkillLibrary"');
    expect(html).toContain('data-command="addMcpServer"');
    expect(html).toContain("command: 'listModels'");
    expect(html).toContain('data-playbook-id="code-generation"');
  });

  it('wires a role change to load that role’s full template (incl. instructions)', () => {
    const html = renderAgentBuilderHtml({ cspSource: 'vscode-resource:' } as never, view);
    expect(html).toContain("if (event.target.id === 'role') syncRoleDefaults(true)"); // explicit change → template
    expect(html).toContain("byId('systemPrompt').value = role.systemPrompt");            // instructions update
    expect(html).toContain('selectedModel = role.model');                                // model updates too
  });

  it('includes a custom-role instructions-required hint (hidden for a non-custom default role)', () => {
    const html = renderAgentBuilderHtml({ cspSource: 'vscode-resource:' } as never, view);
    expect(html).toContain('id="instructionsReq"');
    expect(html).toMatch(/required for a custom role/i);
    // default role here is senior-dev → the hint starts hidden (JS reveals it when "Custom role" is picked)
    expect(html).toMatch(/id="instructionsReq"[^>]*hidden/);
  });

  it('renders edit mode without showing an injected playbooks block in the prompt editor', () => {
    const html = renderAgentBuilderHtml({ cspSource: 'vscode-resource:' } as never, {
      ...view,
      mode: 'edit',
      agent: {
        id: 'a1',
        name: 'Existing',
        role: 'senior-dev',
        roleLabel: 'senior-dev',
        providerId: 'roam',
        model: 'deepseek-v4-pro',
        fallbackModel: 'qwen-plus',
        toolProtocol: 'xml',
        systemPrompt: 'Base prompt\n\n## Playbooks\n### Old\nbody',
        skillIds: ['testing'],
        playbooks: ['code-review'],
        mcpServers: ['github'],
      },
    });

    expect(html).toContain('Base prompt');
    expect(html).not.toContain('### Old');
    expect(html).toContain('data-playbook-id="code-review" checked');
    expect(html).toContain('const initialFallbackModel = "qwen-plus"');
    expect(html).toContain('<option value="xml" selected>XML</option>');
  });
});

describe('skill picker logic', () => {
  it('enforces the five-playbook cap while allowing already-selected items to toggle', () => {
    expect(canSelectPlaybook(['a', 'b', 'c', 'd', 'e'], 'f')).toBe(false);
    expect(canSelectPlaybook(['a', 'b', 'c', 'd', 'e'], 'b')).toBe(true);
    expect(canSelectPlaybook(['a', 'b', 'c', 'd'], 'e')).toBe(true);
  });

  it('narrows by search, category, role, and sort mode', () => {
    expect(selectVisibleSkills(view.catalog.skills, { query: 'keyboard' }).map((s) => s.id))
      .toEqual(['accessibility-audit']);
    expect(selectVisibleSkills(view.catalog.skills, { category: 'infrastructure' }).map((s) => s.id))
      .toEqual(['ci-pipeline-review']);
    expect(selectVisibleSkills(view.catalog.skills, { role: 'reviewer' }, view.roles).map((s) => s.id))
      .toEqual(['code-review']);
    expect(selectVisibleSkills(view.catalog.skills, { sort: 'newest' }).map((s) => s.id)[0])
      .toBe('ci-pipeline-review');
    expect(selectVisibleSkills(view.catalog.skills, { sort: 'most-used' }).map((s) => s.id)[0])
      .toBe('accessibility-audit');
  });
});

describe('describeAgentBuilderSaveProblem (specific save errors)', () => {
  const ok = {
    name: 'CEO', roleKey: 'custom', customRole: 'Chief Exec', providerId: 'roam',
    model: 'deepseek-v4-pro', systemPrompt: 'Lead the company.',
  };

  it('returns undefined for a valid payload', () => {
    expect(describeAgentBuilderSaveProblem(ok, view)).toBeUndefined();
  });

  it('names a custom agent missing its system prompt (the CEO repro)', () => {
    const msg = describeAgentBuilderSaveProblem({ ...ok, systemPrompt: '   ' }, view);
    expect(msg).toMatch(/System prompt/);
  });

  it('names a missing custom role name', () => {
    const msg = describeAgentBuilderSaveProblem({ ...ok, customRole: '' }, view);
    expect(msg).toMatch(/Custom role name/);
  });

  it('lists multiple missing required fields together', () => {
    const msg = describeAgentBuilderSaveProblem({ roleKey: 'custom' }, view) ?? '';
    expect(msg).toMatch(/Name/);
    expect(msg).toMatch(/Model/);
    expect(msg).toMatch(/System prompt/);
  });

  it('flags an unknown provider specifically', () => {
    expect(describeAgentBuilderSaveProblem({ ...ok, providerId: 'nope' }, view)).toMatch(/unknown provider/i);
  });
});

describe('parseAgentBuilderSavePayload', () => {
  it('accepts a save payload with backup model and tool protocol', () => {
    const parsed = parseAgentBuilderSavePayload({
      name: 'Feature Builder',
      roleKey: 'senior-dev',
      providerId: 'roam',
      model: 'new-live-model',
      fallbackModel: 'backup-live-model',
      toolProtocol: 'xml',
      systemPrompt: 'Build carefully.',
      skillIds: ['code-generation', 'testing', 'unknown'],
      playbooks: ['code-generation', 'code-review', 'accessibility-audit', 'ci-pipeline-review'],
      mcpServers: ['github', 'missing'],
      icon: 'F',
      color: '#336699',
    }, view);

    expect(parsed).toMatchObject({
      name: 'Feature Builder',
      roleKey: 'senior-dev',
      providerId: 'roam',
      model: 'new-live-model',
      fallbackModel: 'backup-live-model',
      toolProtocol: 'xml',
      skillIds: ['code-generation', 'testing'],
      playbooks: ['code-generation', 'code-review', 'accessibility-audit', 'ci-pipeline-review'],
      mcpServers: ['github'],
      icon: 'F',
      color: '#336699',
    });
  });

  it('accepts small data URI image icons and rejects oversized image icons', () => {
    const icon = 'data:image/png;base64,eA==';
    const base = {
      name: 'Feature Builder',
      roleKey: 'senior-dev',
      providerId: 'roam',
      model: 'new-live-model',
      systemPrompt: 'Build carefully.',
      skillIds: [],
      playbooks: [],
      mcpServers: [],
    };

    expect(parseAgentBuilderSavePayload({ ...base, icon }, view)?.icon).toBe(icon);
    expect(parseAgentBuilderSavePayload({ ...base, icon: `data:image/png;base64,${'A'.repeat(100_000)}` }, view)?.icon)
      .toBeUndefined();
  });

  it('defaults tool protocol to "auto" (so the backend can pick XML for leakers); keeps explicit choices', () => {
    const base = { name: 'A', roleKey: 'senior-dev', providerId: 'roam', model: 'm', systemPrompt: 'x', skillIds: [], playbooks: [], mcpServers: [] };
    expect(parseAgentBuilderSavePayload({ ...base }, view)?.toolProtocol).toBe('auto');            // missing → auto
    expect(parseAgentBuilderSavePayload({ ...base, toolProtocol: 'auto' }, view)?.toolProtocol).toBe('auto');
    expect(parseAgentBuilderSavePayload({ ...base, toolProtocol: 'native' }, view)?.toolProtocol).toBe('native');
    expect(parseAgentBuilderSavePayload({ ...base, toolProtocol: 'xml' }, view)?.toolProtocol).toBe('xml');
    expect(parseAgentBuilderSavePayload({ ...base, toolProtocol: 'garbage' }, view)?.toolProtocol).toBe('auto'); // unknown → auto
  });

  it('parses + clamps per-agent model fine-tuning (incl. response_format/thinking/stop/tool_choice) and the tier', () => {
    const base = { name: 'A', roleKey: 'senior-dev', providerId: 'roam', model: 'm', systemPrompt: 'x', skillIds: [], playbooks: [], mcpServers: [] };
    const p = parseAgentBuilderSavePayload({
      ...base,
      modelParams: {
        temperature: '0.7', top_p: '0.9', max_tokens: '2048', reasoning_effort: 'high',
        presence_penalty: '0.5', frequency_penalty: '1', response_format: 'json_object',
        thinking_type: 'enabled', thinking_budget_tokens: '4096', tool_choice: 'auto',
        stream: 'disabled', stop: 'END\n###\n',
      },
      contextWindowTokens: '200000',
      tier: 'economy',
    }, view);
    // Regression (Codex): an agent saved through the builder must keep EVERY Settings tuning field — none
    // silently dropped. Same shapes the Settings panel produces (both route through sanitizeParams).
    expect(p?.modelParams).toEqual({
      temperature: 0.7, top_p: 0.9, max_tokens: 2048, reasoning_effort: 'high',
      presence_penalty: 0.5, frequency_penalty: 1, response_format: { type: 'json_object' },
      thinking: { type: 'enabled', budget_tokens: 4096 }, tool_choice: 'auto', stream: false,
      stop: ['END', '###'],
    });
    expect(p?.contextWindowTokens).toBe(200000);
    expect(p?.tier).toBe('economy');
  });

  it('clamps an out-of-range fine-tuning value rather than dropping it', () => {
    const base = { name: 'A', roleKey: 'senior-dev', providerId: 'roam', model: 'm', systemPrompt: 'x', skillIds: [], playbooks: [], mcpServers: [] };
    const p = parseAgentBuilderSavePayload({ ...base, modelParams: { top_p: '5', temperature: 'abc' } }, view);
    expect(p?.modelParams).toEqual({ top_p: 1 }); // top_p clamped to its 0–1 max; non-numeric temperature omitted
  });

  it('omits modelParams when all fine-tuning fields are blank, and ignores an invalid tier', () => {
    const base = { name: 'A', roleKey: 'senior-dev', providerId: 'roam', model: 'm', systemPrompt: 'x', skillIds: [], playbooks: [], mcpServers: [] };
    const p = parseAgentBuilderSavePayload({ ...base, modelParams: { temperature: '', top_p: '' }, tier: 'bogus' }, view);
    expect(p?.modelParams).toBeUndefined(); // → agent uses global defaults
    expect(p?.tier).toBeUndefined();        // → agent follows the role/default tier
  });

  it('requires a custom role label for custom agents', () => {
    expect(parseAgentBuilderSavePayload({
      name: 'CEO Agent',
      roleKey: 'custom',
      providerId: 'roam',
      model: 'deepseek-v4-pro',
      systemPrompt: 'Lead the crew.',
      skillIds: [],
      playbooks: [],
      mcpServers: [],
    }, view)).toBeUndefined();

    expect(parseAgentBuilderSavePayload({
      name: 'CEO Agent',
      roleKey: 'custom',
      customRole: 'CEO',
      providerId: 'roam',
      model: 'custom-live-model',
      systemPrompt: 'Lead the crew.',
      skillIds: [],
      playbooks: [],
      mcpServers: [],
    }, view)?.customRole).toBe('CEO');
  });
});
