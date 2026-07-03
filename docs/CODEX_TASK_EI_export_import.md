# Codex 任务卡 EI — Chat / Messages 导出 + 导入（v0.3.0）

**目标**：给 Chat 和 Messages 面板(已有 Clear 按钮)各加 **Export** + **Import**。用户可把对话**存到本地
JSON → 编辑 → 重新导入查看**。基础设施已存在,主要是文件对话框 + 复用现有序列化。

**范围 = Tier 1**：只导出/导入**显示的对话记录**(存→编辑→重载)。**不**回灌 agent 后端上下文(那是 v0.4
的 Tier 2,配合 checkpoints,不在本卡)。

## Worktree（隔离）
```
git worktree add ../roam-crew-codex-ei -b codex/export-import
cd ../roam-crew-codex-ei && npm install
```

## 允许改的文件
1. `src/views/ChatViewProvider.ts` —— 加 export/import 方法 + 标题栏按钮无关(按钮在 package.json);命令在 extension。
2. `src/views/MessageLogProvider.ts` —— 加 `exportItems()` / `importItems(items)`。
3. `src/extension.ts` —— 注册 4 个命令(见下),复用现有 `chatHistory` 序列化 + `showSaveDialog`/`showOpenDialog`。
4. `package.json` —— 4 个命令 + `view/title` 菜单(Chat 面板 2 个、Messages 面板 2 个)。
5. 测试：`src/views/__tests__/` 下为纯逻辑(导出 payload 形状 / 导入校验)加单测。

> ⚠️ **共享文件提醒**：`ChatViewProvider.ts` / `extension.ts` / `package.json` Claude 也在动(实时 Todo
> 等)。你提交到 `codex/export-import` 分支即可;Claude 审查合并时处理 rebase。**只加新方法/命令,别动
> 现有 clear/terminal/命令执行逻辑。**

## 命令 + 行为
- `roam.exportChat`：`showSaveDialog`(默认 `roam-chat-<agentName>-<YYYYMMDD-HHmm>.json`)→ 写
  `JSON.stringify({ version: 1, kind: 'chat', agent, exportedAt, messages: serializeChatHistory(history) }, null, 2)`。无选中 agent → 提示。
- `roam.importChat`：`showOpenDialog`(filters: JSON)→ 读 → `JSON.parse` → 校验 `kind==='chat'` 且
  `messages` 是数组 → `deserializeChatHistory(parsed.messages)` → 载入**当前选中 agent**(非空先弹确认覆盖,
  和 Clear 对称)→ 更新 `histories` + 持久化(`deps.state.update(chatHistoryKey(agent), …)`)+ 重渲染。
- `roam.exportMessages` / `roam.importMessages`：同理,作用于 `MessageLogProvider` 的活动流条目。
- ChatViewProvider 暴露 `exportSelected(): {agent,messages} | undefined` 和 `importToSelected(messages)`;
  MessageLogProvider 暴露 `exportItems()` / `importItems(items)`。命令在 extension 里调它们 + 文件对话框。

## 校验 / 安全
- 解析失败 / 形状不对 → `showErrorMessage`,**不破坏现有状态**。
- 导入文件由 `showOpenDialog` 用户选(安全);只 `JSON.parse`,不 eval。
- 导入覆盖非空对话前**弹确认**(说明会替换当前内容)。

## DoD
- [ ] `npm run build` / `npm run lint` / `npm test` 通过(本 worktree 已 `npm install`)。
- [ ] 单测覆盖:export payload 形状正确;import 对坏 JSON / 错 kind / 非数组 安全拒绝(不抛、不改状态)。
- [ ] 4 个命令注册 + 4 个 `view/title` 按钮(Chat:export/import;Messages:export/import),图标 `$(save)` / `$(folder-opened)`。
- [ ] 没碰命令执行 / clear / terminal 逻辑;只加 export/import。

## 提交规则
- 不 `git add -A`;只加你改的文件;提交前删 scratch;`git status` 干净。提交到 `codex/export-import`。
- 完成一句话汇报:改了哪些文件、命令名、`npm test` 用例数。**Claude 复审 + 合并。**
