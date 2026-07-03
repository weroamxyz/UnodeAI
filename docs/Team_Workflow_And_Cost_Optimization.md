# 团队流程 & 成本优化编排（修订版 v2）

> 把标准软件工程流程映射到 UnodeAi，在阶段门(Phase Gate)按需切换各角色的模型层级，把「成本套利」从口号变成可执行机制。
>
> **本版是对初稿的修订。** 初稿方向正确、洞察扎实,但有三类问题:① 把概率性的 PM agent 当成确定性编排器(很多「PM 监控/PM 切换」靠提示词不可靠);② 自造 L1/L2/L3 与已落地的 tier 体系重复;③ CCB/ECR/ECO 一整套企业变更管理对「IDE 里的 AI 编码助手」是过度工程。修订集中在 §0,后文按修订后的设计展开。
>
> **相关文档**：[README 文档地图](../README.md) · [STATUS 进展与下一步](STATUS.md) · [PRD](../PRD_MultiAgent_VSCode_Extension.md)
> **落地状态**（2026-06-02）：基础已建（ModelTier 映射、Reviewer 角色、run_checks 客观门、per-agent 成本 + LivePriceService + Dashboard 成本卡）；**动态机制核心已落地** ✅ ——`SessionManager.setModel` 热切换 + `TierController` tier 切换矩阵、`WorkflowEngine` `gated` 类型（run_checks 门 + tier 升降 + 重试/转人工，内置 `feature-gated` 模板）、`TokenCounter` + 70%/80% 上下文门（`OpenAICompatBackend` 硬门拒绝继续）。**仍待**：结构化 Session Digest 压缩（现为按条数裁剪 + 硬门停止）、`.roam/team.json` 承载 tier/gated（req4）、PM 委派支持 claude 后端、阶段/角色成本报告。进度见 [STATUS.md](STATUS.md) P2。

---

## 0. 对初稿的修订摘要（必读）

| # | 初稿 | 修订 |
|---|------|------|
| 🔑 **R1 机制 vs 判断** | 把上下文监控、模型切换、卡死检测都写成「PM 做」 | **拆分**:需要*可靠性*的(切模型、gate 过/不过、上下文压缩)落到**运行时**(WorkflowEngine/SessionManager,确定性);需要*判断*的(质量评估、漂移识别)留给 **PM 提示词**(概率性,尽力而为)。PM 是个 LLM,不是状态机 |
| 🔑 **R2 tier 统一** | 自造 L1/L2/L3 | 直接用已落地的 **`ModelTier = economy / standard / premium`**(`RoleConfig.DEFAULT_MODEL_TIERS`)。L1=economy、L2=standard、L3=premium |
| 🔑 **R3 真实价/真实套利** | $0.60/$2.80/$8.50 等编造数字;倍率 10-15x | 用**真实网关价**(opus-4-8 $5/$25、deepseek-pro $0.44/$0.87、deepseek-flash $0.14/$0.28);旗舰/经济实际 **≈35-90x**,套利比初稿说的更大。具体 $ 数仅示意 |
| 🔑 **R4 热切换可行性** | 假设模型可热切、<2s | 我们的 **`OpenAICompatBackend` 每轮现读 `config.model`**,改字段下一轮即生效,真热切不重启(默认后端);**claude 后端** model 烤进 spawn 参数,需重启,但 L2 快照保上下文 |
| ✂️ **R5 砍 CCB** | §6 整章 CCB/ECR/ECO(~11 天) | **删除**。换成一个极轻量的「**变更请求备注**(Change Note)」(见新 §6)。重活已被 **Reviewer + run_checks** 覆盖 |
| 🔁 **R6 并入 req4** | 独立 Phase 3/4 路线 | gated_workflow + tier 切换矩阵 + 角色规则 = **req4「Team Config v2」同一片地**,合并:全部进 `.roam/team.json`,带默认 |
| ✅ **R7 标注已建** | — | 模型分层、Reviewer 角色、run_checks 客观门、per-agent 成本、实时价目(LivePriceService)**均已实现**;本文档只补「动态切换 + gated 工作流 + 阶段成本拆分」 |
| ➕ **R8 并入 DeepSeek 4.12** | DeepSeek 新增「128K 上下文隐性降级 + 四层防御」(L0 预算/L1 计数/L2 70% 软门/L3 80% 硬门 + Session Digest 压缩) | **采纳并入 §4.2**。它几乎全是运行时机制——正好印证 R1。一处纠正:L2 触发器归**运行时**(确定性),不是「PM 自动触发」;PM 只判断摘要是否仍贴合需求。百分比/压缩率作启发式阈值,不写死为定律 |

---

## 1. 标准 SDLC 7 阶段（保留）

| 阶段 | 主角 | 产出 | 耗时占比 | 模型能力需求 |
|------|------|------|:---:|------|
| ① 需求分析 | PM | 需求/验收标准/任务拆分 | 15% | 推理+结构化,代码弱 |
| ② 架构设计 | Architect | 技术方案/API 契约/数据模型 | 15% | 推理+技术广度 |
| ③ 编码实现 | Developer | 代码+单测 | 35% | **代码质量最关键** |
| ④ 代码评审 | Reviewer | PASS/FAIL + 证据 | 10% | 代码理解(比写容易) |
| ⑤ 测试验证 | QA | 测试报告/Bug 列表 | 15% | 边界推理,中等 |
| ⑥ 部署发布 | DevOps | 部署+健康检查 | 5% | 流程执行,需求低 |
| ⑦ 维护迭代 | PM+Dev | 修复/优化 | 5% | 混合 |

每两阶段之间是一个 **Gate**:PM 评估上一阶段产出(判断)+ run_checks 客观验证(机制),决定是否放行、并设置下一阶段各角色的 tier。

---

## 2. 角色 → 模型层（已落地，对齐真实价）

> tier 体系已在 `RoleConfig.ts`(`ModelTier` + `DEFAULT_MODEL_TIERS` + `modelForRole`)实现并测试。下表为 Roam 网关默认值。

| Tier | Roam 默认模型 | 真实价(USD/1M in·out) | 谁(出厂默认) |
|:---:|------|:---:|------|
| **premium** | claude-opus-4-8 | $5 / $25 | PM、Architect(leads 主导) |
| **standard** | deepseek-v4-pro | $0.44 / $0.87 | Senior Dev、Security、Reviewer、Tech Writer |
| **economy** | deepseek-v4-flash | $0.14 / $0.28 | QA、DevOps、Data |

> tech-writer 用 `modelOverride: { roam: 'qwen-max' }` 保留多语写作专精。映射可被 `.roam/team.json` 覆盖(req4)。

---

## 3. 核心机制：阶段门 + 动态切模型

### 3.1 总原则（R1：机制 vs 判断）

```
┌──────────────────────────────────────────────────────────────────────┐
│  运行时(确定性,WorkflowEngine/SessionManager) —— 负责"机制":         │
│    · gate 的客观检查 = run_checks(build/type-check/test)             │
│    · 通过/失败后按矩阵切各角色 tier(改 config.model)                  │
│    · 重试上限、卡死轮次计数、上下文压缩触发                            │
│                                                                      │
│  PM agent(概率性,提示词) —— 负责"判断":                            │
│    · 主观质量评估(需求是否清晰、设计是否合理)                        │
│    · 漂移/范围蔓延识别、任务拆分、把谁派给谁                          │
│  —— PM 的判断喂给运行时去"执行",而不是让 PM 自己保证执行可靠         │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 动态切模型为何对我们可行（R4）

- **openai-compat 后端(默认/Roam)**:`OpenAICompatBackend.chat()` 每轮请求现读 `this.config.model`。运行时只要更新该 agent 的 `config.model`,**下一轮即用新模型,无需重启、上下文不丢**。需新增 `SessionManager.setModel(agentId, model)`。
- **claude 后端**:model 在 `buildArgs()` 烤进 spawn 参数,切换需 `restart()`;但 L2 快照(snapshot/restore)会保住对话上下文,代价是一次进程重启(秒级)。

### 3.3 Gate 定义（落到现有 WorkflowEngine）

现 `WorkflowEngine` 是线性 step 引擎(step: from/to/action/autoTransition,靠 `correlationId=instanceId` 在 `task.complete` 时推进)。**gated 工作流 = 在 step 之间插入 gate**:

```
对每个 gate:
  1. 客观门:运行时调 run_checks(用户 verifyCommand) → 红则 on_fail
  2. 主观门:把上一步产出交 PM,要 PASS/FAIL(判断)
  3. on_pass:按矩阵 setModel(下游角色 → 目标 tier),执行下一 step
  4. on_fail:按矩阵升级 tier(如 standard→premium)+ 重试,超 maxRetries → 转人工
```

复杂度分级(决定起步 tier),由 PM 在 Gate 0 判断:
- 低(1-3 文件):全队 economy。
- 中(4-10 文件):leads premium、其余 standard。
- 高(关键模块/安全/性能):编码上 premium,其余 standard。

> 注意:Reviewer 是**独立验证者**(只读、非实现者),已实现;PM 提示词已包含「run_checks 绿 + reviewer PASS 才算完」。gated 工作流把这条从「提示词建议」升级为「引擎强制」。

---

## 4. 防漂移：运行时压缩 + PM 纪律（R1 重写）

初稿设想「PM 监控每个 agent 的 context_usage、到 60% 触发摘要-重置」——**PM 拿不到别人的 token 计数,靠提示词做不到**。正确拆分:

### 4.1 上下文压缩 = 运行时机制
- `SessionManager` 已逐 agent 记 `usage.inputTokens`;`OpenAICompatBackend` 已有 `MAX_HISTORY_MESSAGES=60` 的有界裁剪。
- **升级**:把「按条数裁剪」换成「**按 token 占用触发『摘要后重置』**」——见 §4.2 的四层防御。这是确定性的 compaction,不依赖 PM。

### 4.2 现实约束：名义窗口 ≠ 可用窗口（四层防御）

> 整合 DeepSeek 的 Section 4.12(依据用户转述重建)。直接针对实测:在 Cline 上接近 128K 时已工作不正常。**这一节几乎全是运行时机制——正好印证 §0 的 R1。**

**核心发现(经验启发,非定律)**:名义 128K 的有效区远小于标称。观测到的退化带:
- ~**80%** 占用起,代码输出开始**截断**;
- ~**90%** 起,幻觉显著上升(编造不存在的 API/文件);
- ~95%+ 基本不可用。

> 这些百分比是**启发式阈值**(在 Cline 上观测),不是各模型的硬性物理定律;放配置、可调。压缩率/压缩比的「≥90% / ≥95%」是**目标**,不是保证。

**实证记录：一次真实的本会话压缩事件**：

```
本次会话中观测到完整的自动压缩周期：

  状态 A: 134,103 / 128K (105%)
      ↓  ← 系统检测到超出窗口上限，触发被动压缩
  状态 B:  95,250 / 128K (74%)
      ↓  ← 用户感知到的百分比 "只用了一半"
  状态 C:  60,080 / 128K (47%)

解释：
  · 134K = 原始累积 token（包括所有历史消息 + 文件内容 + 工具结果）
  · 95K  = 压缩后的 token（截断/摘要了约 39K 早期对话）
  · 60K  = 进一步压缩/部分历史被换出

损失分析：
  · 被截掉的 39K 里包含什么？早期指令、架构决策、已读取的文件内容
  · Agent 完全不知道什么被丢了 → 继续基于残缺上下文输出
  · 这就是为什么 "接近 128K 附近工作不正常" 的根因

启示：
  · 不是压缩本身有问题，是压缩方式有问题：
    ❌ 被动压缩（超出后才触发）→ 挤压模型输出空间
    ❌ 粗粒度截断早期对话 → 丢失关键约束和契约
    ❌ 无验证步骤 → Agent 在不知道失忆的情况下继续工作
    ✅ 主动压缩（70% 触发）→ 有充足缓冲
    ✅ 结构化摘要（保留决策 + 接口 + 待办）→ 压缩率可控
    ✅ 验证步骤（PM 确认 Agent 理解度）→ 质量闭环
```

**四层防御(L0-L2 运行时确定性,触发器一律不靠 PM 自觉)**:

| 层 | 时机 | 动作 | 归属 |
|:--:|------|------|------|
| **L0 预算** | Session 创建时 | 初始预算 = 窗口 − system_prompt(~8K) − 角色/契约模板(~5-15K) − 输出缓冲(~8K) → 得「动态任务预算」,据此做 §4.6 的上下文感知分包 | 运行时 |
| **L1 计数** | 每次 tool_use / 回合后 | `TokenCounter` 精确累计该 agent 的上下文占用(我们已有 usage 累计,补一个「当前上下文 token」估算即可) | 运行时 |
| **L2 软门** | 占用达 **70%** | **运行时**自动触发压缩(非 PM):让该 agent 产出结构化 **Session Digest**,用 digest 替换旧历史(user 回合边界,保 tool_call 配对);摘要这一步可用 **economy 模型**省钱。限若干轮内完成重置 | 运行时(摘要内容用便宜模型生成) |
| **L3 硬门** | 占用达 **80%** | **后端直接拒绝新 tool_use**,强制保存 + 新建/重置 Session,**绝不进入 80-100% 降级区** | 运行时,确定性 |

> ⚠️ 对初稿的一处纠正:DeepSeek 写「L2 由 PM 自动触发」。**PM 是 LLM,拿不到精确 token 数也不可靠**——触发与硬门必须是**运行时**做(确定性);PM 只参与「摘要内容是否仍贴合原始需求」的判断。

**各模型 80% 硬性上限(默认,可配)**:

| 窗口 | 模型示例 | 硬上限(80%) |
|:--:|------|:--:|
| 128K | GPT-4o / 4o-mini / 4.1 | ~102K |
| 200K | Claude 全系(opus/sonnet/haiku) | ~160K |

**压缩 = 结构化摘要,不是截断**:产出 `Session Digest`(JSON:已完成项、关键决策/契约、待办、碰接点),把 ~80K 上下文压到 ~2-5K 注入新 Session。比我们当前 `MAX_HISTORY_MESSAGES` 的纯条数截断更优(截断会丢早期契约,digest 保留)。

**新增 NFR(P0,均为运行时机制)**:
- **NFR-10.1**:内置 `TokenCounter`,逐 agent 实时上下文占用。
- **NFR-10.2**:80% 硬门,后端拒绝新 tool_use 并重置 Session。
- **NFR-10.3**:70% 软门,限若干轮内完成 digest 重置。

### 4.3 漂移/卡死识别 = PM 提示词(判断) + 运行时计数(可靠性)
- **PM 提示词**(已部分具备,可加强):每个子节点对照原始需求逐条核对、发现「顺手加的/越界改的」就标记或回滚、接口变更必须经 Architect。
- **运行时计数**:对「同一子任务连续失败轮次」做确定性计数(run_checks 连红 / task 重试),≥2 轮 → 升 tier + 缩范围;≥3 轮 → 暂停转人工。靠引擎计数,不靠 PM 自觉。

---

## 5. Bug 修复快速通道（保留，轻量）

```
Bug → PM(economy 分类) → Developer(premium 修复) → Reviewer(standard) → QA(standard 验证) → 完成
                                          ▲ 2 轮修不好 └─ 升级为完整流程(回 Gate 1,Architect 介入根因)
```
- Bug 修默认 Developer 上 premium(修 Bug 要精准理解上下文)。
- 复用现有 `bug-fix` 工作流模板,加「默认 tier + 失败升级」即可。

---

## 6. 极轻量「变更请求备注」（替代 CCB 整章）

> 砍掉 CCB/ECR/ECO 委员会/投票/会议那套企业流程。代码稳定后的把关,**已由 Reviewer + run_checks 覆盖**。这里只留一个**审计用的轻量备注**,不引入审批官僚。

**机制**:当一次改动发生在「主要功能完成之后」(用户标记项目进入 stabilized,或在维护模式),PM 在派活前生成一条 **Change Note**,随任务一起走,完成后归档到 `.roam/changes.log`(JSONL,可选)。

```jsonc
// 一条 change note —— 记录,不是审批
{
  "id": "chg-2026-0001",
  "when": "2026-06-02T10:00:00Z",
  "type": "bugfix | enhancement | refactor | security",
  "summary": "一句话:改了什么、为什么",
  "files": ["src/auth/login.ts"],          // 预计触及
  "verify": "npm run build && npm test",   // 本次验证命令
  "reviewer_verdict": "PASS | FAIL",        // 来自独立 Reviewer
  "checks_green": true                      // 来自 run_checks
}
```

- **不需要**:投票、三方委员会、升级到 Sponsor、定期会议、ECR/ECO 双表。
- **保留的价值**:可追溯(谁、何时、改了什么、验证结果),以及「稳定后改动要过 Reviewer + run_checks」这条纪律——两者我们本就有,Change Note 只是把它落一行盘。
- 紧急修复:照常修,事后补一条 Change Note 即可,无审批阻塞。

---

## 7. 成本优化效果（真实价，示意）

以一个中等 CRUD 功能为例(数量级示意,非精确报价):

| 策略 | 各角色 tier | 相对成本 |
|------|------|:---:|
| 全 premium(旗舰) | opus×5 | 基准 100% |
| 全 standard | pro×5 | ~9% |
| **动态切换(推荐)** | PM economy→premium 仅关键委派、Arch premium、Dev standard(核心 premium)、Rev/QA standard | **~10-15%** |
| 极致省钱(简单任务) | 全 economy | **~2-3%** |

**关键事实(比初稿更夸张)**:用真实网关价,premium 输出 $25/1M vs economy 输出 $0.28/1M = **≈90x**;输入 $5 vs $0.14 = **≈35x**。所以「贵模型干脑力活、便宜模型干体力活」省下的不是 67%,在合适任务上可达 **一个数量级以上**。这正是 Cline/Copilot/Cursor(单 Agent 或绑死单 Provider)做不到的真壁垒。

> 成本对每个角色已可见:`ModelPricing` + `LivePriceService`(实时 /api/pricing)+ SessionManager 累计 + Dashboard。本文档只需补「按阶段/角色拆分」的报告视图。

---

## 8. gated_workflow 模板 schema（用我们的 tier 名）

```jsonc
{
  "id": "feature_dev",
  "name": "标准功能开发(含动态切模型)",
  "type": "gated",                  // 现引擎只有线性;新增 'gated'
  "complexity": "auto",             // auto = PM 在 Gate 0 判断;或 low|medium|high
  "steps": [
    { "id": "design",  "role": "architect", "action": "产出技术方案 + API 契约 + 文件清单" },
    { "id": "code",    "role": "senior-dev", "action": "按契约实现 + 单测" },
    { "id": "review",  "role": "reviewer",   "action": "独立评审,给 PASS/FAIL + 证据" },
    { "id": "qa",      "role": "tester",     "action": "测试 + 边界" }
  ],
  "gates": [
    {
      "after": "code",
      "objective": "run_checks",                  // 运行时:必须绿
      "judge": "pm",                              // PM:主观 PASS/FAIL
      "on_pass": { "setTier": { "senior-dev": "economy", "reviewer": "standard" } },
      "on_fail": { "setTier": { "senior-dev": "premium" }, "maxRetries": 2,
                   "onExhaust": "human" }
    },
    {
      "after": "review",
      "requireVerdict": "PASS",                    // reviewer 必须 PASS
      "on_fail": { "route": "senior-dev", "setTier": { "senior-dev": "premium" }, "maxRetries": 1 }
    }
  ],
  "onComplete": { "report": ["cost_by_role", "cost_by_phase"], "allTo": "idle" }
}
```

Bug 快速通道:`"type": "gated", "skipSteps": ["design"], "defaultTier": { "senior-dev": "premium" }, "escalation": { "maxRetries": 2, "onExhaust": "promote_to_full" }`。

---

## 9. 实现切分（并入 req4，标注已建/待建）

| 项 | 归属 | 状态 |
|----|------|:---:|
| `ModelTier` + tier→模型映射 + `modelForRole` | 配置/RoleConfig | ✅ 已建 |
| 独立 Reviewer 角色 + run_checks 客观门 | 角色/TeamTools | ✅ 已建 |
| per-agent 成本 + 实时价目 + Dashboard 成本卡 | models/SessionManager/Dashboard | ✅ 已建 |
| **`SessionManager.setModel(agentId, model)` 热切换** | 运行时机制 | ⬜ 待建(openai-compat 改字段即可;claude 走 restart+快照) |
| **`WorkflowEngine` 新增 `gated` 类型**(gate=run_checks+PM 判断、on_pass/on_fail 切 tier、重试) | 运行时机制 | ⬜ 待建 |
| **`TokenCounter`:逐 agent 实时上下文占用估算**(NFR-10.1) | 运行时机制 | ⬜ 待建(L1) |
| **80% 硬门:后端拒新 tool_use + 重置 Session**(NFR-10.2) | 运行时机制,确定性 | ⬜ 待建(L3,防 128K 降级核心) |
| **70% 软门:Session Digest 结构化压缩后重置**(NFR-10.3,替代纯条数裁剪) | 运行时机制(摘要用 economy 模型) | ⬜ 待建(L2) |
| **L0 预算分配 + 上下文感知分包** | 运行时机制 | ⬜ 待建 |
| **卡死轮次计数 + 自动升级/转人工** | 运行时机制 | ⬜ 待建 |
| **PM 提示词:复杂度判断、子节点对齐、漂移识别** | PM prompt(判断) | ⬜ 待建(便宜) |
| **`.roam/team.json` 可定义 tier 映射 / 角色 / gated 工作流 / 规则** | Team Config v2 = **req4** | ⬜ 待建(本设计的承载体) |
| 按阶段/角色成本拆分报告视图 | Dashboard | ⬜ 待建 |
| 轻量 Change Note(`.roam/changes.log`) | 运行时,可选 | ⬜ 待建(很小) |
| ~~CCB / ECR / ECO 委员会流程~~ | — | ❌ **不做**(R5) |
| ~~智能模型推荐/历史学习~~ | — | ⏸ 缓 |

**建议落地顺序**(全部并进 req4 Team Config v2):
1. `SessionManager.setModel` 热切换(地基,小)。
2. `WorkflowEngine` `gated` 类型 + tier 切换矩阵 + 重试(核心机制)。
3. `.roam/team.json` 承载 tier 映射 + gated 工作流 + 角色(req4 本体)。
4. token 触发的 compaction(防漂移机制)。
5. 阶段/角色成本报告 + 轻量 Change Note(打磨)。

---

## 10. 总结

```
标准 SDLC ──(每个 Gate)──▶ 运行时按矩阵切 tier ──▶ 成本套利
  需求    架构    编码    评审    测试    部署
  econ → prem →  std/prem → std → std →  econ        ← 机制(确定性)切换
          ▲                ▲
      PM 判断质量      Reviewer PASS + run_checks 绿  ← 判断 + 客观门
```

**三条核心洞察(修订后)**:
1. **每阶段对模型能力需求不同 → Gate 是天然切换点**。这是「成本套利」的具体机制,用真实价省的是**一个数量级**,不是初稿的 67%。
2. **机制归运行时、判断归 PM**。需要可靠的(切模型、gate、压缩、计数)必须确定性实现;PM 只做它擅长的判断。这是初稿最大的认知修正。
3. **这片地 = req4**。gated 工作流 + tier 映射 + 角色 + 规则全进 `.roam/team.json`,带默认。CCB 砍掉,只留一行 Change Note。
```
