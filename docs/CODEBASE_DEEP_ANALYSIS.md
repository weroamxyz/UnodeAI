# UnodeAi — Codebase Deep Analysis Report

**日期：** 2026-06-15  
**合成来源：**  
- `docs/v0.7.0_BUG_AUDIT.md` (System Architect 审计，62 条发现)  
- `docs/v0.7.0_BUG_AUDIT_KIMI_REVIEW.md` (Kimi 再评估，9 条新发现)  
- `docs/CODEX_2026-06-15_CODEBASE_DEEP_AUDIT.md` (CODEX 深度审计)  
- `docs/AUDIT_NOTES.md` (Reviewer 指南 / 已知限制 / 依赖分类)  
**方法：** 静态分析 + 交叉验证上述四份文档，未修改任何源文件。

---

## 一、执行摘要

UnodeAi 代码库已具备成熟的多 Agent 编排型 VS Code 扩展雏形。核心资产按价值排序：

1. **多 Agent 会话生命周期** — `SessionManager` + `MessageBus`：任务分解、消息路由、turn 投递、context 注入、自动 summarization。
2. **PM / Reviewer / 实施者角色协作** — `RoleConfig` 模板 + `SkillResolver`：技能→工具推导，分层 tier 模型选择，PM 委托/并发原语。
3. **Worktree 隔离 + Merge Gate** — `WorktreeCoordinator` + `MergeOrchestrator`：per-agent 分支隔离、auto-merge、finalize 回路（v0.7.0 核心差异点）。
4. **命令沙箱 + 文件并发** — `CommandPolicy` (default-deny allowlist) + `FileCoordinator` (乐观并发 + 读集失效)：主要的反 LLM-RCE 控制。
5. **MCP 生态** — `MCPHub` + `ClaudeMcpConfig` + `McpApproval`：default-deny 批准门控，敏感 server 需持久化用户批准。

**当前主干健康度：** TypeScript 构建通过、ESLint 零错误。测试套件 360 用例通过（单测）但存在 MergeOrchestrator 集成测试 CI 超时波动。依赖审计：生产依赖仅 1 个 moderate（uuid，不影响实际调用路径），dev 依赖有 high/critical 但不进入 `.vsix`。

---

## 二、目录结构（src/）

| 目录/文件 | 职责 | 测试覆盖 |
|-----------|------|----------|
| `backend/` | AgentBackend, OpenAICompatBackend, ClaudeHeadlessBackend, WorkspaceTools, CommandPolicy, FileCoordinator, TeamTools, Verifier, WorktreeCoordinator, MergeOrchestrator, WorktreeManager, TaskClaimRegistry | ~60 tests |
| `session/` | SessionManager（生命周期 + 消息路由 + 回退 + cost timeline）, RulesFile, Summarizer | ~10 routing tests |
| `bus/` | MessageBus（pub/sub + 持久化 export/import） | 4 persistence tests |
| `workflow/` | WorkflowEngine, GatedWorkflow, TierController（线性/门控工作流，tier 热切换，条件路由，L3 恢复） | 21 tests |
| `mcp/` | MCPHub, ClaudeMcpConfig, RealMcpClient, McpApproval, McpPlaceholders, TeamMcpBridge, LocalMcpServer | 25 tests |
| `roles/` | RoleConfig（角色模板 + tier + 模型推导）, SkillResolver（技能→工具推导） | 28 tests |
| `models/` | ModelCatalog, ModelPricing, LivePriceService（模型列表 + 成本估算） | 17 tests |
| `settings/` | SettingsBridge（config/secret/MCP 访问层） | 5 tests |
| `views/` | TeamViewProvider, DashboardProvider, MessageLogProvider, ChatViewProvider, OnboardingWizard, WorkflowEditor, SettingsPanel | 0 unit tests（E2E 覆盖） |
| `state/` | PersistenceManager, TeamFileSchema, DemoTasks | 部分测试 |
| `secrets/` | SecretsManager（仅 SecretStorage，不写入 config/log/Git） | 部分测试 |
| `marketplace/` | Marketplace 相关（新增） | — |
| `chat/` | RoamChatParticipant（VS Code Chat API 入口） | **0** |
| `terminal/` | 终端管理 | — |
| `params/` | ModelParamResolver, sanitizeModelParams | 部分测试 |
| `dialogs.ts` | QuickPick/InputBox 流程（添加 agent、默认团队、发送消息、运行工作流、设置 key） | 0（E2E 覆盖） |
| `extension.ts` | **组合根**（激活、命令注册、后端工厂、UI wiring、marketplace、chat participant） | 0（E2E 覆盖） |
| `types.ts` | 全局类型定义 | — |

---

## 三、Bug 全景（合并去重后共 ~70 条发现）

### 3.1 已修复（v0.7.0 交付中）

| # | 问题 | 源文档 |
|---|------|--------|
| B1 | Worktree remove 后 branch 泄漏 → `WorktreeManager.remove` 新增 `pruneBranch` | v0.7.0_AUDIT #1, KIMI N1 |
| B2 | `release()` vs in-flight `mergeAgent` 竞争 → `release()` 序列化到 `mergeChain` | v0.7.0_AUDIT #2 |
| B3 | `runVerifyChecks` 使用 `cp.exec({ timeout })` Windows 不杀进程 → 改用 `verifyCommandRunner` (`spawn` + SIGKILL) | v0.7.0_AUDIT #3 |
| B5 | `run_checks` 无 wall-clock timeout → 300s cap + SIGKILL | v0.7.0_AUDIT #5 |
| B11 | `void worktreeCoordinator?.onTurnComplete(...)` 丢弃 promise → 加 `.catch` | v0.7.0_AUDIT #11 |
| B20 | `package.json` schema 缺少 `minimum` → `maxParallel: minimum:1`, `verifyTimeoutSeconds: minimum:10` | v0.7.0_AUDIT #20 |
| N2 | Windows 上 `shell: true` + SIGKILL 只杀 cmd.exe 不杀子进程 → `killProcessTree` (Windows `taskkill /T /F`) | KIMI N2 |
| N5 | `verifyTimeoutSeconds` 无 `maximum` → 加 `maximum: 3600` | KIMI N5 |

### 3.2 未修复 — 已确认真实但延后到 backlog

| # | 问题 | 严重度 | 理由 |
|---|------|--------|------|
| B7 | `assignWorkingDirectory` cap check 竞态 | medium | 软上限，最多多一个 worktree |
| B9 | `update-ref` 在 base 被其他 worktree checkout 时失败 | medium | 罕见；`update-ref` 实际不拒绝 |
| B12 | Detached HEAD 返回字面量 `"HEAD"` | medium | 罕见边界条件 |
| B13 | `--no-ff` merge 与 fast-forward 文档注释矛盾 | medium | 功能正常；修正注释 |
| B14 | `system.error` 立即终止 workflow 无重试 | medium | 规格决定 |
| B16 | 已存在 worktree 未检查干净状态 | medium | 风险低（用户自己的 worktree） |
| B17 | 用户已在 `roam/integration` 分支上无保护 | medium | 加清晰错误提示 |
| B18 | Review panel 显示 mid-merge 快照 | medium | 外观问题 |
| B19 | `commitWorktree` 使用 `git add -A` | medium | 可加 `.roamignore` 或路径 allowlist |
| N6 | `release()` 在全局 `mergeChain` 上过度序列化 | low | 正确但不极致响应 |
| N8 | Output cap 不一致（4000 vs 8000 chars） | low | 外观优化 |
| N9 | `verifyCommandRunner` / `defaultRunner` 重复代码 | low | 重构至共享 helper |

### 3.3 已确认非 Bug（原误报）

| 原 # | 声称 | 实际 |
|------|------|------|
| B4 | `commandPolicy` 引用陈旧 | 不正确：`commandPolicy` 通过 `.reload()` 原位修改，所有消费者共享同一引用 |
| B6 | `run_checks` 用 PM 的 `workingDirectory` | PM 非隔离，cwd = `workspaceRoot()`，实际无影响 |
| B8 | auto-finalize 未序列化 | 不正确：`finalize()` 和 `mergeAgent` 内的 auto-finalize 都在 `mergeChain` 上运行 |
| B10/B15/N3/N4 | `ask`/`none` 模式被 verify gate 静默绕过 | 不正确：两 gate 均在 `!verdict.allowed` 时阻止（含 `ask`） |

### 3.4 CODEX 发现的独立风险（未与上述重复）

| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| C1 | `.roam-mcp.json` 凭据残留（含 bearer token，异常退出时未清理，未被 `.gitignore` 忽略） | P1 Security | **未修复** |
| C2 | `MergeOrchestrator` 测试 CI 超时波动（完整运行超时，单独通过） | P1 CI | **未修复** |
| C3 | `npm audit` high 漏洞链（`esbuild`, `minimatch`, `serialize-javascript`） | P1 Supply Chain | **未修复** |
| C4 | Chat Participant（`src/chat/`）缺少测试（空 prompt、错误、取消、超时、并发、订阅泄漏） | P2 | **未修复** |
| C5 | `extension.ts` 组合根过大（激活+命令+后端工厂+UI wiring+marketplace+chat participant） | P2 | **未修复** |
| C6 | Claude backend 无法可靠取消单个 turn | P2 | **未修复** |
| C7 | Git 子进程缺少统一 timeout 机制 | P2 | **部分修复** (B5 修了 `runChecks`，MergeOrchestrator 未覆盖) |
| C8 | `fetch_url` SSRF 防护仍有 DNS TOCTOU 风险 | P2 | **未修复** |
| C9 | 根目录构建产物较多（`.vsix`, `out/`），发布纪律需收紧 | P3 | **未修复** |

---

## 四、架构评估

### 4.1 核心优势（无需改进）

- **CommandPolicy**：default-deny allowlist + shell 控制字符过滤 + 灾难性命令黑名单。10 tests。
- **文件沙箱**：路径穿越拒绝 + CAS 写入 + 读集失效。10 tests。
- **Secrets**：仅 SecretStorage，不写 config/log/Git，不传 webview。
- **MCP default-deny**：server 仅暴露给显式引用它的 agent；敏感 server 需持久化用户批准。
- **依赖安全**：生产 `.vsix` 仅 1 moderate (`uuid`)，实际不触发漏洞路径。dev 依赖（`vitest` critical、`esbuild`/`minimatch` high）不打包。

### 4.2 架构风险

1. **`extension.ts` 单文件组合根**（CODEX C5）— 随着 Chat、Marketplace、workflow、enterprise policy 增长，合并冲突和回归风险急剧上升。建议拆分为 `extension/activate.ts`、`extension/registerCommands.ts`、`extension/backendFactory.ts` 等。

2. **Claude Headless 后端的脆弱性**（CODEX C6）— 依赖外部 CLI 行为，取消不可靠，临时文件生命周期是关键风险。

3. **`.roam-mcp.json` 凭据残留**（CODEX C1）— 当前最高优先级安全问题。临时 MCP 配置写入仓库根目录固定文件名，含 local team bridge bearer token。建议写入 OS temp 或 `.roam/tmp/` 随机文件名，并加 `.gitignore`。

4. **Chat Participant 无测试**（CODEX C4）— `src/chat/RoamChatParticipant.ts` 依赖消息总线事件来 resolve，若 agent 卡住未发终止事件，Chat 请求无限挂起。

### 4.3 竞争定位（基于 Kilo/Roo Gap Analysis）

| 维度 | UnodeAi | Kilo Code | Roo Code |
|------|-----------|-----------|----------|
| 多 Agent 并行 | **领先**（PM 并发委派） | 单 Agent（无证据） | VS Code 窗口级并行（进程分离） |
| Worktree 隔离 | v0.7.0 新增（per-agent 分支 + auto-merge） | 无 | 用户手动 worktree |
| MCP Marketplace | 无（手动配置） | **领先**（声称有 marketplace） | 无（手动配置） |
| 按需技能加载 | 无（全量加载） | 无 | **领先**（progressive disclosure） |
| 模式/角色切换 | 固定角色（启动时） | **领先**（运行时 slash 命令切换） | **领先**（slash 命令 + Boomerang） |
| Checkpoint 系统 | 无 | 无 | **领先**（shadow Git 快照） |
| 共享记忆 | **领先**（`.roam/memory/notes.md` + `memory_note` 工具） | 无证据 | 无证据 |

---

## 五、推荐路线图

### 立即处理（阻塞 v0.7.0 / 安全发布）

| 优先级 | 行动 | 来源 |
|--------|------|------|
| **P0** | 修复 `.roam-mcp.json` 凭据残留（写入 temp、随机文件名、`.gitignore`） | CODEX C1 |
| **P0** | 稳定 `MergeOrchestrator` CI 测试（更长 timeout 或 serial 化） | CODEX C2 |
| **P0** | 处理 `npm audit` high 漏洞（升级 `esbuild`、`@typescript-eslint`；对无法自动修复项建立风险豁免） | CODEX C3 |
| **P1** | 给 Chat Participant 加测试（空 prompt、错误、超时、并发、订阅泄漏） | CODEX C4 |

### 近期处理（v0.7.x / v0.8.0）

| 优先级 | 行动 | 来源 |
|--------|------|------|
| **P1** | 拆分 `extension.ts`（降低回归风险） | CODEX C5 |
| **P1** | Git 子进程统一 timeout/kill（覆盖 MergeOrchestrator） | CODEX C7 |
| **P1** | Claude backend 可取消 turn | CODEX C6 |
| **P1** | 采用按需技能加载（progressive disclosure）降低 token 消耗 | Kilo Gap #1 |
| **P2** | 实现 Git worktree per-agent 自动隔离 + auto-merge 回路 | Kilo Gap #2 |
| **P2** | 构建轻量 MCP 注册表/市场 | Kilo Gap #3 |

### 中期处理

| 优先级 | 行动 |
|--------|------|
| P2 | 建立 verifier evidence 数据模型（每个 agent 输出：改了啥、跑了啥、未验证啥） |
| P2 | 将 command/MCP/web policy 抽象为可配置 policy bundle（Solo/Team/Enterprise/Air-gapped） |
| P2 | 团队级审计日志 |
| P2 | Marketplace pack 签名与来源信任 |
| P3 | Worktree/merge 能力可视化 mission control |
| P3 | 端到端可观测性（cost/latency/error 仪表盘） |
