# Codex 任务卡 V6 — 团队共享记忆 MVP（架构已定:append-only 便签）

**目标**:让多 agent 有一份**共享工作记忆**——任一 agent 能写入一条便签,**所有 agent(及后续会话)都能看到**,
减少全靠 PM 口头转达。基于 DeepSeek 的调研推荐方案 A([RESEARCH_V6](RESEARCH_V6_shared_memory.md))。

**范围 = MVP**:一个 append-only 便签 `.roam/memory/notes.md` + 一个 `memory_note` 工具 + 把最近 N 条注入
每个 agent 的 system prompt。**不做** 检索工具/分类/向量库(留 Phase 2)。

## 架构(Claude 已定,照此实现)
- **数据**:`.roam/memory/notes.md`,人类可读、git 可追踪。每条一行:`- [ISO时间] [agentId] note`。
- **注入**:复用现有"项目上下文注入"通道——和 `.roam/rules.md`(RulesFile)/ProjectConventions 同样的方式,
  把最近 N 条便签包成 `<shared_memory>…</shared_memory>` 拼进每个 agent 的 system prompt;文件变更时热重载。
- **写入**:新工具 `memory_note(note)` → 追加到文件。复用 `update_todos`/`checkpointRecorder` 那种**注入式
  seam**,WorkspaceTools 只调一个注入的 writer,不直接耦合记忆实现。

## Worktree（隔离 — 必须）
```
git worktree add ../roam-crew-codex-v6 -b codex/shared-memory
cd ../roam-crew-codex-v6 && npm install
```
基于**最新 main**(含 v0.4.0 全部内容)。

## 允许改/加的文件
1. **`src/session/SharedMemory.ts`** —— 新建。**照 `src/session/RulesFile.ts` 的风格**(vscode-free、IO 可
   注入、可单测)。类 `SharedMemory`:
   - 构造:`(filePath: string, reader?, appender?, mkdir?)`;`memoryFilePath(workspaceRoot)` 助手返回
     `<root>/.roam/memory/notes.md`(仿 `rulesFilePath`)。
   - `append(agentId: string, note: string): Promise<void>` —— 确保目录在,追加一行
     `- [${new Date().toISOString()}] [${agentId}] ${oneLine(note).slice(0, 500)}\n`。**fully fault-tolerant
     (never throw)**——和 RulesFile.ensureExists 一样,失败(无 workspace/不可写)静默吞掉。
   - `load(): Promise<string>` —— 读文件,缺失/不可读 → `''`(不抛)。
   - `block(maxNotes = 30): string` —— 取**最近** maxNotes 行,包成
     `\n\n<shared_memory>\n<最近便签>\n</shared_memory>`;无内容返回 `''`(让调用方无条件拼接)。
   - 纯助手 `oneLine(s)`(把换行压成空格)。
2. **`src/backend/WorkspaceTools.ts`** —— 加 `memory_note` 工具:
   - `specs()` 里**无条件**加(像 `update_todos`,所有 agent 可用)。description 见下。
   - 构造函数末尾加注入参数 `private memoryWriter?: (agentId: string, note: string) => Promise<string>`。
   - `execute` 加 `case 'memory_note': return this.recordMemoryNote(args.note);`
   - `private async recordMemoryNote(note)`:校验非空(空 → `Error: memory_note requires a non-empty 'note'.`);
     有 writer → `await this.memoryWriter(this.agentId, String(note))` 返回其确认串;无 writer → 返回
     `'Shared memory is not available in this context.'`。**REQUIRED_PARAMS 里给 `memory_note: ['note']`**。
   - description 建议:`"Record a short note to the team's SHARED memory (.roam/memory/notes.md) so other agents and future sessions see it. Use for decisions made, gotchas/pitfalls discovered, interface contracts, or who-owns-what. Keep it one line."`
3. **`src/backend/OpenAICompatBackend.ts`** —— 构造函数加 `memoryWriter?` 参数,透传给 `new WorkspaceTools(...)`
   (放在参数列表末尾,跟 `requestWriteApproval` 之后)。
4. **`src/extension.ts`** —— 接线(加法为主):
   - 构造 `sharedMemory = new SharedMemory(memoryFilePath(workspaceRoot()))`;activate 里 `await sharedMemory.load()`
     (放进现有那个"有 workspace 才做磁盘活"的 try 块里,和 rulesFile.load 一起)。
   - **注入**:找到 `getProjectContext` 那个 dep(现在是 `[projectConventions.get(), rulesFile.get()].filter…join`),
     把 `sharedMemory.block()` 也加进去。
   - **热重载**:加一个 `FileSystemWatcher('**/.roam/memory/notes.md')` → `void sharedMemory.load()`(仿 rulesWatcher)。
   - **写 writer**:`createBackend` 的 openai-compat 分支里,定义
     `const memoryWriter = async (agentId, note) => { await sharedMemory.append(agentId, note); void sharedMemory.load(); return 'Noted to shared team memory.'; }`,作为最后一个参数传给 `new OpenAICompatBackend(...)`。
5. **测试**:
   - `src/session/__tests__/SharedMemory.test.ts`:append 行格式、load 缺失→''、block 取最近 N + 空→''、
     append 失败不抛(注入会抛的 appender)。
   - `src/backend/__tests__/` 给 `memory_note` 加一条:注入假 writer → `run('memory_note',{note:'x'})` 调到 writer
     且返回确认;空 note → 报错;无 writer → 优雅降级。

> ⚠️ **共享文件**:`WorkspaceTools.ts`/`OpenAICompatBackend.ts`/`extension.ts` 是热点。你提交到
> `codex/shared-memory` 分支,Claude review 时处理 rebase。**只加新工具/注入参数,别动** checkpoint/写审批/
> 命令审批/协议(native/xml)/A-B 逻辑。注入参数一律加在各构造函数**末尾**,降低冲突。

## 自验证(提交前全绿)
```
npm run build && npm run lint && npm test && npm run compile:e2e
```
用项目脚本;worktree 保持干净(`_*`/`tmp*` 不提交)。

## 验收
- agent 调 `memory_note("用 X 不用 Y,因为 Z")` → 追加进 `.roam/memory/notes.md`;**其他 agent 下一轮的 system
  prompt 里出现 `<shared_memory>` 含这条**。文件人类可读、git 可见。
- Claude review 合并;DeepSeek dogfood:agent A 记一条坑 → agent B 在后续任务里能引用到。
- Phase 2(以后):`memory_query`/grep 检索、tag、归档——本卡不做。
```
