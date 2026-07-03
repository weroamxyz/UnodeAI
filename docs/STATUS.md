# UnodeAi — 开发进展 & 下一步工作方向

## 📍 现状快照 2026-06-17(最新,优先看这条)

**已发布 0.8.31**(bundled VSIX;CI 上 `npm audit --omit=dev` 高危门 + headless E2E 门 双绿)。
**v0.9「弱模型执行加固」6 项全部交付**(见 [ROADMAP_v0.9_WEAK_MODEL_HARDENING.md](ROADMAP_v0.9_WEAK_MODEL_HARDENING.md)):
search_files(0.8.6)/ 写文件 shrink 守卫(0.8.13)/ 命令守卫误报修(0.8.2/4/7)/ 弱模型 force-XML(0.8.14)/
项目约定注入 A1/A2 / stale-memory 隔离 + read-before-claim(0.8.16)。

**本轮(0.8.18→0.8.31)叠加的护城河 + GA 加固**:
- **verifier-as-gate**(0.8.27)— PM 在共享树上「检查不绿不准报完成」,死锁安全的 retry→escalate→human-handoff
  (纯决策核 `completionGate.ts` 已单测证明必然终止);worktree 合并门(v0.7)与 workflow 门(P2)已存在,三面齐了。
- **「先读真实代码再动手」强规则**(0.8.26,worker 协议)· **Router v1**(0.8.29,可审计选人 + 避开 down agent)。
- **Smart Mode per-turn 模型**(不再污染 config.model)· **Agent Builder 改 running agent 即时生效**(U4)·
  编排可见性 U1/U2/U3(底栏 Activity / 委派进度 / 自定义头像)· MCP↔Marketplace 打通 · 注册/充值入口。
- **GA**:hono 高危经 overrides→4.12.25 清零(且只用 MCP client,不可达)· bundled 发布路径(564 文件/1.3MB)·
  CI 双门 · Mission Control 编辑器标题栏图标(0.8.31)。

**下一步 = 1.0 商用冲刺**(punch-list 见 [BACKLOG.md](BACKLOG.md) 顶部):吸引力特性(Evidence Report / Team Packs /
成本可视化 / Mission Control 第一屏 / 安全叙事)· 近期打磨(combobox ✅ / Add-MCP 引导表单)· Router v2 ·
GA logistics(repo→weroam+开源 / 对齐 repository / roam-skills repo)。

---

> **📌 现行路线图(0.6.7 之后,执行引擎主线)→ [ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md](ROADMAP_v0.7_WEAK_MODEL_EXECUTION.md)**(Codex 战略分析 + 优先级:worktree fan-out 已发 → **verifier-as-gate** ⭐ → worker 协议 → 信任 UI)。
> **📌 现行待办清单(v0.2.12 之后)看这里 → [BACKLOG.md](BACKLOG.md)**。本文以下内容是 v0.1.x–v0.2.0 的历史进展记录。
>
> **唯一权威的「现在做到哪、接下来干啥」**。本文综合 PRD §16 实现状态、两份评审（GLM / Cline）的建议、两份设计文档（MCP / Team Workflow）的待办清单，并以代码实测为准校正。
>
> **更新日期**：2026-06-02 · **基准**：代码实测（`npm test` 111 用例全绿）+ PRD v2.4
> **相关**：[README 文档地图](../README.md) · [PRD](../PRD_MultiAgent_VSCode_Extension.md) · [MCP 设计](MCP_Skills_Integration.md) · [Team Workflow 设计](Team_Workflow_And_Cost_Optimization.md)

---

## 〇、v0.1.1 发布就绪评估（2026-06-05，Claude 自主收尾后）

> **结论：v0.1.1 RC-ready，可发布。** PRD v0.1.1 功能面 100% 落地，Codex 深审发现的 2 个并发/路由阻塞已修并加回归测试。门禁全绿：`build` ✓ · `lint` 0 error ✓ · `test` **223 全绿** ✓ · `vsce package` ✓（`roam-crew-0.1.1.vsix`，4292 文件 / 5.54 MB）· tracked 工作区干净。发布是手动动作,步骤见 [PUBLISH_CHECKLIST_v0.1.1.md](PUBLISH_CHECKLIST_v0.1.1.md)。

| 需求 | 状态 | 备注 |
|------|------|------|
| F1 高级模型参数 | ✅ | 完整面;openai-compat 全量、claude 仅 `--effort`（其余 UI 置灰） |
| F1b Context Window + ⓘ | ✅ | 字段早有,补 UI + 指导 |
| F2 全局默认+层级 | ✅ | `ModelParamResolver`;**reasoning_effort/response_format 默认改为"不发送"**（防网关 400） |
| F3 Smart Mode | ✅ | 选档热切 + 矩阵 UI + tier params |
| F4 Session Memory | ✅ | start 注入 + 每轮刷新（Codex 实现运行时热更） |
| B1 并发排队 | ✅ | 队列 + 取消/排空语义 + **忙碌串线修复** |
| B2 拒令提示 | ✅ | warning toast + Open Settings |
| B3 OutputChannel 转义 | ✅ | 核实已缓解 |
| B4 E2E devDeps | ✅ | lockfile 同步;smoke 3/3 |
| 额外 | ✅ | Chat 面板（任选 agent 多轮对话）、默认网关→`www.unodetech.xyz/v1`、每角色温度默认 |

**本轮修复的 2 个阻塞（Codex 深审）**：① 忙碌 agent 第二个任务覆盖 `pendingOrigin` → completion 串线/广播错；改为仅 idle 才 deliver、忙则入队。② 单轮 turn error 误标 `error` 并 `drainPendingStarts` → 突破 `maxConcurrentAgents`；改为仅 backend 真死亡才释放槽。各加回归测试。

**发布前推迟项（非阻塞,已文档化）**：esbuild bundling（被 ajv 动态 require 阻断,安全路径见 [PUBLISH_CHECKLIST](PUBLISH_CHECKLIST_v0.1.1.md)）· `@types/vscode` pin 到 `~1.85`（devDep,联网刷新）· E2E 扩到 routing · MCP live 验证（v0.2.0）· reasoning_effort 默认关闭,确认网关支持后可在 Model Tuning 开启。

**上下文压缩**：✅ v0.1.x 已上「锚点保留 + token-aware 裁剪到 70% 软门」(保住原始任务,丢中间;80% 硬门为急刹)。摘要式压缩(70% 触发,economy 模型总结老轮次)列入 [v0.2.0 backlog](v0.2.0_BACKLOG.md) §1。仅治 openai-compat;claude 自带 compaction。

详见 [CHANGELOG.md](../CHANGELOG.md) · v0.2.0 候选见 [v0.2.0_BACKLOG.md](v0.2.0_BACKLOG.md)。

## v0.2.0 规划 + 实施(2026-06-05)

v0.1.2 已上架。**v0.2.0 由 Codex 团队实施,Claude 监督审查**。DeepSeek 起草了 PRD/DevPlan,Claude 已审阅校正(base URL 默认、E7 流式实为新建、与代码核对)。

> **📌 文档治理**:规划文档(STATUS / PRD / DevPlan / FeatureSpec / 任务卡 / GUIDANCE / backlog)**由 Claude 统一维护**。其它助手(DeepSeek 等)有想法请写进 [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md),**不要直接改这些权威文档**——直接重写会和已合并代码打架、扰乱 Codex 在制开发(已发生过一次)。

三份权威文档:

- [PRD v0.2.0 Product Brief](PRD_v0.2.0_Product_Brief.md) —— 7 个 Epic(E1 摘要压缩 / E2 PM→Claude IPC 桥 / E3 MCP live / E4 工作流分支 UI / E5 硬化收尾 / E6 onboarding / E7 Chat 增强)。
- [DevPlan v0.2.0](DevPlan_v0.2.0.md) —— 逐文件/逐任务/逐验收,M1–M5。
- [CODEX_v0.2.0_GUIDANCE.md](CODEX_v0.2.0_GUIDANCE.md) —— **给 Codex 的明确指导**:角色、不可破坏的约束(安全模型/注入式/webview 防注入/全英文/不双重压缩 claude/并发不变量)、已校正项、里程碑评审检查点、DoD。

> 用户要求(已并入):provider + API Key 流程 Base URL 默认 `https://www.unodetech.xyz/v1`。

### v0.2.0 进度总表（基线 v0.1.2 已上架 · 当前 main 测试 251 绿）

| Epic / 任务 | 状态 | 备注 |
|---|---|---|
| **E1** 上下文摘要压缩 | ✅ 已并 `3cb8923` | Summarizer + softLimit 规划 + compactHistory 钩(claude 排除) |
| **E2** PM→Claude 本地 MCP 桥 | ✅ 已并 `cc814ed` | LocalMcpServer(loopback+token)+ 引用计数 factory;剩 live 手验([A]) |
| **Chat 追平 C1** 侧边栏富聊天 | ✅ 已并 `d8af9e1` | `roam.chat` 视图 + Markdown(token→DOM,无 innerHTML)+ 每-agent 持久化 |
| **Chat 追平 C2** 流式+中断 | ✅ 已并 `e1ead3d` | SSE 解析/重建(纯,工具循环不破)+ chatStream 流式 delta + abort/Stop;claude abort best-effort。263 绿 |
| **Chat 追平 C3 + C3b** 工具卡片 + 上下文条/压缩标记 | ✅ 已并 `5c3e2e1` | tool_result 事件 + 真实 diff(写前读旧内容,纯 diff.ts)+ 工具卡(DOM/escape,瞬态不入历史)+ 上下文条(claude→managed)+ 🗜 压缩标记。278 绿 |
| **Chat 追平 C4** Plan/Act 硬隔离 | ✅ 已并 `9f29847` | 工具层硬隔离:plan 模式过滤 toolSpecs + `routeToolCall` 拒令(write/run/delegate/**MCP** 全挡,非仅提示词)+ 单测证明;mode 服务端归一化(伪造 webview mode 绕不过);claude best-effort 标注。284 绿 |
| **E4** 工作流条件分支 UI | ✅ 已并 `0154871` | WorkflowEditor 面板(无 innerHTML)+ team.json 首个写入器(保 members/mcpServers/version)+ goto 校验/拒覆盖内置 + 纯序列化模块。294 单测 +4 E2E |
| **E6** Onboarding / 30 秒到价值 | ✅ 已并 `dd4dab4` | 5 页向导(DOM 渲染)+ Base URL 预填(roam.baseUrl=unodetech/v1)+ pricing 链接(sanitizeHref)+ demo 库 + 空状态 3 卡;复用 createDefaultTeam/roam secret/task.assign。299 单测 +5 E2E |
| **E5b** esbuild 打包 | ✅ 已并 `8747967`;**切默认门已清** | opt-in build:bundle;RealMcpClient 字面量 import + ajv external + .vscodeignore.bundle 白名单。3870/5.15MB→553/0.95MB。**bundled VSIX 上 github MCP live 跑通(ajv 校验路径 OK,白名单完整)** → 可在 v0.2.0 发布时把 build/main 切到 bundle |
| **E5c/d/e** improver/audit/E2E hardening | ✅ 已并 `383c795` | modelTierCell 校验抽纯模块并接入 saveSmart(回归测试守真实路径);uuid audit 1 moderate 不可利用(处处 arg-less uuidv4(),uuid 留 ^9 不破坏升级);routing+concurrency E2E(公共面驱动);评审顺手补 setMaxConcurrent 升档 drain。301 单测 +8 E2E。**Wave 1 收口** |
| **E3** MCP live 验证 | 🟢 E3.1 ✅ 通过(`0f02a54`) | github MCP(stdio)经 openai-compat 注入式路径 live 跑通:模型调 `github__list_issues` 返回真实数据;[报告](MCP_LIVE_VALIDATION_REPORT.md)。**顺带修 2 个 live bug**(密钥对话框 emoji 判断跳步 / 空 roam.baseUrl→api.openai.com)。在 **unbundled 与 bundled 两种 VSIX 上都验过**(后者顺带清掉 E5b 切默认门)。**E3.2 playwright ✅ 也通过**(`playwright__*` 工具,返回 example.com 真实数据;navigate 权限错→agent 自动换 run_code 成功,外部 server 行为非阻塞)。两个 server 已验。E3.3 claude-native 待跑(第二后端)。流式思考模型 finding 见 [backlog](v0.2.0_BACKLOG.md) |
| **E5a** 5-agent 压测 | ✅ 实测通过 | 5 agent(deepseek-v4-flash)cap=5 广播并发,全部完成无报错/卡死。extensionHost 基线 530MB→稳态 540MB(**5 路增量仅 ~+10MB**,in-process 轻量;530 是整进程含 VSCode+他扩展)。消息投递=进程内同步 pub/sub,亚毫秒≪200ms 目标 |
| **E7** Chat 增强 | ➡️ 已并入 Chat 追平 C2 | 取代/扩展 |

> **优先级**:Chat 追平(C1–C4)✅ 全完。🟢 **Wave 1 ✅ 全部收口**(E4 `0154871` → E6 `dd4dab4` → E5b `8747967` → E5c/d/e `383c795`,均 Claude 复审合并)。🟢 **Wave 2 主体已完成**:E3.1 github MCP live ✅(亦清 E5b 切默认门)、E5a 5-agent 压测 ✅、streaming/baseUrl/密钥对话框 3 个 live bug 已修。**剩**:E3.2 playwright / E3.3 claude-native(可选)+ 发布前把 build/main 切 bundle → `vsce publish 0.2.0`。

**进度明细(Codex 实施 / Claude 评审)**：
- ✅ **M1 / E1 上下文摘要压缩**(`3cb8923`)——纯 `Summarizer` + `TokenCounter.softLimit(messages)` 规划 + `compactHistory?` 钩(claude 排除)+ 硬门 trim 保留摘要(评审修复)。234 绿。
- ✅ **M2 / E2 PM→Claude 本地 MCP 桥**(`cc814ed`)——`LocalMcpServer`(loopback + 随机 token + 401 + 端口释放)+ `buildTeamBridgeConfig` 合并 `--mcp-config` + ClaudeHeadless 仅 PM 惰性起/停(含 exit 释放)+ 共享引用计数 factory。244 绿。剩 live Claude PM→Dev 手动验证([A])。
- **Chat 体验追平(C1–C4)** = 一等主线(高于 E3/E4/E6),详见 [FeatureSpec](FeatureSpec_Chat_PlanAct_Mode.md):
  - ✅ **C1 侧边栏富聊天视图**(`d8af9e1`)——`roam.chat` WebviewView(侧边栏,非编辑器/非 terminal)+ token-model→DOM 的 Markdown/代码渲染(无 innerHTML,XSS 安全)+ agent 切换器 + Team 卡片 Chat 按钮 + 每-agent 持久化(cap 50,移除即清)+ onReply 按 from 路由;删除旧 editor ChatPanel。251 绿。
  - ✅ **C4 Plan/Act 硬隔离**(`9f29847`)——`planMode.ts` 默认拒绝白名单(仅 read_file/list_dir/list_agents);OpenAICompat 在 plan 模式**过滤 toolSpecs** + `routeToolCall` **在分发前拒令**(write/run/delegate **及命名空间 MCP 工具全挡**,被迫/幻觉调用也拦,单测证明非仅提示词);SessionManager 服务端归一化 mode(伪造 webview mode 绕不过);ChatViewProvider 每-agent Plan/Act 开关(默认 Act,无 innerHTML);ClaudeHeadless 仅 best-effort `[PLAN MODE]` 提示(原生工具权限 spawn 时固定,代码内注明)。284 绿。
  - ✅ **Chat 追平 C1–C4 全部完成并合并**。**全部任务卡**:[C1](CODEX_TASK_C1_Sidebar_Chat.md)·[C2](CODEX_TASK_C2_Streaming_Interrupt.md)·[C3](CODEX_TASK_C3_Tool_Cards_Context.md)·[C4](CODEX_TASK_C4_PlanAct_Mode.md) 均已并 main。⏭ 下一步:E3(MCP live 手验)/ E4(工作流分支 UI)/ E5(硬化收尾)/ E6(onboarding)。

---

## 〇.5、v0.3 / v0.4 路线(2026-06-07)

v0.2.5 已上架。下一阶段对标 Cline / Roo Code / Kilo Code,整合 Codex/DeepSeek 分析 + 用户反馈 →
[ROADMAP_v0.3_v0.4.md](ROADMAP_v0.3_v0.4.md)。核心判断:**加 Solo/Fast 单 agent 模式**(简单任务跳过
多 agent 重流程,补上对 Cline 的最大短板)+ 并行派发修复 + 信任(checkpoints)。最近 patch 先做
quick-wins:Quick Start 标签修正、chat "thinking…" 指示、dashboard 上下文用量、unode 折扣价 bug。

## 一、一句话现状

> **已上架 Marketplace（`RoamAI.roam-crew` v0.1.0，首发 UTC 2026-06-05）。v0.1.1 已 RC-ready（见上）。核心闭环跑通，架构与安全是强项。**

实测基线（2026-06-04 复核）：

| 指标 | 值 | 备注 |
|------|----|------|
| 单元测试 | **169 全绿** | 25 个测试文件，Vitest，~1.6s（Codex 硬化轮 +8、review 跟进 +1：realpath 沙箱 / MCP 授权 / schema / gated 门拦截）· `npm run lint` 0 error · `package-lock.json` 已落地 · E2E scaffold（待联网真机跑） |
| 构建 | ✅ `out/` 可编译 | `npm run build`（tsc） |
| 真实后端验证 | ✅ 双后端 | OpenAICompat ↔ Roam ComputeVault；ClaudeHeadless ↔ `claude` v2.1.158 全链路 |
| 打包就绪 | ✅ 已发布 | `images/icon.png` 已补、`roam-crew-0.1.0.vsix` 产出、`package-lock.json` 已落地；**已上架 Marketplace**（`RoamAI.roam-crew` v0.1.0，发布 `2026-06-05T00:11:11Z`，安装数 0） |

---

## 二、已完成（Done）

### 核心架构
- **AgentBackend 抽象** + 两个实现：`OpenAICompatBackend`（默认，进程内 HTTP，自带 ≤12 轮工具循环、有界历史、token 计量）、`ClaudeHeadlessBackend`（spawn `claude` stream-json，已修复 ready/init 块缓冲死锁）
- **SessionManager**：生命周期状态机 + 总线桥 + 双向路由（入站→后端，`turn_complete`→`task.complete`）+ 崩溃自动重启 + 对话快照持久化
- **MessageBus**：进程内 pub/sub（send/broadcast/reply/onType/onAddressed、TTL、correlation、环形缓冲）
- **WorkflowEngine**：线性预置模板（feature / bug-fix / code-review / docs）

### PM 编排（核心差异化）
- **TeamTools**：`list_agents` / `assign_task`（await + correlationId 防竞态）/ `broadcast` / `run_checks`，仅注入给进程内后端的协调者 agent

### 安全与并发
- **CommandPolicy**：三模式（none / allowlist默认 / all）+ shell 控制符过滤 + 灾难命令黑名单（防 LLM-RCE）
- **FileCoordinator**：乐观 CAS + 读集失效预警（跨文件依赖防御 L1）
- 文件沙箱（限工作目录、拒路径遍历）+ run_checks 验证门（跨文件防御 L2）+ 契约先行 prompt（L3）

### 持久化与可观测性
- L1 进程重启 + **L2 对话上下文还原**（每轮快照存 workspaceState，有界历史）
- SecretStorage（每 provider 独立 key）+ `.roam/team.json` 团队配置
- Team Webview / Activity Feed / Dashboard / 状态栏 / 每-agent OutputChannel

### Skill 段1（[MCP 设计](MCP_Skills_Integration.md) §5）
- `SkillResolver`：`skills[]` → 能力令牌（read/write/execute/search/delegate），环路安全；角色模板不再手写 allowedTools

### MCP 段2 核心（[MCP 设计](MCP_Skills_Integration.md) §6，后端感知）
- `MCPHub`（仅 openai-compat，注入式 client、`serverId__tool` 命名空间、default-deny、per-skill 过滤、超时、`${VAR}` 经 SecretStorage）
- `ClaudeMcpConfig.buildClaudeMcpConfig`（claude 原生 `--mcp-config`）
- `RealMcpClient`（懒加载 SDK，未装也能 build/test）

### TTV 冲刺（PRD v2.4，回应评审）
- 添加 Agent：模型选择改 **QuickPick** + 可远程配置 `ModelCatalog`（`/v1/models` + `roam.modelCatalogUrl` + 静态兜底）
- 自定义 Agent 名称 + 去重
- **One-Click Demo Team** 命令 + 空状态 CTA（回应「新用户 onboarding 差」）
- **costUsd 估算**：`ModelPricing` 价目表 + `LivePriceService`（实时 `/api/pricing`）+ SessionManager 注入 + Dashboard 显示（回应「成本套利需成本可见」）

---

## 三、下一步工作方向（按优先级）

> 优先级综合了：PRD §18 Roadmap + GLM/Cline 两份评审的优先级调整建议 + 两份设计文档的待办。每项标注**来源**与**落地位置**，便于直接开工。

### 🔴 P0 — Marketplace 发布前必做

| # | 工作项 | 落地位置 | 来源 / 理由 |
|---|--------|---------|------------|
| 1 | ✅ **补 `images/icon.png`**（2026-06-02 完成） | `images/icon.png` + `scripts/gen-icon.js` + `images/_brand/` | 128×128，**官方 WeRoam logomark**（白标 + 品牌紫 `#832BEB` 圆角底，从 media kit 下载）；零依赖脚本解码源 PNG、采样品牌紫、合成 + 抗锯齿。`vsce` 校验通过 |
| 2 | ✅ **打包跑通**（2026-06-02）+ ✅ **Marketplace 发布**（2026-06-05） | `roam-crew-0.1.0.vsix`（5.44 MB）→ `RoamAI.roam-crew` v0.1.0 | `vsce package` 已产出干净 vsix（修了 `.vscodeignore`）；publisher `roamai`（displayName「RoamAI」）已注册，`vsce publish` 已上架，首发 `2026-06-05T00:11:11Z`（Gallery API 实测）。剩余：演示视频等 GTM 物料（PRD §18 / GLM「不发布=不存在」）。可选优化：esbuild bundling 消除 4115 文件警告 |
| 3 | ✅ **Dashboard 成本可视化**（2026-06-02 完成） | `views/DashboardProvider.ts` + `SessionManager.getCostTimeline()` | 累计成本趋势 sparkline（SVG）+ Cost-by-Agent 排行条 + Provider token 分布条，全部从实时 usage 渲染。支撑「成本套利」叙事（GLM §4.1、Cline D2） |

### 🟡 P1 — 稳定性与可信度（本轮全部落地，2026-06-02）

| # | 工作项 | 落地位置 | 状态 |
|---|--------|---------|------|
| 4 | **MCP 段2 收尾** | `mcp/McpApproval.ts` + `mcp/McpPlaceholders.ts` + `views/SettingsPanel.ts` + `dialogs.ts` | ✅ `requiresApproval` 审批门（首次挂载模态确认 + 持久化已批准集）；✅ MCP 状态进 Settings 面板 Tab2（后端感知）；✅ `${WORKDIR}` 在 args/url 替换（两条挂载路径，`resolveServerPlaceholders`）；✅ 可存任意名密钥（Set API Key → 「Custom secret name…」，支持 `GITHUB_TOKEN`）。**仍待**：对真实 github/playwright server 的 **live 验证**（需联网+token，你本地跑） |
| 4b | ✅ **Settings 面板 + API Key 可见性** | `views/SettingsPanel.ts` + `settings/SettingsBridge.ts` | 命令 `roam.openSettings` + Team 面板 ⚙ 按钮；Providers tab 用 `has()` 显示「已设置/未设置」**绝不 reveal 明文**；MCP tab；More tab 跳转原生设置。`SettingsBridge`（注入式、6 单测）同时充当 #8 的配置访问层 |
| 5 | ✅ **消息落盘 + L3 工作流还原** | `bus/MessageBus`（export/import）+ `state/PersistenceManager` + `workflow/WorkflowEngine`（export/restore + onChange） | 消息防抖落盘 workspaceState、重启 import 回日志（不重放）；运行中工作流持久化、重启 `restore()` 重发当前步续跑。7 单测 |
| 6 | ✅ **模型降级（fallback）** | `SessionManager.recordTurnOutcome` + `AgentConfig.fallbackModel` | 连续 2 次失败且配了 `fallbackModel` → 自动切换并发 `session.modelSwitched`（openai-compat 下轮即生效）。3 单测 |
| 7 | ✅ **E2E 测试框架（scaffold）** | `.vscode-test.mjs` + `test-e2e/`（@vscode/test-cli） | 激活+命令注册+打开 Settings 的冒烟测试；`npm run test:e2e`。**需先 `npm i`** 装 e2e devDeps 并在能下载 VS Code 的环境跑 |
| 8 | ✅ **拆 extension.ts + 事件类型化** | `src/dialogs.ts`（抽出 ~210 行对话框）+ `SessionEventData` 类型化 `on/off` | extension.ts 事件处理器去掉全部 `any`；对话框流程移入 `dialogs.ts`（注入 `DialogDeps`）。剩余可继续抽 commands/backends（增量） |

### 🟢 P2 — 进阶能力（Team Config v2 / "req4" 这片地）

> 集中在 [Team Workflow 设计](Team_Workflow_And_Cost_Optimization.md)，全部并进 `.roam/team.json` 承载。建议落地顺序见该文档 §9。

> **核心三连（9/10/11）已落地，2026-06-02**——「成本套利」从叙事变成可执行的运行时机制。

| # | 工作项 | 落地位置 | 状态 |
|---|--------|---------|------|
| 9 | **`setModel` 热切换 + tier 切换矩阵** | `SessionManager.setModel` + `workflow/TierController.ts` | ✅ openai-compat 改字段即生效；`TierController.applyTiers({role:tier})` 按 provider 解析 tier→模型并热切（5 单测） |
| 10 | **WorkflowEngine `gated` 类型 + 重试** | `workflow/GatedWorkflow.ts` + `workflow/WorkflowEngine.ts` | ✅ gate = run_checks 客观门；pass→onPass 降 tier（省钱）、fail→escalate tier + 重试（≤maxRetries）、耗尽→pause 人工。内置 `feature-gated` 模板 + 真机 runChecks 接线（`runVerifyChecks`）。8 单测（含引擎集成）|
| 11 | **TokenCounter + 70%/80% 上下文门** | `backend/TokenCounter.ts` + `OpenAICompatBackend` | ✅ chars/4 估算 + soft/hard 阈值；硬门在工具循环内拒绝继续、发信号并压缩（防 128K 退化带）。4 单测 |
| 12 | **PM 委派支持 ClaudeHeadlessBackend** | `mcp/TeamMcpBridge.ts` | ⏳ **核心已做**：`TeamMcpBridge` 把 TeamTools 适配成 MCP client（listTools/callTool 路由回 MessageBus，3 单测）。**仍待**：把它托管为本地 MCP 端点（streamable-http 服务或 stdio 子进程）+ claude `--mcp-config` 接线 + live 验证——一个需进程/IPC 的独立 epic（Cline D1 / ADR-5）|
| 13 | ✅ **工作流条件路由**（if/else + loop） | `workflow/GatedWorkflow.ts`（`resolveBranch`）+ `WorkflowEngine` | step 加 `branches[]`（命中子串→goto，无条件分支=else）；支持回跳成环 + `MAX_TRANSITIONS` 防失控。`run()` 现也接受模板对象（为 req4 铺路）。6 单测（含 loop 集成）|
| 14 | ✅ **UI 内编辑已建 agent** | `dialogs.showEditAgentDialog` + `TeamViewProvider`（Edit 按钮）+ `roam.agentEdit` | 改名 / 换模型（`setModel` 下轮即生效）/ 设 fallback 模型，不再删后重建；改完落盘 + 刷新（`onRosterChanged`）|

### 低优先 / 缓做
- worktree 并发策略（PRD：乐观并发 + 验证门对多数场景够用，复杂度高，GLM 建议可不做）
- PM 并行委派（现顺序）
- 可视化工作流编辑器（两份评审一致：先做声明式 JSON）
- 团队模板市场、i18n、a11y 完善

---

## 四、评审建议的处置台账

> 把两份评审的核心建议逐条标注「已采纳 / 进行中 / 计划中」，避免建议悬空。

| 建议（来源） | 处置 |
|------|------|
| One-Click Demo Team（GLM §1.3、Cline B1） | ✅ 已做（v2.4） |
| 成本估算 costUsd（GLM §2.2 问题4、Cline B5/D2） | ✅ 基础已做（v2.4）；趋势/排行/分布 → P0#3 |
| 模型选择从列表拉取（Cline B3） | ✅ 已做（QuickPick + ModelCatalog，v2.4） |
| Agent 名称自定义（Cline B4） | ✅ 已做（v2.4） |
| Skill 从标签升级为能力声明（GLM 问题1） | ✅ 段1 已做（SkillResolver） |
| MCP 集成（GLM §4.2 架构杠杆） | ⏳ 核心+审批门已做，仅剩 live 验证 → P1#4 |
| extension.ts 拆分 + 事件类型化（GLM §4.2） | ✅ 事件类型化 + 对话框抽到 dialogs.ts（P1#8） |
| 消息落盘 + L3 还原（两份评审） | ✅ 已做（P1#5） |
| 成本可视化趋势/排行/分布（GLM §4.1 / Cline D2） | ✅ 已做（P0#3 Dashboard） |
| 模型降级 fallback（PRD §16） | ✅ 已做（P1#6） |
| API Key 可见性（首次上手痛点） | ✅ 已做（Settings 面板，P1#4b） |
| E2E 测试（两份评审，PRD §20.C） | ✅ scaffold 就位，需 npm i + 真机跑（P1#7） |
| 工作流条件分支优先于可视化编辑器（GLM 问题2、避坑1） | ⬜ 计划 → P2#13 |
| PM 委派支持 Claude 后端（Cline D1） | ⬜ 计划 → P2#12 |
| maxConcurrentAgents 超限行为未定义（Cline 问题6） | ⬜ 待定义（3 行代码 + 1 条 PRD 说明） |
| 性能指标多为估算，需实测（Cline A4） | ✅ 已实测（E5a，2026-06-06）：5-agent 并发增量内存 ~+10MB、消息投递亚毫秒（进程内 pub/sub） |
| PM systemPrompt 结构化决策框架 + Guardrail（GLM 问题5） | ⬜ 计划（PM 派给不存在 agent 时 SessionManager 拦截） |
| ClaudeHeadless stream-json 加 schema 校验（GLM 避坑3） | ⬜ 计划（验证 `type` 字段枚举） |
| OutputChannel HTML 转义（PRD §13.5 已知敞口） | ⬜ 计划 |

---

## 五、给接手者的最短路径

1. ✅ **已发布**：P0#1 icon / P0#2 打包+`vsce publish` / P0#3 成本可视化均已完成，`RoamAI.roam-crew` v0.1.0 已上架（2026-06-05 首发）。下一步是演示视频等 GTM 物料。
2. **想增强可信度**：P1#4 MCP 收尾（live 验证）→ P1#5 落盘/还原 → P1#8 拆 extension.ts。
3. **想做成本套利的「真机制」**：P2#9→#10→#11，即 [Team Workflow 设计](Team_Workflow_And_Cost_Optimization.md) 的热切换 + gated 工作流 + 上下文压缩三连。

> 维护提醒：测试数 / 实现状态等「会变的数字」以本文件和 PRD §16 为准；`docs/` 下两份评审是**时点快照**，请勿回填新数字。
## Codex 发布硬化更新（2026-06-02）

当前发布判断：核心产品目标已经合理落地。RoamCrew 已经具备“在 VS Code 内组建多 agent 团队、由 PM 编排、按角色/模型分工、通过消息总线协作、受文件/命令/MCP 权限约束”的主路径。Codex 本轮重点补齐正式发布前的安全与工程门槛。

本轮已完成：MCP 执行授权与审批指纹、Claude 原生 MCP 审批过滤、stdio MCP 环境变量收紧、Webview CSP/nonce、`.roam/team.json` schema 校验、命令执行默认关闭、`run_checks`/`verifyCommand` 统一走 CommandPolicy、文件沙箱 realpath 校验、ESLint、CI、LICENSE、VSIX 文档白名单。

已验证：`npm run build` 通过；`npm run lint` 通过；MCP 授权/审批、TeamTools 命令策略、team.json schema、workspace symlink sandbox、OpenAICompat/并发相关定向测试通过。

仍需发布环境完成：`package-lock.json` 与 E2E devDependencies 同步。本机 `npm install --package-lock-only --ignore-scripts` 因网络/解析超时未完成；当前 CI 暂用 `npm install --ignore-scripts`，正式 release 分支建议在可联网环境刷新 lockfile 后切回 `npm ci`。E2E 暂不作为本轮发布阻断项。

## v0.1.1 规划（2026-06-04）

v0.1.0 已上架 Marketplace（见上）。v0.1.1 为**功能补丁**，主题「让用户不改 JSON 就能掌控模型行为」。两份规划文档已对齐、可直接开工：

- [PRD v0.1.1 Product Brief（Rev. 2）](PRD_v0.1.1_Product_Brief.md)——「做什么」：四项需求 F1–F4 + 收尾 B1–B4。
- [DevPlan v0.1.1（与 Rev. 2 对齐）](DevPlan_v0.1.1.md)——「怎么做」：9 工作日、逐任务文件/行号/验收 + 风险表。

四项需求：**F1** 每-agent advanced 模型参数（temperature/top_p/thinking/reasoning_effort…）+ **F1b** 每-agent Context Window 设置 + ⓘ 指导（字段 `contextWindowTokens` 已存在，纯 UI）、**F2** 全局默认+按-agent 覆盖层级（`ModelParamResolver`）、**F3** Smart Mode 按任务自动选档（**复用**既有 `ModelTier`/`DEFAULT_MODEL_TIERS`/`TierController`，非新建）、**F4** `.roam/rules.md` 跨-session 项目记忆（仿 `.clinerules`）。

**进度**：✅ **M1**（B1 并发排队 / B2 拒令提示 / B3 已缓解 / F2 参数解析层）。✅ **M2**（F1 完整参数面：OpenAICompat 全量 + claude `--effort`；F1b Context Window + ⓘ；Model Tuning 页 + 输入校验）。✅ **M3**（F3 Smart Mode：`selectTier` 按任务选档 + 每 turn 热切，复用既有 tier 表；Smart Mode 设置页：开关/默认 tier/tier→model 矩阵/每-role tier；配置走 `roam.smartMode.*`）。✅ **M4**（F4 Session Memory：`.roam/rules.md` 项目记忆,start 时注入每个 agent 系统提示的 `<project_context>`;FileSystemWatcher 重载,新/重启 agent 生效)——build/lint/**203 测试**全绿。⏭ v0.1.1 四里程碑全部落地,下一步 **Codex review + test**（交接件 [docs/CODEX_REVIEW_v0.1.1.md](CODEX_REVIEW_v0.1.1.md)）。

> Rev. 2 已校正初稿三处硬伤：F3 与既有 tier 基建撞名/重复 → 改为复用；F1 的 claude 后端 flag（实测 claude CLI 仅 `--model/--fallback-model/--effort/--json-schema`，无 `--temperature/--top-p/--max-tokens/--thinking-budget`）→ 完整参数面只对 openai-compat；B4 lockfile 已完成 → 降级、移出关键路径。

## Codex v0.1.1 发布就绪审查（2026-06-05）

结论：**v0.1.1 功能里程碑 M1-M4 已落地，但暂不建议发布**。本轮本地验证结果为
`npm.cmd run build` 通过、`npm.cmd run lint` 通过、`npm.cmd test` 203 个单元测试通过；
`npm.cmd run compile:e2e` 失败，原因是 `package.json` 已声明 E2E devDeps，但 `package-lock.json`
未同步 `@types/mocha` / `mocha` / `@vscode/test-cli` / `@vscode/test-electron`。

发布前阻塞项：

1. `package.json` / `package-lock.json` 仍是 `0.1.0`，需要在同步 lockfile 后 bump 到 `0.1.1`。
2. B1 并发排队需要补取消语义：queued agent 仍是 `stopped`，当前 `stop()` / `stopAll()` 可能不会清掉
   `pendingStarts`，后续释放槽位时会违背用户停止意图自动启动。
3. B1 错误路径需要补 drain：`backend.start()` 抛错或 backend 发 `error` 后容量已释放，但 queued agent
   可能不会继续启动。

完整审查、代码行号与交接清单见 [CODEX_REVIEW_v0.1.1.md](CODEX_REVIEW_v0.1.1.md)。

## Codex v0.1.1 完成修复状态（2026-06-05）

结论更新：**PRD completion pass 已完成，v0.1.1 本地 RC 门禁已通过；Marketplace publish 前仍建议做一次依赖审计判断。**

本轮已修复：

1. B1 queued start 的取消语义和 error/start-failure drain。
2. F4 `.roam/rules.md` 运行中更新语义：每个 turn 传入最新 project context；OpenAI backend 刷新 system block；Claude backend 在后续 turn 注入当前 context；首次激活可创建空 rules 文件。
3. F1 Model Tuning UI 补齐 `stream` / `thinking` / `thinking.budget_tokens` / `stop` / `tool_choice`，并加入 per-field “Use global default”。
4. F2 Smart Mode tier params 通过 `roam.modelTierParams` 接入 `ModelParamResolver`。
5. F3 Smart Mode 增加 `taskTierHints` 编辑器，并过滤非法 tier/provider/role 输入。
6. B4 E2E devDeps 已同步进 lockfile，package metadata 已 bump 到 `0.1.1`。

验证：

- `npm.cmd run build` 通过。
- `npm.cmd run lint` 通过。
- `npm.cmd test` 通过：30 个测试文件 / 218 个测试。
- `npm.cmd run compile:e2e` 通过。
- `npm.cmd run test:e2e` 通过：3 个 VS Code smoke 测试。
- `npm.cmd run package` 通过，生成 `roam-crew-0.1.1.vsix`（5.61 MB）。

剩余注意：

- `npm install` 报 14 个 npm audit findings（6 moderate / 7 high / 1 critical），未自动 `npm audit fix`，发布前需人工判断。
- E2E 过程中 VS Code 测试宿主输出了 Windows 环境警告（WindowsApps EPERM / Jump List / mutex），但测试退出码为 0。
- 完整动作日志见 [CODEX_V0.1.1_COMPLETION_LOG.md](CODEX_V0.1.1_COMPLETION_LOG.md)。

## Claude 交叉复核 + 发布前风险定级（2026-06-05）

Codex 本轮已在本地落地并验证；Claude 交叉复核独立重跑 `npm run build` / `lint` / `npm test`（**218 全绿**），确认 RC-ready。结论：**同意 Codex 判断,v0.1.1 进入本地 RC-ready,可发布前确认。**

**npm audit 风险定级（14 findings — 非阻塞）**：

- **13 / 14 在 devDependencies**：E2E 测试工具链（`mocha` → `serialize-javascript`、`@vscode/test-cli`、`@vscode/test-electron`）。这些**不进 VSIX**（`.vscodeignore` 已排除 `test-e2e/` 与 devDeps），对最终用户零暴露。`npm audit --omit=dev` 仅剩 1 条。
- **1 / 14 在生产依赖**：`uuid` <11.1.1（moderate）——advisory 仅影响 v3/v5/v6 **且传入 `buf` 参数** 的调用;本项目所有调用均为 `uuidv4()` **无 buf 参数**，故**该漏洞不适用于我们的用法**。`npm audit fix --force` 会升 `uuid@14`（破坏性 major），不建议为此升级。
- **打包文件数告警**：`vsce` 提示 4000+ 文件（未 bundle 故保留 prod node_modules）。功能无碍;若要消除告警,可选 esbuild bundling（PRD P0#2 已记为可选优化）。

**处置**：以上均记为**发布前风险项,不阻塞 v0.1.1**。建议在 Marketplace publish 前:① 复跑 `npm audit` 确认无新增 critical 进入 prod;② 评估是否做 esbuild bundling。
