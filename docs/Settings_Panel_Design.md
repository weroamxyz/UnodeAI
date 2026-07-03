# UnodeAi — Settings 面板设计方案（修订版 v2）

> 把分散在 VS Code 原生 Settings / SecretStorage / `.roam/team.json` / workspaceState 的配置，整合进一个后端感知、默认安全的自定义 Settings 面板。
>
> **本版是对 DeepSeek 初稿（v1.0）的修订。** 初稿结构清晰、痛点抓得准、「原生 vs 自定义」的分工原则也对；但有几处需要纠正：① 把 4 个 Tab 当一个整包，未对齐既有 P0/P1/P2 优先级；② Tab4 重造了原生 Settings（双写同步隐患），恰恰违背了它自己立的原则；③ Tab1 的「显示 API Key」是安全倒退；④ 两处与已定文档冲突的事实错误；⑤ MCP 状态画成全局开关，未反映「后端感知 + default-deny」的真实架构。修订集中标注在 §0，后文按修订后的设计展开。
>
> **版本**：v2 · **日期**：2026-06-02 · **状态**：草案（设计文档）
> **相关文档**：[README 文档地图](../README.md) · [STATUS 进展与下一步](STATUS.md) · [MCP/Skills 设计](MCP_Skills_Integration.md) · [PRD](../PRD_MultiAgent_VSCode_Extension.md)
> **落地状态**（2026-06-02）：⬜ 全部未实现。本设计**不是新增范围**，而是把已排进 P1 的两件事（UI 内编辑 agent、MCP/Skills UI 面板）+ 一个新的高 ROI 小项（API Key 可见性）做成统一面板。落地与排期跟踪见 [STATUS.md](STATUS.md)。

---

## 0. 对初稿的修订摘要（必读）

| # | 初稿（v1.0） | 修订（v2） |
|---|----------|----------|
| 🔑 **R1 优先级对齐** | 4 个 Tab 当一个 ~5–6 天整包，按 P0–P5 顺序排 | **按既有路线图重排**：Tab1（API Key 可见性）= 最高 ROI/最小体量 → 抽出来做**发布快随**；Tab2（MCP）**并入 P1#4 MCP 收尾**；Tab4（Team Config）大幅瘦身（见 R2）；Tab3（Pricing）让位给更要紧的 **Dashboard 趋势图（P0#3）**。见 §5 重排后的实施计划 |
| 🔑 **R2 Tab4 别重造原生 Settings** | Tab4 把 13 个单值配置项（maxConcurrentAgents/logLevel/commandApproval…）在 webview 里重新实现一遍，且承认 `modelPrices`「可在两处编辑」 | **双写=同步隐患，违背初稿自己的原则**。原生 Settings 已把单值设定（枚举校验 + `enumDescriptions`，package.json 已写详尽 description）做得很好。Tab4 **瘦成「快捷区」**：几个按钮 + `workbench.action.openSettings('@ext:roam.roam-crew')` 跳转原生；自定义面板只保留原生做不了的（密钥遮罩、MCP 测试、连接状态） |
| 🔴 **R3 安全：去掉「显示」API Key** | Tab1 mockup 有 `[显示]` 按钮把密钥读出 | **安全倒退**。`SecretsManager` 有 `has()` 足够做「已设置/未设置」指示，**绝不把明文回吐进 webview DOM**。只显示 `●●●●…last4` 或「✅ 已设置」，操作仅 `[更换] [删除]`。webview 用严格 **CSP + nonce**（复用 `TeamViewProvider` pattern），任何 secret 不拼进 HTML |
| 🟠 **R4 事实错误（与已定文档冲突）** | ① mockup 用 `@anthropic/mcp-server-filesystem`；② Anthropic 行既「未设置 [设置]」又注「claude CLI 自带认证」 | ① 该包名不存在，**已被 [MCP 设计 R6](MCP_Skills_Integration.md) 纠正为 `@modelcontextprotocol/server-filesystem`**；② `ClaudeHeadlessBackend` 走 `claude` CLI 自带登录，**不读我们 SecretStorage 的 `ANTHROPIC_API_KEY`**——该行应明确「claude 后端无需在此设 key」，避免诱导用户设一个不被使用的 key |
| 🟠 **R5 MCP 状态后端感知** | MCP server 画成全局 `🟢 running / 🔴 stopped` 单一开关 | 我们的架构：**MCPHub 仅服务 openai-compat；claude 走 `--mcp-config` 自托管；server 对 agent 是 default-deny、按授权挂载**——不存在全局 running 状态。状态改为**三段式**：已注册 / 被哪些 agent 授权 / 是否被某 openai-compat agent 连上。且此面板是 **`requiresApproval` 首次挂载确认（[MCP 设计 §7.2](MCP_Skills_Integration.md)，至今未做）的天然落点** |
| 🟡 **R6 SettingsBridge 与拆分协同** | 把 SettingsBridge 当 UI 的附属 | `SettingsBridge`（集中封装散落的 `getConfiguration('roam')`）正好是 GLM 评审建议「拆 extension.ts」（[STATUS P1#8](STATUS.md)）的一部分。**无论 UI 做不做，先把这个配置访问层抽出来**，extension.ts 立刻瘦身，面板与命令共享同一读写入口 |
| 🟡 **R7 零碎纠正** | 导入/导出、硬编码示意值 | 导入 team.json 必须做 **schema 校验**（防 malformed JSON 崩面板，呼应 PRD §13.5 敞口）；**导出不解析 `${VAR}`**，保持 secret 引用形态、不导出明文；模型数（初稿「147」）与模型命名一律从 `ModelCatalog` 实时取，不硬编码 |

---

## 1. 现状分析

### 1.1 当前 Settings 入口

| 入口 | 实现 | 问题 |
|------|------|------|
| VS Code 原生 Settings UI | `package.json` → `contributes.configuration`，13 个属性 | 用户需切到 Extensions 面板找 UnodeAi；无法分组；API Key 无法在原生 Settings 做密码遮罩 |
| `roam.setApiKey` 命令 | `SecretsManager.promptAndStore()` | 一次性、无上下文；**看不到「哪个 key 设了哪个没设」** |
| `roam.addAgent` 命令 | 4–5 步 QuickPick 向导 | 工作正常，但创建后的 agent 编辑/调参无处可点 |
| MCP Server 注册 | 仅靠手动编辑 `.roam/team.json` | 纯 JSON、无 GUI、无校验、无连接测试 |
| 模型价格 | `roam.modelPrices` JSON 对象 | 纯 JSON、易出错、无预览 |

### 1.2 痛点（按真实严重度排序）

1. **API Key 不可见**（最痛、最易解）：用户不知道 `ROAM_API_KEY` 设了没、有哪些 provider key —— 直接卡住首次上手。
2. **Agent 创建后不可编辑**：改 model/backend/tools 只能删了重建（= [STATUS P1](STATUS.md) 已列项）。
3. **MCP Server 无 GUI + 无审批**：手写 `.roam/team.json`，连接状态不可见，敏感 server 无 `requiresApproval` 确认（= [STATUS P1#4](STATUS.md) MCP 收尾）。
4. 价格配置门槛高、设置分散（次要）。

---

## 2. 设计方案：混合式 Settings 面板

### 2.1 总体策略（保留初稿原则，但 Tab4 据此修正）

```
┌──────────────────────────┬────────────────────────────────────┐
│  VS Code 原生 Settings     │  UnodeAi 自定义 Settings Panel     │
│  (package.json，单值设定)   │  (Webview，原生做不了的交互/可视化)    │
├──────────────────────────┼────────────────────────────────────┤
│ • maxConcurrentAgents     │ • API Keys 管理（遮罩，不 reveal）    │
│ • logLevel                │ • MCP Server 注册/测试/授权/审批      │
│ • messageRetentionDays    │ • Agent 编辑（model/baseUrl/tools…）  │
│ • autoSaveInterval        │ • Provider 连接健康检查 & 状态概览     │
│ • defaultProvider/baseUrl │ • 模型价格表（可视，缓做）            │
│ • modelCatalogUrl         │ • 一键导出/导入 team.json（带校验）   │
│ • pricingSources          │                                      │
│ • concurrencyStrategy     │  ← Tab4 不再重造左侧这些单值项；       │
│ • verifyCommand           │     只放一个「跳转原生 Settings」快捷区 │
│ • commandApproval         │                                      │
│ • allowedCommands         │                                      │
│ • modelPrices             │  ← 单一真相源：手动价仍以配置为准，    │
│                           │     面板编辑 = 写同一份配置，不双写     │
└──────────────────────────┴────────────────────────────────────┘
```

**原则**（R2 强化）：
- 单值类型设定（数字/枚举/字符串列表）**只留在原生 Settings**，自定义面板**不复制**，仅提供跳转。
- 需要交互、可视化、跨数据源（config + SecretStorage + team.json）关联的功能，才进自定义面板。
- 任何「两处可编辑同一数据」的设计一律避免——必要时面板只是同一配置项的另一视图，写回同一个 `configuration.update()`，不引入第二真相源。

### 2.2 入口

| 入口 | 位置 | 说明 |
|------|------|------|
| 命令面板 | `UnodeAi: Open Settings`（`roam.openSettings`，待注册） | `Ctrl+Shift+P` |
| Activity Bar 视图 | Team Panel 标题栏 ⚙ 图标 | view/title menu，复用现有按钮组 |
| 状态栏 | 状态栏项右键 → "Settings…" | 快捷入口 |

### 2.3 面板结构（3 个核心 Tab + 1 个瘦身 Tab）

```
┌─────────────────────────────────────────────────────────┐
│  ⚙ UnodeAi Settings                              [×]  │
├─────────────────────────────────────────────────────────┤
│  [Providers]  [MCP Servers]  [Pricing]  [More ⚙→原生]    │
└─────────────────────────────────────────────────────────┘
```

#### Tab 1: Providers（API Keys & 网关）— **最高优先，发布快随**

```
┌─────────────────────────────────────────────────────────┐
│  Providers                                     [刷新]   │
├─────────────────────────────────────────────────────────┤
│  🏠 Roam (算力仓)                                       │
│  ├─ API Key:  ✅ 已设置  ●●●●…a1b2     [更换] [删除]    │  ← 不 reveal，仅 last4
│  ├─ Base URL: https://computevault.../v1   [测试连接]   │
│  ├─ 状态: ✅ 已连接 — 模型数: <从 ModelCatalog 实时取>   │
│  └─ 上次刷新: 2026-06-02 11:45                           │
│                                                         │
│  🤖 Anthropic (Claude 后端)                              │
│  └─ ℹ claude 后端通过 `claude` CLI 自带认证，无需在此设 key │  ← R4 修正
│                                                         │
│  🔵 OpenAI / 🔧 Custom                                   │
│  └─ API Key:  ⚠ 未设置                      [设置]      │
│                                                         │
│  [+ Add Custom Provider]（v2，初版仅预设 provider）       │
└─────────────────────────────────────────────────────────┘
```

**数据源**：`SecretsManager.has()`（**不调 `get()` 回吐明文**）+ `getConfiguration('roam').baseUrl`。
**操作**：设置/更换/删除 → `SecretsManager.set()/.delete()`；测试连接 → 打 `/v1/models`；模型数复用 `ModelCatalog`。
**安全（R3）**：只显示「已设置 + 末 4 位」或纯状态徽章；reveal 全文按钮不做；webview 严格 CSP + nonce；secret 不进 HTML。

#### Tab 2: MCP Servers — **并入 P1#4 MCP 收尾**

```
┌─────────────────────────────────────────────────────────┐
│  MCP Servers                     [+ Add Server] [导入]  │
├─────────────────────────────────────────────────────────┤
│  📁 filesystem                   stdio                   │
│  ├─ command: npx -y @modelcontextprotocol/server-filesystem ${WORKDIR}│ ← R4
│  ├─ ⚠ requiresApproval: true   (首次挂载需确认)          │ ← R5: 审批落点
│  ├─ 已注册 ✓ | 授权给: senior-dev, reviewer              │ ← R5: 后端感知
│  └─ openai-compat 连接: 🟢 已连(dev) | claude: 自托管     │
│      [Edit] [Test] [撤销授权] [Remove]                   │
│                                                         │
│  (空状态) No MCP servers registered.                     │
│  [+ Add your first MCP server]                          │
│                                                         │
│  📋 .roam/team.json  [Open file] [Export（不含明文 secret）]│ ← R7
└─────────────────────────────────────────────────────────┘
```

**数据源**：`mcpRegistry` ← `PersistenceManager.loadTeamMcpServers()`；运行态来自 `MCPHub`（仅 openai-compat）。
**状态语义（R5）**：不是全局 running/stopped，而是「已注册 / 被哪些 agent 授权（default-deny）/ 是否被某 openai-compat agent 连上」；claude 后端标注「自托管（`--mcp-config`）」。
**审批（R5）**：`requiresApproval=true` 的 server（filesystem/github 等）首次被授权/挂载时，面板弹确认——补上 MCP 设计 §7.2 至今未做的那一环。
**操作**：Add（表单按 transport 展开 command+args / url）；Test（`MCPHub` connect + list tools）；授权/撤销（写 agent 的 grant）；Remove（删 registry + 写回 team.json，带 schema 校验 R7）。

#### Tab 3: Pricing — **可缓；真正的成本缺口是 Dashboard 趋势图（P0#3）**

保留初稿的价格表设计（Live Sources + Manual Overrides + 可视表格），但：
- 表格内容**从 `ModelPricing`/`LivePriceService` 实时取**，不硬编码示意值（R7）。
- 手动价编辑 = 写 `roam.modelPrices` 这**同一份配置**，不在面板另存一份（R2 单一真相源）。
- 实际排期低于 P0#3：用户更需要「按 agent/阶段的成本趋势」而非「编辑单价」。本 Tab 在 Dashboard 成本可视化完成后再做更顺。

#### Tab 4 → "More"：**瘦身为跳转原生（R2）**

不再重造 13 个单值配置项。改为一个轻量区：
```
┌─────────────────────────────────────────────────────────┐
│  More Settings                                          │
│  并发 / 安全 / 日志 / Provider 默认值等单值设定，          │
│  由 VS Code 原生 Settings 管理（带校验与说明）：           │
│      [ ⚙ 打开 UnodeAi 原生设置 ]                        │  → workbench.action.openSettings('@ext:roam.roam-crew')
│  [Export team.json]  [Import team.json（带 schema 校验）] │
└─────────────────────────────────────────────────────────┘
```
> Agent 编辑（初稿 Tab4/P4）独立成「Agent 编辑」能力：Team Panel 卡片加 ✏ → 打开面板的 agent 编辑视图，预选中该 agent（= [STATUS P1](STATUS.md)「UI 内编辑已建 agent」）。

---

## 3. 技术实现

### 3.1 新增文件

```
src/
  views/SettingsPanel.ts        ← Webview Panel Provider（命令 roam.openSettings）
  settings/SettingsBridge.ts    ← 统一读写 config/密钥/MCP 的后端桥接层（R6：先抽）
```

### 3.2 SettingsBridge（R6：与 extension.ts 拆分协同，优先抽出）

封装所有 Settings 读写，**消除散落在 extension.ts 的 `getConfiguration('roam')`**——即便 UI 暂不做，这一层也独立有价值（直接服务 [STATUS P1#8](STATUS.md) 的 extension.ts 瘦身）。

```typescript
export interface ProviderStatus {
  providerId: string; name: string;
  hasApiKey: boolean;        // 来自 SecretsManager.has()，不含明文
  keyHint?: string;          // 末 4 位，可选；绝不传完整 key
  baseUrl: string; connected: boolean; modelCount: number; lastChecked: string;
  usesCliAuth?: boolean;     // anthropic/claude：true → 前端显示「无需设 key」
}
export interface McpServerStatus {
  config: MCPServerConfig; registered: boolean;
  grantedTo: string[];       // 被授权的 agent id（default-deny）
  connectedByOpenAICompat: string[]; selfHostedByClaude: boolean;
  toolCount?: number; requiresApproval: boolean;
}
export interface SettingsSnapshot {
  providers: ProviderStatus[];
  mcpServers: McpServerStatus[];
  pricing: { sources: string[]; overrides: Record<string, ModelPrice>; livePrices: Record<string, ModelPrice> };
  // 注意：不再镜像全部 roam.* 单值项（R2）；More Tab 跳转原生
}
```

**职责**：`getSnapshot()`；`setApiKey/deleteApiKey`（经 SecretsManager，不读回明文）；`addMcpServer/removeMcpServer/testMcpServer/grantServerToAgent`（写 team.json + MCPHub，带 schema 校验）；`refreshPrices()`；`setConfig(key,value)`（少量面板内联编辑统一走 `configuration.update`，单一真相源）。

### 3.3 SettingsPanel（消息协议，与 TeamViewProvider 风格一致）

| Direction | Message | Payload | 备注 |
|-----------|---------|---------|------|
| webview → ext | `getSnapshot` | `{}` | |
| ext → webview | `snapshot` | `SettingsSnapshot` | 不含明文 secret |
| webview → ext | `setApiKey` / `deleteApiKey` | `{ providerId, value? }` | |
| webview → ext | `testProvider` | `{ providerId }` | 打 /v1/models |
| webview → ext | `addMcpServer`/`removeMcpServer`/`testMcpServer` | `MCPServerConfig` / `{id}` | 带校验 |
| webview → ext | `grantServer`/`revokeServer` | `{ serverId, agentId }` | default-deny 授权 |
| webview → ext | `refreshPrices` | `{}` | |
| ext → webview | `error` | `{ message, hint? }` | 错误友好（含排查建议） |
| ext → webview | `apiKeyUpdated` / `mcpStatusChanged` / `pricesUpdated` | … | 增量刷新 |

**安全要点**：`retainContextWhenHidden: true`（避免操作 key 时丢输入）；CSP `default-src 'none'` + nonce 脚本；密钥永不下发到 webview。

### 3.4 extension.ts 改动

```diff
+ import { SettingsPanel } from './views/SettingsPanel';
+ import { SettingsBridge } from './settings/SettingsBridge';
+ const bridge = new SettingsBridge(secrets, persistence, mcpHub, pricing, livePrices);
+ reg('roam.openSettings', () => SettingsPanel.createOrShow(extensionUri, bridge));
+ // Agent 编辑：Team Panel ✏ → 打开面板并预选 agent
```

---

## 4. UI 设计原则

1. **原生主题适配**：全部用 `--vscode-*` CSS 变量，跟随亮/暗主题。
2. **Tab 切换不滚出视口**；即时反馈（Toast + 面板内状态指示）。
3. **错误友好**：连接/启动失败显示具体错误 + 排查建议。
4. **安全**（R3）：API Key 仅遮罩/状态，不 reveal；严格 CSP + nonce；secret 不进 webview。
5. **复用 `TeamViewProvider` 的 `.agent-card` / `.btn` / `.status-badge` 与 nonce/CSP pattern**。

---

## 5. 实施计划（R1：按既有路线图重排）

> 不再是一个独立的 P0–P5 整包，而是分散接入既有优先级。

| 顺序 | 内容 | 对应 [STATUS](STATUS.md) | 体量 |
|------|------|------|------|
| **1（发布快随）** | `SettingsBridge` 抽出 + Tab 1 Providers（API Key 可见性，遮罩不 reveal） | 新增高 ROI 项 + 服务 P1#8 拆分 | ~1–1.5 天 |
| **2** | Tab 2 MCP Servers（注册/测试/授权/审批，后端感知状态） | **并入 P1#4 MCP 收尾** | ~1.5 天 |
| **3** | Agent 编辑视图（Team Panel ✏ → 面板预选 agent） | **P1「UI 内编辑 agent」** | ~1 天 |
| **4** | "More" Tab（跳转原生 + 导入/导出带校验） | 收尾 | ~0.5 天 |
| **5（缓）** | Tab 3 Pricing 表 | 在 **P0#3 Dashboard 趋势图**之后 | ~1 天 |

---

## 6. 待决定事项

1. **Agent 编辑入口**：Team Panel 卡片 ✏ → 打开 Settings 面板的 agent 编辑视图、预选中该 agent（建议；避免 Team Panel 内 inline 编辑把两个面板职责搅在一起）。
2. **自定义 Provider**：初版仅预设 roam/anthropic/openai/google/ollama/custom；用户自定义 provider 列 v2。
3. **面板生命周期**：`retainContextWhenHidden: true`（操作 API Key 时不丢输入）。
4. **Pricing Tab 时机**：确认是否等 Dashboard 成本趋势（P0#3）落地后再做，避免两处成本视图重复。
