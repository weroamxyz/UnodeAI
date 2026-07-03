# UnodeAi 路线图 · 0.8.110+ → 1.0（手感优先，压缩到 GA）

> **状态**:当前权威（2026-06-21 重新编号）。进展以 [STATUS.md](STATUS.md) 为唯一权威源,本 doc 只管"接下来做什么、为什么、什么顺序"。
> **🔢 重新编号(2026-06-21)**:原计划 0.8.51–0.8.55 的特性版本号,已被 **0.8.51–0.8.108 的"可靠性=手感"
> 大修复(网关 400 自愈、`run_checks` 死锁、命令审批热加载、Smart Mode UI、工作目录单一真相 + 去 pin)**消耗掉了**
> ——这段本身就是路线图第一条"可靠性即丝滑",不是跑题。下表把**尚未做的特性**改用 **F1–F7 顺位**(实际发布号 0.8.110+,按当时下一个可用号落地;0.8.109 已被并发图标化占用)。
> **基线**:已发布 **0.8.108**(bundled VSIX,982 测试绿,CI audit+E2E 双门绿;运行时工作目录契约已硬化并经 Codex 两轮评审)。

## 一句话策略
churn(劝退)发生在**首次接触的手感**,不在隐形的可靠性。所以:**先补每天能感受到的手感(Solo 入口 +
上下文控制 + 只读研究子 Agent + MCP 可信),把这条做成通往 1.0 的路**;CLI / Review / Enterprise-lite
这些"专业感打磨"**后置到 GA 之后**,不挡 1.0。护城河线(可验证多 Agent、跨模型一致性)**并行不断**。

来源:Codex 的 10 版建议(手感优先,判断对) × 本仓库 [BACKLOG.md](BACKLOG.md) 的 1.0 punch-list ×
model-variance 4 杠杆。本 doc 是两者对齐后的压缩版。

## ⚠️ 排期前必读:三项"已存在",按打磨而非重写
做下面版本前先认这三件事,否则会白干一遍:
- **@file / @folder 上下文已实现** → [src/session/ContextMentions.ts](../src/session/ContextMentions.ts)、
  [FileMentions.ts](../src/session/FileMentions.ts)、[contextLabel.ts](../src/views/contextLabel.ts)。
  F3 真正新增的只是 **slash 模板 + token-cap chips**。
- **Solo 已实现**(`roam.startSolo` 切换)。0.8.51 是"**2 击、免建 team 的快速入口**",复用现有 Solo,不重做。
- **MCP preflight 已起步**(0.8.41:命令在 PATH 检查 + 诚实报错 + uv 检测)。F7 在其上加 smoke + 状态徽章。

## 版本计划(压缩排序)

> 编号是**顺序占位,非硬优先级**;**门禁(smoke test S5–S8)永远先于下面任何特性**。
> ⚠️ 下表版本号是"特性顺序",**实际发布号会被穿插的修复/打磨版顺延**(例:0.8.109 已被"并发模式图标化"占用)。落地某特性时取**当时下一个可用号**,别死磕表里的数字。

| 顺位 | 主目标 | 交付内容 | 验收标准 |
|---|---|---|---|
| **F1 (≈0.8.110)** | **Open Chat in Editor**(已批准,parked) | 编辑器区 `WebviewPanel` 镜像 sidebar chat;sidebar + 编辑器面板**双向同步**;纯 UI 改,不动后端 | 可把任一 agent 的 chat 作为编辑器标签页打开,与 sidebar 实时同步;[[chat-editor-panel-plan]] |
| **F2** | Solo 快速入口 | `Roam: Quick Ask / Solo Edit` 命令;自动选 workspace;免建 team 即可开始;默认轻量模型/工具 | 新用户打开项目后 **2 击内**能发起一次 Solo 修改 |
| **F3** | 日常编码手感 | 在已有 @-context 上加 **slash 模板 `/fix` `/review` `/test` `/explain` `/commit-msg`** + 引用 **token-cap 与可见 chips** | 用户能明确控制上下文(不靠模型猜文件);引用有 cap + chips |
| **F4** | 只读研究子 Agent ⭐ | 只读研究子任务:并行扫码、汇总证据、返回引用;**禁写文件/禁危险命令**;主 Agent 只收结构化摘要 | 主 Agent 可并行派 2–3 个只读研究任务,主上下文不被淹 |
| **F5** | **ModelProfile 注册表**(model-variance 杠杆③) | 把散落的每模型知识(协议偏好/工具名别名/参数支持/上下文窗口/可靠性档)收进**一个注册表** | 换模型不再有"惊吓";Router/基准台读它做决策;[[model-variance-strategy]] |
| **F6** | Router v2 | 路由从"按角色"升到"**角色 + 能力 + MCP grant + 负载 + 最近失败**";可解释 | PM 能说明**为什么选某 Agent**;GitHub/MCP 类任务自动路由给有权限者 |
| **F7** | MCP 可信安装 | MCP 卡加 preflight + 依赖/env 检查 + **smoke test**;状态 **Ready / Needs token / Missing uv / Failed smoke** | 装完即知能不能用;不能用时有明确下一步,绝不静默失败 |
| **→ 1.0 candidate** | 验证 + GA | **benchmark/demo harness**(Solo fix / Team bugfix / 研究子 Agent / MCP install / Worktree verify-gate)+ GA logistics(repo→weroam+OSS、对齐 package.json repository、建 roam-skills repo、store/billing 文案) | npm test + build + bundle smoke + demo script + release notes 全绿;能公开对比 Cline/Kilo 核心场景 |

> **✅ GA URL migration — DONE (0.8.112, 2026-06-21):** migrated off the temporary `yanzhang79` GitHub to the **`weroamxyz` org**:
> 1. `roam.marketplace.catalogUrl` → `https://raw.githubusercontent.com/weroamxyz/roam-skills/main/catalog.json` (public **weroamxyz/roam-skills** repo created; roam-crew code repo is private so the catalog lives in the public skills repo; source-of-truth + CI in [marketplace/catalog.json](../marketplace/catalog.json), publish = copy into roam-skills. SHA-pin/signing still TODO.)
> 2. `roam.marketplace.skillLibraryUrl` → `https://github.com/weroamxyz/roam-skills` ✅
> 3. `package.json` `repository.url` → `https://github.com/weroamxyz/roam-crew` ✅ (`roam.modelCatalogUrl` default is empty — nothing to migrate).
> Remaining GA item: `publisher` is still `roamai` (the VS Code Marketplace identity — a separate decision from the GitHub org; changing it = a new store listing). Fetch failures fall back to the bundled catalog.

## 丝滑(handfeel)优先级 — Grok 复盘 + 0.8.7x–0.8.90 session 反思(2026-06-20 拍板)

> 背景:Grok 建议"把 Roam 做到无比丝滑"。诊断方向对(丝滑值得做;80% 丝滑 = 感觉不到等待),但约一半药方是让 Roam 去打 Cursor 本命战场(inline Cmd+K / Composer / 补全 / fork Code-OSS),与本路线图"不进 Cline/Kilo/Cursor 同质战场、不 fork"冲突。下面是过滤后的 **Roam 版丝滑策略**。

> **认知重构:Roam 的"丝滑"≠ 补全/键击延迟,而是"不卡住 / 不中断 / 不丢状态 / 会推进"。** 0.8.71–0.8.90 这一串修复(网关 400 自愈、`run_checks` 死锁、表单跳市场被清空、MCP 挂载失败、PM 不到 reviewer、审批不弹/不实时)本身就是 Roam 品类里最对路的丝滑投资——**可靠性 = 手感**。

**第一步(门禁,先做):完成当前 smoke test。** RELEASE_SMOKE_CHECKLIST §3–§8 在最新 bundled VSIX(0.8.90+)跑绿并 sign-off,才动下面的丝滑工程。带病做新体验是负和。

排序(GA 前后):
1. **可靠性即丝滑**(继续,GA 前)—— 编排路径 stall 清零;补 **"PM 卡住自动推进 nudge"**(最后一个已知编排 stall:委派返回后 PM 未推进到 run_checks/reviewer/finalize 时,nudge 一次)。
2. **感知延迟**(GA 前后,= Grok 的"80%"落到 Roam 该落处)—— 首 token 提速;委派链/工具卡片**即时反馈**;**乐观 UI**(点击即有反应,不空等);分层路由首层走快模型(复用 Smart Mode,**别照抄 Grok 臆造的型号**,只取"快模型打首层"原则)。
3. **编排台打磨(主场护城河,中期)**—— Mission Control / Dashboard 做到"一眼看懂每个 Agent 在干嘛 + 随时暂停/介入",这是 Cursor 结构上做不出的差异化丝滑(对应 Grok"可视化 Agent Orchestra",但落在我们已有的编排可视化上)。
4. **键盘流 + 入口**(便宜分)—— Solo 快速入口、slash 模板(见 F3)、全局指令/快速聊天快捷键。

**明确别做(与定位冲突 — Grok 的坑):**
- ❌ **inline Cmd+K / Composer / 多文件补全 <300ms** —— Cursor 本命,见下"暂缓"节。
- ❌ **Fork Code-OSS** —— 扔掉 VS Code 扩展的分发/兼容优势,巨工程、回报存疑;保留扩展形态。
- ❌ **现在上重型 Tree-sitter + 向量索引** —— 编排走"只读研究子 Agent(F4)+ 上下文接地"的轻路径;全量向量库后置。

## 1.0 之后(GA 后置,非阻塞)
Codex 原 0.8.56–0.8.59,价值真,但不该挡 GA,除非有付费客户卡某项:
- **Headless CLI**:`roam run "<goal>" --solo/--team --workspace … --json`,复用 SessionManager,verify 失败返回非零 exit。
- **PR / Review 工作流**:`Review Current Changes` + `roam review`,基于 git diff 出 findings/行号/风险/测试建议,默认只读,可一键转 Developer 修复。
- **Team / Enterprise-lite**:本地 policy bundle(允许命令/模型层级/MCP grant/审计日志/preset 导入导出),日志脱敏不记 secret。
- **沙箱执行 (Sandboxed execution)** — 和 CLI + Enterprise-lite 同 track。
  - **为什么 post-1.0**:现状已是**策略级沙箱**(文件工具限制在 workspace + 符号链接/越界守卫 + 幻觉路径 re-root;命令 `CommandPolicy` none/allowlist/**ask 默认人在环批准**;worktree 隔离 + checkpoint 回退;env 脱敏)。缺口=`run_command` 是 host 进程(`spawn` shell:true,用户权限),无 OS 强制隔离。**真沙箱的价值在"人离开审批环路"时才凸显**——即 Headless CLI / 无人值守自动跑,所以两者绑一起。1.0 前 ask+allowlist+worktree 已是合理安全模型(类 Cursor ask)。
  - **落地路径**:① **Docker 可选沙箱**(第一步,最现实):命令在容器内跑、挂载 workspace、opt-in 开关、和 worktree 协作;② 之后可选 OS 原语(macOS `sandbox-exec` / Linux `bwrap`+seccomp / Windows job object)做轻量本地沙箱,或云端 sandbox 做远程无人值守(类 Codex)。
  - **便宜过渡(可选,不等容器)**:"workspace 外只读" / "默认拒网络"的 wrapper 守卫——是补丁,真隔离仍需容器。
  - TODO:写 Docker opt-in 1-pager(挂载/网络/容器生命周期/与 worktree 关系)。
- **Agent / Skill 生态**:Agent Builder 导出/导入;Marketplace 加 Skills/Playbooks 区;自建 Agent 免手改 team.json。

## 暂缓(别进 Cline/Kilo 拥挤战场)
inline autocomplete、JetBrains、Cloud Agents、完整企业 SSO——大工程且同质化,现阶段不打。

## 与既有路线图的关系
- 取代 BACKLOG 顶部"1.0 冲刺 punch-list"中**已交付的 attractions**(Evidence Report / Team Packs /
  成本可视化 / Mission Control / 安全叙事 / combobox / Add-MCP 表单——均已发)之后的**下一段排期**。
- model-variance 杠杆①②已发(0.8.49),③在 F5,④在 1.0 candidate 的 benchmark harness。
- Smart Router(本地 LLM 自动选 agent+model)仍是 **1.0 之后**,Router v2(F6)是其地基。
