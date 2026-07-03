# Codex 任务卡 V3 Phase 2 — Team 卡片显示"每个 agent 改了哪些文件 + diff"

**目标**:在 Team 面板的 agent 卡片上,显示**这个 agent 改过哪些文件**(来自 V1 Checkpoints),点一下能看
**unified diff**。这是你 Phase 1(实时指标)的自然延续,直接复用已有的 CheckpointStore 数据。

**范围**:**只读 UI** —— 读 `CheckpointStore.list()`,在卡片上渲染"改动文件"区 + 一个看 diff 的命令。
**不加任何工具、不碰 WorkspaceTools/后端/协议**。

## Worktree（隔离 — 必须）
```
git worktree add ../roam-crew-codex-v3p2 -b codex/v3-phase2
cd ../roam-crew-codex-v3p2 && npm install
```
基于**最新 main**(含 V6 / solo / 0.5.0-dev)。

## 数据来源（已存在,只读）
- `CheckpointStore`（`src/backend/Checkpoints.ts`,**别改它**):`list(): Checkpoint[]`,每条
  `{ id, agentId, agentName, path, before, after, ts, truncated? }`,newest-first。
- `createUnifiedDiff(before, after, path)`（`src/backend/diff.ts`):返回 `{ text, truncated }`。

## 允许改/加的文件
1. **`src/views/checkpointSummary.ts`** —— **新建纯函数**(避免动我的 Checkpoints.ts):
   `groupChangedFilesByAgent(checkpoints: Checkpoint[]): Map<agentId, { path: string; checkpointId: number; ts: number }[]>`
   —— 每个 agent 下,**按文件去重取最新一次**(同一文件多次改只留最近的那条 checkpoint),newest-first,
   每 agent 截断到比如最近 8 个文件。纯逻辑、可单测。
2. **`src/views/TeamViewProvider.ts`** —— 在 `_renderAgentCard` 里加一个"改动文件"区:
   - 用注入的 checkpoint 访问器拿数据(见下),渲染该 agent 的改动文件列表:`📝 <path>`,每个可点。
   - 点击 → `postMessage({ command: 'showCheckpointDiff', checkpointId })`;在 `onDidReceiveMessage`/
     `agentCommands` 那套里加 `case 'showCheckpointDiff'` → `vscode.commands.executeCommand('roam.showCheckpointDiff', checkpointId)`。
   - 无改动 → 不渲染这块。compact 卡片不用加(保持图标)。
   - **构造函数加一个只读访问器参数** `private getCheckpoints: () => Checkpoint[] = () => []`(末尾加,默认空,
     测试/无注入时安全)。
3. **`src/extension.ts`** —— 只加:
   - 构造 `teamViewProvider` 时传 `() => checkpointStore.list()`(`checkpointStore` 已是模块级,见 V1)。
   - 注册命令 `roam.showCheckpointDiff`(id: number)→ 取 `checkpointStore.get(id)`,用
     `createUnifiedDiff(cp.before ?? '', cp.after, cp.path)` 生成文本,
     `vscode.workspace.openTextDocument({ content, language: 'diff' })` + `vscode.window.showTextDocument(...)`
     打开成只读 diff 文档(简单、不需要虚拟文件系统)。找不到/truncated → `showInformationMessage` 提示。
   - `session.context`/`refreshTeam` 已会刷新 Team 面板,改动文件会随之更新(不用额外事件)。
4. **`package.json`** —— 加命令 `roam.showCheckpointDiff`(title "UnodeAi: Show Checkpoint Diff",icon `$(diff)`;
   不用进 view/title 菜单,卡片内部点击触发即可)。
5. **测试**:`src/views/__tests__/checkpointSummary.test.ts` —— 纯函数:同文件多次改只留最新、按 agent 分组、
   newest-first、每 agent 截断、空输入。

## 验收
- 让某 agent 改几个文件后,它的 Team 卡片上出现"📝 改动文件"列表;点一个 → 打开该文件的 unified diff。
- 纯函数有单测;`npm run build && npm run lint && npm test && npm run compile:e2e` 全绿。
- Claude review 合并;之后并进 v0.5.x。

> ⚠️ `TeamViewProvider.ts`/`extension.ts` 是热点,Claude 也可能动。你提交到 `codex/v3-phase2` 分支即可,
> review 时处理 rebase。注入参数加构造函数**末尾**;**别动** Checkpoints.ts / diff.ts / 后端 / 协议。
