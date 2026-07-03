# DevPlan v0.3.0 — Solo / Fast Mode（头牌）

> Claude 维护 · 2026-06-09 · 配套:[BACKLOG.md](BACKLOG.md) · [ROADMAP_v0.3_v0.4.md](ROADMAP_v0.3_v0.4.md)
> 负责人:**Claude 实现**(核心编排改动)。DeepSeek 并行做 [D1](DEEPSEEK_TASK_D1_default_teams.md)/[D2](DEEPSEEK_TASK_D2_openrouter.md)(数据层,不撞核心)。

## 1. 目标与定位
一个**始终在场的全能单 agent("Solo")**,作为零门槛默认快车道,与现有多 agent **Team 模式并存**。
定位语:**"Cline 级单人编程速度 + 可选的 AI 团队(带真正的审查门 + 按角色成本路由)"**。

解决的痛点(DeepSeek/Codex 一致 P0):今天每个任务都付 PM→Architect→Dev→Reviewer 的开销,改一行配置
也要走完整团队,比单 agent 还慢。Solo 给简单/日常任务一条直路。

## 2. 关键设计决策(已与用户拍板)
1. **不是 PM 上的模式开关** —— Solo 是独立 agent/独立车道,不改 PM 的职责(PM 仍只编排、不写码)。
2. **不毁团队** —— Solo 与 Team 共存,不是二选一替换。
3. **Solo = 全能工程师,不是"会写码的 PM"** —— 全套执行工具(read/write/search/execute),**无 `delegate`**
   (不编排、不委派),**无 review gate**(这正是它换速度的代价;要质量门就用 Team)。
4. **引擎复用** —— 单 agent 的"读→改→跑→观察→迭代"循环 `OpenAICompatBackend` 已经在跑;Solo 主要是
   **配置 + UX**,不是新引擎。
5. **v0.3 手动选 Solo vs Team;自动路由(分类器)留到 v0.4**,不过度工程。

## 3. 组件与改动点(逐文件)
| 文件 | 改动 | 风险 |
|---|---|---|
| `src/types.ts` | `AgentRole` 联合加 `'solo'`(1 行) | 极小 |
| `src/roles/RoleConfig.ts` | 加 `solo` `RoleTemplate`:全栈通才 prompt;`skills` 选能解析出 read/write/search/execute 的组合(如 code-generation+debugging+testing);**确保 `allowedTools` 不含 delegate**;tier 默认 `standard`(成本路由,用户可改);温度 ~0.2 | 小(**与 DeepSeek D1/D2 同文件 → 见 §6 串行**) |
| `src/backend/OpenAICompatBackend.ts` | `MAX_TOOL_ITERATIONS` 改为可配(默认 12);Solo 走更高上限(~25),因单 agent 无委派来延展步数。经 `BackendNetworkOptions` 或 config 传入 | 小 |
| `src/extension.ts` | 新命令 `roam.startSolo`(若无 solo agent 则创建并 start、打开其 chat);把高 iteration 上限按 role==='solo' 接到 createBackend;onboarding/空状态接入"两扇门" | 中 |
| `src/dialogs.ts` | `createSoloAgent(d)`:构造 solo `AgentConfig`(复用 `AgentConfigBuilder().fromTemplate('solo')` + 选定 provider)+ `sessionManager.create` + start。仿 `createDefaultTeam` | 小 |
| `src/views/OnboardingWizard.ts` | 首屏改"两扇门":**「Solo —— 一个 agent,快」**(默认推荐)/ **「Team —— PM+专家+审查门」**。Solo 门 → `roam.startSolo` | 中 |
| `src/views/ChatViewProvider.ts` | Solo 一等公民:无团队时也能直接和 Solo 对话(置顶/默认选中);有团队时 Solo 与团队 agent 间清晰切换 | 中 |
| 测试 | `RoleConfig` solo 模板单测(无 delegate、工具齐全);`OpenAICompatBackend` iteration 上限可配单测;dialogs `createSoloAgent` 单测 | — |

> Solo 角色因无 delegate,会被现有 worker 合规协议(v0.2.24)注入——这没问题,正好让 Solo 也守"用项目脚本、
> 别赖环境坏了"。命令改写兜底(v0.2.26)对 Solo 同样生效。

## 4. UX 细节
- **Onboarding 两扇门**:文案明确"简单/日常 → Solo;复杂/多文件/要审查 → Team"。
- **Chat**:Solo 始终可选;新用户装上**不建团队就能直接用**(对标 Cline 零门槛)。
- **状态栏/Team 面板**:Solo 也以一张卡/一个入口呈现(可复用紧凑卡)。
- **不删 Team 的任何东西**;只是多一条更快的路。

## 5. 里程碑
- **M1 — Solo 能跑(核心)**:types + RoleConfig solo 模板 + `createSoloAgent` + `roam.startSolo` + iteration 上限可配。验收:命令起一个 solo agent,在 chat 里给它"修个小 bug",它能读→改→跑→验证一条龙完成,无 PM/委派开销。
- **M2 — 入口/UX**:onboarding 两扇门 + Chat 把 Solo 变一等公民(无团队可用)。验收:全新工作区,onboarding 选 Solo,30 秒内对话出活。
- **M3 — 打磨**:Team 面板/状态栏入口、文案、与 Team 切换顺滑;DoD 门禁全绿。

## 6. 与 DeepSeek 的并行协调(防撞车)
- 唯一共享文件:`src/roles/RoleConfig.ts`(DeepSeek D1 加知识工作模板/预设、D2 加 OpenRouter provider;Claude 加 solo 模板)。三处都是**不同区域的加性改动**,但按既有规则**串行合并**:
  - **DeepSeek 先合 D1、D2**(小、快),Claude 的 Solo 在其之上 rebase 再加 solo 模板。
  - 若 Claude 先到,DeepSeek rebase。
- 其余文件不重叠(DeepSeek 不碰 types/OpenAICompatBackend/extension/dialogs/Onboarding/Chat;Claude 不碰 RoleConfig 的知识工作模板与 provider 数据)。

## 7. 明确不做(范围外)
- **自动路由分类器** → v0.4。
- **Solo 自带 review gate** → 不做,这是 Solo 的速度取舍;要审查走 Team。
- **并行派发 / checkpoints / 浏览器观察器** → v0.4。

## 8. 总 DoD
- `npm run build` / `npm run lint` / `npm test` 全绿;新单测覆盖 solo 模板与 iteration 上限。
- 全新工作区:onboarding 选 Solo → 直接对话 → 单 agent 完成一个小任务(读/改/跑/验证),无团队、无委派。
- Team 模式不受影响(回归)。
