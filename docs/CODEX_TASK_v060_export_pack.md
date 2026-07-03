# Codex 任务卡 v0.6.0 E1 — 导出团队/角色为可分享 pack(Marketplace 地基的「发布」侧)

**目标**:让用户能把**当前团队**或**单个 agent**导出成一个声明式 pack 文件(YAML),格式对齐 Kilo Code 的
modes,可直接分享 / 提 PR 进 `roam-marketplace`。这是 V0.6.0 Marketplace 的「发布/导出」侧(E1),与 Claude 正在
做的 E0 catalog 地基**不重叠**,可在 M1 期间并行起步。

**范围 = 只做「导出 + schema + 文档」,不碰商店 UI / 安装 / catalog 拉取**(那是 Claude 的 E0)。
**参考**:[PRD_v0.6.0_Marketplace.md](PRD_v0.6.0_Marketplace.md) §2.1 / §3.1 / E1。

## Worktree
```
git worktree add ../roam-crew-codex-export -b codex/marketplace-export
cd ../roam-crew-codex-export && npm install
```
基于最新 main(v0.5.1 之后)。

## 先调研(这几处是关键)
- **团队/agent 的现有序列化**:`team.json` 的读写、Create-Team 选择器怎么落地一支团队、Add-Agent 怎么存单个
  agent 配置(role / provider / model / system prompt / modelParams / capability)。找到「一个团队/一个 agent 的
  完整可序列化形态」。
- **现有 export/import 管道**:Chat/Messages 的 export/import(v0.2.32)是参照,但**那是会话数据,不是配置**——
  这次导的是**团队/角色定义**,别复用错对象。
- **capability/工具权限模型**:agent 声明的 read/write/command/fetch/MCP 能力在哪定义(SkillResolver / 角色模板
  / team.json schema),导出时要原样带上(装回时仍走 default-deny,见 PRD §3.2)。
- **Kilo modes 字段**:看 `Kilo-Org/kilo-marketplace` 的 `modes/*.yaml`(角色 + 工具访问 + 文件读写限制 +
  指令),pack 字段尽量对齐以便互导。

## 要实现
1. **pack schema v1(声明式 YAML)** — 先和 Claude 对一版字段再写代码:
   - `team.yaml`:`kind: team`、`id`、`name`、`description`、`author`、`version`、`agents: [...]`(每个含 role/
     provider/推荐 model 或成本档/system prompt/capability/modelParams)、`coordinator`(PM)。
   - `agent.yaml`:`kind: agent`、单个角色的同上字段(≈ Kilo mode)。
   - 用现有 **ajv** 校验(YAML→JSON 后),放一份 JSON Schema 进仓库(`schemas/roam-pack.schema.json`)。
2. **导出命令/按钮**:
   - 命令 `roam.exportTeamPack`(把当前/选定团队 → `team.yaml`)和 `roam.exportAgentPack`(选定 agent →
     `agent.yaml`),走 VS Code save 对话框写文件。
   - Team 面板 `view/title` 加一个「Export Pack」入口(与现有 export 按钮风格一致)。
3. **导出内容净化**:**绝不**把 API key / secret / 本地绝对路径写进 pack(密钥本就在 SecretStorage,不在配置里;
   再加一道断言)。`baseUrl` 等可保留但标注。
4. **文档**:`docs/CONTRIBUTING_PACKS.md` —— 抄 Kilo 贡献流程(查重、按模板、测试、提 PR),说明导出的 pack 怎么
   提进 `roam-marketplace`。

## 允许改的文件
- 新增:`src/marketplace/PackExport.ts`(导出逻辑)、`src/marketplace/packSchema.ts` + `schemas/roam-pack.schema.json`、
  命令注册(`package.json` contributes + extension.ts 命令接线)、`docs/CONTRIBUTING_PACKS.md`。
- 可读不可改:团队/agent 的现有序列化模块(只读取它们的形态,别改它们的存储格式)。
- **别动**:E0 的 catalog/安装路径(Claude 在做)、协议(native/xml)、泄漏恢复、checkpoint、审批、pricing 这些
  刚改过的区域。

## 测试
- 单测:构造一支含 PM + 2 专家的团队 → 导出 → 校验 YAML 通过 schema、字段齐全、**不含密钥/绝对路径**;构造单
  agent → 导出 → 同上。round-trip 的「装回」侧由 E0/M2 做,这里只断言导出产物合法。
- 沿用现有测试的 fake 注入风格,不依赖真实网络/agent。

## 自验证 + 验收
```
npm run build && npm run lint && npm test && npm run compile:e2e   # 全绿
```
- 验收:在真实工作区建一支团队 → Export Pack → 得到一个合法 `team.yaml`,人读一眼字段对、无密钥泄漏。
- **开工前先把 schema v1 字段发给 Claude 评审**(对齐 Kilo + 与 E0 装载侧契约一致),再写实现。
- Claude review 后合并进 v0.6.0-alpha。worktree 保持干净。
