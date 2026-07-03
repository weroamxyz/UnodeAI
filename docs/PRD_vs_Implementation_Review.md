# PRD vs 实现评估报告

> **评估日期**: 2026-06-02
> **PRD 版本**: v2.2
> **评估范围**: 对比 PRD 各项需求与代码实现的一致性，评估产品是否达到设计要求，并对 PRD 提出优化建议
>
> ⚠️ **这是一份时点评估快照，内容已冻结、不回填新进展。** 文中实现状态/完成度统计以 2026-06-02 的代码为准（部分建议如「一键默认团队」「模型列表拉取」「Agent 名称自定义」「成本估算」已在 PRD v2.4 落地）；**最新状态及各条建议处置见 [STATUS.md](STATUS.md)「评审建议处置台账」**。
> 相关：[README 文档地图](../README.md) · [PRD](../PRD_MultiAgent_VSCode_Extension.md) · 另一份评审：[GLM](Project_Review.md)

---

## 一、总体评价

**结论：PRD v2.1/v2.2 定义的 MVP（Phase 1）功能已基本实现，核心差异化能力落地扎实，但存在若干 UX 流程与 PRD 描述不一致、部分 P0/P1 功能实现不完整、性能指标多数为估算而非实测等问题。**

| 维度 | 评分 | 说明 |
|------|------|------|
| 核心架构实现 | ⭐⭐⭐⭐⭐ | AgentBackend 抽象、SessionManager、MessageBus、TeamTools 均完整实现 |
| 安全与并发 | ⭐⭐⭐⭐⭐ | CommandPolicy + FileCoordinator + 跨文件三层防御，超出同类产品 |
| UI/UX 实现 | ⭐⭐⭐ | Webview 面板已实现，但多个交互流程与 PRD 描述不一致 |
| 测试覆盖 | ⭐⭐⭐⭐ | 52 个 Vitest 用例，但缺 E2E 测试 |
| 性能验证 | ⭐⭐ | 多数指标为 [估]，仅 3 项 [实测] |
| 文档-代码一致性 | ⭐⭐⭐ | PRD 已做 v2.0 修正，但仍有多处描述与代码行为不符 |

---

## 二、逐项需求对照

### FR-1 团队配置

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-1.1 | `.roam/team.json` + workspaceState | ✅ | ✅ | 一致。PersistenceManager 同时支持两种存储 |
| FR-1.2 | 每成员配角色/Skill/Provider/模型 | ✅ | ✅ | 一致。RoleConfig + AgentConfigBuilder 完整 |
| FR-1.3 | 配置团队工作流 | ⚠️ | ⚠️ | 一致。WorkflowEngine 有线性模板，无条件路由 |
| FR-1.4 | 导入/导出团队模板 | ❌ | ❌ | 一致 |
| FR-1.5 | 项目级/全局级配置层级 | ❌ | ❌ | 一致 |

### FR-2 Session 管理

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-2.1 | 每 Agent 独立运行时 | ✅ | ✅ | 双后端：进程内 HTTP + Claude CLI 子进程 |
| FR-2.2 | 启停/重启单个 Agent | ✅ | ✅ | 命令 `roam.agentStart/Stop/Restart` 均已注册 |
| FR-2.3 | 一键启停整队 | ✅ | ✅ | `roam.startAllAgents/stopAllAgents` |
| FR-2.4 | 状态实时显示 | ✅ | ✅ | Webview 卡片 + 状态栏 |
| FR-2.5 | 崩溃恢复 + 上下文还原 | ⚠️ | ⚠️ | L1 ✅ L2 ✅ L3 ❌ — 一致 |
| FR-2.6 | 并发数上限 | ✅ | ✅ | `maxConcurrentAgents` 配置 |

### FR-3 Agent 间通信

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-3.1 | 点对点消息 | ✅ | ✅ | MessageBus.send + SessionManager 路由 |
| FR-3.2 | 广播 | ✅ | ✅ | MessageBus.broadcast |
| FR-3.3 | 消息路由 | ⚠️ | ⚠️ | routeInbound 硬编码规则 |
| FR-3.4 | 消息持久化 | ❌ | ❌ | 内存环形缓冲，重启丢失 |
| FR-3.5 | 消息附件 | ⚠️ | ⚠️ | payload.files 传递，无内联预览 |

### FR-4 多 Provider

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-4.1 | Roam（ComputeVault）| ✅ | ✅ | 默认 Provider，预填 endpoint |
| FR-4.2 | Anthropic（Claude CLI）| ⚠️ | ⚠️ | PRD v2.2 说"集成验证通过"，但 PM 委派工具对 Claude 后端不可用 |
| FR-4.3 | OpenAI / 兼容网关 | ✅ | ✅ | OpenAICompatBackend 通用 |
| FR-4.4 | 本地模型 | ⚠️ | ⚠️ | 经 OpenAI 兼容路径可达 |
| FR-4.5 | 自定义 Provider | ✅ | ✅ | custom provider 支持 |
| FR-4.6 | 每 Agent 独立 key | ✅ | ✅ | SecretStorage 按 provider 隔离 |

### FR-5 UI

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-5.1 | 团队面板 | ✅ | ✅ | Webview 实现 |
| FR-5.2 | 消息/活动日志 | ✅ | ✅ | Activity Feed |
| FR-5.3 | Dashboard | ⚠️ | ⚠️ | 统计卡有，趋势图/预算告警缺 |
| FR-5.4 | 状态栏 | ✅ | ✅ | `UnodeAi (active/total)` |
| FR-5.5 | 每 Agent 独立输出 | ✅ | ✅ | OutputChannel |

### FR-6 工作流引擎

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-6.1 | 可视化工作流编辑器 | ❌ | ❌ | 一致 |
| FR-6.2 | 预置模板 | ⚠️ | ⚠️ | 线性模板已有 |
| FR-6.3 | 条件路由 | ❌ | ❌ | 一致 |
| FR-6.4 | 执行历史 + 回放 | ❌ | ❌ | 一致 |

### FR-7 PM 编排

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-7.1 | PM 查看团队 | ✅ | ✅ | list_agents 工具 |
| FR-7.2 | PM 派活并等结果 | ✅ | ✅ | assign_task + correlationId await |
| FR-7.3 | PM 广播 | ✅ | ✅ | broadcast 工具 |
| FR-7.4 | PM 跑验证门 + 修复闭环 | ✅ | ✅ | run_checks |
| FR-7.5 | PM 并行委派 | ❌ | ❌ | 当前顺序 |

### FR-8 安全与并发

| ID | 需求 | PRD 状态 | 实际验证 | 差距说明 |
|----|------|---------|---------|---------|
| FR-8.1 | 命令执行审批策略 | ✅ | ✅ | CommandPolicy 三模式 + 黑名单 |
| FR-8.2 | 文件沙箱 | ✅ | ✅ | 工作目录限制 + 路径遍历防御 |
| FR-8.3 | 文件并发保护 | ✅ | ✅ | 乐观 CAS |
| FR-8.4 | 跨文件依赖失效预警 | ✅ | ✅ | 读集失效 |
| FR-8.5 | worktree 隔离 | ❌ | ❌ | 预留策略位 |

---

## 三、关键差距与风险（PRD 自评之外）

### 🔴 高优先级差距

#### 1. 添加 Agent 流程与 PRD §10.1 流程 A 严重不一致

**PRD 描述**：
> 选择角色 → 输入名称 → 选择 Provider → 选择模型（从 provider 拉取可用模型列表）→ 检查 key → 写入

**代码实际**：
> 选择角色 → 选择 Provider → 输入 Base URL → 输入模型名（手动文本框，非模型列表）→ 检查 key

具体差异：
- ❌ **无"输入 Agent 名称"步骤** — 直接用模板默认名
- ❌ **模型选择是 InputBox（手动输入），非 QuickPick（从列表选）** — PRD 明确说"从 provider 拉取可用模型列表"
- ⚠️ **Base URL 步骤对非技术用户不友好** — PRD 未提到此步骤，Roam 默认已预填但用户仍需确认

**影响**：User Story #1"一键/快速建预配置 AI 团队"无法达成；首次配置体验 <5min 的 NFR 存疑。

#### 2. 无"一键默认团队"功能

PRD §5 User Story #1："一键/快速建预配置 AI 团队"。当前只能逐个添加 Agent，无"Create Default Team"命令。虽然 `createTeam()` 函数存在于代码中但未被任何命令暴露。

**影响**：新用户 onboarding 体验差——需要手动添加 4-5 个 Agent 才能组建完整团队。

#### 3. ClaudeHeadlessBackend 不支持 PM 委派

PRD §7.1 后端模式对比表已标注，但这是**核心差异化功能**的限制：若用户选 Claude 作为 PM 后端，PM 将无法使用 assign_task/list_agents/run_checks，等于丧失核心卖点。

**影响**：PM Agent 必须运行在 OpenAICompatBackend 上，限制了 Provider 选择自由度——这与"按角色异构 Provider"的愿景矛盾。

### 🟡 中优先级差距

#### 4. Dashboard 成本估算不完整

PRD §10.1 流程 D 展示了完整的 Dashboard mockup，包括：
- Token 消耗趋势图（柱状图）→ ❌ 未实现
- Agent 排行 → ❌ 未实现
- Provider 分布 → ❌ 未实现
- openai-compat 的 costUsd → ❌ 未估算

当前 Dashboard 仅有 4 个统计数字卡，距离 PRD mockup 差距较大。

#### 5. 消息历史重启丢失

PRD 标注为 P1/❌，但这对调试和可观测性影响显著。多 Agent 协作时，用户经常需要回溯"PM 为什么做了这个决定"，重启后无法追溯。

#### 6. maxConcurrentAgents 超限行为未定义

PRD 和代码均未说明：当运行中 Agent 数已达上限时，用户尝试启动新 Agent 会发生什么？是排队？拒绝？静默忽略？

### 🟢 低优先级差距

#### 7. 性能指标多数为估算

PRD §7.1 的 15 项指标中，仅 3 项标注 [实测]，其余 12 项为 [估]。关键指标如"5 Agent 并发内存 < 2GB"尚未验证。

#### 8. E2E 测试为 0

PRD 自认，但意味着核心用户旅程（添加 Agent → 启动 → 发消息 → 观察输出）无自动化验证。

---

## 四、PRD 优化建议

### A. 内容准确性优化

| # | 建议 | 原因 |
|---|------|------|
| A1 | **修正 §10.1 流程 A**，对齐代码实际的添加 Agent 流程 | 当前描述与实际交互严重不符 |
| A2 | **§10.1 流程 A 模型选择**改为 InputBox 或标注"v1 手动输入，v2 拉取列表" | 避免读者误以为已实现模型列表拉取 |
| A3 | **§5 User Story #1** 降级为 ⚠️ 或补充说明 | "一键建团队"未实现，仅"逐个添加" |
| A4 | **§7.1 性能基准**：制定实测计划，Phase 2 结束前至少补齐 5 Agent 并发内存、消息延迟 | 多数 [估] 指标影响 NFR 可信度 |
| A5 | **§9.4 TeamTools**：明确标注 ClaudeHeadlessBackend 不支持 PM 委派 | 当前仅在对比表中提及，模块设计章节未强调 |

### B. 缺失需求补充

| # | 建议内容 | 优先级 | 理由 |
|---|---------|--------|------|
| B1 | **新增 FR：一键创建默认团队** | P0 | 核心用户旅程；`createTeam()` 代码已存在但未暴露 |
| B2 | **新增 FR：maxConcurrentAgents 超限行为** | P1 | 用户会遇到，需明确是排队还是拒绝 |
| B3 | **新增 FR：Provider 模型列表拉取** | P1 | 降低配置门槛，PRD 已暗示但未明确为需求 |
| B4 | **新增 FR：Agent 名称自定义** | P2 | PRD 流程 A 提到但代码未实现 |
| B5 | **新增 FR：Dashboard 成本估算（openai-compat costUsd）** | P1 | 商业定位"成本套利"需成本可见性支撑 |
| B6 | **新增 FR：MCP 服务器失败降级策略** | P2 | MCP 挂掉时 Agent 不可用，需 graceful degradation |
| B7 | **新增 NFR：Provider 不可达时的错误提示** | P1 | 用户配错 endpoint 时当前行为不明 |

### C. 结构优化

| # | 建议 | 理由 |
|---|------|------|
| C1 | **§6 Functional Requirements 拆分为"配置时"与"运行时"** | 当前按功能域分，但用户旅程跨越多域，拆分后更易追踪端到端完成度 |
| C2 | **新增 §"用户旅程验收标准"** | 每条 User Story 对应可执行的验收用例，而非仅靠 FR 交叉覆盖 |
| C3 | **§16 Implementation Status 增加"验证方式"列** | 区分"代码存在"与"集成验证通过"（如 ClaudeHeadlessBackend） |
| C4 | **§18 Roadmap 增加"验收标准"列** | 每个 Phase 有明确的可测量完成条件 |
| C5 | **ADR-5：为何 PM 委派不支持 ClaudeHeadlessBackend** | 这是核心限制，值得记录决策理由和未来解法 |

### D. 战略层面优化

| # | 建议 | 理由 |
|---|------|------|
| D1 | **重新审视"PM 必须用 OpenAICompatBackend"限制** | 这与"按角色异构 Provider"的愿景矛盾；长期应考虑为 Claude 后端也实现委派工具（经 MessageBus 中转） |
| D2 | **"成本套利"需要成本可见性支撑** | PRD 反复提成本套利为差异化，但 Dashboard 成本功能滞后；建议提升 Dashboard 成本估算优先级至 P0 |
| D3 | **Go-to-Market 前补齐一键建团队** | Marketplace 首发版若需用户手动添加 4-5 个 Agent，转化率会很低 |
| D4 | **定义"最小可演示场景"(Minimal Demo Scenario)** | PM 指挥 2-3 个 Agent 完成一个小 feature 的端到端演示脚本，确保核心叙事可复现 |

---

## 五、实现完成度统计

### 按 PRD 优先级

| 优先级 | 总项 | ✅ 已实现 | ⚠️ 部分实现 | ❌ 未实现 | 完成率 |
|--------|------|----------|------------|----------|--------|
| P0 | 17 | 14 | 2 | 1 | 82% ✅ |
| P1 | 11 | 3 | 5 | 3 | 27% ⚠️ |
| P2 | 6 | 0 | 0 | 6 | 0% ❌ |

> 注：P0 完成率较高，核心 MVP 可用；P1 完成率偏低，影响用户体验和商业化就绪度。

### 按功能域

| 功能域 | 完成度 | 评价 |
|--------|--------|------|
| 核心架构（Backend/Session/Bus）| 95% | 扎实，双后端 + MCP 集成超出预期 |
| PM 编排（TeamTools）| 85% | 核心流程完整，缺并行委派 + Claude 后端支持 |
| 安全（CommandPolicy + FileCoord）| 100% | 超出同类产品，威胁模型清晰 |
| UI/UX | 65% | 面板功能有，交互流程与 PRD 不符，缺一键建团队 |
| 可观测性（Dashboard/成本）| 40% | 统计卡有，趋势/成本/排行缺 |
| 工作流 | 50% | 线性模板可用，条件路由/回放缺 |
| 持久化 | 70% | L1/L2 ✅，L3 ❌，消息不落盘 |
| 测试 | 60% | 单元测试好，E2E 为 0 |

---

## 六、结论与建议优先级

### 立即修复（Phase 2 前）
1. **暴露"一键默认团队"命令** — 代码已有 `createTeam()`，只需注册命令 + UI 入口
2. **修正 PRD §10.1 流程 A** — 对齐代码实际行为，避免团队/用户误解
3. **定义 maxConcurrentAgents 超限行为** — 3 行代码 + 1 条 PRD 说明

### Phase 2 重点
4. Dashboard 成本估算（支撑"成本套利"叙事）
5. 消息落盘 + L3 工作流还原
6. Provider 模型列表拉取（改善添加 Agent 体验）
7. E2E 测试框架搭建

### Phase 3 考虑
8. PM 委派工具对 ClaudeHeadlessBackend 的支持（经 MessageBus 中转）
9. 工作流条件路由
10. 性能基准实测化

---

*评估人：Cline (AI Code Review) | 评估基于 PRD v2.2 + 代码快照 2026-06-02*