# UnodeAi v0.5.x Roadmap — Execution Engine Hardening & Agent Reliability

**Status**: v0.5.2 ✅ published · v0.5.3 in planning · v0.5.4+ roadmap
**Updated**: 2026-06-11
**三者联动**: Claude (strategy + review) · Codex (UI/frontend) · DeepSeek/Kimi (backend logic + integration)

---

## 现状总结（v0.5.2 成果）

**发布日期**: 2026-06-11

### 已完成的三层改进

#### P0: PowerShell 原子命令恢复 ✅
**问题**: `ask` mode 在 CommandPolicy 中直接拒绝管道、链式、`$()`—— 即使用户会被提示批准，也被提前卡住。
**根因**: SHELL_CONTROL 正则 `/[;&|`\n\r]|\$\(|\$\{|>|</` 在 ask mode 也应用了。
**修复**: 去掉 ask mode 的 SHELL_CONTROL 检查，只保留 CATASTROPHIC 模式黑名单（真正危险的：rm -rf、mkfs、fork bomb、format drive、pipe-to-shell）。
- **量化效果**: PowerShell 任务成功率 ~40% → 85%+（dogfooding 验证）
- **关键改动**: [CommandPolicy.ts:181-191](../src/backend/CommandPolicy.ts#L181-L191)
- **代码提交**: `9c9602b`

#### P1: 工具调用硬规则 ✅
**问题**: Agent 会写"我现在会读文件"，但不发工具调用——下一轮才补工具，浪费一轮。根因：系统提示没硬约束。
**修复**: 系统提示第一句硬规则："If your previous message described an action but didn't include a tool call, your NEXT message MUST open with a tool call."
- **破坏光说不练的循环**, 强制原子化执行
- **关键改动**: [OpenAICompatBackend.ts:704-717](../src/backend/OpenAICompatBackend.ts#L704-L717)
- **代码提交**: `bd45278`

#### P2: 环境透明度注入 ✅
**问题**: Agent 不知道有哪些工具可用，试过一个失败就被迫换工具，走弯路。
**修复**: 系统提示注入"Available tools: read, write, run_command, ..."
- **清除路径黑盒**, agent 一眼看清自己的能力
- **关键改动**: [OpenAICompatBackend.ts:709](../src/backend/OpenAICompatBackend.ts#L709)
- **代码提交**: `bd45278`

### 副作用改进（从 dogfooding 和 UnodeAi 自分析学来）
- **Post-write diagnostics**: TypeScript/ESLint 错误实时反馈
- **Verification obligation**: 文件修改后必须验证（test/build）
- **Out-of-folder detection**: 框架层面检出路径逃逸，而不靠 agent 自觉
- **Terminal output reliability**: 处理 PowerShell 空输出的情况（shell integration edge case）
- **Solo icon bundling**: 修了 package-bundle.mjs 确保所有资产进 vsix

**Turn Count to First Correct 的降低**: 从 4-6+ (vs Cline 1-2) → **目标 1-2** (R2 基准待验)

---

## v0.5.3 规划 — G-001 中途转向（**只做这一件事**）

> **2026-06-11 重定范围（Opus 复审）**：原计划把 interject + C3 + C1 塞进一个版本，且任务卡里写满了**与真实代码不符**的示例（虚构的 `kind:'message'` 事件、不存在的 `routeToolCall`/`tools.run`、为「UI 线程 vs 后端线程」准备的 `AsyncMutex`——而本进程是**单线程 Node 事件循环**，没有竞态）。这种文档喂给弱 agent 会被照抄→编译失败→空转，正是我们要消灭的 dogfooding 失败模式 [[agent-robustness-insight]]。已重写为「接口 + 不变量 + 测试 + 一个真实决策」。

**核心目标（唯一）**: **G-001 中途转向** — `interject()` 让用户给*正在跑*的 turn 注入一条消息，agent 下一步重新规划。

**砍掉/推迟**:
- ❌ **两种模式**（instruction/observation）→ 砍。两者都只是一条 user 消息，模型几乎不区分，不值当多一个参数 + 一组单选按钮 + 测试。**只做一种**。
- ⏳ **C3 死循环检测** → 推迟为 R2 之后的**独立小 PR**。理由：`runTurn` 里**已有** `failCounts`/`REPEAT_FAIL_LIMIT`、`circuitBreaks`、`announceNudges`（[OpenAICompatBackend.ts:360-368](../src/backend/OpenAICompatBackend.ts#L360-L368)）。原方案是没读现有代码、从零重写，还把 `REPEAT_FAIL_LIMIT` 2→1（一次瞬时失败就废掉工具，很可能**增加**失败轮数）。C3 应是基于 R2 数据**调旋钮**，不是重写。
- ⏳ **C1 批量审批** → 推迟 v0.5.4。

**关键设计决策（已定）**: **等待，不抢占**。interject 被调用时循环多半卡在 `await this.chat()`，v1 **不**中断在途请求；排队的文本在**下一轮循环顶部**消费（已答完所有 tool_call 之后）。延迟 ≤ 一个 tool 往返，简单且安全。

**必须守的不变量**: OpenAI 格式下，assistant 带 `tool_calls` 后，必须先用 `tool` 消息逐个回答**才能**再出现 `user` 消息。所以**只在迭代循环顶部注入** user 消息——那里上一轮的 tool 结果已全部落历史。详见后端任务卡。

**前置门**: 先跑 **R2 基准**（RoamClaw 主责）再锁范围——用数据确认 interject 解决的是真实痛点、并决定 C3 是否还需要。

**时间线**: R2 报告（06-12~13）→ 06-14 锁范围 → 实现（06-14~17）→ 06-18 发布。

**任务卡**:
- 后端 → [TASK_DEEPSEEK_v0.5.3_G001_BACKEND.md](TASK_DEEPSEEK_v0.5.3_G001_BACKEND.md)（DeepSeek/Kimi）
- UI → [TASK_CODEX_v0.5.3_G001_UI.md](TASK_CODEX_v0.5.3_G001_UI.md)（Codex）
- 基准 + dogfood → [TASK_ROAMCLAW_v0.5.3.md](TASK_ROAMCLAW_v0.5.3.md)（RoamClaw）

---

## Cline 对标 — DeepSeek/RoamClaw 五点反馈（落地评估）

> 来源：RoamClaw(PM) 提出的"追上 Cline"五点（2026-06-11）。**逐条对真实代码核验后**的结论——和 C3 一样，有两点"已经做了/premise 不成立"，照单全收会重复造轮子。张的指示：尽量塞进 v0.5.x。

| # | 反馈 | 对真实代码核验 | 落地 |
|---|------|--------------|------|
| **#3** 写后强制校验 | **v0.5.2 已发**：post-write diagnostics 注入 + verification obligation + ⚠ 未验证标记（[runTurn:459-485](../src/backend/OpenAICompatBackend.ts#L459-L485)、`verifyObligation` 设置）。**已做 ~80%**。 | **增量小活**：加 `roam.verifyCommand`，写后自动跑可配置校验命令并回灌。→ **v0.5.4** |
| **#1** Intent→Tool 桥 | **部分已有**：announce-without-call 的 nudge（`looksLikeAnnouncedAction` + `MAX_ANNOUNCE_NUDGES`，[runTurn:443-458](../src/backend/OpenAICompatBackend.ts#L443-L458)）+ 协议层 leaked-call 回收。**缺**的是"逼出工具调用"。⚠️ 但"从散文里替模型臆测工具+参数自动执行"是**危险**的（可能写错文件）——不做。 | **安全切片**：announce-without-call 时，native 协议下**重试一次并强制 `tool_choice:'required'`**（`buildChatBody` 已支持 tool_choice，[:858](../src/backend/OpenAICompatBackend.ts#L858)），逼模型真出工具调用，而非框架猜参数。→ **v0.5.4** |
| **#2** 主动注入工作区上下文 | **净新增**，且是这批里最有价值的。当前每轮"盲开"，要花 tool call 才看到文件/报错。`DiagnosticsCollector`/`FileDiagnostic` 已存在（仅用于写后）。 | **真要做**：每轮开头注入"当前活动编辑器文件(截断) + 工作区 error/warning 诊断"，**opt-in + token 上限**。→ **v0.5.5**（独立一版） |
| **#4** 精简 Solo 后端 | **premise 基本不成立**：Solo 已 `team=undefined`（无 `assign_task`/`broadcast`，[extension.ts:196](../src/extension.ts#L196)+`canDelegate`）、`NoopFileCoordinator`（[:207](../src/extension.ts#L207)）、专属 solo 提示词（[RoleConfig.ts:546](../src/roles/RoleConfig.ts#L546)"There is no team"）。PM 说的"还跑 file coordinator/claim registry/MCP bridge/team-bus"**已不存在**。 | **仅审计**：确认没有 team 语言/工具泄漏到 Solo；有就清，没有就关单。→ 并入 **v0.5.5**（~1h） |
| **#5** 引导式工具流水线 | task-pattern 库预结构化工具链——本质是 planner/macro 层，**大且有风险**（易把强模型也框死）。PM 自评 Large。 | **推迟 v0.6+**，分阶段；部分会从 #1 自然长出。 |

**净结论**：v0.5.4 收 #1(安全切片)+#3(verifyCommand)；v0.5.5 收 #2(+#4 审计)；#5 留 v0.6。每版仍**只装小而实的量**，不重蹈 Haiku 版过度堆叠。

**任务卡**：
- 可靠性对（#1+#3）→ [TASK_DEEPSEEK_v0.5.4_RELIABILITY.md](TASK_DEEPSEEK_v0.5.4_RELIABILITY.md)
- 上下文注入（#2）→ [TASK_v0.5.5_CONTEXT_INJECTION.md](TASK_v0.5.5_CONTEXT_INJECTION.md)

---

> **2026-06-12 重排序（dogfooding 触发）**：用户问"为什么同样的 DeepSeek，Cline 不会卡工具调用?"——根因是**格式**:UnodeAi 两层嵌套 `<use_tool><tool>X</tool>…</use_tool>`,弱模型把外层 wrapper 误闭成 `</tool>`(详见下);Cline 用**工具名即标签** `<X>…</X>`(一层,无 wrapper 可误闭)。**工具调用可靠性是"廉价模型能用"的地基,优先级高于可见性**。故 v0.5.4 改由**扁平工具格式领衔**,可见性顺延 v0.5.5。

## v0.5.4 规划 — 工具调用可靠性地基（扁平格式领衔）

**目标**:
0. 🔴🔴 **扁平工具调用格式**（Cline 式 tool-name-as-tag）：把 `<use_tool><tool>X</tool>…</use_tool>` 换成 `<X>…</X>`,**从结构上**消除"误闭 wrapper → 工具调用消失 → agent 卡死"这一整类弱模型故障(dogfooding 实测,见 [扁平格式任务卡](TASK_v0.5.4_FLAT_TOOLCALL_FORMAT.md))。今天的容错补丁([firstUseToolBody](../src/backend/toolProtocol/XmlToolProtocol.ts#L136))保留为兜底。**本版地基,最高优先**。
1. 🔴 **#1 `tool_choice:'required'`**：announce-without-call 时逼出真工具调用(同主题,见 [可靠性任务卡](TASK_DEEPSEEK_v0.5.4_RELIABILITY.md))。
2. 📊 **基准复测**：扁平格式落地后重跑任务套件,测**工具调用成功率 / 卡死次数**的下降——这是可靠性改动,必须用数据证明。

**为什么领衔**：影响排序 = 工具调用可靠(能不能干活) > 可见性(看不看得到干了啥) > 功能。dogfooding 反复栽在工具调用上(P0/P1/P2,再到这次 XML 误闭),说明它是真瓶颈。扁平格式**根治**而非打补丁。

**预计复杂度**：中（集中在 `XmlToolProtocol` 的 prompt guide + parser + 测试,三者同步改）。

---

## v0.5.5 规划 — 可见性工作流（G-004+G-005）+ #3 写后校验

> 原定 v0.5.4 的可见性顺延至此（让位给工具调用地基）。仍是 R2 唯一硬 gap,不降级,只是排在可靠性之后。

**目标**:
0. 🔴 **可见性工作流（G-004+G-005,同根）**：write diff **完全不显示** + 终端输出看不清,根因同为"agent 动作只活在瞬态 tool-activity 流"。修法：让 write diff 与命令输出成为聊天里**显眼、常驻**的 transcript 条目（或默认 `writeApproval=ask`）。UI 主责。
1. 🔧 **#3 `roam.verifyCommand`**：写后自动跑可配置校验命令并回灌(见 [可靠性任务卡](TASK_DEEPSEEK_v0.5.4_RELIABILITY.md) Feature B)。

---

## v0.5.6 规划 — 主动上下文注入（Cline #2）+ Solo 审计（#4）

**目标**:
0. 🔵 **Cline #2 主动注入工作区上下文**：每轮开头注入"当前活动编辑器文件(截断) + 工作区诊断",opt-in + token 上限。详见 [上下文注入任务卡](TASK_v0.5.5_CONTEXT_INJECTION.md)。五点里最大的 net-new UX。
1. 🔍 **Cline #4 Solo 审计**（~1h）：确认无 team 工具/语言泄漏到 Solo。

---

## v0.6+ 规划 — 触及边界

1. 🎯 **C2 @ 上下文自动补全**：输入 `@` 弹补全面板（Files / Functions / Turns / Web）。
2. ⚙️ **工具链编排 / macro_tools**：`tool.requires` 前置条件、序列工具、`if_success/if_fail` 条件分支。
3. **Cline #5 引导式工具流水线**：task-pattern 库预结构化工具链（planner/macro,大且有风险,分阶段）。
4. **代码审查模式** / **增量执行** / **模型降级**（超 token 自动换轻量模型续跑）。

---

## 关键依赖与风险

| 项 | 状态 | 风险 | 缓解 |
|---|---|----|-----|
| P0 ask mode 宽松化 | ✅ v0.5.2 done | shell 注入？| CATASTROPHIC 黑名单 + user approval 仍为 gate |
| P1 硬规则效果 | ⚠️ 待 R2 验证 | agent 忽视? | 系统提示强度待加强（双引号 + 大写 MUST） |
| G-001 interject 实现 | 📋 计划 v0.5.3 | 并发竞态? | MessageBus Promise queue + async/await |
| Terminal 可靠性 | 🟢 v0.5.2 已修 | 某些工具仍无输出? | spawn executor 作为可靠降级路径 |
| R2 基准重跑 | ⏳ 准备中 | 网络/timeout? | 超时自动 skip，汇总结果不含 outlier |

---

## 发布节奏

> **版本号 ⟂ 里程碑（2026-06-12 解耦）**：**版本号是单调计数器,只在真正 `vsce publish` 时 +1;里程碑是功能标签,发布时落到当时的下一个可用版本号。** 起因:dogfooding 期间本地 dev 构建烧掉了 0.5.3/0.5.4/0.5.5(从未上架),"v0.5.3 interject 里程碑"实际以 **0.5.6** 上架。继续拿里程碑名当版本号只会越来越乱。**今后 dogfooding 走 F5 dev host(不打包、不升版),版本号只在发布时前进。** 下方各 `## v0.5.x 规划` 标题是**里程碑序号(功能)**,实际上架版本以本表为准。

| 里程碑（功能） | 上架版本 | 状态 |
|---|---|---|
| P0/P1/P2 工具可靠性 + Solo | 0.5.2 | ✅ 已发 2026-06-11 |
| **Interject 中途转向 (G-001)** | **0.5.6** | ✅ 已发 2026-06-12（含 4 个 dogfooding 修复） |
| **扁平工具调用格式（可靠性地基）** | **0.5.7** | ✅ 已发 2026-06-12（R4 功能验证通过:native+XML 均端到端,无误闭卡死） |
| 可见性工作流 (G-004+G-005) + #3 verifyCommand | 0.5.8 | 计划 |
| 主动上下文注入 (Cline #2) + #4 Solo 审计 | 0.5.9 | 计划 |
| @ 补全 · 工具链/macro · 引导流水线(#5) · 代码审查 | 0.6+ | TBD |

> 0.5.3–0.5.5 = 本地 dev 构建(detector / XML / new-window / pricing 修复的迭代),**未上架**,已并入 0.5.6。

**Cline 反馈集成进度（2026-06-12 重排）**:
- 🔴🔴 **扁平工具格式**（NEW，dogfooding 触发）: **v0.5.4 领衔**——根治"误闭 wrapper → 卡死"那类故障（[卡](TASK_v0.5.4_FLAT_TOOLCALL_FORMAT.md)）。Cline 同款 DeepSeek 不卡的真正原因。
- 🟡 **#1 Intent→Tool**: 随扁平格式入 v0.5.4（`tool_choice:'required'`，**不**框架臆测参数）
- 🟢 **#3 写后校验**: v0.5.2 已发主体；`roam.verifyCommand` 顺延 v0.5.5
- 🔴 **可见性 G-004+G-005**: 顺延 v0.5.5（让位给工具可靠性地基；仍是 R2 唯一硬 gap，不降级）
- 🔵 **#2 主动上下文注入**: v0.5.6（[卡](TASK_v0.5.5_CONTEXT_INJECTION.md)）
- 🟢 **#4 精简 Solo**: 基本已做；v0.5.6 仅审计
- ⏳ **C2 (@ autocomplete) / #5 引导流水线**: v0.6+
- 🔬 **C3 (弱模型防卡顿)**: **不重写**——R2 已显示 P1/P2 基本压住光说不练，改为按需微调现有旋钮（[OpenAICompatBackend.ts:360-368](../src/backend/OpenAICompatBackend.ts#L360-L368)）。扁平格式落地后大概率进一步淡化。

---

## 测量与 R2 基准 — ✅ 完成 (2026-06-11)

**目标**: 验证 P0/P1/P2 是否真的把 Turn Count to First Correct 从 4-6+ 降到 1-2（对标 Cline）。
**结论已记入** [UX_BENCHMARK §四/§五](UX_BENCHMARK_vs_Cline.md)（R2 增量轮，T1/T3，张实跑）。

**结果**:
- ✅ **可靠性地板追平**：T1/T3 both **一轮修对、自跑测试自证、不死循环、不甩锅** → Turn-Count-to-First-Correct **4-6 → 1**。P0/P1/P2 见效。
- ✅ **U5 自证持平**（先误判 RC 不自证，张确认 RC 真跑了测试 → **G-003 撤销**）。
- ✅ **U9 成本透明 RC 反超**（显示花费，Cline 不显示）。
- ❌ **U8 插话 RC=0** → v0.5.3 **G-001**（本就在做）。
- ❌ **U3/U7 可见性**：write **完全不显示 diff**（G-004 已确认）+ 终端输出看不清（G-005，U7=1）。**同根**：agent 的动作只活在瞬态 tool-activity 流，不像 Cline 常驻显眼 → **v0.5.4「可见性」工作流**。
- ◽ U1 流式小幅落后（2 vs 3），观察项。

**R2 的作用兑现**：验证了 v0.5.2、撤掉一个误报（G-003）、挖出一条 code review 看不出的真 gap（可见性）。**插话(T6/U8)留待 v0.5.3 发布后的 R3。**

---

## 当前任务分配表

### 🔵 Claude 负责（战略 + 最终把关）
- [ ] 发布 v0.5.2（已完成 ✅）
- [ ] 设计 interject() 接口 + runTurn 改造方案
- [ ] 代码审查 Codex PR（UI 层）+ DeepSeek PR（后端层）
- [ ] R2 基准设计与分析
- [ ] 本文档维护（更新进度、风险调整）

### 🟡 Codex 负责（UI/前端 — v0.5.3）
- [ ] 打破输入框禁用（allowInputWhileBusy 设置）
- [ ] 实现 ⚡ Interject 按钮 + 弹框
- [ ] 进度条改造（工具名 + 迭代计数）
- [ ] 队列 chip 显示待处理数
- [ ] 消息卡样式（INTERJECT 消息的紫色背景 + 左边框）
- [ ] 单测（5–8 个）+ 截图验证
- [ ] 提交 PR，等 Claude review

**预计工作量**: 3–4 天（2026-06-12 ~ 2026-06-15）

### 🟠 DeepSeek/Kimi 负责（后端逻辑 — v0.5.3）
- [ ] 设计 interjectedMessages 队列数据结构
- [ ] 改造 OpenAICompatBackend.runTurn()：
  - [ ] 每轮工具循环检查队列
  - [ ] 从队列拿消息 → 插入历史
  - [ ] 调用 chat() 推进循环
- [ ] 不破坏现有的 tool-call 循环不变量（REPEAT_FAIL_LIMIT、MAX_CIRCUIT_BREAKS）
- [ ] ClaudeHeadlessBackend stub（无实现，同步返回）
- [ ] 单测（4–6 个）：
  - [ ] 队列 FIFO 顺序
  - [ ] 不重复执行已完成的工具
  - [ ] 与 abort 不冲突
- [ ] 集成测试：SessionManager → backend 调用链
- [ ] 提交 PR，等 Claude review

**预计工作量**: 4–5 天（2026-06-12 ~ 2026-06-17）

### 互动点
1. **2026-06-12 上午**: 三方同步 interject() 接口细节 → Codex/DeepSeek 独立开发
2. **2026-06-14 中午**: Codex PR ready → Claude 快速 review（1 小时）→ DeepSeek 看 Codex 代码，确认前端调用点
3. **2026-06-15 下午**: DeepSeek PR ready → Claude review（2 小时）+ 集成测试
4. **2026-06-16**: 联合 E2E 测试（场景 A/B/C）
5. **2026-06-17 傍晚**: 修 bug、润色 UX
6. **2026-06-18 发布 v0.5.3**

