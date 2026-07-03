# DeepSeek 任务卡 D1（重写版）— 更多默认团队模板（知识工作类）

> 这版**把完整代码都给你了**。你的活 = 把下面的代码块**原样粘到指定锚点** + 写测试文件 + `npm test`
> 跑绿 + 干净提交。**不要自己改字段名/类别/结构**——照抄即可。上一次失败是因为漏了花括号 + 把
> scratch 文件提交进去了,这版按步骤走就不会。

**目标**:新增 3 个知识工作团队预设(商业规划 / 商业分析 / 财务分析),把 UnodeAi 从"只会编码"
扩展到知识工作。每个团队 = `pm`(协调者,已存在)+ 2~3 个新专业角色。

---

## 只动这 2 个文件
1. `src/roles/RoleConfig.ts` —— 在指定锚点**追加**(下面给了完整代码)。
2. `src/roles/__tests__/RoleConfig.presets.test.ts` —— **新建**(下面给了完整内容,整文件照抄)。

> ⛔ 不要改其它任何文件(尤其 `types.ts`)。不要动 `RoleConfig.ts` 里已有的任何条目(包括 `solo`
> 模板、`ui-ux` 技能、`createTeam`)——**只在锚点之后插入新内容**。

---

## 步骤 1：加 4 个技能

在 `RoleConfig.ts` 里找到 `SKILL_LIBRARY` 中 `'ui-ux'` 这个技能。在它的结尾 `},` **之后**、在
关闭 `SKILL_LIBRARY` 的那行 `};` **之前**,粘贴下面这一整段(注意 category 只能用现有值,这里用
`'management'`/`'data'`,**不要改成别的**):

```ts
  'business-analysis': {
    id: 'business-analysis',
    name: 'Business Analysis',
    description: 'Analyze business problems, gather and document requirements, and map processes.',
    category: 'management',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'strategy': {
    id: 'strategy',
    name: 'Strategy',
    description: 'Formulate business strategy, go-to-market plans, and competitive positioning.',
    category: 'management',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'financial-modeling': {
    id: 'financial-modeling',
    name: 'Financial Modeling',
    description: 'Build financial models, projections, budgets, and valuations.',
    category: 'data',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
  'market-research': {
    id: 'market-research',
    name: 'Market Research',
    description: 'Research markets, competitors, customer segments, and industry trends.',
    category: 'data',
    implementation: { type: 'builtin', tools: ['read', 'write', 'search', 'message'] },
  },
```

## 步骤 2：加 4 个角色模板

找到 `ROLE_TEMPLATES` 中 `'solo'` 模板。在它的结尾 `},` **之后**、在关闭 `ROLE_TEMPLATES` 的那行
`};` **之前**,粘贴下面这一整段(`role: 'custom'` 是对的,**不要**改成新角色名;`allowedTools` 用
`deriveTools([...])` 生成):

```ts
  'business-analyst': {
    name: 'Business Analyst',
    role: 'custom',
    skill: 'business-analysis',
    skills: getSkillsByIds(['business-analysis', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelParams: { temperature: 0.5 },
    systemPrompt: `You are a Business Analyst. Clarify the business problem, gather and document
requirements, map current/target processes, and lay out options with clear trade-offs. Be concrete
and structured; write findings to files when useful.`,
    description: 'Clarifies requirements, maps processes, and frames options with trade-offs.',
    icon: '📋',
    color: '#5C6BC0',
    allowedTools: deriveTools(['business-analysis', 'documentation']),
  },
  'market-researcher': {
    name: 'Market Researcher',
    role: 'custom',
    skill: 'market-research',
    skills: getSkillsByIds(['market-research', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelParams: { temperature: 0.6 },
    systemPrompt: `You are a Market Researcher. Research the market, competitors, customer segments,
and trends. Summarize findings with sources/assumptions stated, and call out what's uncertain.`,
    description: 'Researches markets, competitors, segments, and trends.',
    icon: '🔎',
    color: '#26A69A',
    allowedTools: deriveTools(['market-research', 'documentation']),
  },
  'financial-analyst': {
    name: 'Financial Analyst',
    role: 'custom',
    skill: 'financial-modeling',
    skills: getSkillsByIds(['financial-modeling', 'documentation']),
    model: 'claude-sonnet-4-20250514',
    tier: 'standard',
    modelParams: { temperature: 0.3 },
    systemPrompt: `You are a Financial Analyst. Build simple, clearly-labeled financial models,
projections, and budgets. State every assumption. Show the numbers and the reasoning behind them.`,
    description: 'Builds financial models, projections, budgets, and valuations.',
    icon: '💰',
    color: '#66BB6A',
    allowedTools: deriveTools(['financial-modeling', 'documentation']),
  },
  'strategy-lead': {
    name: 'Strategy Lead',
    role: 'custom',
    skill: 'strategy',
    skills: getSkillsByIds(['strategy', 'business-analysis']),
    model: 'claude-sonnet-4-20250514',
    tier: 'premium',
    modelParams: { temperature: 0.5 },
    systemPrompt: `You are a Strategy Lead. Turn analysis into a coherent strategy and go-to-market
plan: priorities, positioning, risks, and a sequenced plan. Decisive but evidence-based.`,
    description: 'Turns analysis into strategy, positioning, and a sequenced plan.',
    icon: '🧭',
    color: '#AB47BC',
    allowedTools: deriveTools(['strategy', 'business-analysis']),
  },
```

## 步骤 3：加团队预设映射

在 `ROLE_TEMPLATES` 的关闭 `};` **之后**(即紧接着上面那个 `};` 的下一行)粘贴:

```ts
/**
 * Named knowledge-work team presets (v0.3.0). Each starts with the PM (coordinator); the rest are the
 * specialist roles above. Pass `roles` straight to createTeam().
 */
export const TEAM_PRESETS: Record<string, { label: string; roles: (keyof typeof ROLE_TEMPLATES)[] }> = {
  'business-planning': { label: 'Business Planning', roles: ['pm', 'strategy-lead', 'market-researcher', 'financial-analyst'] },
  'business-analysis': { label: 'Business Analysis', roles: ['pm', 'business-analyst', 'market-researcher'] },
  'financial-analysis': { label: 'Financial Analysis', roles: ['pm', 'financial-analyst', 'business-analyst'] },
};
```

## 步骤 4：新建测试文件

新建 `src/roles/__tests__/RoleConfig.presets.test.ts`,**整文件照抄**:

```ts
import { describe, it, expect } from 'vitest';
import { ROLE_TEMPLATES, TEAM_PRESETS, createTeam } from '../RoleConfig';

describe('knowledge-work team presets (D1)', () => {
  it('every preset starts with the PM and only references real role templates', () => {
    for (const [key, preset] of Object.entries(TEAM_PRESETS)) {
      expect(preset.roles[0], `${key} must start with pm`).toBe('pm');
      for (const role of preset.roles) {
        expect(ROLE_TEMPLATES[role], `${role} must exist`).toBeDefined();
      }
    }
  });

  it('builds each preset team with the right number of agents, all message-capable, none with execute', () => {
    for (const preset of Object.values(TEAM_PRESETS)) {
      const team = createTeam(preset.roles, 'roam');
      expect(team).toHaveLength(preset.roles.length);
      for (const agent of team) {
        expect(agent.allowedTools.length).toBeGreaterThan(0);
        expect(agent.allowedTools).toContain('message');
        if (agent.role !== 'pm') {
          expect(agent.allowedTools).not.toContain('execute'); // knowledge-work roles don't run commands
        }
      }
    }
  });

  it('new specialist templates derive their tools from skills and never get delegate', () => {
    for (const key of ['business-analyst', 'market-researcher', 'financial-analyst', 'strategy-lead']) {
      const t = ROLE_TEMPLATES[key];
      expect(t).toBeDefined();
      expect(t.systemPrompt.length).toBeGreaterThan(0);
      expect(t.allowedTools).not.toContain('delegate');
    }
  });
});
```

---

## DoD（全部满足才算完成）
- [ ] `npm run build` 通过(0 error)。
- [ ] `npm run lint` 通过(0 error)。
- [ ] `npm test` 通过(**用 `npm test`**),包含上面新测试。
- [ ] 没改除这 2 个文件以外的任何文件;没动 RoleConfig 里任何已有条目。

## 提交规则（重要 —— 上次就栽在这）
- **不要 `git add -A`。** 只提交这两个文件:
  ```
  git add src/roles/RoleConfig.ts src/roles/__tests__/RoleConfig.presets.test.ts
  git commit -m "feat: knowledge-work team presets (D1)"
  ```
- 提交前若产生了任何临时/调试文件(如 `_*.js`、`_*.ts`、scratch),**先删掉**,别提交进去。
- 提交后 `git status` 必须是干净的(除了你不想提交的 vsix 等已被 ignore 的)。

## 硬性提醒（rule）
- 跑测试/构建一律 `npm test` / `npm run build` / `npm run lint`,**不要** `npx vitest` / `tsc` / `eslint`。
  (即便你敲了,UnodeAi 也会自动改写成项目脚本——但请直接用对的。)
- 报错先核对你粘贴的代码块和锚点位置(最常见错误:漏了某个 `},` 或 `};`);**不要**得出"环境坏了"。
- 完成后一句话汇报:`npm test` 多少个用例通过、加了哪几个角色/预设。

**完成后 Claude 复审 + 把这些预设接到"创建团队"的 UI/onboarding。**
