# PRD v0.6.0 — Marketplace / 可扩展生态(Extensibility Store)

> **状态**:草案(Claude 起草,待你拍板范围)· **日期**:2026-06-10 · **基线**:v0.5.1 已上架 Marketplace
> **头牌主题**:把 UnodeAi 从「内置一套 agent/团队」升级为「**可装、可分享、可扩展**的 AI 团队平台」。
> **战略定位**:这是 Cline/Roo 做不到的差异化——它们是「单强模型 + 内置工具」;UnodeAi 是「多 agent
> 团队 + 便宜模型套利 + 可扩展生态」。Cline parity 的体验差距**不在这条线**,走 V0.5.x 小迭代补(见
> [UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md))。
>
> **文档治理**:本 PRD 与 STATUS/BACKLOG/DevPlan 由 Claude 统一维护。其它助手(Codex/DeepSeek)的想法写
> 进 [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md),勿直接改本文。每个 Epic 开工时由 Claude 出逐文件 DevPlan +
> 任务卡,指定允许改的文件范围(worktree 隔离,不重叠)。

---

## 一、为什么是 Marketplace(问题陈述)

今天 UnodeAi 的能力是**封死在扩展里的**:
- 角色/团队是内置的(软件团队 + 3 个知识工作团队),用户想要一个「法律团队」「SRE 团队」只能自己一个个
  Add Agent 手搓 system prompt。
- MCP server 要手改配置 JSON,没有「发现→一键装→配权限」的路径(BACKLOG 里的 "MCP Setup 向导" 一直没做)。
- 用户调好的一套团队 / 一条 prompt 模板,**没法分享**给别人,也没法从别人那里装过来。

这三件事合起来就是一个 **Marketplace(可扩展生态)**:让能力可以被**第三方/社区贡献**,让用户**一键获取**,
让 UnodeAi 的价值随生态增长而不是随我们的内置内容增长。这是平台型护城河。

### 北极星
> 用户能在 30 秒内,从商店里装好一个「现成的 AI 团队」或一个 MCP 工具,并立刻用起来——**不碰任何配置文件**。

---

## 二、范围与三个 tab

商店分三类内容(Kilo Code 式三 tab),但**不一次全做**,按杠杆/复杂度分阶段:

商店分三类内容(**直接对标 Kilo Code 的三类:Skills / MCP Servers / Modes**),按杠杆/复杂度分阶段:

| Tab | 内容 | 对应 Kilo | 杠杆 | 复杂度 | 本版阶段 |
|-----|------|-----------|------|--------|----------|
| **Teams & Agents** | 可分享的「团队预设」(整套 PM+专家)和单个「角色包」(role + 默认模型 + system prompt) | Kilo 的 **Modes**(单 agent)→ 我们**扩成多 agent 团队**(护城河) | 🥇 最高(直接放大「AI 团队」卖点) | 中(已有 export/import + Create-Team 选择器地基) | **M2(核心)** |
| **MCP Servers** | 精选第三方 MCP server(GitHub / Playwright / Filesystem…),一键装 + 配权限向导 | Kilo 的 **MCP Servers**(基本照搬) | 🥇 高(补 backlog 一直缺的 MCP 向导) | 中(default-deny 安全模型已有) | **M3** |
| **Skills / Templates** | 可复用技能包/任务模板/slash 命令,**遵循开放 Agent Skills 规范** | Kilo 的 **Skills**(同一开放规范 → 互通) | 🥈 中(与 slash 命令重叠) | 小 | **M4(可顺延 v0.6.x)** |

> **拍板点 ①(✅ 已定 2026-06-10)**:三 tab 优先级 = **Teams&Agents → MCP → Skills**。M2=Teams、M3=MCP、
> M4=Skills(可顺延)。

### 2.1 参考 Kilo Code(`Kilo-Org/kilo-marketplace`)——抄对的、分叉的
Kilo Code 的 marketplace 是一个 **curated git 仓库**(Apache-2.0),按目录分三类:`skills/`(每个技能 = 一个含
`SKILL.md` 的文件夹,YAML frontmatter,遵循**开放的 Agent Skills 规范**,跨工具互通)、`mcps/`(MCP server
配置)、`modes/`(YAML 定义的自定义 agent:角色 + 工具访问权限 + 文件读写限制 + 行为指令)。贡献 = 向该仓库提
PR(查重、按模板、跨平台测、清晰文档)。

**我们照抄的(别重新发明)**:
- **registry = 一个 curated git 仓库**(`roam-marketplace`),按目录分类 + 一个 `index.json`,**而不是裸单 JSON**
  (这点比我初稿更好,改用 Kilo 的目录约定,见 §3.1)。
- **贡献 = GitHub PR 流程**(模板 + 查重 + 文档),零后端冷启动。
- **Skills 直接采用开放 Agent Skills 规范**(`SKILL.md` + YAML frontmatter),**不自造格式**。
- **Agents/Modes 用 YAML 声明**(角色 + capability/工具权限 + 文件读写限制 + 指令),字段尽量对齐 Kilo modes。

**我们分叉/超过 Kilo 的(= 护城河)**:
- **Teams(多 agent)**:Kilo 的 modes 是**单** agent;我们的 Teams&Agents tab 卖的是**整支 AI 团队**(PM+专家
  一键装好就能协作)——这是 Kilo 结构上没有的,是我们最大的差异化。
- **便宜模型套利**:pack 可声明「推荐模型/成本档」,配合现有 Smart Mode/成本路由,装来的团队默认走便宜档。

> **冷启动红利(战略点)**:因为 Skills 用开放 Agent Skills 规范、modes/skills 都是声明式 YAML,**UnodeAi 可
> 以直接导入 Kilo 的现有 marketplace 内容(modes→agents、skills→skills)**,商店开门就不空。M2 的「从 git URL
> 装」要把 `Kilo-Org/kilo-marketplace` 作为首个可识别来源做兼容适配(import adapter)。

---

## 三、内容来源与安全模型(最关键的架构决策)

### 3.1 来源(catalog source)——拍板点 ②(对齐 Kilo)
**采用 Kilo Code 的模式:registry = 一个 curated git 仓库**,而非裸单 JSON。三层来源:

1. **精选 registry(默认)= `roam-marketplace` git 仓库**。目录约定(抄 Kilo):
   ```
   roam-marketplace/
   ├── index.json        # 索引:每条 = id/名/描述/作者/版本/图标/kind/path/可信档
   ├── teams/<id>/team.yaml      # 团队预设(多 agent,Roam 独有)
   ├── agents/<id>/agent.yaml    # 单角色包(≈ Kilo mode)
   ├── mcps/<id>/mcp.yaml        # MCP server 配置(≈ Kilo mcps/)
   └── skills/<id>/SKILL.md      # 技能包(开放 Agent Skills 规范,与 Kilo 互通)
   ```
   扩展启动 + 每日 + 打开商店时拉 `index.json` + 按需拉单个 pack,缓存。**我们策展,质量可控。**(数据层复用
   `roam.modelCatalogUrl` 既有的「远端拉取 + 合并内置 + 缓存」套路,只是源从单 JSON 换成 git 仓库 + index。)
2. **从 Git URL / 本地文件夹装(power user)**:贴任意 git 仓库或本地路径读 pack 装进来。**首个要兼容的外部源 =
   `Kilo-Org/kilo-marketplace`**(import adapter:Kilo modes→agents、Kilo skills→skills),吃到冷启动红利。
   非精选源默认标 ⚠ unverified + 需用户显式确认。
3. **发布/提交 = GitHub PR**(抄 Kilo 的贡献流程):创作者把 pack 提 PR 到 `roam-marketplace`(模板 + 查重 +
   文档);或用 E1 的「导出为 pack」直接分享文件。**M2/M3 先只做「装」+「导出」,托管式提交后台留到 v0.6.x。**

> **拍板点 ②(✅ 已定 2026-06-10)**:registry = **精选 git 仓库 `roam-marketplace`(抄 Kilo)+ 从 git/本地装
> (首兼容 `Kilo-Org/kilo-marketplace`)**。不做后台服务。
>
> **pack 格式**:`*.yaml`(teams/agents/mcps)+ `SKILL.md`(skills),字段对齐 Kilo modes/skills 以便互导;
> 用现有 ajv schema 校验(YAML→JSON 后校验)。E1 导出产物同此格式,可直接提 PR 进 registry。

### 3.2 安全模型(default-deny,不可妥协)
这是 Marketplace 最大的风险面,Claude 亲自把关:
- **装一个 pack ≠ 授权它做任何事。** 团队/角色 pack 只带 prompt+模型+capability **声明**;capability(read/
  write/command/fetch/MCP)沿用现有 default-deny + 命令审批 + 写审批,装完后用户该批的还得批。
- **MCP server pack** 装上后默认**不启用任何工具**,逐个工具要用户在向导里勾选启用(对齐现有 MCP default-deny)。
- **来源可信度标识**:精选(✓ Roam curated)/ 社区(⚠ community)/ 本地或 git(⚠ unverified)三档可视标签。
- **payload 校验**:装之前用现有 ajv schema 校验 pack(YAML→JSON 后);拒绝带可执行代码的 pack(M2/M3 的
  pack 只能是声明式 YAML/SKILL.md——角色/团队/MCP 配置/技能,**不含任意代码**;带代码的扩展是另一个量级,不在
  本版。注:Kilo 的 skills 可带 `scripts/` 辅助脚本——我们 v0.6.0 **先不执行** pack 内脚本,只取其声明式部分)。
- **不引入 SSRF/路径逃逸**:catalog/git 拉取复用 `webFetch.ts` 的 SSRF 防护;本地 pack 读取做 realpath 包含
  校验(对齐 @file 的处理)。

---

## 四、Epics(本版交付物)

### E0 — Marketplace 地基(shell + catalog 数据层 + 安全)· Claude
- 商店入口(Team 面板右上角 `$(extensions)` 按钮 / 命令 `roam.showMarketplace`)。
- Marketplace webview 外壳:三 tab、搜索、来源筛选、卡片(图标/名/作者/可信标签/装按钮)、已装/可更新状态。
- **catalog 数据层**:`MarketplaceCatalog`——拉取 `roam-marketplace` 的 `index.json` + 按需取单 pack + 合并
  内置 + 缓存 + 刷新策略(复用 `modelCatalogUrl` 既有套路);pack(YAML/SKILL.md)的 ajv schema + 校验;来源
  可信度分级;Kilo 仓库 import adapter 的接口位。
- 装/卸/启停的统一 plumbing + 持久化(`.roam/installed-packs.json` 或 globalState,跨 reload 存活)。
- **安全门**:default-deny、可信标签、payload 校验、SSRF/路径校验(见 §3.2)。

### E1 — 发布/导出(让用户能分享)· Codex(规格明确)
- 「导出为 pack」:把当前团队 → `teams/<id>/team.yaml`;把单个 agent → `agents/<id>/agent.yaml`(声明式
  YAML,字段对齐 Kilo modes,复用现有 team/agent 序列化 + export/import 管道)。导出产物可直接提 PR 进
  `roam-marketplace`。
- 文档化「提交到 Roam registry」的 GitHub PR 流程(`CONTRIBUTING_PACKS.md` + registry 仓库模板,抄 Kilo 的
  贡献模板)。

### E2 — Teams & Agents tab(核心)· Codex 主力 + Claude 审
- 浏览/搜索团队预设 + 角色包;一键「装这个团队」→ 走现有 Create-Team 落地(直接生成 agents,不碰配置文件)。
- 装单个角色包 → 进 Add-Agent 的角色列表。
- 「我的」:已装内容管理 + 一键卸载。
- 精选首发内容(Roam 出品 ≥6 个团队 pack:法律 / SRE-运维 / 数据分析 / 内容营销 / 产品设计 / 学术研究——
  把「AI 团队」推出编码圈,呼应原 BACKLOG 知识工作方向)。

### E3 — MCP Servers tab + 配置向导 · Codex 主力 + Claude 审(安全)
- 精选 MCP server 列表(GitHub / Playwright / Filesystem / Fetch / 数据库…),一键装。
- **配置向导**:填 server 启动参数/密钥(密钥走 VS Code SecretStorage,不落明文)、**逐工具勾选启用**
  (default-deny)。吸收 BACKLOG 里一直没做的 "MCP Setup 向导"。
- 对齐现有 MCP live 验证路径([MCP_LIVE_VALIDATION_REPORT.md](MCP_LIVE_VALIDATION_REPORT.md))。

### E4 — Skills / Templates tab(可顺延)· DeepSeek 候选 + Claude 审
- 可复用 prompt/任务模板 + slash 命令的「装」;与现有 @-context / slash 打通。
- 若 M1–M3 工期吃紧,**整体顺延到 v0.6.x**,不阻塞 v0.6.0 发布。

---

## 五、里程碑与排期(Claude + Codex 并行,worktree 隔离)

> **硬规则(沿用)**:Codex 独立 git worktree + 分支(`git worktree add ../roam-crew-codex-<task> -b
> codex/<task>` → `npm install`);Claude 在 main 审查后合并;无人自合并/自发布。每个任务由 Claude 指定允许
> 改的文件范围,不重叠。每个 Epic 开工前 Claude 出逐文件 DevPlan + 任务卡。

| 里程碑 | 内容 | 负责人 | 验收门 | 目标版本 |
|--------|------|--------|--------|----------|
| **M1** | E0 地基(shell + catalog 数据层 + 安全模型) | **Claude**(架构关键路径,亲自做) | build+lint+test 全绿;商店能拉 registry、渲染卡片、装一个内置 stub pack 跑通装/卸 | v0.6.0-alpha1 |
| **M2** | E2 Teams&Agents tab + E1 导出 | **Codex**(worktree)+ Claude 审 | 从商店一键装一个团队 → 直接出 agents 可对话;导出团队为 pack 再装回 round-trip | v0.6.0-beta1 |
| **M3** | E3 MCP tab + 配置向导(安全:Claude 把关) | **Codex**(worktree)+ Claude 审安全 | 装一个 MCP server + 向导配密钥 + 逐工具启用;default-deny 验证;一个真实 MCP(如 Filesystem)live 跑通 | v0.6.0-rc | 
| **M4** | E4 Skills tab(可选) | DeepSeek 候选 + Claude 审 | 装一个模板能用;否则顺延 v0.6.x | v0.6.0 或 v0.6.x |
| **GA** | 精选首发内容(≥6 团队 pack + ≥5 MCP pack)+ 商店 listing 截图 + CHANGELOG + 发布 | **Claude** | 全门禁绿 + 现场验收 + 你拍板 | **v0.6.0** |

**并行起步(M1 期间就能铺开)**:
- **Claude**:M1 地基(E0)——这是所有 tab 的依赖,先解封。
- **Codex(worktree `codex/marketplace-export`)**:E1 导出 pack(只动序列化/导出管道 + 新 pack schema,不碰
  E0 的 catalog 层),与 Claude 的 E0 不冲突,可同时跑。
- **DeepSeek + UnodeAi**:dogfood 当前 v0.5.1 主线 + 起草精选团队 pack 的内容(prompt/角色),走
  [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md),Claude 策展定稿。

**节奏**:不憋大版本。M1 done 即发 `0.6.0-alpha`(内部),M2/M3 各发一个预览,GA 才是公开 v0.6.0。期间 V0.5.x
的 Cline-parity 小迭代**并行照常发**(两条线不互锁:V0.5.x 走 main 的 hotfix 节奏,V0.6.0 走 worktree 攒)。

---

## 六、非目标(本版明确不做)
- ❌ 带**可执行代码**的第三方扩展(沙箱/签名/审核是另一个量级,留到生态成熟后)。
- ❌ 托管式 registry 后台服务(鉴权/审核/CDN)——MVP 用 Roam-hosted JSON + GitHub PR 提交。
- ❌ 付费/计费的 pack(变现留到后面)。
- ❌ 评分/评论/下载量等社区社交功能(冷启动不需要)。

---

## 七、风险与缓解
| 风险 | 缓解 |
|------|------|
| 安全(装了恶意 pack) | 声明式 JSON-only pack(无代码)+ default-deny + 可信标签 + ajv 校验 + SSRF/路径防护(§3.2),Claude 亲自把关 M3 |
| 冷启动内容空 | GA 前 Roam 自产 ≥6 团队 + ≥5 MCP 精选,商店开门就不空 |
| 体量失控 | 严格分阶段(M1 地基→M2 团队→M3 MCP),Skills 可顺延;非目标清单兜底 |
| 与 V0.5.x parity 线抢资源 | 两线物理隔离:parity 走 main hotfix(小、勤发),Marketplace 走 worktree(大、攒) |

---

## 八、开工前待办(Claude)
1. 出 **E0 逐文件 DevPlan**(`DEVPLAN_v0.6.0_marketplace.md`):`MarketplaceCatalog` / pack schema /
   install 管道 / webview 的具体文件与接口。
2. 定 **pack schema v1**(team.yaml / agent.yaml / mcp.yaml + SKILL.md 四种 kind 的字段,对齐 Kilo modes/
   skills),先写进 DevPlan 评审。
3. 出 **Codex E1 任务卡**(导出 pack)+ **DeepSeek/Kimi 首轮 UX 基准任务卡**,让两方在 M1 期间并行起步。
4. ✅ **拍板点 ① ② 已确认(2026-06-10)**:tab 顺序 Teams→MCP→Skills · registry = git 仓库抄 Kilo。按此执行。

> 下一步文档:`DEVPLAN_v0.6.0_marketplace.md`(E0 逐文件)· [CODEX_TASK_v060_export_pack.md](CODEX_TASK_v060_export_pack.md)
> (E1 任务卡,已出)· [DEEPSEEK_TASK_ux_benchmark_round1.md](DEEPSEEK_TASK_ux_benchmark_round1.md)(基准任务卡,已出)。

---

## 参考来源
- Kilo Marketplace 仓库结构(Skills/MCP/Modes、curated git + PR 贡献、Agent Skills 开放规范):
  https://github.com/Kilo-Org/kilo-marketplace · https://kilo.ai/docs/automate/mcp/overview
