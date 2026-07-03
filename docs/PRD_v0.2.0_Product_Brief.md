# UnodeAi v0.2.0 — Product Brief

> 📌 **文档治理**:本文件由 Claude 统一维护。有不同意见/新方向请写进 [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md),勿直接改写(会与已合并代码打架)。

> **Status**: Reviewed (Claude) — Codex to implement
> **Date**: 2026-06-05
> **Baseline**: v0.1.2（Marketplace `RoamAI.roam-crew`，已通过 CHANGELOG 记录）
> **Target**: TBD（建议 4–5 周 / 20–25 工作日）
> **主题**: 「从"能跑"到"可靠、可扩展、可增长"」
>
> **Claude 审阅校正(2026-06-05)**：① 用户要求——provider+API Key 流程 Base URL 默认填 `https://www.unodetech.xyz/v1`(并入 E6a)。② E7 流式输出**并非"已有"**——`chat()` 硬编码 `stream:false`、`FetchFn` 只返回 text,需新建流式路径且工具循环轮仍走非流式(详见 E7)。③ 实施方为 **Codex 团队**,Claude 监督审查——指导见 [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md)。其余设计与代码核对一致(TokenCounter.softLimit / trimHistory / TeamMcpBridge / ClaudeMcpConfig / WorkflowEngine.branches 均属实)。

---

## 执行摘要

v0.1.x 完成了核心闭环——多 Agent 团队、PM 编排、按角色选模型、安全模型、Settings 面板。v0.2.0 的目标是**消除 v0.1.x 留下的三大体验裂缝**：

1. **长会话退化**：v0.1.x 的上下文裁剪是"丢掉中间"——agent 会遗忘早期决策。v0.2.0 用 LLM 摘要替代丢弃。
2. **PM 被锁在后端**：PM 只能驱动进程内 openai-compat agent，无法编排 Claude headless agent。v0.2.0 打通 IPC 桥。
3. **新用户流失**：30 秒内看不到价值。v0.2.0 做真正的 onboarding + demo 路径。

同时完成 v0.1.x 推迟的硬化工序（MCP 真实验证、条件分支 UI、性能实测、esbuild 打包）。

---

## 1. Scope

### 1.1 In Scope ✅

| # | Epic | Priority | 估时 | 来源 |
|---|------|----------|------|------|
| **E1** | 上下文摘要压缩（替代丢弃） | 🔴 P0 | 5d | Backlog §1 · STATUS |
| **E2** | PM 委派支持 Claude 后端（IPC 桥） | 🔴 P0 | 5d | Backlog §2 · PRD v0.1.1 out-of-scope · GLM · Cline D1 |
| **E3** | MCP 真实服务器 live 验证 | 🟡 P1 | 2d | Backlog §3 · PRD v0.1.1 out-of-scope |
| **E4** | 工作流条件分支 UI（声明式 JSON 编辑） | 🟡 P1 | 3d | Backlog §4 · GLM 避坑#1 |
| **E5** | 硬化收尾包 | 🟡 P1 | 4d | Backlog §5 · CODEX_REVIEW follow-ups |
| **E6** | Onboarding / 30-秒到价值 | 🔴 P0 | 4d | Backlog §6 · GLM §1.3 · STATUS recurring gap |
| **E7** | Chat 面板增强（中断 / 流式输出 / 历史） | 🟢 P2 | 3d | Backlog §6 |

**总估时**：~26 工作日（约 5 周），可并行 E1+E2（独立模块）、E3+E4（独立 UI/验证）、E5 散布在各阶段。

### 1.2 Out of Scope ❌（deferred to v0.3.0+）

- 团队模板市场（需要服务端 + 审核流程）
- i18n / a11y 完整覆盖
- worktree 并发策略
- 可视化工作流编辑器（先做声明式 JSON——GLM 避坑#1）
- PM 并行委派（现为顺序）
- Agent 自主更新 `.roam/rules.md`（仍然是手动编辑）

---

## 2. Epic 详情

### E1 — 上下文摘要压缩（Context Compaction by Summarization）

**问题**：v0.1.x 的 `trimHistory` 在达到 70% 软门时**丢弃中间的对话轮次**，只保留 system prompt + 首个用户任务 + 最近 K 轮。长会话中 agent 会"遗忘"早期决策（例如架构师约定的契约），表现为幻觉或重复劳动。

**设计**：

```
触发时机: TokenCounter 达到 softLimit (70%) —— 主动触发，给 80% 硬门留余地
行为: 把要丢弃的中间轮次先送给一个 economy 模型做总结,
     生成 [rolling summary]，替换被丢弃的部分，
     而不是直接丢弃。

消息结构变为:
  [system (+ project_context)]
  → [rolling summary of older turns]     ← 新：LLM 生成的运行摘要
  → [anchor: first user task]            ← 保留（锚点）
  → [last K full turns]                  ← 保留（最近上下文）
```

**摘要策略**：
- **增量式**：只总结**新被丢弃的轮次**，追加到已有摘要，不重跑全文。
- **廉价模型**：使用 economy tier（如 `deepseek-v4-flash`），复用现有 `TierController` 的基础设施。
- **缓存**：摘要缓存在 `SessionManager` 的会话状态中，随会话生命周期。
- **scope**：仅对 `OpenAICompatBackend` 生效。Claude headless 后端自带原生 compaction——**不要双重压缩**。

**实现要点**：

| 组件 | 改动 |
|------|------|
| `backend/TokenCounter.ts` | 已有 `softLimit()` / `hardLimit()`，复用 |
| `backend/OpenAICompatBackend.ts` | 替换 `trimHistory` 的丢弃路径：达到 softLimit → 调 summarizer → 注入 rolling summary → 继续 |
| `session/Summarizer.ts` | **新文件**——纯模块：接收 `Message[]`（待丢弃轮次）+ 已有 `rollingSummary?: string` → 调用 economy 模型的 `/v1/chat/completions` → 返回增量摘要文本 |
| `session/SessionManager.ts` | 持有 `Summarizer` 实例，`deliverTurn` 前检查 `TokenCounter.softLimit`，触发摘要 |

**验收**：
- 长会话（≥50 轮）的上下文占用始终 ≤ 70% 软门
- 探测早期决策（如 "我们在开始时约定的编码规范是什么？"）能从 rolling summary 中正确回答
- 摘要调用使用 economy tier 模型，成本可控
- 增量摘要：新轮次只产生 ~1 次 economy 调用，不随历史长度线性增长
- Claude headless 后端不触发 UnodeAi 的摘要逻辑（claude 自行管理窗口）

---

### E2 — PM 委派支持 Claude 后端（IPC Bridge）

**问题**：v0.1.x 的 PM（协调者 agent）只能驱动进程内 openai-compat 后端——因为 `TeamTools`（`list_agents` / `assign_task` / `broadcast` / `run_checks`）是通过代码注入的，需要和 SessionManager 共享同一个进程内 MessageBus。Claude headless 后端是独立子进程，无法直接访问这些工具。

**目标**：让 Claude 后端的 PM 也能调用 `TeamTools`，实现真正的"PM 不限后端"。

**设计**：

核心思路是把 `TeamMcpBridge`（已存在，v0.1.x 的 `mcp/TeamMcpBridge.ts`——把 `TeamTools` 适配成 MCP tool 接口）**托管为一个本地 MCP 端点**，然后通过 `claude --mcp-config` 让 claude 子进程连接它。

```
                    ┌─────────────────────────────┐
                    │  VS Code Extension Process   │
                    │                             │
                    │  TeamMcpBridge (已有)        │
                    │  + new: LocalMcpServer       │ ← 新：托管为 streamable-http 或 stdio
                    │    (port/pipe)               │
                    │       ↑                      │
                    └───────┼──────────────────────┘
                            │ HTTP / stdio
                    ┌───────┴──────────────────────┐
                    │  Claude Headless (子进程)      │
                    │  claude --mcp-config ...      │ ← 新：启动时传入 MCP 配置
                    │  自动获取 list_agents 等工具   │
                    └──────────────────────────────┘
```

**实现分两层**：

#### 层 1：LocalMcpServer（本地 MCP 端点）— 核心

| 项 | 内容 |
|----|------|
| 新文件 | `src/mcp/LocalMcpServer.ts` |
| 协议 | **streamable-http**（优先）或 stdio（备选）——streamable-http 在 Windows 上更可靠 |
| 行为 | 在扩展激活时启动一个小型 HTTP 服务器（`localhost` 随机端口），挂载 `TeamMcpBridge` 的 tool list + call handler |
| 安全 | 仅监听 `127.0.0.1`，端口随机；仅在 PM 启动时绑定，停止时释放；使用随机 token 做简单鉴权（`Authorization: Bearer <random>` 头或 query param） |
| 生命周期 | 惰性启动（首个 claude PM agent start 时）、最后一个 claude PM agent stop 时关闭 |

#### 层 2：ClaudeMcpConfig 扩展 + 启动参数

| 项 | 内容 |
|----|------|
| 文件 | `src/mcp/ClaudeMcpConfig.ts`（已有 `buildClaudeMcpConfig`） |
| 改动 | 把 `LocalMcpServer` 的端点和 token 注入 `buildClaudeMcpConfig` 的输出 |
| 文件 | `src/backend/ClaudeHeadlessBackend.ts` |
| 改动 | `start()` 中：如果该 agent 是 PM 角色 → 启动 `LocalMcpServer` → 生成 `--mcp-config` 临时文件 → 传给 `claude` 子进程。Non-PM agent 不走这条路径（无 `TeamTools`）。 |

**验收**：
- 创建一个 PM agent（backend: claude）→ 启动 → PM 能成功调用 `list_agents` 查看团队成员
- PM 能 `assign_task` 给其他 agent → 任务路由正确 → 子 agent 完成后 PM 收到结果
- PM 能 `broadcast` 和 `run_checks`
- 停止 PM agent → `LocalMcpServer` 端口释放
- 多个 claude PM agent 共享同一个 `LocalMcpServer` 实例（不复启动）

---

### E3 — MCP 真实服务器 Live 验证

**问题**：v0.1.x 完成了 MCP 的全部审批门、占位符、Settings 面板——但**从未对真实 MCP 服务器跑过完整的端到端流程**。PRD v0.1.1 明确标记为 out-of-scope、backlog 要求 live smoke。

**范围**：
- 至少验证 **2 个** MCP 服务器：`@anthropic/mcp-server-github` 和 `@anthropic/mcp-server-playwright`
- 覆盖：连接 → tool list → tool call → 结果回到 agent → agent 基于结果行动
- 两端后端都要验证（openai-compat + claude headless）
- 记录所有发现的问题，修 P0/P1 级别的问题

**验收**：
- 用真实 GitHub token 连接 `github` MCP server → agent 能读 issue/PR
- 用 Playwright MCP server → agent 能打开网页、截图
- 审批门（`requiresApproval`）在真实场景中正确触发
- `${VAR}` 占位符在真实 token 注入中正确替换
- 记录一份 [MCP_LIVE_VALIDATION_REPORT.md]（发现 + 修复 + 剩余问题）

---

### E4 — 工作流条件分支 UI（声明式 JSON 编辑）

**问题**：v0.1.x 的 `WorkflowEngine` 已经支持 `branches[]`（条件分支 + loop），但**没有任何 UI 来编辑分支**。用户只能手写 JSON——这背离了 v0.1.x "不让用户手改 JSON" 的主题。

GLM 和 Cline 两份评审一致建议：**先做声明式 JSON 编辑，不要做可视化编辑器**。

**设计**：

| 项 | 内容 |
|----|------|
| 新文件 | `src/views/WorkflowEditor.ts`（Webview Provider） |
| 命令 | `UnodeAi: Edit Workflow` → 打开 Workflow Editor 面板 |
| UI 布局 | 左侧：步骤列表（可拖拽排序）+ 每步的 type / agent / prompt。右侧：选中步骤的详情面板——如果是 `gated` 或带 `branches` 的步骤，显示分支编辑器 |
| 分支编辑 | 一个分支 = `{ condition: string, goto: stepId }`。编辑器是**结构化表单**（不是裸 JSON 编辑器）——condition 输入框 + goto 下拉（列出可用步骤）+ 删除/添加分支按钮 |
| loop 指示 | 如果某分支的 `goto` 指向当前步骤之前的步骤 → 自动标记为 🔄 loop |
| 数据存储 | 编辑结果存回 `team.json` 的 `workflows[]`（已有 schema 支持） |
| 模板 | 保留现有 4 个预置模板（feature / bug-fix / code-review / docs），用户可基于模板编辑 |

**验收**：
- `UnodeAi: Edit Workflow` → 面板打开 → 现有 workflow 步骤正确展示
- 在 gated 步骤上添加 2 个分支（pass→step3、fail→step4）→ 保存 → `team.json` 更新 → 重新加载面板保持编辑结果
- 创建一个带 loop 的工作流（测试失败→修复）→ loop 标记正确显示
- 删除一个分支 → 保存 → 分支数减少
- 基于 `feature` 模板编辑 → 不影响原始模板

---

### E5 — 硬化收尾包（Hardening Carryovers）

这一包集中处理 backlog §5 和 Codex 审查 follow-up 中积累的硬化任务：

| # | 项 | 估时 | 来源 |
|---|----|------|------|
| **E5a** | **5-agent 并发压力测试 + 真实性能指标** | 1d | Backlog §5.3 · Cline A4 |
| **E5b** | **esbuild 打包**（消除 vsce 文件数告警） | 1d | Backlog §5.4 · STATUS |
| **E5c** | **IMPROVER review 结果落地** | 1d | CODEX_REVIEW follow-ups |
| **E5d** | **npm audit 处置**（评估是否升级 uuid） | 0.5d | STATUS · CHANGELOG |
| **E5e** | **E2E 测试扩展到 routing + concurrency** | 0.5d | STATUS |

**E5a 详情**：
- 启动 5 个 agent（PM + arch + dev + qa + tech-writer），同时发任务
- 记录：总内存占用、消息延迟（p50/p95）、CPU 使用率
- 替代 v0.1.x 中所有 `[估]` 标记的性能数字
- 目标：5-agent 场景下内存 ≤ 500MB、消息延迟 p95 ≤ 200ms

**E5b 详情**：
- 用 esbuild 打包 `extension.ts` 入口 → 单文件（或少数几个 chunk）输出
- `ajv` / `ajv-formats` 动态 require 问题已有安全路径（PUBLISH_CHECKLIST_v0.1.1.md：external + allowlist）
- 打包后 vsce 文件数从 ~4200 降至 ~50
- 回归测试：打包后的 vsix 安装到 VS Code → 所有功能正常

---

### E6 — Onboarding / 30-秒到价值

**问题**：这是 v0.1.x 评审（GLM §1.3, §4.3）反复强调的 **#1 产品缺口**。新用户打开 UnodeAi 看到空白面板，不知道从何开始。v0.1.x 有了 One-Click Demo Team——但还远远不够。

**v0.2.0 的 onboarding 应该是一段"引导式体验"，不只一个按钮**。

**设计**：

#### E6a — 首次激活向导（First-Run Wizard）

| 项 | 内容 |
|----|------|
| 触发 | 扩展首次激活时（`workspaceState` 无 `roam.onboardingComplete` 标记）自动弹出 |
| 步骤 | ① Welcome（1 屏，说明 UnodeAi 是什么）→ ② Provider Setup（选择 provider + 输入 API Key，或跳过；**Base URL 输入框默认预填 `https://www.unodetech.xyz/v1`**——即 `roam.baseUrl` 默认值，用户可改）→ ③ Create Your First Team（一键创建 PM+Dev+QA，或手动选角色）→ ④ Run Demo Task（预置任务："用 TypeScript 写一个 hello world HTTP server"）→ ⑤ Done（指向 Dashboard、Chat、Settings 的下一步引导） |
| ⚠️ Base URL 默认（用户要求） | 凡是"选 provider + 输入 API Key"的流程（Onboarding ② / Add Agent / Set API Key 若涉及端点），**Base URL 一律默认预填 `https://www.unodetech.xyz/v1`**。已有 Add-Agent 端点流程已预填（`dialogs.ts` 读 `roam.baseUrl` 默认值）；Onboarding 的 Provider 步骤必须同样默认。 |
| ⚠️ 选模型指引（用户要求） | Provider 步骤里放一句可点击链接：**"Browse models & pricing → https://www.unodetech.xyz/pricing?lang=en"**,引导用户去选合适的模型。已在 v0.1.x 同步加到 `roam.baseUrl` 设置描述、Add-Agent 模型选择器标题、USAGE。 |
| 实现 | 新文件 `src/views/OnboardingWizard.ts`（Webview Provider），每步一个页面，底部有 Back/Next/Skip 按钮 |
| 跳过 | 任何时候可跳过 → 标记 `onboardingComplete` → 不再弹出。可通过命令 `UnodeAi: Run Setup Wizard` 重新打开 |

#### E6b — Team Panel 空状态 CTA

当前 Team Panel 空状态已有一个 "Add your first agent" 按钮（v0.1.x TTV 冲刺），v0.2.0 增强：

- 空状态显示 **3 个快速开始卡片**：
  1. "🚀 Quick Start Team"（PM + Dev + QA，一键创建）
  2. "🧪 Run Demo Task"（用已有 team 跑预置 demo）
  3. "📖 Open Documentation"（打开 USAGE.md）
- 每张卡片有图标 + 一句话描述 + 按钮

#### E6c — Demo Task Library

- 预置 3–5 个 demo task（如 "Hello World HTTP server"、"Add unit tests to existing code"、"Code review a file"）
- 每个 demo task 有标题 + 描述 + 预期结果
- `UnodeAi: Run Demo Task` 命令 → QuickPick 选择 demo task → 自动发给 PM

**验收**：
- 全新安装 → 激活 → Onboarding Wizard 自动弹出
- Wizard 走完 5 步 → Team 已创建，agent 已启动，demo task 已发
- 空状态显示 3 张快速开始卡片
- `Run Demo Task` → 选择 task → PM 收到并开始编排
- 重复激活不弹出 Wizard（`onboardingComplete` 标记生效）

---

### E7 — Chat 面板增强（中断 / 流式 / 历史）

**问题**：v0.1.1 的 Chat 面板（`UnodeAi: Open Chat with Agent`）是最小可用版——能发消息、能收到回复，但缺乏三个关键体验：

1. **不能中断正在生成的回复**（按了发送只能等）
2. **没有流式/打字机输出**（回复一次性蹦出来）
3. **没有历史记录**（关了面板就丢了对话）

| 项 | 内容 |
|----|------|
| **中断（Cancel）** | 发送按钮在 agent 处理中变为 ■ Stop 按钮 → 点击后通过 MessageBus 发 `session.interrupt` → `SessionManager` 调 `backend.abort()` |
| **流式输出** | ⚠️ **需新建,并非已有**：`OpenAICompatBackend.chat()` 当前**硬编码 `stream:false`**,且 `FetchFn` 抽象只返回 `text(): Promise<string>`、**没有流式 body**。要支持流式需:① 扩展 `FetchFn`(或新增一个流式 fetch)暴露 `response.body`/可迭代 chunk;② 在 chat() 加 `stream:true` 的 SSE 解析路径,逐 `delta.content` 经 MessageBus 发 `session.stream_chunk`;③ 注意**工具循环**仍需完整响应——流式只用于"无工具调用的最终回答"轮,或在检测到 tool_calls 时回退非流式。Claude headless 的 stream-json 已是逐事件,但现 `ClaudeHeadlessBackend` 多按完整文本块 emit `assistant`,token 级流式需确认 `StreamJsonParser` 的增量粒度。**这是 E7 最大的未知量,建议 M5 第 1 天先做可行性探针。** |
| **历史持久化** | Chat 面板关闭时自动保存当前对话到 `workspaceState`（per-agent key）。下次打开同一 agent 的 Chat → 恢复最近 N 条消息 |
| **Agent 选择器** | Chat 面板顶部下拉切换 agent（不需关面板重新开） |

**验收**：
- Chat 中发消息 → agent 处理中 → 点 Stop → agent 收到中断 → Chat 显示 "Cancelled"
- openai-compat agent 回复以打字机效果逐 token 渲染
- 关闭 Chat 面板 → 重新打开同一 agent → 历史消息显示
- 切换 agent → Chat 面板换到新 agent 的对话

---

## 3. 里程碑 & 时间线

```
Week 1:  M1 — Foundation
         ├─ E1 上下文摘要压缩 (5d)
         └─ E5d npm audit 处置 (穿插)

Week 2:  M2 — IPC Bridge
         ├─ E2 PM→Claude 后端委派 (5d)
         └─ E5a 5-agent 压力测试 (穿插开始)

Week 3:  M3 — Live Validation + UI
         ├─ E3 MCP 真实服务器验证 (2d)
         ├─ E4 工作流分支 UI (3d)
         └─ E5e E2E 扩展 (穿插)

Week 4:  M4 — Onboarding + Chat
         ├─ E6 Onboarding / 30-秒到价值 (4d)
         └─ E5b esbuild 打包 (1d)

Week 5:  M5 — 收尾 + 发布
         ├─ E7 Chat 面板增强 (3d)
         ├─ E5c IMPROVER review (1d)
         └─ Release: 0.2.0 → vsce publish (1d)
```

**并行机会**：
- E1 + E2 可部分并行（模块独立）：E1 在 `OpenAICompatBackend` 内，E2 新文件 `LocalMcpServer` + 改 `ClaudeHeadlessBackend`
- E3 + E4 可并行：E3 是验证工作（不需要大改动），E4 是新 UI 面板
- E5a 早点开始（需要多次跑 + 调优），散布在 M2–M4

---

## 4. 架构原则

1. **不要破坏 v0.1.x 的安全模型**：CommandPolicy、FileCoordinator、MCP default-deny 在任何新功能中都不应被绕过。
2. **新模块走注入式架构**：跟随现有 `SessionManagerDeps` / `SettingsPanelDeps` 模式，不引入全局单例。
3. **纯模块优先于 VS Code 依赖**：像 `Summarizer`、`LocalMcpServer` 的逻辑核心应是 vscode-free 的（通过依赖注入获得 IO），这样可单测。
4. **Claude 后端不重复造轮子**：Claude headless 已经有自己的 window management / MCP config / stream-json。UnodeAi 只做它不提供的部分（TeamTools 桥、Chat UI）。

---

## 5. 文件变更地图

| 文件 | 改动 | Epic |
|------|------|------|
| `src/backend/TokenCounter.ts` | 暴露 `softLimit` 供 E1 触发 | E1 |
| `src/backend/OpenAICompatBackend.ts` | `trimHistory` → 摘要路径；接入 `Summarizer` | E1 |
| `src/session/Summarizer.ts` | **新文件**——增量 LLM 摘要生成器 | E1 |
| `src/session/SessionManager.ts` | 持有 `Summarizer`；`deliverTurn` 前门控 | E1 |
| `src/mcp/LocalMcpServer.ts` | **新文件**——本地 streamable-http MCP 端点 | E2 |
| `src/mcp/TeamMcpBridge.ts` | 已有——由 `LocalMcpServer` 挂载 | E2 |
| `src/mcp/ClaudeMcpConfig.ts` | 扩展——注入本地 MCP 端点配置 | E2 |
| `src/backend/ClaudeHeadlessBackend.ts` | `start()` 中 PM agent 启动 `LocalMcpServer` + 传 `--mcp-config` | E2 |
| `src/views/WorkflowEditor.ts` | **新文件**——工作流编辑器 Webview | E4 |
| `src/views/OnboardingWizard.ts` | **新文件**——首次激活向导 | E6 |
| `src/views/TeamViewProvider.ts` | 空状态增强（快速开始卡片） | E6 |
| `src/views/ChatPanel.ts` | 中断 / 流式 / 历史 / agent 选择器 | E7 |
| `src/extension.ts` | 注册新命令 + 新 Provider；E5b esbuild 入口 | E4/E6/E7/E5 |
| `package.json` | 命令贡献 + esbuild 打包脚本 | E5b |

---

## 6. 验收门禁（Definition of Done）

- [ ] `npm run build` 通过
- [ ] `npm run lint` 0 error
- [ ] `npm test` 全绿（目标 ≥250 测试）
- [ ] `npm run test:e2e` 全绿（扩展 routing + concurrency 场景）
- [ ] E2：claude PM 成功编排完整 demo task（实测，需 API key）
- [ ] E3：MCP live validation report 完成 + P0/P1 问题已修
- [ ] E5a：5-agent 并发压力测试报告完成（含内存/延迟实测数据）
- [ ] E5b：esbuild 打包后 vsix 安装 → 所有功能正常
- [ ] E6：全新安装 → Onboarding Wizard → Demo Task 完整走通
- [ ] `CHANGELOG.md` 更新
- [ ] `npm version minor` → `0.2.0`
- [ ] `vsce package` → `vsce publish`

---

## 7. 风险 & 缓解

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| `LocalMcpServer` streamable-http 在 Windows 上不稳定 | 中 | 高（E2 的核心依赖） | 备选：stdio 子进程模式（`claude --mcp-config` 支持两种）；M2 第 1 天先做协议探针 |
| 摘要质量差导致 agent 决策错误 | 中 | 中 | 摘要只用于"记忆早期决策"，不替代最近 K 轮完整上下文；用已知的早期决策做定向测试；如摘要不可靠就 fallback 到旧丢弃模式 |
| `ajv` 动态 require 阻断 esbuild 打包 | 中 | 低（有已知 workaround） | PUBLISH_CHECKLIST 已有安全路径：external ajv/ajv-formats + allowlist；不影响功能 |
| E6 onboarding 太复杂，用户跳过率高 | 中 | 中 | 每步都可以跳过；Wizard 总步数 5 步、每步 <3 个输入；AB 对比"有 wizard vs 无 wizard"的 demo team 创建率 |
| E2 + E6 并行导致集成冲突 | 低 | 中 | 两者改不同模块（E2=后端/MCP，E6=UI/webview）——交集仅 `extension.ts` 注册，最后合并 |
| E1 摘要调用增加了 API 成本 | 低 | 低 | 摘要仅在达到 70% 软门时触发（长会话才可能）；每次增量调用 ~1 次 economy tier API call；已有成本追踪可衡量影响 |

---

*End of Product Brief — Draft for Review*