# UnodeAi v0.1.1 — Development Plan

> **Baseline**: `3acc89b` (v0.1.0 marketplace-ready)  
> **Target**: 9 working days / ~2026-06-18  
> **Cadence**: Sequential milestones — each completes before the next starts  
> **Aligned with**: [PRD v0.1.1 Rev. 2](PRD_v0.1.1_Product_Brief.md) — this plan reflects the Rev. 2
> corrections (F3 reuses the existing tier infra; F1 Claude scope = `--effort`/`--json-schema` only;
> B4 lockfile already done). All method/line refs below verified against the tree at `3acc89b`.

---

## 依赖图（关键路径）

```
      ┌────────────── M1 (Day 1–2) ──────────────┐
      │ B1 → B2 → B3 → F2 (ModelParamResolver)   │   B4 是旁路（联网时做，不在关键路径）
      └──────────────┬────────────────────────────┘
                     ▼
              ┌──── M2 (Day 3–4) ────┐
              │ F1 参数全链路           │
              └────┬──────────────────┘
                   ▼
            ┌───── M3 (Day 5–6) ─────┐
            │ F3 SmartMode（复用       │
            │ TierController）         │
            └────┬───────────────────┘
                 ▼
          ┌───── M4 (Day 7–8) ─────┐
          │ F4 RulesFile           │
          └────┬───────────────────┘
               ▼
          ┌─ Release (Day 9) ─┐
          │ vsce publish      │
          └───────────────────┘
```

- **F2 先落地**：F1 的 backend 透传依赖 `ModelParamResolver` 解出的 `AgentModelParams`。
- **F1 在 F3 之前**：F3 的 tier 切换本质是换 model（经现有 `TierController.setModel`），可选地带一组 tier 级 `modelParams` —— 后者复用 F1 的 `AgentModelParams` 类型。
- **F3 在 F4 之前**：两者都要改 `extension.ts` 的 wiring；先做 F3 让合并面更小。
- **B4 离开关键路径**：`package-lock.json` 已提交，只剩 E2E devDeps 联网安装，挪到 M4 末尾顺带做，不阻塞任何里程碑。

---

## M1 — Foundation（Day 1–2）

> ✅ **M1 完成**（commit 待提交）。`npm run build` / `npm run lint` / **179 测试**全绿（+10：F2 解析器 7、B1 并发 2、B2 拒令 1）。
> 落地文件：`SessionManager.ts`（B1 排队/排空/queued 事件）、`extension.ts`（queued toast、`notifyCommandBlocked`、ModelParamResolver 注入）、`TeamTools.ts`（`onCommandBlocked`）、`types.ts`（`AgentModelParams`）、`backend/AgentBackend.ts`+`OpenAICompatBackend.ts`（params 透传）、新文件 `params/ModelParamResolver.ts`、`package.json`（`roam.modelDefaults.*` ×6）。
> **B3 更正**：核实后为**已缓解**——webview（MessageLog 服务端 `esc()`+客户端 `textContent`，Dashboard/Team 用 `esc/escAttr`）全转义，agent 输出到的 OutputChannel 是纯文本通道（不渲染 HTML）。硬化轮已堵口，无需改动。

### Task 1.1 — B1: `maxConcurrent` 超限 → 排队 + toast（不再抛错）✅

| 项 | 内容 |
|----|------|
| 文件 | `src/session/SessionManager.ts` |
| 当前行为 | `start()` 第 **150 行** `throw new Error('Max concurrent agents (${this.maxConcurrent}) reached')`（守卫在第 149 行 `getRunningCount() >= maxConcurrent`） |
| 目标行为 | ① 不抛错 ② 把该 **start 请求**（sessionId）记入一个待启动队列字段（如 `private pendingStarts: string[]`）③ `vscode.window.showInformationMessage("Agent '${id}' queued — will start when a slot frees.")` |
| 排空时机 | 某 session 转为 `stopped`/`idle`-after-complete 时，检查 `pendingStarts`，有空位则 `this.start(next)` |
| 注意 | 守卫的是 **启动并发**（spawn 进程数），不是消息投递；不要往 MessageBus inbox 塞东西。队列的是「想启动但没槽位的 agent」 |
| 代码改动量 | ~15 行（throw → 入队 + toast；stop 路径加排空钩子） |
| 验收 | 启动超出 `maxConcurrent` 的 agent → 无报错；toast 出现；前一个停止后排队的 agent 自动启动 |

---

### Task 1.2 — B2: `commandApproval: none` 拒令 → toast（已定位精确文件）✅

| 项 | 内容 |
|----|------|
| reason 来源 | `src/backend/CommandPolicy.ts:68` —— 返回 `reason: 'command execution is disabled...'` |
| 现状（静默面） | 拒绝信息目前只回到调用方字符串：`TeamTools.ts:135`（`run_checks`）、`extension.ts:310`（`runVerifyChecks`）、`WorkflowEngine.ts:374`（gate 无法跑）—— 都没有给用户弹窗 |
| 目标行为 | 在这些 **拒绝汇合点** 调一次 `vscode.window.showWarningMessage("Command blocked by roam.commandApproval: ${reason}")`（带「Open Settings」按钮跳 `roam.commandApproval`）。注意 `CommandPolicy` 是 vscode-free 的纯模块，**toast 要在 extension 层调**，不要污染 policy |
| 验收 | `commandApproval: none` 下触发 `run_checks` → warning toast 出现并能跳设置 |

---

### Task 1.3 — B3: OutputChannel HTML 转义 — ✅ 已缓解（无需改动）

| 项 | 内容 |
|----|------|
| 核实结论 | webview 渲染面**已全部转义**：`MessageLogProvider` 服务端 `esc(it.content)` + 客户端 `textContent`（DOM API，天然安全）；`DashboardProvider`/`TeamViewProvider` 用 `esc`/`escAttr`（见 `views/webviewSecurity.ts`） |
| OutputChannel | agent 输出写入的是 `vscode.OutputChannel`（**纯文本**通道，不解析 HTML），原标题「OutputChannel 转义」属误诊 |
| 处置 | Codex 硬化轮已堵住 webview XSS 口子，本轮无改动；保留此条作为已核实记录 |

---

### Task 1.4 — F2: 全局默认 + ModelParamResolver ✅

**新文件**: `src/params/ModelParamResolver.ts`（与 PRD 文件图一致；纯模块、可单测）

```typescript
export interface ModelParamResolverDeps {
  config: ConfigStore;  // roam.modelDefaults.*
}

export class ModelParamResolver {
  resolveParams(
    agentConfig: AgentConfig,
    smartTierParams?: AgentModelParams
  ): AgentModelParams;
}
```

**解析链**（逐层 fallback）：
```
1. agentConfig.modelParams 显式值
2. smartTierParams（SmartMode 注入，M3 时用，M1 时不传）
3. roam.modelDefaults.* VS Code 配置
4. 硬编码兜底：{ temperature: 0.7, max_tokens: 4096, stream: true }
```

| 改动文件 | 内容 |
|----------|------|
| `package.json` | 新增 `roam.modelDefaults.temperature`, `.topP`, `.maxTokens`, `.reasoningEffort`, `.stream`, `.responseFormat` contributions |
| `src/params/ModelParamResolver.ts` | **新文件** |
| `src/session/SessionManager.ts` | 在 `deliverTurn()`（第 321 行，调 `backend.sendUserTurn`）前调用 `resolver.resolveParams()` 并随 turn options 注入 |
| `src/backend/AgentBackend.ts` | `UserTurnOptions` 增加 `modelParams?: AgentModelParams` |
| `src/extension.ts` | 构造 `ModelParamResolver` 注入 `SessionManagerDeps` |

**单元测试**：
- Agent 显式值 > 全局默认 > 硬编码
- 部分字段显式、其余 fallback
- `roam.modelDefaults.*` 未配置时走硬编码

**验收**：
- 不改 team.json → launch → agent 使用 `roam.modelDefaults.temperature=0.7`
- VS Code Settings 改 `roam.modelDefaults.temperature` 为 `1.2` → agent 下一个 turn 用 1.2
- team.json 设 `modelParams.temperature: 0.3` → 该 agent 用 0.3，其他用全局 1.2

---

## M2 — Advanced Model Parameters（Day 3–5）

> ✅ **M2 完成**（commit 待提交）。build/lint/**187 测试**全绿（+8：OpenAICompat F1 body 1、sanitize 7）。
> Task 2.1 类型已在 M1 落地。落地文件：`OpenAICompatBackend.ts`（chat() 完整参数面）、`ClaudeHeadlessBackend.ts`（`--effort` 映射 + 构造接 resolvedParams）、`extension.ts`（claude 后端传 resolved params；openSettings 注入 roster 读写）、`views/SettingsPanel.ts`（Model Tuning tab + 控件 + backend 置灰 + F1b Context Window + ⓘ `<details>` 帮助）、新文件 `params/sanitizeModelParams.ts`（webview 输入校验）。
> **偏离说明**：Task 2.3 原计划「SettingsBridge 加 getAgentModelParams」——实际放进 `SettingsPanelDeps`（`listAgentTunings`/`setAgentTuning`），因为 roster 是 SessionManager 的活状态、不是 setting；bridge 保持只管 secrets/config/MCP。`--json-schema` 暂未接（需具体 schema，response_format:json_object 无法直接映射），文档化为 deferred。

### Task 2.1 — 新增 types

| 项 | 内容 |
|----|------|
| 文件 | `src/types.ts` |
| 新增接口 | `AgentModelParams`（见 PRD §F1 的完整定义） |
| 修改接口 | `AgentConfig` 增加 `modelParams?: AgentModelParams` |
| 验收 | `npm run compile` 无 type error |

---

### Task 2.2 — Backend 透传

> ⚠️ **Claude CLI 边界（已实测 `claude --help`）**：headless 只有 `--model` / `--fallback-model` /
> `--effort`(low/medium/high/xhigh/max) / `--json-schema`。**没有** `--temperature` / `--top-p` /
> `--max-tokens` / `--thinking-budget`。完整参数面只对 openai-compat 成立——见 PRD F1 后端矩阵。

| 文件 | 内容 |
|------|------|
| `src/backend/AgentBackend.ts` | `UserTurnOptions.modelParams` 已加（F2），无需改 |
| `src/backend/OpenAICompatBackend.ts` | **方法是 `chat()`**（第 289 行，非 `buildRequestBody`）：把 `modelParams` 字段拍平进 `POST /v1/chat/completions` body（跳过 `undefined`）。今天该方法只塞了 `model/messages/stream/temperature/max_tokens` |
| `src/backend/ClaudeHeadlessBackend.ts` | `buildArgs()`（第 176 行）：**仅** `reasoning_effort` → `--effort`；`response_format` → `--json-schema`（可选）。其余字段 **无 flag，直接忽略**（不要 push 不存在的 flag） |

**验收**：
- 单元测试（openai-compat）：给定 `AgentModelParams{ temperature: 0.3, max_tokens: 8000, top_p: 0.9 }` → 请求 body 含这三个字段；`undefined` 字段不出现在 body
- 单元测试（claude）：给定 `{ reasoning_effort: 'high', temperature: 0.3 }` → `buildArgs()` 含 `--effort high`，**不含** `--temperature`（被忽略）
- 单元测试（claude）：给定 `{ response_format: { type: 'json_object' } }` → 含 `--json-schema`（或文档化为暂不实现，二选一）

---

### Task 2.3 — Settings Panel: Model Tuning 标签页

| 项 | 内容 |
|----|------|
| 文件 | `src/views/SettingsPanel.ts` |
| 新增 tab | "Model Tuning" |
| 布局 | 每 agent 一张 card：temperature（range 0–2 step 0.1）、top_p（range 0–1 step 0.05）、max_tokens（数字输入）、reasoning_effort（下拉）、stream（开关）、thinking（开关+budget）、response_format（下拉 text/json_object）、presence_penalty / frequency_penalty（range -2–2） |
| **F1b: Context Window** | 数字输入「Context Window (tokens)」→ 写 `AgentConfig.contextWindowTokens`（**字段已存在**，[OpenAICompatBackend.ts:109](../src/backend/OpenAICompatBackend.ts#L109) 已喂给 TokenCounter，70%/80% 门已生效——**纯 UI，零后端改动**）。占位 `128000` |
| **ref 帮助 (ⓘ)** | Context Window 旁一个纯 HTML `<details><summary>ⓘ</summary>…</details>`（**零 JS**，符合 nonce-only CSP）；展开给「怎么按你的模型查窗口」指导（不硬编码 per-model 表，会过时）。文案见 PRD §F1b |
| "Use global default" checkbox | 每参数旁，勾选则灰色 + 清空 agent 显式值 |
| **backend-aware 置灰** | 当该 agent `backend === 'claude'`，矩阵外参数（temperature/top_p/max_tokens/penalties/stop/tool_choice）渲染为禁用 + "openai-compat only" 提示，避免误以为生效。Context Window **两后端都适用**（OpenAICompat 用它做门；claude 后端的 TokenCounter 同样可用），不置灰 |
| Bridge 扩展 | `SettingsBridge` 新增 `getAgentModelParams(agentId)`, `setAgentModelParams(agentId, params)`；context window 走 `members[].contextWindowTokens` |
| 数据存储 | team.json 中 `members[].modelParams`（+ `members[].contextWindowTokens`） |
| 验收 | ① 改 temperature → 保存 → `team.json` 该 agent `modelParams.temperature` 更新；claude agent 下矩阵外控件禁用 ② 改 Context Window 为 32000 → `contextWindowTokens` 写入；下次启动该 agent 的 TokenCounter 用 32000（软门在 ~22400 tok 触发）③ 点 ⓘ 展开指导文本 |

---

## M3 — Smart Mode（Day 5–6）

> ✅ **M3 完成**（commit 待提交）。build/lint/**196 测试**全绿（+9：SmartMode 8、SessionManager 选档集成 1）。
> 落地文件：`types.ts`（`ModelTier` 上移 + `SmartModeConfig` + `TeamConfig.smartMode/modelTiers`）、`roles/RoleConfig.ts`（`ModelTier` 改为从 types 重导出）、新文件 `workflow/SmartMode.ts`（`selectTier`/`resolveModelTiers`/`modelForTier`，纯函数）、`session/SessionManager.ts`（`resolveTaskModel` dep，deliverTurn 前选档热切）、`extension.ts`（`readSmartMode`/`resolveTaskModel` 装配 + 面板 `getSmartMode`/`updateSmartMode`）、`views/SettingsPanel.ts`（Smart Mode tab：开关 + 默认 tier + tier→model 矩阵 + 每-role tier）、`package.json`（`roam.smartMode.*` ×4 + `roam.modelTiers`）。
> **存储**：Smart Mode 配置走 VS Code 设置（`roam.smartMode.*` / `roam.modelTiers`），非 team.json——与 F2 的 `roam.modelDefaults.*` 一致，且免去 team.json 写入复杂度。`modelTiers` 只存 delta（按 tier 浅合并 defaults）。
> **claude 限制**：`setModel` 对已 spawn 的 claude 进程不热切，下次启动生效（已在 Task 3.4 注明）。

> ⚠️ **复用已有 tier 基建，禁止另起炉灶。** 仓库已有 `type ModelTier = 'premium'|'standard'|'economy'`
> ([RoleConfig.ts:123](../src/roles/RoleConfig.ts#L123))、`DEFAULT_MODEL_TIERS`（每 provider 的 tier→model 表，
> [RoleConfig.ts:125](../src/roles/RoleConfig.ts#L125)）、`modelForRole()`、以及运行时热切的
> `TierController.applyTiers()`（[TierController.ts:50](../src/workflow/TierController.ts#L50)，经
> `SessionManager.setModel` 第 105 行）。**不要新增名为 `ModelTier` 的接口**——会与既有联合类型撞名。

### Task 3.1 — 新增 types（仅 SmartModeConfig）

| 项 | 内容 |
|----|------|
| 文件 | `src/types.ts` |
| 新增 | `SmartModeConfig`（见 PRD §F3）；**复用** `RoleConfig.ts` 的 `ModelTier`，不要重定义 |
| 修改 | `TeamConfig` 增加 `smartMode?: SmartModeConfig` 与 `modelTiers?: Record<ModelTier, Record<string,string>>`（可选覆盖 `DEFAULT_MODEL_TIERS`，缺省即用内置） |

---

### Task 3.2 — SmartMode 选档层（薄，复用 TierController 落地）

| 项 | 内容 |
|----|------|
| 新文件 | `src/workflow/SmartMode.ts`（与 PRD 文件图一致；纯函数、可单测） |
| 方法 | `selectTier(msg, cfg: SmartModeConfig, roleDefault: ModelTier): ModelTier` |
| 逻辑 | ① `cfg.enabled === false` → 返回 `roleDefault`（不动）② `msg.payload.metadata.tier` 显式 → 用之 ③ `cfg.taskTierHints[msg.type]` → 用之 ④ 否则 `roleDefault`（来自 `RoleTemplate.tier`） |
| 落地 | **不自己解析 model**——把选出的 tier 交给现有 `TierController.applyTiers({ [agentId]: tier })`，由它经 `modelFor(tier, provider)` → `setModel` 热切 |
| 验收 | 单元测试 4 条路径；OFF 时恒等返回 roleDefault |

---

### Task 3.3 — Settings Panel: Smart Mode 标签页（可编辑 tier 矩阵）

| 项 | 内容 |
|----|------|
| 文件 | `src/views/SettingsPanel.ts` |
| 新增 tab | "Smart Mode" |
| 布局 | ON/OFF 开关 + 默认 tier 下拉（premium/standard/economy）；**可编辑 tier 矩阵**：行 = `premium/standard/economy`，列 = 已配置的 provider，单元格 = model picker（初值取自 `DEFAULT_MODEL_TIERS`）—— 这就是用户要的「每岗位 2–3 个模型」面；每个 role 经其 `RoleTemplate.tier` 指向某一行 |
| 每-role 默认 tier | 每个 agent 旁一个小下拉，覆盖该 role 的默认 tier |
| Bridge 扩展 | `getSmartModeConfig()`, `setSmartModeConfig()`, `getModelTiers()/setModelTiers()` |
| 数据存储 | `team.json` 的 `smartMode` 与 `modelTiers` 键（均可选，缺省回落内置） |
| 验收 | 打开 Settings → Smart Mode → 编辑矩阵某格 → `team.json.modelTiers` 写入；OFF→ON 切换持久化 |

---

### Task 3.4 — 接入 SessionManager

| 项 | 内容 |
|----|------|
| 文件 | `src/session/SessionManager.ts` |
| 改动 | `routeInbound()`（第 291 行）→ `deliverTurn()`（第 321 行）之前：`const tier = SmartMode.selectTier(msg, smartCfg, roleDefault)` → `tierController.applyTiers({ [sessionId]: tier })` |
| 注入 | `applyTiers` 内部 `modelFor(tier, provider)` → `setModel`（第 105 行，改 `info.config.model`），`OpenAICompatBackend` 下个请求即读新 model（零重启，上下文保留） |
| ⚠️ claude 后端 | `setModel` 对 claude headless **不会零重启**（model 是 spawn 时的 `--model`）。v0.1.1：要么走现有 restart 路径，要么对 claude agent 跳过 live tier 切换并在 UI 注明；不要假装热切生效 |
| 验收 | integration 测试（openai-compat）：SM ON + reviewer 默认 `economy` → `deepseek-v4-flash`；发 `metadata.tier: premium` → 切到 `claude-opus-4-8`（按 `DEFAULT_MODEL_TIERS`） |

---

## M4 — Session Memory（Day 7–8）

> ✅ **M4 完成**（commit 待提交）。build/lint/**203 测试**全绿（+7：RulesFile 4、projectContextBlock 2、SessionManager F4 注入 1）。
> 落地文件：新文件 `session/RulesFile.ts`（`load`/`get` + 可注入 reader + `projectContextBlock`/`rulesFilePath` 辅助，纯模块）、`session/SessionManager.ts`（`getProjectContext` dep + `withProjectContext()` 在 start 注入，**不变异** info.config）、`extension.ts`（构造 RulesFile + `**/.roam/rules.md` FileSystemWatcher 重载 + 传 `getProjectContext`）。
> **偏离说明**：RulesFile 保持 vscode-free（reader 注入,可单测），FileSystemWatcher 放 extension 装配（DevPlan 原写 RulesFile.watch()）。
> **运行时语义**：注入发生在 agent **start** 时(系统提示一次性,缓存,便宜)。编辑 rules → watcher 重载缓存 → **新启动/重启**的 agent 生效;已在跑的会话不热改系统消息(避免改 history[0] 的侵入式操作)。Task 4.2 验收②的「下个 task 即更新」收窄为「下次启动生效」——更安全、可解释,留给 Codex 评估是否需要会话内热更。
> **B4**：`package-lock.json` 已提交;E2E devDeps 仍需联网 `npm install` 后跑(非阻塞)。

### Task 4.0 — B4: E2E devDeps 同步（旁路，联网时做）

| 项 | 内容 |
|----|------|
| 现状 | `package-lock.json` **已提交**（2026-06-04 核实）—— lockfile 那半已完成 |
| 剩余 | 在可联网环境 `cd test-e2e && npm install`，让 `@vscode/test-cli` 等 devDeps 解析；再跑冒烟 |
| 验收 | `npm run test:e2e` 可下载 VS Code 并跑通激活/命令注册冒烟（含 Task 4.3 的 rules 注入） |
| 阻塞性 | 非发布阻塞；联网不便时可顺延至发布后补 |

---

### Task 4.1 — RulesFile 实现

| 项 | 内容 |
|----|------|
| 新文件 | `src/session/RulesFile.ts` |
| 方法 | `load()`, `get()`, `watch(onChange)`, `dispose()` |
| 路径 | `<workspaceRoot>/.roam/rules.md` |
| 文件不存在 | `load()` / `get()` 返回 `''`（不报错） |
| watcher | `vscode.workspace.createFileSystemWatcher` → create/change/delete → 自动 `load()` |
| 验收 | 单元测试覆盖文件不在、创建、编辑、删除场景 |

---

### Task 4.2 — 系统提示注入 + watcher 集成

| 项 | 内容 |
|----|------|
| 文件 | `src/extension.ts` — 构造 `RulesFile` → 注入 `SessionManagerDeps` |
| 文件 | `src/session/SessionManager.ts` — `start()` 时调用 `rules.get()` |
| 注入形式 | 在 `backend.start(env)` 前，将 agent 的 `systemPrompt` 追加：`originalPrompt + '\n\n<project_context>\n' + rules.get() + '\n</project_context>'` |
| 运行时更新 | watcher 触发 → `RulesFile.get()` 返回新内容；每个 `sendUserTurn` 前重新读取（可夹带在 `deliverTurn` 或 backend `sendUserTurn` 中） |
| 验收 | ① `.roam/rules.md` 写 "Use strict TypeScript" → launch → system prompt 含 `<project_context>Use strict TypeScript</project_context>` ② 运行时编辑 rules → 下个 task → system prompt 已更新 |

---

### Task 4.3 — E2E smoke

| 项 | 内容 |
|----|------|
| 测试 | `test-e2e/suite/rules-injection.test.ts`：创建默认 team → 验证 rules 注入 system prompt |
| 验收 | E2E 通过 |

---

## Release — Day 9

| 步骤 | 命令 / 动作 |
|------|-------------|
| 1 | `npm version patch` → `0.1.1` |
| 2 | 从 `git log v0.1.0..HEAD --oneline` 生成 `CHANGELOG.md` |
| 3 | `vsce package` |
| 4 | `vsce publish` |
| 5 | `git tag v0.1.1 && git push origin v0.1.1 --tags` |

---

## 风险 & 缓解

| 风险 | 可能性 | 缓解 |
|------|--------|------|
| ~~Claude CLI 不支持某些 flags~~（**已确认事实，非风险**） | — | 已实测：claude headless 仅 `--model/--fallback-model/--effort/--json-schema`。F1 完整面只做 openai-compat；claude 侧只接 `--effort` + 可选 `--json-schema`，其余忽略。已写进 PRD 矩阵 + Task 2.2 |
| Smart Mode tier 切换在 **claude 后端** 不能零重启 | 中 | claude 的 model 是 spawn 时 `--model`，`setModel` 改字段不影响已起进程。v0.1.1 对 claude agent 走 restart 或跳过 live 切换（Task 3.4 已注明） |
| Smart Mode tier 切换导致 **openai-compat** 上下文丢失 | 低 | `setModel()` 只改 `info.config.model` 不重启；下个请求即时生效，history 保留 |
| `.roam/rules.md` watcher 竞态（快速连写触发多次 reload） | 低 | `load()` 用 debounce 300ms |
| `ModelParamResolver` 与既有 `AgentConfig.temperature/maxTokens` 字段双来源冲突 | 低 | 既有 `AgentConfig.temperature`/`maxTokens` 标记 deprecated；resolver 优先读 `modelParams.*`，旧字段作为兜底之一，迁移不破坏 |
| `team.json` 新增可选键被旧 schema 校验拒绝 | 低 | `TeamFileSchema` 已有；为 `modelParams`/`smartMode`/`modelTiers` 加可选校验分支（参考既有 schema 测试） |

---

## Codex Completion Pass — 2026-06-05

After the initial Codex readiness review, the remaining PRD gaps were closed in code and tests:

- B1 queue cancellation/error-drain semantics fixed.
- F1 Settings full parameter surface completed.
- F2 Smart Mode tier params wired through `roam.modelTierParams`.
- F3 `taskTierHints` Settings editor added and Smart Mode input validation hardened.
- F4 running `.roam/rules.md` update semantics implemented.
- B4 lockfile/E2E dependency sync completed; package metadata bumped to `0.1.1`.

Verification now passing:

- `npm.cmd run build`
- `npm.cmd run lint`
- `npm.cmd test` (218 tests)
- `npm.cmd run compile:e2e`
- `npm.cmd run test:e2e` (3 smoke tests)
- `npm.cmd run package` (`roam-crew-0.1.1.vsix`, 5.61 MB)

Remaining pre-publish cautions:

- `npm install` reported 14 npm audit findings; no automatic audit fix was applied.
- See [CODEX_V0.1.1_COMPLETION_LOG.md](CODEX_V0.1.1_COMPLETION_LOG.md) for the detailed action log.
