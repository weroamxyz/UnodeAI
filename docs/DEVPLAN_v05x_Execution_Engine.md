# DevPlan V0.5.x — Agent Execution Engine(单 agent 执行内环升到 Cline 级)

> **状态**:总执行计划(权威)· **日期**:2026-06-10 · **基线**:v0.5.1(已上架)
> **总负责:Opus(Claude)**。规划经 DeepSeek 提案 → Codex 收敛 → Opus 裁决 → **Fable 5 落成本计划**(读过
> 真实代码后定稿,所有行号已核实)。
> **执行分工**:**Opus + Codex 在 Claude Code 插件环境写码**(Opus 主刀核心内环 on main;Codex 做规格明确
> 模块 in worktree);**DeepSeek 在 UnodeAi 环境 + Cline 环境跑基准/验证**(记分员,不写核心码)。
>
> **一句话**:把架构重心从「让模型更强」转为「**让框架更聪明**」——框架负责确定性执行/观察/验证,LLM 负责
> 理解与决策。目标:**每个 agent(Solo 与 Team 里的每个 worker)都有 Cline 级执行内环,弱模型(DeepSeek/
> Kimi)在这个架构里仍然能成功执行**,同时不动 UnodeAi 的多 agent 编排优势。

---

## 〇、裁决记录(三方意见的最终归并)

| 议题 | DeepSeek | Codex | **最终裁决(Opus,Fable 5 确认)** |
|------|----------|-------|-----------------------------------|
| 战略诊断 | 强在编排、弱在单 agent 执行内环 | 同意 | ✅ **采纳**,这是 V0.5.x 的核心命题 |
| P0 选型 | 意图解析→框架自动执行 | 反对:惊喜执行+安全边界;P0 应是结果驱动确定性 hook | ✅ **按 Codex**:P0 = 写后反馈环 + 验证义务。intent-to-tool 降 P2 且**仅限安全读类** |
| 验证强制 | 不可配置、不可跳过 | 不可**静默**跳过 | ✅ **按 Codex**:nudge 一次 → 仍不验证则**显式标注未验证**,不无限阻塞,不与审批模型打架 |
| 统一 AgentRuntime | P0 大重写 | P0 统一 runtime | ⚠ **降级为「挣来的重构」**:先发确定性 hook(每个独立可发);hook 落地后代码重复真痛了再抽 runtime。**且范围仅 openai-compat 内环**——ClaudeHeadlessBackend 是黑盒且本就是 Cline 级,不动 |
| 上下文注入 | 注入打开文件全文等 | 要相关性筛选 + token cap | ✅ **按 Codex**,盲塞全文会污染上下文烧 token |
| 放哪个版本 | (v0.6 主题) | (v0.6 主题) | ✅ **V0.5.x 增量小版本**(用户拍板);Marketplace 保持 V0.6.0,两线并行但**本线优先** |

---

## 一、手术台现状(代码实测,2026-06-10)

术区 = [OpenAICompatBackend.ts](../src/backend/OpenAICompatBackend.ts)(1003 行,in-process 工具循环)+
[WorkspaceTools.ts](../src/backend/WorkspaceTools.ts)(730 行)。**已有的鲁棒层(别重做)**:

| 已有机制 | 位置(已核实) |
|----------|----------------|
| F8 空回复重试(一次) | runTurn L350,L399-411 |
| 同参重复失败熔断(2 次)+ 熔断上限止损(2 次) | L102-105,L450-465,L485-489 |
| announce-then-act 提醒(2 次,zh/en 启发) | L106-107,L426-441 + announcedAction.ts |
| 泄漏工具调用恢复(协议无关)+ 标记剥离 | L412-419 + toolProtocol/leakedToolCalls |
| reasoning_effort 拒绝闩锁重试 | L634-661 |
| 上下文软/硬门 + 锚点保留裁剪 + 滚动摘要 | L362-377,L572-605 |
| **写后 meta 钩子(手术切口①)**:`takeLastRunResult()` 带 `kind:'write'`+`path`,routeToolCall 已用它生成 unified diff | WorkspaceTools L295;Backend L526-535 |
| **消息队列(手术切口②)**:`sendUserTurn` 入队 + `drain()` 串行——**排队式插话后端已免费,只是 UI 禁了输入框** | L125,L264-271,L305-327 |
| 回合结束判定点(手术切口③):`calls.length === 0` 即模型想收工——announce-nudge 已挂这里,验证义务同点插入 | L426-443 |
| 回合级状态局部变量模式(failCounts/circuitBreaks/announceNudges)——新增 wroteFiles/verified 照抄此模式 | L356-360 |
| 诊断读取先例:`vscode.languages.getDiagnostics()`(@problems) | extension.ts L814 |

**关键架构约束(写进所有任务卡)**:
- `OpenAICompatBackend` 是 **vscode-free 可单测**的(构造器 DI:fetchFn/commandExecutor/checkpointRecorder/…)。
  一切新能力(诊断采集等)必须走**构造器注入**,vscode 实现在 extension.ts/SessionManager 接线,测试注入 fake。
- **ClaudeHeadlessBackend 不动**(黑盒,本就是 Cline 级);本计划全部作用于 openai-compat 内环——便宜模型全跑
  这条路,正中 gap。
- 协议无关:新注入的纠偏/诊断/验证消息一律是普通 user/tool 消息,native 与 XML 模式同样生效。
- 每个 hook 配 `roam.engine.*` kill-switch(默认开)——手术安全绳,出问题用户可配置降级,不用回滚版本。

---

## 二、发布列车(每节车厢独立可发、独立验收)

### 🚄 v0.5.2 — 写后反馈环 + 验证义务(P0,手术核心)· **Opus 主刀,main**

**E2-1 写后诊断注入(= BACKLOG #3,VS Code 独有杠杆)**
- 新增注入接口 `DiagnosticsProvider`:`collect(paths: string[]) => Promise<FileDiagnostics[]>`(内部等
  language server 沉降 ~1s、只取 Error(默认)、按文件去重、**token cap ~1500**、只查本回合写过的文件)。
- 接线:extension.ts/SessionManager 用 `vscode.languages.getDiagnostics(uri)` 实现(参照 L814 的 @problems);
  vitest 注入 fake。
- 挂点:routeToolCall 写成功分支(切口①)。写后采集 → 非空则把
  `[post-write diagnostics] src/x.ts: L12 error TS2304: ...` 作为该 tool result 的**附加段**回灌(模型下一步
  立刻看到自己刚制造的红线,不用等跑测试)。
- 回合级聚合:`wroteFiles: Set<string>` 记录本回合写过的文件(切口③要用)。
- kill-switch:`roam.engine.postWriteDiagnostics`(默认 true)。

**E2-2 验证义务(不可静默跳过)**
- 回合级状态:`wroteFiles` 非空 && 自最后一次写之后**没有**(成功跑过 run_command/run_checks || 写后诊断全绿)
  ⇒ 模型在切口③想收工时,**注入一次**纠偏 user 消息("你改了 N 个文件但未验证——现在跑项目的检查命令,或
  明确说明被什么阻塞")并 continue(`MAX_VERIFY_NUDGES = 1`,照抄 announce-nudge 模式)。
- 仍不验证 ⇒ **不阻塞**,但在 finalText 末尾追加显式标注:`⚠ Changes not verified(写入 N 文件,未运行检查)`
  ——该文本随 TurnResult 流向 chat 和 PM(Team 模式下 PM 看得到 worker 没验证,会打回)。**诚实呈现,不硬卡。**
- kill-switch:`roam.engine.verifyObligation`(默认 true)。
- 测试:fake 诊断 provider + fake executor 的回合级单测(写→脏诊断→注入;写→收工→nudge→跑检查→干净收工;
  nudge 后仍收工→⚠ 标注;plan 模式与零写入回合不触发)。

**验收门**:build+lint+test+e2e 全绿;手测「让 agent 写个带类型错误的文件」→ 下一轮模型自述并修复;CHANGELOG;
发 v0.5.2。**DeepSeek 基准 R2 对照 R1:U5(错误恢复)分必须涨。**

### 🚄 v0.5.3 — G-001 插话 / mid-run steering · **Opus 后端 + Codex UI,可与 v0.5.2 并行开工**

**E3-1 排队下一条(便宜的一半)**
- 后端已支持(切口②)。改动在 UI:运行中**不再禁用输入框**(ChatViewProvider L1135 一带),Enter ⇒
  `sendUserTurn` 入队;chat 顶部显示「⏳ 已排队 N 条」chip,可点 × 撤回(撤回 = 从 backend.queue 删,需暴露
  `removeQueued(idx)`)。
- ClaudeHeadlessBackend:同样走 SessionManager 的排队语义(turn 间投递),不改其内部。

**E3-2 立即插话(中途纠偏)**
- Backend 新增 `interject(text: string)`:推入 `pendingInterjections[]`;runTurn 在**每次迭代顶部 + 每个工具
  调用之间**检查,非空则把 `[USER INTERJECTION] <text>`(role:user)splice 进 history,下一次 LLM 调用即生效。
- UI:运行中输入分两个动作——默认 Enter = 排队;「⚡插话」按钮(或 Ctrl+Enter)= interject。明确区分
  「插话纠偏」vs「Stop」。
- Team 模式:对 PM 插话 = 给协调者注入;**不打断**正在跑的委派(委派的取消语义沿用 v0.5.1 Stop/cancel 传播)。
- Claude 后端:v0.5.3 先不支持 mid-turn interject(黑盒进程),回退为排队;UI 上对 claude agent 隐藏⚡按钮。
- 测试:迭代间注入生效顺序;插话不破坏 Stop;排队/撤回;XML 模式同样生效。

**验收门**:全绿 + 手测 T6 场景(跑到一半「停,直接用 Math.pow」→ 下一步改道);发 v0.5.3。**DeepSeek 基准
R3:U8(运行中介入)必须从落后翻到 ≥ Cline——G-001 关闭。**

### 🚄 v0.5.4 — 主动上下文 + 失败纠错统一(P1)· **Codex 主力(worktree),Opus 审**

**E4-1 主动上下文注入(相关性 + cap)**
- 每回合开始(refreshProjectContext 同站点)注入一个 `<turn_context>` 块:最近 diagnostics 摘要(workspace 级,
  cap)、上一回合写过的文件清单 + 验证状态、(Team)同伴最近完成的相关任务一行。**不塞打开文件全文**;总预算
  ~800 token,超了截断。kill-switch:`roam.engine.turnContext`。
- 与现有 projectContext(rules/conventions/shared memory)合流,不重复注入。

**E4-2 失败纠错统一为 EnginePolicy**
- 把散落的确定性反应收拢成一个可单测的 policy 模块(纯函数:`(event, turnState) => directive`):缺参拒绝、
  同参熔断、announce-nudge、空回复重试、验证义务、(新)未读先写警告、(新)policy 拦截后的替代建议(命令被
  拦 ⇒ 直接在 tool result 里给出「改用 npm test」级别的替代指引,不等模型猜)。
- **行为不变的重构 + 两个小新增**,回归测试全量搬过来。

**验收门**:全绿 + 回归基准 R4(U2/U5/U9 不退步,token/轮数应下降);发 v0.5.4。

### 🚄 v0.5.5 — P2(条件触发,看数据)
- **仅当** R2-R4 数据显示「模型仍频繁说而不做」:intent-to-tool **只做安全读类**(read_file/list_dir/
  @problems 级;写与命令永远要结构化调用+审批)。
- **仅当**「修bug/加功能」轨迹仍混乱:操作管道模板(recipe)。
- 数据不支持就不做——**P2 是选项,不是承诺**。

---

## 三、三方分工与节奏

| 谁 | 在哪 | 干什么 | 优先序 |
|----|------|--------|--------|
| **Opus(总负责)** | Claude Code,main | v0.5.2 全部(E2-1/E2-2)→ v0.5.3 后端(E3-2)→ 各版审查/合并/发布 | 本线最高优先 |
| **Codex** | Claude Code,worktree `codex/interject-ui` → `codex/engine-p1` | v0.5.3 UI(E3-1 + ⚡按钮)→ v0.5.4 全部(E4-1/E4-2)→(空档再回 Marketplace E1 导出卡) | 本线 > Marketplace |
| **DeepSeek** | **UnodeAi 环境 + Cline 环境** | 基准记分员:**R1 立刻跑**(v0.5.1 基线,按已有 runbook)→ 每发一版跑增量轮(R2/R3/R4,重点维度)→ 每轮证据回填 UX_BENCHMARK §四/§五 | 与开发并行,不挡发布 |

- **基准就是手术监护仪**:R1(现在)= 术前体征;R2/R3/R4 = 每刀之后的复查。沙盒与 8 任务 prompt 已锁
  ([bench/ux-sandbox/RUNBOOK_round1.md](../bench/ux-sandbox/RUNBOOK_round1.md)),增量轮只需重跑该刀对应任务
  (R2→T1/T3;R3→T6;R4→T2/T4/T5),半小时一轮。
- **手术纪律**:一版一个器官;每版全门禁 + kill-switch;**不动** ClaudeHeadlessBackend、tool 协议/泄漏恢复、
  checkpoint、审批、pricing;Codex/Opus 文件范围不重叠(Opus = backend 内环,Codex = views/UI 与新 policy
  模块);无人自合并自发布。
- **Marketplace(V0.6.0)**:PRD/拍板不变,Codex 的 E1 导出卡**降为空档任务**;E0 地基(Opus)顺延到本线
  v0.5.3 发布后视余力恢复。**当前最关键节点是执行内环,资源向本线倾斜。**

## 四、风险与回退
| 风险 | 缓解 |
|------|------|
| 诊断噪声(language server 误报/慢)灌进上下文 | 只查本回合写过的文件 + 只取 Error + 沉降等待 + token cap + kill-switch |
| 验证义务把只改文档的回合也卡住 | nudge 仅一次且不阻塞;模型可一句话说明「文档无需验证」即收工;诊断全绿也算过 |
| 插话注入撞上正在写的 history(并发) | 注入只在迭代边界/工具间隙消费(单线程事件循环天然安全),绝不在请求飞行中改 history |
| 新 hook 退化弱模型表现(过度纠偏来回震荡) | 全部 nudge 有上限(照抄现有 MAX_* 模式);基准增量轮当回归门 |
| 双线抢 Codex | 明确优先序:engine 线 > Marketplace;E1 卡保留但标“空档任务” |

> 任务卡:[CODEX_TASK_v053_interject_ui.md](CODEX_TASK_v053_interject_ui.md)(已出)·
> DeepSeek 沿用 [DEEPSEEK_TASK_ux_benchmark_round1.md](DEEPSEEK_TASK_ux_benchmark_round1.md)(+增量轮说明已补)。
> v0.5.4 的 Codex 卡在 v0.5.2 合并后由 Opus 出(地基定了再写细卡,避免返工)。
