# UnodeAi — MCP + Skills 集成设计（修订版 v2）

> 把静态 Skill 标签升级为**能力声明**,并让 Agent 通过 MCP 获得可扩展工具。
>
> **本版是对 Kimi 初稿的修订。** 初稿方向正确,但有一处承重级架构错误(忽略 claude 原生 MCP)、安全模型偏薄、以及若干「对文档不对代码」的事实漂移。修订点集中标注在 §0,后文按修订后的设计展开。
>
> **相关文档**：[README 文档地图](../README.md) · [STATUS 进展与下一步](STATUS.md) · [PRD](../PRD_MultiAgent_VSCode_Extension.md)
> **落地状态**（2026-06-02）：**段1（SkillResolver）✅ 已实现**；**段2 核心（MCPHub / ClaudeMcpConfig / RealMcpClient）✅ 已实现并测试**；段2 收尾（真实 npm i + live 验证、`requiresApproval` 审批门、VS Code 命令/面板）⬜ 待做，进度跟踪见 [STATUS.md](STATUS.md) P1#4。

---

## 0. 对初稿的修订摘要（必读）

| # | 初稿问题 | 修订 |
|---|----------|------|
| 🔴 **R1** | MCP 只接进 `OpenAICompatBackend`,完全无视 `ClaudeHeadlessBackend`——而 claude **原生支持 MCP** | **后端感知**:claude 后端走 CLI `--mcp-config`,让 claude 自己托管 server;openai-compat 后端才用进程内 `MCPHub`。绝不对 claude agent 再套一份 Hub(否则重复连接同一 server) |
| 🔴 **R2** | 工具名用 `read_file/write_file/run_command`(低层名) | 真实 `allowedTools` 是**能力令牌** `read/write/execute/search/delegate`;`WorkspaceTools` 内部才把 `read`→`read_file/list_dir`、`write`→`write_file`、`execute`→`run_command`。Skill 的 `builtin.tools` 必须用能力令牌 |
| 🟠 **R3** | 安全被当纯收益;`${VAR}` 实际从 `process.env` 读(注释却说 SecretStorage) | MCP = 把大批任意工具交还给 LLM,是 dual-use。沿用 default-deny:server 默认不挂、按 server 显式授权、secrets 真走 `resolveEnv`/SecretStorage、敏感 server(fs/github)单独确认、MCP 调用纳入审计 |
| 🟡 **R4** | 团队文件名写成 `.teamrc.json` | 真实是 **`.roam/team.json`**(见 `PersistenceManager.loadTeamFile`) |
| 🟡 **R5** | 命令前缀 `roamCrew.mcp.*` | 真实命名空间是 **`roam.*`**(如 `roam.showAgentOutput`) |
| 🟡 **R6** | 包名 `@anthropics/mcp-server-browser`(不存在) | 浏览器 MCP 用 **Playwright MCP**(`@playwright/mcp`)或 `@modelcontextprotocol/server-*`;所有默认 server 用真实存在的包名 |
| 🟡 **R7** | `SSEClientTransport` | MCP 规范已弃用 SSE,转向 **Streamable HTTP**。新代码用 `StreamableHTTPClientTransport`,SSE 仅作旧 server 兼容 |
| 🟡 **R8** | `npx -y` 直接 spawn | 复用本项目刚踩平的 Windows `.cmd`/shell spawn 教训;`npx` 冷启慢,需缓存/预热,长跑 server 复用连接 |
| 🟢 **R9** | Skill 重构与 MCP 捆成一个 epic | **拆成两段**:段1 = SkillResolver(纯能力声明,不引 MCP,零新依赖)→ 现在做;段2 = MCP 集成(独立 epic) |

---

## 1. 现状与问题（修订）

| 维度 | 当前实现 | 问题 |
|------|----------|------|
| **Skill** | `AgentSkill = {id,name,description,category}`,纯分类标签 | 不表达「这个技能给什么工具」 |
| **工具门控** | `AgentConfig.allowedTools: string[]`,令牌 `read/write/execute/search/delegate` | 角色模板手写、复制粘贴,与 skill 无映射 |
| **内置工具** | `WorkspaceTools`(read/write/list/execute 四个,沙箱在 workingDirectory)+ `TeamTools`(PM 委派) | 不可扩展,只能碰文件系统 + 委派 |
| **外部能力** | 无 | 无法用 GitHub/浏览器/DB 等 |

**核心矛盾(PRD 已记录)**:Skill 被定义成「能力标签」,但 Agent 实际能做什么由 `allowedTools` + `WorkspaceTools`/`TeamTools` 决定,二者无映射。

> 注:`allowedTools` 还顺带门控非 WorkspaceTools 的能力——`delegate` 令牌在 `extension.ts` 决定是否给 openai-compat agent 注入 `TeamTools`(PM 委派);`search` 目前是占位令牌(未来接搜索工具)。SkillResolver 必须产出这套**令牌**词汇,而不是低层函数名。

---

## 2. 目标

1. **Skill 即能力声明**:一个 Skill = 一组能力令牌(内置)或一组 MCP 工具(外部),或子技能组合。
2. **allowedTools 由 skills 推导**,不再手写。
3. **MCP 后端感知**:claude 走原生 `--mcp-config`,openai-compat 走 `MCPHub`。
4. **权限最小化 + default-deny**:Agent 只见被授权技能里的工具;MCP server 默认不挂。
5. **向后兼容**:无 `skills`/无 `implementation`/无 `mcpServers` 时,行为不变。

---

## 3. 架构（修订:后端感知）

```
                        ┌─────────────────┐
                        │  SessionManager │
                        └───┬─────────┬───┘
              ┌─────────────┘         └──────────────┐
              ▼                                       ▼
  ┌───────────────────────────┐        ┌──────────────────────────────┐
  │   OpenAICompatBackend      │        │   ClaudeHeadlessBackend       │
  │   (进程内工具循环)          │        │   (spawn `claude` 子进程)      │
  │  ┌──────────┐ ┌─────────┐  │        │                               │
  │  │Workspace │ │TeamTools│  │        │  claude 原生托管 MCP:          │
  │  │Tools     │ │(delegate)│  │        │   spawn 时传 --mcp-config      │
  │  └──────────┘ └─────────┘  │        │   或写 .mcp.json               │
  │  ┌────────────────────────┐│        │                               │
  │  │   MCPHub (进程内 client)││        │  ←—— 不要再套 MCPHub!          │
  │  └───────────┬────────────┘│        │      claude 自己连 server      │
  └──────────────┼─────────────┘        └───────────────┬───────────────┘
                 │                                       │
                 └──────────────┬────────────────────────┘
                                ▼
                  ┌──────────────────────────────┐
                  │  MCP Servers (stdio / HTTP)   │
                  │  filesystem · github · ...    │
                  └──────────────────────────────┘
```

**为什么后端感知是必须的**:claude CLI 内建 MCP host——给它 `--mcp-config` 它自己拉起 server、列工具、在 agent 循环里调用,并套自己的权限。若我们对 claude agent 再跑一个 `MCPHub`,会出现**两个 client 连同一个 server**,工具命名/状态/成本都重复且不一致。所以:
- **openai-compat 后端**:我们自管工具循环 → 需要 `MCPHub` 把 MCP 工具喂进 `tools` 数组、路由 `tool_calls`。
- **claude 后端**:claude 自管 → 我们只负责**生成它要的 MCP 配置**(由同一份技能/server 声明翻译而来),不碰运行时。

这与既有事实一致:PM 委派(TeamTools)也只在 openai-compat 进程内可用,claude 要委派得走 MCP。MCP 接入同理。

---

## 4. 类型扩展(修订)

```typescript
// ========== types.ts ==========

/** 一个 Skill 的实现方式。新增字段,可选——不填即旧行为(legacy 标签)。 */
export type SkillImplementation =
  | {
      type: 'builtin';
      /** 能力令牌(不是低层函数名!):'read'|'write'|'execute'|'search'|'delegate' */
      tools: string[];
    }
  | {
      type: 'composite';
      /** 组合的子技能 id;解析时递归展开(带环路保护) */
      skillIds: string[];
    }
  | {
      type: 'mcp-server';                 // 段2 才消费
      serverId: string;                   // 引用 MCPServerConfig.id
      toolFilter: 'all' | 'allowlist' | 'denylist';
      toolList?: string[];
    };

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  /** 段1 新增。缺省 = legacy 标签,不贡献任何工具(向后兼容)。 */
  implementation?: SkillImplementation;
}

export type SkillCategory =
  | 'development' | 'design' | 'documentation' | 'management'
  | 'security' | 'infrastructure' | 'data'
  | 'external';   // 段2:MCP 外部服务类技能

/** 段2:MCP Server 配置。stdio(子进程)/ streamable-http(远程)。 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable-http' | 'sse'; // sse 仅兼容旧 server
  command?: string;                                // stdio
  args?: string[];                                 // stdio
  url?: string;                                    // http/sse
  /** ${VAR} 占位符,由 resolveEnv 从 VS Code SecretStorage 解析(不是 process.env) */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** default-deny:server 默认不对任何 agent 暴露,需在 agent.skills 或 mcpServers 显式引用 */
  requiresApproval?: boolean;                      // fs/github 等敏感 server 置 true
}

// AgentConfig 段2 新增:额外挂载的 MCP server id(与技能里的 mcp-server 合并)
//   mcpServers?: string[];
// TeamConfig 段2 新增:团队级 server 注册表
//   mcpServers?: MCPServerConfig[];
```

---

## 5. 段1：SkillResolver（现在做,本 PR）

`src/roles/SkillResolver.ts`——把 `skills[]` 解析成能力令牌集合。

```typescript
export class SkillResolver {
  constructor(private library: Record<string, AgentSkill>) {}

  /** 这些技能授予的能力令牌(read/write/execute/search/delegate),去重。 */
  resolveAllowedTools(skills: AgentSkill[]): string[] {
    const acc = new Set<string>();
    const seen = new Set<string>();               // 环路保护
    const visit = (skill: AgentSkill | undefined) => {
      if (!skill || seen.has(skill.id)) { return; }
      seen.add(skill.id);
      const impl = skill.implementation;
      if (!impl) { return; }                       // legacy 标签:不贡献
      if (impl.type === 'builtin') {
        impl.tools.forEach((t) => acc.add(t));
      } else if (impl.type === 'composite') {
        impl.skillIds.forEach((id) => visit(this.library[id]));
      }
      // mcp-server:贡献的是 MCP 工具(段2),不是能力令牌
    };
    skills.forEach(visit);
    return [...acc];
  }
}
```

**词汇映射(R2 修订)**:`builtin.tools` 用能力令牌;`WorkspaceTools.specs()` 已经把 `read`→`read_file/list_dir`、`write`→`write_file`、`execute`→`run_command`。Resolver 不碰低层名。

**推导接线**:`ROLE_TEMPLATES` 不再手写 `allowedTools`,改为由其 `skills` 推导;`AgentConfigBuilder.setSkills()` 也即时推导(add-agent 选技能 → 工具自动算出)。显式 `setAllowedTools()` 仍可覆盖(向后兼容/逃生舱)。

**段1 带来的唯一实质权限变化**:`architect` 不再有 `execute`(其技能 architecture/code-review/documentation 都不含 execute)——这是合理的最小权限收紧(架构师设计、不跑 shell;跑构建由 PM 的 `run_checks` 或 dev 负责)。其余角色令牌集不变(必要时通过精选技能列表保持原 posture,如 pm 保持 no-write、security 保持 no-execute)。所有推导结果由测试逐角色锁定。

---

## 6. 段2：MCP Hub（独立 epic,后做）

仅服务 **openai-compat** 后端。要点:
- `register/unregister/getToolSpecs/executeTool/hasTool`,工具命名空间 `serverId__toolName` 防冲突。
- transport 默认 `StreamableHTTPClientTransport`;stdio 用 `StdioClientTransport`,spawn 复用本项目的 Windows `.cmd` 加固 + 超时 + 健康检查。
- `getToolSpecs(agentId, allowedServerIds)` **default-deny**:只暴露该 agent 通过技能/`mcpServers` 显式授权的 server。
- 集成进 `OpenAICompatBackend.runTurn` 的工具路由:`mcpHub.hasTool(name)` → `mcpHub.executeTool`,否则落到 `team`/`tools`。
- secrets:`env` 的 `${VAR}` 经 `resolveEnv`(SessionManager 已有的注入点,读 SecretStorage)解析,**不读 process.env**。

**claude 后端**:不进 Hub。由一个 `buildMcpConfig(agentSkills, serverRegistry)` 把该 agent 授权的 server 翻成 claude 的 `--mcp-config` JSON,在 `ClaudeHeadlessBackend.buildArgs()` 里传入。运行时由 claude 托管。

---

## 7. 安全考量(修订 R3,强化)

1. **default-deny**:`MCPServerConfig` 默认不暴露给任何 agent;必须在 agent 的技能(mcp-server 型)或 `mcpServers[]` 显式引用。
2. **敏感 server 单独确认**:`filesystem`(可越过 WorkspaceTools 路径沙箱!)、`github`(带 PAT 可删库)等置 `requiresApproval`,首次挂载需用户确认。
3. **secrets**:`${VAR}` 走 SecretStorage/`resolveEnv`,绝不写进 `.roam/team.json` 明文,也不裸读 `process.env`。
4. **命名空间隔离**:`serverId__toolName`。
5. **最小工具集**:`toolFilter: allowlist` 精确暴露子集。
6. **审计**:MCP `tool_use` 与内置工具一样进每-agent OutputChannel + 活动流;调用带超时。
7. **fs server 根目录**:若挂 filesystem server,根目录应限定到 agent 的 `workingDirectory`,与 WorkspaceTools 沙箱对齐,避免出现「一个工具有沙箱、另一个没有」。

---

## 8. 默认 MCP Servers(修订 R6,真实包名)

```typescript
export const DEFAULT_MCP_SERVERS: Record<string, MCPServerConfig> = {
  filesystem: {
    id: 'filesystem', name: 'Filesystem', transport: 'stdio',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '${WORKDIR}'],
    requiresApproval: true,                         // 越沙箱风险
  },
  github: {
    id: 'github', name: 'GitHub', transport: 'stdio',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
    requiresApproval: true,
  },
  playwright: {                                     // 浏览器:Playwright MCP(真实存在)
    id: 'playwright', name: 'Browser (Playwright)', transport: 'stdio',
    command: 'npx', args: ['-y', '@playwright/mcp@latest'],
  },
};
```
> 注:具体包名/版本以发布时 MCP 生态为准;此处仅示意「用真实存在的包」。

---

## 9. 团队文件 / 命令(修订 R4 R5)

- 团队文件:**`.roam/team.json`**(非 `.teamrc.json`),段2 增 `mcpServers[]`(团队级注册表)与 member 的 `mcpServers[]`。
- 命令前缀 **`roam.*`**:`roam.mcp.addServer` / `roam.mcp.removeServer` / `roam.mcp.listServers` / `roam.agent.mountSkill` / `roam.agent.unmountSkill`。

---

## 10. 实施路径(修订 R9)

**段1（本 PR,纯 Skill,零新依赖）**
1. `types.ts`:加 `SkillImplementation` + `AgentSkill.implementation?`(+ `external` 分类)。
2. `SkillResolver`(builtin + composite → 能力令牌,环路安全)。
3. `SKILL_LIBRARY` 每个技能补 `implementation`;`ROLE_TEMPLATES` 与 `AgentConfigBuilder.setSkills` 改为推导 `allowedTools`。
4. 测试:resolver 单元 + 逐角色推导结果回归锁定。验证现有行为不破(architect 失去 execute 为唯一有意变更)。

**段2（独立 epic,引 `@modelcontextprotocol/sdk`）**
1. `MCPServerConfig` 类型 + `MCPHub`(仅 openai-compat)。
2. `buildMcpConfig` → claude `--mcp-config`(claude 后端)。
3. `.roam/team.json` 增 `mcpServers`;`SessionManager` 按 agent 授权拉起/复用 server。
4. default-deny 安全门 + secrets 经 resolveEnv + 敏感 server 确认。
5. VS Code 命令 + Team View 的 MCP/Skills 面板 + Dashboard MCP 调用统计。

---

## 11. 向后兼容

| 场景 | 行为 |
|------|------|
| 无 `skills` | 继续用显式 `allowedTools` |
| `AgentSkill` 无 `implementation` | legacy 标签,推导贡献为空 → 退回显式 `allowedTools` |
| 无 `mcpServers` | 视为空,段2 逻辑不触发 |
| 旧 `.roam/team.json`(无 mcpServers) | schema 允许缺省 |

---

## 12. 收益

1. **Skill 语义化**:从空标签变成「Agent 能做什么」的可执行声明,`allowedTools` 不再手写。
2. **能力可扩展**:段2 后任何 MCP server 即插即用,复用社区生态,不为每个外部服务写适配器。
3. **后端一致**:claude 与 openai-compat 都能用 MCP,各按原生方式,不重复造轮子。
4. **权限精确 + 默认安全**:技能/`toolFilter`/default-deny 三层收口。
5. **战略契合**:MCP 放大 agent 真实可干的活 → turn↑ → Roam token 消耗↑,正向强化 token 漏斗商业模式。
6. **向后兼容**:旧配置零改动可跑。
