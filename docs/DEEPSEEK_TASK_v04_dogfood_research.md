# DeepSeek + UnodeAi 任务卡 (v0.4.0 周期) — 滚动 dogfood + V6 共享记忆调研

你这一轮有**两件事**：(A) 持续用 UnodeAi 真做任务、报 bug;(B) 一个调研任务,产出给 Claude 做架构。

---

## A. 滚动 dogfood（主线,持续做）
**目标**：在每个新功能合进 main 后,第一时间用真实任务把它压一遍,抢在用户之前发现 bug。

**现在(v0.3.0 已发布)先压这些**，用真实多步任务、Solo 或团队都行：
1. **@-context**：在真实任务里用 `@folder` / `@problems` / `@url` 给 agent 喂上下文,确认它确实"看到"了
   （让它复述/基于注入内容回答,别用工具读）。
2. **实时 Todo**：做一个 ≥4 步的真任务,确认顶部 Plan 清单出现并实时 `☐→▸→☑` 走到 N/N。
3. **真终端**：让 agent 跑 `npm test` / `node xxx` 这类要 TTY 的命令,确认在它专属终端里真跑、退出码正确。

**之后每当 Claude/Codex 把新功能合进 main**（我会通知你 rebase），按下面对应项压测：
- **V3 Parallel Console**(Codex)：起多个 agent,确认 Console 面板实时显示各自状态/任务/ctx%/成本。
- **V1 Checkpoints / V2 Write-approval**(Claude)：让 agent 改文件 → 出现 diff 预览 → approve/deny 都试；
  改几个文件后用 restore 回滚,确认文件被还原、对话能继续。

**报告格式**（每次）：用了哪个版本/commit、做了什么任务、哪步出问题、**贴原始输出/截图**,别下"环境坏了"
结论。自验证统一用 `npm run build` + `npm run lint` + `npm test`（真终端,退出码为准）。

> ⚠️ 在**独立工作区**或子目录里跑,别把产物(`tmp_demo/` 之类)留进 RoamCrew 仓库根；scratch 文件用 `_` 前缀。

---

## B. 调研任务 V6 — 共享工作记忆 / 项目知识库（产出给 Claude 架构）
**问题**：现在多 agent 协作,跨 agent 的事实(决策、约定、谁负责什么、接口契约)主要靠 PM 口头转达,易丢。
我们想要一个**共享工作记忆**:agent 能写入/查询一份团队共享状态,减少 PM 手动搬运。

**你要产出一份调研短文**（`docs/RESEARCH_V6_shared_memory.md`,你新建并提交到你的分支/或直接发我），覆盖：
1. **同类做法**：Cline / Kilo / Cursor / Claude Projects 等怎么处理跨会话/跨 agent 的共享上下文与记忆?
   各自的数据结构(KV? 向量库? 文件? 追加日志?)、写入时机、读取/检索方式、冲突处理。
2. **对 UnodeAi 的选型建议**：在我们现有架构(MessageBus + 每 agent 独立后端 + 已有 `.roam/rules.md`
   项目记忆 + FileCoordinator)下,共享记忆**最该长在哪一层**?是扩展 `.roam/` 下的结构化文件,还是
   一个进程内共享 store + 工具(`memory_write` / `memory_query`),还是走 MCP?给 1 个推荐 + 2 个备选,带取舍。
3. **最小可用切口**：如果只做一个 v0.4 能落地的 MVP,你建议先做哪个最小子集(比如"团队共享便签",
   append-only,agent 用一个工具写、PM/其他 agent 能读)?

**不要写实现代码**——这是调研 + 设计建议。Claude 收到后定架构,再决定谁来实现(很可能 Codex)。

---

**优先级**：A(dogfood)是你的主线、每天做;B(调研)穿插完成,不阻塞 A。有任何 v0.3.0 真实 bug,立刻单独报。
