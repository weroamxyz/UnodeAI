# Codex 任务卡 v0.5.3 — 插话/排队 UI(G-001 mid-run steering 的 UI 半边)

**目标**:agent 运行中,用户**不再被禁言**:输入框保持可用,Enter = **排队下一条**(后端队列已存在!),
⚡按钮/Ctrl+Enter = **立即插话**(走 Opus 正在加的 `interject()`)。这是 Cline-parity P0 gap G-001
(用户明确要求「我们也需要能插话」)。

**总计划**:[DEVPLAN_v05x_Execution_Engine.md](DEVPLAN_v05x_Execution_Engine.md) §二 v0.5.3。
**分工**:你做 **UI + SessionManager 接线**;`interject()` 后端本体由 **Opus 在 main 上做**(E3-2),你**别碰
OpenAICompatBackend 的 runTurn**。开工时若 Opus 的 interject 还没合,先把 UI 做完接到「排队」,⚡按钮留
disabled-stub,Opus 合并后一行接通。

## Worktree
```
git worktree add ../roam-crew-codex-interject -b codex/interject-ui
cd ../roam-crew-codex-interject && npm install
```

## 先调研
- [ChatViewProvider.ts:1135](../src/views/ChatViewProvider.ts#L1135) 一带:运行中禁用输入框的逻辑(busy 状态
  怎么传到 webview、`setInputEnabled` 类似物在哪)。
- [OpenAICompatBackend.ts:264-271](../src/backend/OpenAICompatBackend.ts#L264-L271):`sendUserTurn` 的现有队列
  ——busy 时再 send 就是排队,**后端不用改就能排**;你要补的是把「队列内容」暴露给 UI(队列长度/各条文本/
  撤回),在 AgentBackend 接口上加最小只读视图 + `removeQueued(index)`。
- SessionManager:用户消息从 webview 到 backend 的路径;busy 状态从哪来。
- ClaudeHeadlessBackend:确认排队语义对它同样成立(SessionManager 层排即可),它**不支持**立即插话——UI 对
  claude agent 隐藏⚡。

## 要实现
1. **运行中输入框可用**:busy 时不再 disable;placeholder 变为「输入将排队;⚡可立即插话」。
2. **Enter = 排队**:busy 时提交 → `sendUserTurn`(自然入队);chat 顶部「⏳ 已排队 N 条」chip,展开可见每条
   + × 撤回(调 `removeQueued`)。空闲时行为完全不变。
3. **⚡插话按钮 + Ctrl+Enter**:busy 且 backend 支持时可用 → 调 `interject(text)`(Opus 的 E3-2);transcript
   里把插话渲染成显眼的「⚡ 插话」气泡。claude-backend agent 隐藏⚡(能力探测,别硬编码 provider 名)。
4. **Stop 语义不变**:Stop 仍是 Stop(清队列、断委派);插话≠Stop,UI 文案明确区分。
5. **webview 安全**:插话/队列文本过现有的转义/防注入管道(webviewSecurity.ts),别开新洞。

## 允许改的文件
`src/views/ChatViewProvider.ts`(主战场)、webview 端 html/js 模板、`src/session/SessionManager.ts`(接线)、
`src/backend/AgentBackend.ts`(接口加 `queuedTurns()`/`removeQueued()`/`canInterject()` 最小面)、
`src/backend/ClaudeHeadlessBackend.ts`(仅实现接口缺省:不可插话、队列走现有机制)。
**别动**:`OpenAICompatBackend.runTurn` 内环(Opus 术区)、tool 协议、审批、checkpoint、pricing。

## 测试 + 验收
```
npm run build && npm run lint && npm test && npm run compile:e2e   # 全绿
```
- 单测:busy 排队 N 条顺序执行;撤回第 k 条;Stop 清空队列;claude agent 的 canInterject=false。
- 手测验收(基准 T6 场景):跑一个多步任务,中途 Enter 一条(看到排队 chip)、⚡一条(下一步立刻改道)、
  Stop(全部干净停止)。
- Claude(Opus)review 后合并;CHANGELOG 归 v0.5.3。worktree 保持干净。
- **优先级:本卡 > 你手里的 Marketplace E1 导出卡**(E1 降为空档任务)。
