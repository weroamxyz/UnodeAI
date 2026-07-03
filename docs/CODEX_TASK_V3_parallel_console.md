# Codex 任务卡 V3 (Phase 1) — Parallel Console（实时"谁在干什么"看板）

**目标**：新增一个 **Parallel Console** webview——一张实时看板,一眼看到**每个 agent 当前在干什么**:
状态、当前任务、上下文用量 %、累计 token/成本/轮次、最近错误。这是 v0.4.0 的**门禁项之一**
（checkpoints + write-approval + parallel-console），也是对 Kilo "Agent Manager" 的对标第一步。

**范围 = Phase 1（看板,只读）**：只渲染 `SessionManager.getAll()` 已有的数据,**不改任何工具/后端/写
入路径**。Phase 2(每个 agent 改了哪些文件 + diff)留到 Claude 的 V1 Checkpoints 落地后,由 Claude 提供
文件活动数据源再接上——**本卡不做 diff/文件归属**。

## Worktree（隔离 — 必须）
```
git worktree add ../roam-crew-codex-v3 -b codex/parallel-console
cd ../roam-crew-codex-v3 && npm install
```
基于最新 main（含 v0.3.0）。

## 数据来源（已存在,只读,别改）
- `sessionManager.getAll(): SessionInfo[]`（`src/types.ts:294`）。每个 `SessionInfo` 有你需要的一切：
  `id` · `config`(取 `config.name` / `config.role`) · `status` · `currentTask?` · `errorMessage?` ·
  `usage?: { inputTokens, outputTokens, costUsd, turns }` · `contextUsage?: { tokens, window, ratio }`。
- 实时刷新：监听 `sessionManager` 的事件（`session.status` / `session.context` 等已 fire）触发 `refresh()`。
  参考 `TeamViewProvider` 怎么订阅 sessionManager + 重渲染（同样的模式,照抄结构即可）。

> ⚠️ 不要去 FileCoordinator 找"谁占用哪些文件"——它是 optimistic CAS,没有公开的归属/claims 读 API。
> 文件归属 + diff 是 Phase 2,依赖 Checkpoints,不在本卡。本卡只用 SessionInfo。

## 允许改的文件
1. `src/views/ParallelConsoleProvider.ts` —— **新建**。一个 `vscode.WebviewViewProvider`,`viewType =
   'roam.parallelConsole'`。结构、CSP/nonce、`esc/escAttr`、订阅刷新都**照 `TeamViewProvider` 的现成写法**。
2. `package.json` —— 在 `contributes.views.roam` 加一个 webview view（id `roam.parallelConsole`,name
   "Console"，icon `$(dashboard)` 或 `$(server-process)`）；加一个命令 `roam.showParallelConsole`
   （title "UnodeAi: Show Parallel Console"）+ `view/title` 里给它一个 refresh 按钮(可选)。
3. `src/extension.ts` —— **只加**：构造 `parallelConsoleProvider`、`registerWebviewViewProvider`、注册
   `roam.showParallelConsole`、把它接进 `wireEvents()` 现有的 sessionManager 监听里 `?.refresh()`。
   **加法式改动,别动 WorkspaceTools / 命令执行 / checkpoints 相关任何东西**（Claude 正在改 WorkspaceTools）。
4. 测试：把"把 `SessionInfo[]` 投影成看板行"的逻辑抽成一个**纯函数**（如
   `src/views/parallelConsoleModel.ts`: `toConsoleRows(sessions): ConsoleRow[]`,算出 context% =
   `round(ratio*100)`、成本格式化、状态标签/emoji），在 `src/views/__tests__/` 加单测覆盖空列表/有错误/
   有/无 usage。webview HTML 本身不强求测试,纯模型函数必须有。

## 看板每行展示（建议）
`<状态emoji> <name> (<role>)` · 当前任务(`currentTask` 截断,空则 "idle") · `ctx 42%`(有 contextUsage 才显示) ·
`$0.0123 · 7 turns`(有 usage 才显示) · 出错时红字显示 `errorMessage` 截断。复用 `TeamViewProvider` 的
状态 emoji 约定(`running/idle/stopped/error`)保持一致。空团队 → 友好空态（"No agents yet"）。

## 自验证（提交前必须,全绿）
```
npm run build      # exit 0
npm run lint       # 0 error
npm test           # 全绿,且你新增的纯模型单测计入
npm run compile:e2e
```
> 用项目脚本(`npm test`)；worktree 保持干净(不提交 `_*` / `tmp_demo` 等)。

## 验收
- 起一个团队(或 Solo)后,Console 面板实时显示每个 agent 的状态/任务/ctx%/成本,状态变化即时刷新。
- 不碰 WorkspaceTools / checkpoints；Claude review 后合并 main。
- Phase 2(文件归属 + per-agent diff)Claude 会在 Checkpoints 落地后另开卡,接到本面板上。
