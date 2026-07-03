# UnodeAi v0.2.0 — Development Plan

> 📌 **文档治理**:本文件由 Claude 统一维护。有不同意见/新方向请写进 [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md),勿直接改写(会与已合并代码打架)。

> **Date**: 2026-06-05
> **Product Brief**: [PRD_v0.2.0_Product_Brief.md](PRD_v0.2.0_Product_Brief.md)
> **Baseline**: v0.1.2（Marketplace `RoamAI.roam-crew`，218 测试全绿）
> **Duration**: 5 周 / 26 工作日
> **This doc**: 「怎么做」——逐文件、逐行、逐验收条件

---

## 约定

> **v0.2.0 角色（本版由 Codex 团队实施）**：**Codex = 实施方**（落地所有 `[C]`/`[X]` 编码任务）；**Claude = 监督 + 审查**（每个里程碑评审、把关门禁与架构纪律、不写实现代码）；**`[A]` = 人工/用户**（联网/密钥/浏览器/Marketplace 操作）。草稿里的 `[C]` 标记原假设 Claude 实施——**本版一律由 Codex 实施**,Claude 只在 [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) 定义的检查点评审。
>
> **强制纪律(每个任务)**：单 Epic 一分支;每次合并前 `build`/`lint`/`test` 全绿;新逻辑核心走纯模块 + 单测;用户可见文本全英文;webview 注入用户数据只用 `textContent`/DOM API,禁 `innerHTML` 拼接;不破坏安全模型;详见 GUIDANCE。

- 每一步的 **Owner** 标记：`[C]`/`[X]` = Codex 实施、`[A]` = 人工（需联网/密钥/浏览器/市场操作）；Claude 审查所有步骤
- 每一步结束标记 `✅` 供打卡（build / lint / test 全绿为打卡前提）
- 测试文件新建格式：`src/<module>/__tests__/<module>.test.ts`（Vitest）
- 新 Webview 格式：`src/views/<Name>.ts`（实现 `vscode.WebviewViewProvider` 或 `vscode.ViewProvider`）

---

## M1 — Foundation（Week 1）

### E1: 上下文摘要压缩（5d）

#### Task E1.1 — `Summarizer` 纯模块 (1d) `[C]`

| 项 | 内容 |
|----|------|
| 新文件 | `src/session/Summarizer.ts` |
| 职责 | 纯函数模块：接收 `io` 对象（`chatCompletion: (messages, model) => Promise<string>`）+ `messages` 数组（待丢弃轮次）+ 可选 `existingSummary` → 返回增量摘要字符串 |
| 接口 | `export interface Summarizer { summarize(io: SummarizerIO, toDrop: Message[], existingSummary?: string, economyModel: string): Promise<string> }` |
| prompt | 注入 `toDrop` 前拼接 `existingSummary`："Previous summary: ... Now summarize these additional conversation turns into a concise factual summary. Preserve key decisions, commitments, file paths, and error messages." |
| 实现 | 构造 system prompt: "You are a conversation summarizer. Produce a concise, factual summary of the conversation turns below. Only include key facts: decisions made, files changed, errors encountered, and commitments. Omit filler and speculation." + user: `toDrop` 的文本 → 调 `io.chatCompletion` → 拼接 `existingSummary + '\n---\n' + result` |
| 类型 | 导入 `src/models/Message.ts`（如果还没有 Message 类型，从 backend 提取） |
| `io` 的提供者 | `SessionManager` 注入（持有 economy model 的 provider） |

**验证**：`src/session/__tests__/Summarizer.test.ts` — mock `chatCompletion` 返回固定摘要文本 → 验证拼接逻辑

#### Task E1.2 — `Summarizer` 接入 SessionManager (1d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/session/SessionManager.ts` |
| 改 `SessionManagerDeps` | 新增 `summarizer: Summarizer`、`summarizerModel: string`（从 TeamConfig 或默认 economy tier 取） |
| 新增字段 | `private rollingSummary: Map<string, string>` = `agentId → summary text`，与会话生命周期同 |
| 新增方法 | `private async summarizeIfNeeded(session: ManagedSession, messages: Message[]): Promise<Message[]>` — 检查 `session.backend instanceof OpenAICompatBackend` ✗ → 直接 return messages；✓ → 调 `TokenCounter.softLimit(messages)` → 未触发 → return messages；已触发 → 调 `this.deps.summarizer.summarize(...)` → 构造 rolling summary message 插入在 system 和 anchor 之间 |
| `deliverTurn` 改动 | 在 `sendUserTurn` 之前插一步 `messages = await this.summarizeIfNeeded(session, messages)` |
| constructor | 在 `SessionManager` 构造时实例化 `Summarizer`（使用 `this.deps.modelProvider` 调 economy tier 模型的 chat completion） |

**验证**：
- `src/session/__tests__/SessionManager.test.ts` 新增 3 个测试：
  1. softLimit 未触发 → `summarizeIfNeeded` 返回原 messages（不减）
  2. softLimit 触发 → `summarizeIfNeeded` 返回含 rolling summary 的消息数组（替换丢弃部分）
  3. Claude 后端 → `summarizeIfNeeded` 直接返回原 messages（不触发摘要逻辑）

#### Task E1.3 — 替换 `trimHistory` 的丢弃行为 (1d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/backend/OpenAICompatBackend.ts` |
| 改 `trimHistory` | 当前行为：达到 softLimit → 丢弃中间的对话轮次。新行为：**不再在 backend 内丢弃**——改为依赖 `SessionManager.summarizeIfNeeded` 在 deliver 前注入摘要。`trimHistory` 降为仅做硬门守护（达到 `hardLimit` 时仍执行紧急裁剪） |
| 改 `chat()` | 硬门路径保留（`TokenCounter.hardLimit` → 裁剪到最后 K 轮 → 继续）；软门路径移到 SessionManager 前置处理 |
| `TokenCounter` 配合 | 暴露 `softLimit(messages: Message[]): { triggered: boolean; toDrop: Message[]; keep: Message[] }` 供 SessionManager 使用 |

**验证**：`src/backend/__tests__/OpenAICompatBackend.test.ts` 新增 1 测试：长历史 → 硬门裁剪有效 → 不丢 system

#### Task E1.4 — 集成测试 + 端到端验证 (2d) `[C]+[A]`

| 项 | 内容 |
|----|------|
| 单元测试 | `Summarizer` (6 个) + `SessionManager` 摘要路径 (3 个) + `OpenAICompatBackend` 硬门 (1 个) = ~10 新测试 |
| 集成测试 | 手动：创建 dev agent → 送 50+ 轮任务（递增消息量）→ 观察 `rollingSummary` 是否正确生成 → 探测早期决策（"我们在第 3 轮约定了什么命名规范？"）→ agent 应能回答 |
| 端到端检查 | economy 调用计数 ≤ 3（50 轮场景）；Claude backend agent 的上下文管理中无 `Summarizer` 介入 |
| 回归 | 全量 `npm test` 通过 + `npm run test:e2e` 扩展 1 个长会话场景 |

> **M1 结束打卡** ✅：E1 10+ 测试全部通过、build/lint 绿、手动集成验证完成 ✅

---

## M2 — IPC Bridge（Week 2）

### E2: PM 委派支持 Claude 后端（5d）

#### Task E2.1 — `LocalMcpServer` 纯核心 (2d) `[C]`

| 项 | 内容 |
|----|------|
| 新文件 | `src/mcp/LocalMcpServer.ts` |
| 职责 | 把 `TeamMcpBridge`（已有）挂载为本地 HTTP MCP 端点 |
| 接口 | `export interface LocalMcpServer { readonly port: number; readonly token: string; start(bridge: TeamMcpBridge): Promise<void>; stop(): Promise<void>; }` |
| 实现 | 用 Node.js `http.createServer`（零依赖）监听 `127.0.0.1:<random port>`。POST `/mcp` → JSON-RPC 处理：`tools/list` → 返回 bridge 的所有 tool schema；`tools/call` → `{ params: { name, arguments } }` → 调 `bridge.callTool(name, args)` → 返回 result。鉴权：检查 `Authorization: Bearer <token>` 头 |
| `createLocalMcpServer` 工厂 | `export function createLocalMcpServer(): LocalMcpServer` — 纯模块，vscode-free |
| 错误处理 | bridge 报错 → 返回 JSON-RPC error（code -32000）；HTTP 400 on bad request；`listen` 失败（端口占用）→ 重试 3 次，每次换端口 |
| Token | `crypto.randomBytes(16).toString('hex')` — 会话级随机 |

**验证**：`src/mcp/__tests__/LocalMcpServer.test.ts` (5 个)
1. start → listening on `127.0.0.1:<port>`
2. `tools/list` → 返回数组含 `list_agents` / `assign_task` / `broadcast` / `run_checks`
3. `tools/call` `list_agents` → mock bridge 返回 agent list → 正确返回
4. 无 token 请求 → 401
5. stop → 端口释放

#### Task E2.2 — `ClaudeMcpConfig` 扩展 (1d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/mcp/ClaudeMcpConfig.ts` |
| 新增函数 | `export function buildTeamBridgeConfig(localServer: LocalMcpServer): MCPConfigEntry` |
| 行为 | 生成 streamable-http 的 MCP 配置条目：`{ type: 'http', url: 'http://127.0.0.1:<port>/mcp', headers: { Authorization: 'Bearer <token>' } }` |
| 改 `buildClaudeMcpConfig` | 新增可选参数 `teamBridgeConfig?: MCPConfigEntry` → 合并到已有的 MCP config 输出中 |
| 临时文件 | `start()` 中写 `--mcp-config` 指向临时 JSON 文件（`os.tmpdir()/roam-team-bridge-<pid>.json`），agent 停止时删除 |

**验证**：`src/mcp/__tests__/ClaudeMcpConfig.test.ts` 新增 2 个：
1. `buildTeamBridgeConfig` 输出正确的 http type + url + headers
2. `buildClaudeMcpConfig` 合并用户 MCP + team bridge 两个条目

#### Task E2.3 — `ClaudeHeadlessBackend` 接入 (1.5d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/backend/ClaudeHeadlessBackend.ts` |
| 新 deps | `localMcpServerFactory: () => LocalMcpServer`（注入，从 SessionManager 来） |
| `start()` 改 | 新增逻辑：`if (agent.role === 'pm') { this.localServer = localMcpServerFactory(); await this.localServer.start(this.teamMcpBridge); const configFile = writeTeamBridgeMCPConfig(this.localServer); args.push('--mcp-config', configFile); }` |
| `stop()` 改 | `if (this.localServer) { await this.localServer.stop(); }` |
| 生命周期 | `localMcpServer` 在 backend 构造时创建实例，但只在 PM role 时启动（惰性） |
| TeamMcpBridge 获取 | 从 `SessionManager` 传入（作为 ClaudeHeadlessBackend 依赖）。如果 PM 角色但没有 TeamMcpBridge → warning toast + 跳过（non-PM 正常行为） |

**验证**：`src/backend/__tests__/ClaudeHeadlessBackend.test.ts` 新增 3 个：
1. PM role agent → `start()` 启动了 `LocalMcpServer` + `--mcp-config` 参数正确
2. Non-PM agent → `start()` 不启动 `LocalMcpServer`，无 `--mcp-config`
3. `stop()` → `LocalMcpServer.stop()` 被调

#### Task E2.4 — 端到端集成（手动） (0.5d) `[A]`

| 项 | 内容 |
|----|------|
| 操作 | 创建 PM agent（backend: claude）+ Dev agent（backend: claude）→ 发 "Create a hello world TypeScript file" → PM 应自动 `list_agents` → `assign_task` 给 Dev → Dev 完成 → PM 收结果 |
| 检查 | Team Webview 中能看到 PM→Dev 的 assign→complete 链路；`ActivityFeed` 有对应事件 |

> **M2 结束打卡** ✅：E2 10 测试通过、build/lint 绿、端到端手动验证 PM→Dev 链路完成 ✅

---

## M3 — Live Validation + UI（Week 3）

### E3: MCP 真实服务器 Live 验证（2d）

#### Task E3.1 — github MCP server 验证 (0.5d) `[A]`

| 项 | 内容 |
|----|------|
| 前提 | 安装 `@anthropic/mcp-server-github`，获取 GitHub PAT（`repo` + `read:org` scope） |
| 步骤 | ① UnodeAi Settings → MCP → Add Server → `github` → `command: npx`, `args: ["-y", "@anthropic/mcp-server-github"]`, `env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" }` → ② 存 `GITHUB_TOKEN` 到 SecretStorage → ③ 创建 agent（skill: "github-tools"）→ ④ Chat 中发 "List open issues in this repo" → ⑤ 检查 agent 能读 issue 列表 |
| 记录 | 审批门触发次数、tool call 成功率、错误信息（如有） |
| 发现 | 写入 `MCP_LIVE_VALIDATION_REPORT.md` |

#### Task E3.2 — playwright MCP server 验证 (0.5d) `[A]`

| 项 | 内容 |
|----|------|
| 前提 | 安装 `@anthropic/mcp-server-playwright`（需 Playwright browsers） |
| 步骤 | ① Settings → MCP → Add `playwright` → `command: npx`, `args: ["-y", "@anthropic/mcp-server-playwright"]` → ② 创建 agent（skill: "browser-tools"）→ ③ Chat: "Open https://example.com and take a screenshot" → ④ 检查 agent 返回截图/页面内容 |
| 记录 | 同 E3.1 |

#### Task E3.3 — claude headless + MCP 验证 (0.5d) `[A]`

| 项 | 内容 |
|----|------|
| 步骤 | 用 claude headless backend 的 agent（非 PM role，避免和 E2 混淆）→ 配置 github MCP → Chat 中发 github 查询 → 检查 claude 子进程是否能通过 MCP 调用 tool |
| 对比 | openai-compat MCP（注入式 client，`serverId__tool` 命名空间）vs claude 原生 MCP（`--mcp-config`）——两者行为对比 |

#### Task E3.4 — 修复验证中发现的问题 (0.5d) `[C]`

| 项 | 内容 |
|----|------|
| 范围 | P0（阻断 MCP 调用）+ P1（审批门/权限异常）级别的问题 |
| 可能涉及 | `McpApproval.ts`、`McpPlaceholders.ts`、`RealMcpClient.ts`（懒加载 SDK 路径）、`ClaudeMcpConfig.ts` |
| 记录 | 每个修复关联到 `MCP_LIVE_VALIDATION_REPORT.md` 的发现条目 |

> **E3 验收**：`MCP_LIVE_VALIDATION_REPORT.md` 写入（至少 2 个 server、2 条后端），P0/P1 已修，build/lint/test 绿

### E4: 工作流条件分支 UI（3d）

#### Task E4.1 — `WorkflowEditor` Webview Provider (2d) `[C]`

| 项 | 内容 |
|----|------|
| 新文件 | `src/views/WorkflowEditor.ts` |
| 类型 | `vscode.WebviewViewProvider`（侧面板）或 `vscode.ViewProvider`（独立面板）→ 用独立面板（类似 Chat），因为工作流编辑是高专注度操作 |
| 注册命令 | `roam.editWorkflow` → `UnodeAi: Edit Workflow` → 创建/显示面板 |
| webview 内容 | 纯 HTML/JS（不含 React/Vue 等外部框架，遵循现有 Settings 面板的模式：inline HTML + 最小 inline JS） |
| 数据流 | 打开 → 通过 `MessageBus` 请求当前 `team.json` 的 `workflows[]` → workspace → webview 渲染。保存 → webview postMessage → workspace → 写回 `team.json` |
| 布局 | 左侧：步骤列表（UL + 每行 LI：序号、type badge、agent name、prompt 截断、删除按钮）。右侧：选中步骤的详情面板（type 下拉、agent 下拉、prompt textarea、branches 编辑器）。底部：Add Step 按钮 |
| drag-to-reorder | 用原生 HTML Drag & Drop API（`draggable="true"` + `dragstart/dragover/drop` 事件）——不为这引入 SortableJS 依赖 |
| branches 编辑器 | 仅在 `gated` 类型步骤中出现。一个分支 = `condition` input + `goto` select（列出其他步骤名）+ 🗑 删除按钮。底部 "+ Add Branch"。如果 `goto` 指向序号较小步骤 → 行尾显示 🔄 |
| 预置模板 | 面板顶部 QuickPick-style tabs：`Feature` / `Bug Fix` / `Code Review` / `Docs` → 点击加载对应模板（不影响已保存的自定义 workflow） |

**验证**：`src/views/__tests__/WorkflowEditor.test.ts`（如果需要测试 webview 逻辑，可能更适合 E2E）→ 最少 1 个单元测试：`parseWorkflowSteps` / `serializeWorkflowSteps`

#### Task E4.2 — `WorkflowEngine` 侧改动 (0.5d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/workflow/WorkflowEngine.ts` |
| 改动 | `saveWorkflow(workflow: WorkflowTemplate)` 方法：校验 branches 的 `goto` 目标存在 → 不存在的 goto → 拒绝并返回 error message → 写入 `team.json` |
| 改动 | `listWorkflows(): WorkflowTemplate[]` 方法：从 `team.json` 读 custom workflows + 合并预置模板 |
| 改动 | `deleteWorkflow(id: string)` 方法：从 `team.json` 删除 |

**验证**：`src/workflow/__tests__/WorkflowEngine.test.ts` 新增 3 个：
1. save → 无效 goto（指向不存在的 stepId）→ reject
2. save → 有效 branches → 成功写入
3. delete → workflow 从 list 中消失

#### Task E4.3 — 集成 + 回归 (0.5d) `[C]`

| 项 | 内容 |
|----|------|
| 回归 | 现有工作流测试（GatedWorkflow 的 8 个 + WorkflowEngine 的集成测试）全部通过 |
| E2E | `npm run test:e2e` 新增 1 个：打开 Workflow Editor → loaded workflow has steps |

> **M3 结束打卡** ✅：E3 report 完成、E4 build/lint/test 绿（+6 新测试）、E4 UI 手动验证完成 ✅

---

## M4 — Onboarding + esbuild（Week 4）

### E6: Onboarding / 30-秒到价值（4d）

#### Task E6.1 — `OnboardingWizard` Webview (2d) `[C]`

| 项 | 内容 |
|----|------|
| 新文件 | `src/views/OnboardingWizard.ts` |
| 类型 | `vscode.ViewProvider`（独立面板，不可 dock——onboarding 应该是"模态"体验） |
| 触发 | `extension.ts` 的 `activate()` 中：`context.workspaceState.get('roam.onboardingComplete')` 为 falsy → 自动 `vscode.commands.executeCommand('roam.onboarding')` |
| 命令 | `roam.onboarding` → `UnodeAi: Run Setup Wizard`（也可手动调用） |
| 5 页 | 每页一个 `<section>`，`display: none/block` 切换（非 SPA 路由——单 HTML 文件内切换） |
| ① Welcome | 大标题 "Welcome to UnodeAi" + 副标题 "AI agents that work together, right in VS Code" + 2 句说明 + "Get Started →" |
| ② Provider | "Choose your AI provider" — radio: OpenAI Compatible（默认）/ Claude Headless。**Base URL 输入框默认预填 `https://www.unodetech.xyz/v1`**(取 `roam.baseUrl` 默认值,用户可改)。输入 API Key 或 Skip。存到 SecretStorage。**放一句可点击链接 "Browse models & pricing → https://www.unodetech.xyz/pricing?lang=en"** 引导选模型 |
| ③ Team | "Create your first team" — 2 卡：⚡ Quick Start（PM+Dev+QA，一键）+ ✏ Custom（手动选角色）。默认选中 Quick Start → "Create Team →" |
| ④ Demo | "Run your first demo" — 3 个 Demo Task 卡片（"Hello World HTTP Server"、"Add unit tests"、"Code review"）。选一个 → "Run →" |
| ⑤ Done | "You're all set!" — 3 个下一步链接按钮：Dashboard / Chat / Settings。底部 "Finish" |
| 底部栏 | 5 个 step 指示器（● ○ ○ ○ ○）+ Back / Skip / Next 按钮 |
| 数据 | Wizard 中创建 team/agent/发 task 的 action 通过 `postMessage` → extension 侧执行（复用现有 `OnboardingDeps`——包装 SessionManager + 命令调用） |

**验证**：E2E 1 个：Wizard 完成 → `onboardingComplete` 标记为 true

#### Task E6.2 — Team Panel 空状态增强 (0.5d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/views/TeamViewProvider.ts` |
| 改 `getWebviewContent` | 当 agent 列表为空时，当前显示 "Add your first agent →" 按钮——替换为 3 张卡片布局 |
| 卡片 | 3 张 CSS Grid 卡片（2 列），每张：icon emoji + 标题 + 一句话描述 + 按钮（"Create" / "Run" / "Open"）。卡片 hover 有微妙 background change |
| 卡片 1 | 🚀 Quick Start Team — "One click to create PM + Dev + QA" → `roam.demoCreateTeam` |
| 卡片 2 | 🧪 Run Demo Task — "See UnodeAi in action with a pre-built task" → `roam.runDemoTask` |
| 卡片 3 | 📖 Open Documentation — "Learn about agents, teams, and workflows" → 打开 USAGE.md |

#### Task E6.3 — Demo Task Library (0.5d) `[C]`

| 项 | 内容 |
|----|------|
| 新文件 | `src/state/DemoTasks.ts` |
| 内容 | 导出 `DEMO_TASKS: DemoTasks[]`，每项 `{ id, title, description, prompt, expectedOutcome }` |
| 预置任务 | ① "Hello World HTTP Server"（TypeScript, ~20 行）② "Add unit tests to selected file"（vitest, 3-5 个测试）③ "Code review src/extension.ts"（综合性 review）④ "Create a React component"（简单 UI 组件）⑤ "Write project README"（从代码结构推断） |
| 命令 | `roam.runDemoTask` → QuickPick 显示标题列表 → 选中 → 把 `prompt` 发给 PM（`sessionManager.startAndSend('pm', prompt)`） |
| enhancement | 如果 Team 中无 PM → 提示创建；如果无 agent → 提示运行 Setup Wizard |

#### Task E6.4 — `extension.ts` 集成 (1d) `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `src/extension.ts` |
| 注册 | 注册 `OnboardingWizard` provider、`roam.onboarding` / `roam.runDemoTask` / `roam.editWorkflow` 命令 |
| 激活逻辑 | `activate()` 中：check `onboardingComplete` → false → 1 秒延时后 `roam.onboarding`（让 UI 先渲染） |
| deps 注入 | 创建 `OnboardingDeps`：持有 `SessionManager`、`SecretStorage`、`TeamConfigIO`、`context.workspaceState` |

> **M4 结束打卡** ✅：E6 build/lint/test 绿、手动验证完整 Onboarding Wizard 流程 ✅

---

## E5: 硬化收尾包（散布 M2–M5）

### E5a: 5-agent 压力测试（1d） `[A]`

| 项 | 内容 |
|----|------|
| 脚本 | `scripts/stress-test-5-agents.js` — Node.js 脚本（使用 VS Code 扩展 API 不可行——用 UnodeAi 的 programmatic API 或手动操作） |
| 手动 | 创建 5 个 agent（PM + arch + dev + qa + tech-writer）→ 同时用 QuickPick 或 Chat 给每人发一个独立任务 → 记录 VS Code 进程的内存/CPU（Windows Task Manager 或 `process.memoryUsage()`） |
| 指标 | 内存峰值、稳态内存、消息延迟（从发到收的 p50/p95） |
| 目标 | 5-agent 并发 ≤ 500MB 内存、消息 p95 ≤ 200ms |
| 输出 | 更新 `docs/STATUS.md` 中所有 `[估]` → `[实测]` |

### E5b: esbuild 打包（1d） `[C]`

| 项 | 内容 |
|----|------|
| 安装 | `npm install -D esbuild` |
| 脚本 | `esbuild.config.mjs` — 入口 `src/extension.ts` → `out/extension.js`（bundled），external: `vscode`、`ajv`、`ajv-formats`（动态 require 的模块），platform: `node`，format: `cjs`（VS Code 扩展格式） |
| tsconfig | 不改——esbuild 用 `transform` 模式（TypeScript → JS），不需要 type checking（那是 `tsc --noEmit` 的事） |
| `package.json` | `"scripts": { "build:bundle": "esbuild src/extension.ts --bundle --external:vscode --external:ajv --external:ajv-formats --platform=node --format=cjs --outfile=out/extension.js --sourcemap" }` |
| `.vscodeignore` | 添加 `!out/extension.js` 和 `!out/extension.js.map`；排除 `src/`、`node_modules/` 中除 `ajv`/`ajv-formats`/@modelcontextprotocol/sdk 以外的模块（或全打包进 out/） |
| 渐进 | 先 `build:bundle` → `vsce package` → 文件数从 ~4200 → ~50 → 安装到 VS Code → 跑所有 smoke test |
| 回退 | 如果打包后有问题 → 保留 `build`（tsc）为默认，打包作为可选优化 |

### E5c: IMPROVER review 结果落地（1d） `[C]`

| 项 | 内容 |
|----|------|
| 来源 | Codex v0.1.1 审查中标记的 IMPORTANT follow-ups（CODEX_REVIEW_v0.1.1.md §128-138） |
| 项 | ① Settings 面板 `modelTierCell` 限制 provider 为已知 registry → 在 `saveSmart()` 中加 whitelist 校验 ② 文档一致性检查（PRD/DevPlan/STATUS 中过时的 B4 描述） |
| 改 | `src/views/SettingsPanel.ts`（`saveSmart`: `modelTierCell` provider 校验）、`docs/STATUS.md`（P1#7 过时说法） |

### E5d: npm audit 处置（0.5d） `[C]`

| 项 | 内容 |
|----|------|
| 操作 | `npm audit --omit=dev` → 当前已知 1 条（uuid moderate，不影响本项目的调用方式）。如果新报 critical → 逐一评估是否影响 prod path |
| 不做 | `npm audit fix --force`（会升 uuid breaking major） |
| 记录 | 在 `CHANGELOG.md` 和 `STATUS.md` 中更新 audit 状态 |

### E5e: E2E 扩展（0.5d） `[C]`

| 项 | 内容 |
|----|------|
| 文件 | `test-e2e/suite/` 新增 `routing.test.ts` + `concurrency.test.ts` |
| routing | 2 个 agent（dev + qa）→ 给 qa 发 task → 验证只有 qa 收到 → dev 无消息 |
| concurrency | 启动 3 个 agent（max 2） → 第 3 个进入 pending → stop 一个 → 第 3 个自动 start |

> **E5 结束打卡** ✅：5 项全部完成，build/lint/test/e2e 全绿，audit 报告更新 ✅

---

## M5 — Chat Experience Parity（重排为一等主线）+ 发布（Week 5+）

> **调整(2026-06-05, Claude)**：原 E7「Chat 面板增强（3d）」**被取代/扩展**为一条独立的 **Chat 体验追平**主线,
> 详见 [FeatureSpec_Chat_PlanAct_Mode.md](FeatureSpec_Chat_PlanAct_Mode.md)。原因:用户的核心痛点是"和每个 agent
> 的对话远不如 Cline"。真正的差距是 **流式 + 对话内工具/动作可见 + Markdown 渲染**(原计划要么 defer 要么没提),
> 而不是 Plan/Act。这条线 ~10.5d,**优先级高于 E3/E4/E6**(用户最直接的痛点),可在 E2 之后立刻排,或与 E3/E4 并行。

### Chat Parity 主线 — C1–C4（实施依 FeatureSpec）

| Task | 估时 | 摘要 |
|------|------|------|
| **C1** 侧边栏富聊天视图 `[C]` | 3d | **放在 UnodeAi 侧边栏(WebviewView,不是编辑器面板、不是 OutputChannel/terminal)** + Markdown/代码渲染 + agent 切换器 + 每-agent 持久化(`workspaceState`,移除 agent 即清);回复按 `msg.from` 过滤 |
| **C2** 流式 + 中断 `[C]` | 2.5d | 扩展 fetch 抽象出**流式 body**(现 `FetchFn` 只有 `text()`、`chat()` 硬编码 `stream:false`);流式仅用于**无工具调用的最终回答轮**,工具循环轮仍非流式;`session.stream_chunk` 增量;Stop→`backend.abort()` |
| **C3** 工具/动作可见卡片 + **C3b 上下文用量条/压缩标记** `[C]` | 3.5d | C3:把 `read/edit/run`/MCP 调用渲染成对话内**卡片**(可折叠 diff/输出),随事件出现——**本版最大缺口**;仅"可见",审批 UI 不在本轮。**C3b**:把已自动生效的 F1b 上下文窗口 + E1 压缩**显示**出来——上下文用量条(`tokens÷contextWindowTokens`,数据由后端经 `turn_complete`/事件上报)+ `🗜 Context compacted` 标记(E1 压缩时发结构化信号);claude agent 显示"managed by Claude"。**不重复实现压缩本身**。路径/diff/数字一律 escape、不 faked |
| **C4** Plan/Act(**硬隔离**) `[C]` | 2d | 模式切换;**Plan 模式在工具层禁用 write/execute**(给模型的工具集去掉写/执行 + CommandPolicy 拒绝),`[PLAN MODE]` 提示词只作防御纵深;mode 在 extension 侧应用,不信 webview |

**顺序**:C1 → C2 → C3 → C4。**关键约束**(同 GUIDANCE):webview 渲染模型/工具数据**禁 `innerHTML`**、CSP nonce、全英文、不弱化安全模型、纯核心单测、每合并门禁绿。

> 验收见 FeatureSpec §4。**C1 完成即可让用户先体验富聊天(结构 + Markdown),C2/C3 再叠加流式与动作可见。**

---

## M5.5 — 发布（1d）

### Release

| 项 | 内容 |
|----|------|
| Changelog | `CHANGELOG.md` 新增 `## [0.2.0]` 段，列出 E1–E7 |
| Version | `npm version minor` → `0.2.0` |
| 全量验证 | `npm run build` · `npm run lint` · `npm test`（目标 ≥250）· `npm run test:e2e` |
| 打包 | `vsce package` → `roam-crew-0.2.0.vsix` |
| 发布 | `vsce publish` |
| Tag | `git tag v0.2.0` + `git push --tags` |
| 文档 | `docs/STATUS.md` 更新 "v0.2.0 已发布" 段 |
| GTM | 更新 Marketplace 描述（加入 Onboarding / Context Compaction / Claude PM 亮点） |

> **M5.5 结束打卡** ✅：v0.2.0 已发布到 Marketplace ✅

---

## 风险表

| 风险 | 阶段 | 缓解 |
|------|------|------|
| `LocalMcpServer` HTTP 在 Windows 上可能被防火墙/CSP 阻断 | M2 | Day 1 先做协议探针；备选 stdio |
| E1 摘要质量显著影响 agent 行为 | M1 | 保留 hardLimit 为安全阀；可降级为旧丢弃模式 |
| E6 Wizard 在 Windows VS Code 上 UI 渲染异常 | M4 | Webview UI 使用标准 HTML/CSS，已在 v0.1.x Settings 面板上验证 |
| E7 流式输出在 webview→extension 的 postMessage 时延高 | M5 | 批量发送（每 3-5 个 SSE chunk 合并一次 postMessage，减少 IPC 开销） |
| esbuild 打包后 MCP SDK / ajv 路径异常 | M4 | 已知 workaround（PUBLISH_CHECKLIST）；打包后立刻做 smoke test |

---

## 测试预算

| Epic | 新测试 | 累计 |
|------|--------|------|
| 当前基线（v0.1.2） | — | **218** |
| E1: 上下文摘要 | ~10 | 228 |
| E2: IPC Bridge | ~10 | 238 |
| E4: 工作流分支 UI | ~6 | 244 |
| E5: 硬化包 | ~4 | 248 |
| E7: Chat 增强 | ~4 | 252 |
| **v0.2.0 总目标** | **~34** | **≥250** |

---

*End of Development Plan — To be executed after PRD review sign-off*