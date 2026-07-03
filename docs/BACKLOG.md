# UnodeAi — 现行待办清单（单一前瞻列表）

## ⚡ 现状 2026-06-19 — 1.0 路线 = 手感优先，压缩到 GA（当前权威）

> **路线图权威已更新**:[ROADMAP_v0.8.51-1.0.md](ROADMAP_v0.8.51-1.0.md)(2026-06-19 拍板,手感优先压缩版)。
> 基线:**已发布 0.8.50**(bundled VSIX,CI audit+E2E 双门绿)。下面"1.0 冲刺 punch-list"里的 attractions
> 已**全部交付**(Evidence Report / Team Packs / 成本可视化 / Mission Control / 安全叙事 / combobox /
> Add-MCP 表单),保留作历史参考;**下一段排期看上方 ROADMAP**。
>
> **接下来顺序(压缩)**:0.8.51 Solo 快速入口 → 0.8.52 slash 模板+chips → 0.8.53 只读研究子 Agent →
> 0.8.53b ModelProfile 注册表 → 0.8.54 Router v2 → 0.8.55 MCP 可信安装 → **1.0 candidate**(benchmark
> harness + GA logistics)。CLI / Review / Enterprise-lite / 生态分享 **后置到 GA 之后**。
> model-variance 杠杆:①②已发(0.8.49)、③=0.8.53b、④=1.0 candidate 的 harness。

> 基线:**已发布 0.8.31（bundled VSIX，CI 上 audit+E2E 双门绿）**。下方 2026-06-10 的"双线"与
> tier 表是历史参考。v0.9 加固路线图:[ROADMAP_v0.9_WEAK_MODEL_HARDENING.md](ROADMAP_v0.9_WEAK_MODEL_HARDENING.md)。

**v0.9 弱模型加固 6 项全部交付**:① search_files(0.8.6) ② 写文件防灾/shrink 守卫(0.8.13)
③ 命令守卫误报修(0.8.2/4/7) ④ 弱模型 tool-call 纪律/force-XML(0.8.14) ⑤ 项目约定注入 A1/A2
⑥ stale-memory 隔离 + read-before-claim(0.8.16)。**本轮又叠加护城河**:verifier-as-gate(PM 路径,
0.8.27,死锁安全的 retry→escalate→human-handoff)、"先读真实代码再动手"强规则(0.8.26)、Router v1
(可审计+避开 down agent,0.8.29)、GA 加固(audit-clean + bundled + CI E2E 门,0.8.28/0.8.31)。

### 1.0 冲刺 punch-list(按价值排序)
- **吸引力/Time-to-value**(Codex 市场分析):Evidence Report(任务结束的证据报告)· Team Packs
  (Bugfix/Release/Security 等可执行团队包)· 成本对比可视化(all-premium vs mixed routing)· Crew
  Mission Control 第一屏 · 安全默认叙事(README/store 文案)。🟢 快赢:成本可视化 + 安全叙事。
- **近期打磨**:Agent Builder 模型选择 type-to-filter combobox(张 tagged "next")· Marketplace
  "Add MCP server" 引导式表单。
- **Router v2**:能力/MCP 感知打分(需 roster view 暴露 agent 能力)。
- **商用 logistics(GA)**:repo→weroam + 开源 · 对齐 package.json repository(origin 仍 yanzhang79)·
  建 roam-skills repo · onboarding/time-to-value · store/billing 文案。
- **1.1(GA 后)**:Agent Builder 扩展(分享/导出自建 agent、托管 skill 创作)。

---

## Agent Builder polish (post-0.8.12, low priority, UX-only)
- ~~**Model select: combine the search box + dropdown into one type-to-filter combobox**~~ ✅ 已做(0.8.x)。
- "Add MCP server" in the Marketplace MCP tab is a thin alias to the team.json editor — a guided form
  would be nicer later.

> **以下为历史参考（2026-06-10 当时的"接下来"清单，已被上方现状取代）**。历史进展见 [STATUS.md](STATUS.md)、路线图见
> [ROADMAP_v0.3_v0.4.md](ROADMAP_v0.3_v0.4.md)。每项标注:**优先级 · 负责人(Claude 实现 /
> DeepSeek 候选 / 需设计 / 需你拍板) · 投入**。
>
> **更新**:2026-06-10 · **基线**:**v0.5.1 已发布上架** · **阶段**:🚀 **双线并行**(见下)。
>
> ---
> ## ⚡ 现行双线(2026-06-10,v0.5.1 后)— 这是当前权威
> v0.3→v0.5 已交付:Solo/Fast、每 agent 真终端(PTY)、OpenRouter、知识工作团队、checkpoint/回退、写文件
> 审批(diff)、实时 Todo、@-context(file/folder/problems/url)、命令审批、后台命令、弱模型鲁棒四层、团队
> 共享记忆、v0.5.1 stabilization。**现在分两条不互锁的线:**
>
> 1. **V0.5.x Execution Engine 线(当前最高优先,2026-06-10 升格)** → **权威:
>    [DEVPLAN_v05x_Execution_Engine.md](DEVPLAN_v05x_Execution_Engine.md)**。把每个 agent 的执行内环升到
>    Cline 级(写后诊断反馈、验证义务、插话、主动上下文),弱模型也能成功执行。列车:v0.5.2 反馈环 →
>    v0.5.3 插话(G-001)→ v0.5.4 上下文+纠错 → v0.5.5(看数据)。Opus 总负责主刀,Codex UI/P1,
>    DeepSeek 跑基准监护([UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md) = 记分牌)。
> 2. **V0.6.0 护城河线(Marketplace/可扩展生态)** → **权威:[PRD_v0.6.0_Marketplace.md](PRD_v0.6.0_Marketplace.md)**。
>    拍板已锁(Teams→MCP→Skills;git registry 抄 Kilo)。**资源暂向 1 倾斜**:Codex E1 导出卡降为空档任务,
>    E0 地基在 v0.5.3 发布后恢复。
>
> 下方 v0.2.x 时代的 Tier 表是历史参考,仍有效的遗留项(#1 实时Todo✅、#3 IDE诊断、#6 运行中介入、#9
> Marketplace→已升为 V0.6.0 头牌、#11 hooks)按上面双线归口。
> ---
>
> **里程碑判断**:v0.2.x 已把"地基"夯实——**agent 鲁棒性全套已上线**(见下),这是"便宜模型也
> 可靠"这一真护城河。地基稳后,v0.3.0 转向触达面与 parity。

---

## ✅ 本轮已发布(参考,无需再做)
- **v0.2.8** 命令审批 'ask' 模式(Run / Always-allow / Deny)
- **v0.2.9** agent 间消息(`send_message`,F3)
- **v0.2.10** 实时 Analysis 卡 + 状态圆点 + 滚动动词
- **v0.2.11** delegated-agent 卡 Stop 修复 + 空首响应重试(F8)+ 回复复制按钮
- **v0.2.12** 并行委派 Option B step 1(`assign_task_async` + `await_tasks`)
- **v0.2.13** Codex review 硬化:send_message 作为 turn 投递;命令白名单收窄为模板;await_tasks 失败标记;async 并行上限
- **v0.2.14** Option B step 2(TaskClaimRegistry + 架构师分区)· **v0.2.15** 团队规则按钮 · **v0.2.16/17** fetch_url + SSRF
- **v0.2.18** 🔑 Agent 鲁棒性 A1/A2(自动注入项目约定)· **v0.2.19** @file · **v0.2.20** 后台长命令
- **v0.2.21** copy 可见/Team Rules 默认值/PM 主动汇报 · **v0.2.22→23** 委派"Waiting on X"卡 + 状态 emoji
- **v0.2.24** 🔑 worker 合规协议 + 空回复强制重试 · **v0.2.25** 🔑 L3 fallback 模型升级 + 模型热切修复 + @file realpath + 命令审批收窄
- **v0.2.26** 一键清空(确认弹窗)+ 紧凑 Team 面板 + icon copy + 🔑 **命令改写兜底**(`npx vitest`→`npm test`,弱模型敲错也执行不了错的)

> 🔑 = Agent 鲁棒性四层,**已全部上线**:L0 命令改写兜底(v0.2.26)· A1/A2 约定注入(v0.2.18)·
> L1 worker 合规协议 + L2 空回复重试(v0.2.24)· L3 模型升级(v0.2.25)。**这套是当前最大成果**,
> 下一步是真实 dogfooding 验证它对 deepseek-flash 是否压得住罢工。

---

## 🥇 Tier 1 — 优先做

### 🔑 Agent 鲁棒性(来自 DeepSeek dogfooding —— 最高杠杆)
> 洞察:DeepSeek 用 UnodeAi 编程,反复用错测试命令(`npx vitest` 而非 `npm test`)并把自己的 bug 归因为"infra 坏了"(F3/F8/#10 同一病根)。根因不是 DeepSeek 一家,而是 **UnodeAi 没把项目约定喂给 agent**。Claude 会读 package.json 是训练使然;弱/便宜模型不会。**产品卖点是"用便宜模型套利",所以必须对弱 agent 鲁棒**——这也是对 Cline/Roo/Kilo(靠单强模型)的差异化。

| # | 事项 | 说明 | 负责人 | 投入 |
|---|------|------|--------|------|
| A1 | **自动注入项目约定** | ✅ 已发 v0.2.18(`ProjectConventions`:探测 package.json scripts + 包管理器,经 `getProjectContext` 注入两个后端,package.json 变更自动刷新) | — | — |
| A2 | **提示词加固** | ✅ 已发 v0.2.18(并入 A1 的约定块:用项目脚本、勿自创命令、报 not-found/no-suite 勿归因"环境坏了") | — | — |


| # | 事项 | 说明 | 负责人 | 投入 |
|---|------|------|--------|------|
| 1 | **实时 Todo 清单** | agent 把多步任务拆成可勾选清单,实时更新,在 chat 渲染。与 Analysis 卡 + 多 agent 定位最契合,差异化最强 | Claude 实现 | 中 |
| 2 | **写文件审批 + 回退/检查点** | 写操作可"预览 diff→批准"(对称于命令审批);一键"撤销这一轮"的所有改动(基于快照/git stash)。解决自动改文件的信任问题 | Claude 实现 | edit-approval 小 / rewind 中 |
| 3 | **IDE 诊断喂给 agent** | 用 `languages.getDiagnostics`(Problems 面板)做工具/写后自动附加,比 `run_checks` 快一个量级的反馈回路。VS Code 独有杠杆 | Claude 实现 | 中 |
| 4 | **Option B step 2:架构师分区 + TaskClaimRegistry** | ✅ 已发 v0.2.14 | — | — |
| 4b | **团队规则(Team Rules)按钮 + 强制写** | Team tab 旁加「Rules」按钮 → 弹框让用户写团队规则(如"developer 写完必须架构师评估")。团队创建时**强制提示**写一条。**通用机制,取代把工作流硬编码进 prompt**——用户用自然语言表达治理规则。**底层已就绪**:写入 `.roam/rules.md`,经 [RulesFile.ts](../src/session/RulesFile.ts) `getProjectContext`/`projectContextBlock` 已注入每个 agent system prompt、每轮刷新。要做的只是:① Team 面板 `view/title` 菜单加按钮;② 编辑规则的 webview/输入框,持久化到 `.roam/rules.md`;③ `createDefaultTeam`/onboarding 完成后强制弹一次让用户写规则(可留空但要看到)。| Claude 实现 | 中(管道已有,主要是 UI)|

## 🥈 Tier 2 — 值得做

| # | 事项 | 说明 | 负责人 | 投入 |
|---|------|------|--------|------|
| 5 | **F4:chat 输入卡死** | 队列中的已知 bug,需复现 + 定位 + 修。诊断型任务 | DeepSeek 候选(带任务卡)| 待诊断 |
| 6 | **运行时排队消息 / 中途引导** | agent 运行时输入框现在直接禁用([ChatViewProvider.ts:1135](../src/views/ChatViewProvider.ts#L1135));改成可排队下一条 / 中途插话纠偏 | Claude 实现 | 中 |
| 7 | **后台长命令** | ✅ 已发 v0.2.20(`run_command(background:true)` 返回 `bg_N` 句柄不阻塞 + `check_command`/`kill_command`;同命令策略门控;agent stop 时杀残留)| — | — |
| 8 | **@file 引用 + 斜杠命令/任务模板** | chat 里 `@path` 塞文件入上下文;可复用的 prompt/任务模板。与 #9 Marketplace 部分重叠 | Claude 实现 | @file 中 / slash 小 |
| 8b | **Stop 中断 await_tasks** | 现在 Stop 只取消当前 HTTP 请求,打不断本地的 `await_tasks` 等待(老 `assign_task` 也有此限,并行后体感更明显)。Codex v0.2.13 review 标注的次要项 | Claude | 中 |

## 🥉 Tier 3 — 锦上添花

| # | 事项 | 说明 | 负责人 | 投入 |
|---|------|------|--------|------|
| 9 | **Marketplace(Kilo Code 式)** | 右上角入口,Agent / MCP / Skills 三个 tab,装第三方扩展。**大功能,需先出设计文档 + 你拍板范围**(来源 = git 仓库 or registry JSON?三类一起还是先做一类?) | 需设计 + 需你拍板 | 大 |
| 10 | **Web 抓取工具 `fetch_url`** | ✅ 已发 v0.2.16(DeepSeek 实现 + Claude SSRF 加固)。遗留:DNS-rebinding + 十进制/八进制 IP 编码未覆盖;web_search(需 provider)未做 | — | — |
| 10b | **fetch_url SSRF 加固(续)** | v0.2.17 DNS 校验 + 手动逐跳 redirect。v0.2.25 续:**② 十进制/八进制/十六进制/短式 IP 编码已挡**(`numericV4ToDotted` inet_aton 解码 + isPrivateV4,literal 层防御,不依赖平台 DNS;含回归测试)。**残留**:① TOCTOU(校验解析一次、fetch 连接时再解析,理论仍可 rebind——需把已解析 IP 钉死给连接,Node 全局 fetch 不易做;已在 webFetch.ts 注明);③ 把 fetch_url 从 `read` 拆成独立 capability —— **暂缓**:会改 capability 模型(SkillResolver/角色模板/team.json schema)且对现有 `read` agent 是破坏性变更,需迁移设计;非紧急,留待与 #9 Marketplace 一并规划 | Claude | 残留小 |
| 11 | **生命周期 hooks** | PreToolUse / PostToolUse / Stop(如"每次写完自动跑 prettier")。偏高级用户 | 需设计 | 中 |
| 12 | **可定制状态栏 / 输出风格** | 小幅打磨 | 低优先 | 小 |

## 🔍 调研 / 观察项(非编码)

| # | 事项 | 说明 |
|---|------|------|
| 13 | **终端可见性评估** | UnodeAi 用 `spawn` 抓子进程输出(看不到终端 session);评估是否改用 VS Code 真终端(像 Cline,`createTerminal` + shell integration)的利弊。**我已答应给你出评估** |
| 14 | **F8 观察** | F8 是没复现确诊的防御性修复;留意 reviewer/delegated agent 首轮空是否再现,若再现需抓真实日志真正定位 |
| 15 | **现场验证(你来测)** | v0.2.8 命令审批、v0.2.10 Analysis 卡、v0.2.12 并行委派——在真实任务里验视觉/行为,不满意我再调 |

## 📦 历史遗留队列(早于本轮,确认是否仍要)

| # | 事项 | 来源 |
|---|------|------|
| 16 | **Solo mode**(单 agent 模式验证收尾) | 早期规划([SOLO_MODE_VALIDATION.md](SOLO_MODE_VALIDATION.md)) |
| 17 | **E3.3 claude-native MCP**(第二后端 MCP live 验证,可选) | v0.2.0 Wave 2 遗留 |
| 18 | **Marketplace 商店截图**(扩展 listing 配图) | 发布打磨 |

---

## 🚀 v0.3.0 计划("Cline 级 parity + 触达面")

> v0.2.x 已顺手做掉路线图里大量 parity-polish(thinking 指示器 v0.2.10、@file v0.2.19、后台命令
> v0.2.20、状态可视化等)。v0.3.0 聚焦没做的大件,详见 [ROADMAP_v0.3_v0.4.md](ROADMAP_v0.3_v0.4.md)。

| # | v0.3.0 事项 | 优先级 | 负责人 | 投入 |
|---|------|--------|--------|------|
| **S** | **Solo / Fast 模式**(单 agent 全循环,简单任务默认走它,跳过 Arch→Review)—— **头牌**,Codex+DeepSeek 一致 P0 | 🥇 P0 | **Claude(需先设计)** | 大 |
| **G** | **OpenRouter 等更多网关**(一把 key→上百模型)—— 触达面最大杠杆 | 🥇 P0 | **DeepSeek(任务卡 D2)** | 中 |
| **T** | **更多默认团队**(商业规划/商业分析/财务分析)—— 把"AI 团队"推出编码圈,低投入高差异化 | 🥈 P1 | **DeepSeek(任务卡 D1)** | 小 |
| 1 | **实时 Todo 清单**(多步任务可勾选清单,chat 渲染)—— 差异化强 | 🥈 P1 | Claude | 中 |
| 3 | **IDE 诊断喂给 agent**(`languages.getDiagnostics`,写后自动附加)—— VS Code 独有杠杆 | 🥈 P1 | Claude | 中 |
| M | **MCP Setup 向导**(GitHub/Playwright/Filesystem 模板,保持 default-deny)| 🥉 P2 | 需设计 | 中 |
| 8c | **@-context 扩展**(@folder / @problems / @url,@file 已有)| 🥉 P2 | Claude/DeepSeek | 中 |

## ⛓️ 留到 v0.4.0("信任 + 团队真并行")
- **#13 Cline 级命令执行(VS Code 真终端 + shell integration)** —— 设计已出 → [DEVPLAN_terminal_execution.md](DEVPLAN_terminal_execution.md)。把 `run_command`/`run_checks` 从裸管道 spawn 换成集成终端(PTY),**同时解决两件事**:① agent 能跑 vitest 这类需要 TTY 的工具(消掉当前缺口,对齐 Cline/Claude Code/Codex);② 命令执行可见。带 spawn 兜底。**因 dogfooding 痛点,Phase 1 值得提前。** Claude 实现。
- **#2 写文件审批 + 检查点/回退**(per-step 快照、对比、一键撤销)—— 最大信任缺口,与 v0.4 checkpoints 合并立项
- **并行派发**(PM 真正扇出独立任务,agent 不空转)· **agent 浏览器** · 共享工作记忆 · 更智能文件协调

## 🧊 待设计 / 待拍板
- **#9 Marketplace**(Agent/MCP/Skills 三 tab)—— 体量最大,先出设计文档 + 你拍板范围
- **#10b ③** fetch_url 拆独立 capability(随 #9 一并规划)· **#11** 生命周期 hooks
> #13 终端执行已从"调研项"升为 v0.4 计划项(见上 ⛓️ 段 + DevPlan)。

## 三团队结构 + v0.3/v0.4 完整计划(2026-06-09)
> **完整开发计划见 → [DEVPLAN_v0.3.0_v0.4.0.md](DEVPLAN_v0.3.0_v0.4.0.md)**(权威)。这里只放当前并行分工。

三团队:**Claude**(规划/架构 + 关键功能 + 审查门 + 发布)· **Codex**(编程主力,做规格明确的功能)· **DeepSeek+UnodeAi**(实时测试/dogfooding,build+lint 自检,Claude 跑测试)。

**硬规则:** Codex 和 DeepSeek **各自独立 git worktree + 分支**(`git worktree add ../roam-crew-<who> -b <who>/<task>` → 该目录 `npm install`);Claude 在 main **审查后合并**;无人自合并/自发布。每个任务由 Claude(架构师)指定**允许改的文件范围**,不重叠。

**当前分配(立刻开始):**
- **Claude:** **#13-1 终端执行 Phase 1**(核心路径,解封 agent 跑测试 + Cline 对齐)→ [DevPlan](DEVPLAN_terminal_execution.md)。
- **Codex(worktree `codex/openrouter`):** **G — OpenRouter provider**(只动 `RoleConfig.ts` provider 数据 + `openAICompatBaseUrl.ts`(如需)+ 测试;不碰命令执行路径)。
- **DeepSeek+UnodeAi:** dogfood 当前 main(用新 Create-Team 选择器建个知识工作团队,跑真实任务,报 bug;build+lint 自检)。
- **Claude 发 v0.2.28**(当前 main:D1 UI + PM 规则 + vitest4),让三方 + 用户都在同一近期基线。

> 注:用户曾问"能否每个 developer 做完后让 architect 评估"——结论是**不硬编码进 PM 提示词**,改由团队规则(v0.2.15)让用户自己写规则表达,更通用。

> 文档治理:本清单与 STATUS/PRD/设计文档由 Claude 统一维护;其它助手的想法写进
> [PROPOSALS_INBOX.md](PROPOSALS_INBOX.md),勿直接改权威文档。
