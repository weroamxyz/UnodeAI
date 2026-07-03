# Cline 反馈整合计划 — v0.5.3/v0.5.4 UX & 稳定性改进

**来源**: Cline 与 UnodeAi 对标分析
**日期**: 2026-06-11
**优先级**: P1（影响日常体验）

> **2026-06-11 重定范围（Opus 复审）**：本文 §C3 的"dead loop detection"原方案是**从零重写**，但 `runTurn` 里**已有** `failCounts`/`REPEAT_FAIL_LIMIT`、`circuitBreaks`、`announceNudges`（[OpenAICompatBackend.ts:360-368](../src/backend/OpenAICompatBackend.ts#L360-L368)）。请把 §C3 当作**待办背景**，不要照其示例代码重写——正确做法是 R2 之后基于数据**微调现有旋钮**（独立小 PR）。§C3 里把 `REPEAT_FAIL_LIMIT` 2→1 的建议**不要采纳**：一次瞬时失败就废掉工具会增加失败轮数。§C1/§C2 推迟到 v0.5.4。v0.5.3 只做 interject。

---

## 现状对比

### 1️⃣ Diff 审批 — Accept All / Reject All

**现在** (UnodeAi):
```
Agent wants to modify 3 files:
┌─────────────────────┐
│ ✓ src/app.ts        │ [Approve ▼]
│ ✓ src/index.ts      │ [Approve ▼]
│ ✓ src/utils.ts      │ [Approve ▼]
└─────────────────────┘
```
→ 用户要批 3 次，每个文件都点一次 "Approve"

**Cline 的做法**:
```
Agent wants to modify 3 files:
┌─────────────────────────────────┐
│ ✓ src/app.ts      │ ✓  ✗        │
│ ✓ src/index.ts    │ ✓  ✗        │
│ ✓ src/utils.ts    │ ✓  ✗        │
├─────────────────────────────────┤
│ [Reject All]  [Accept All]      │
└─────────────────────────────────┘
```
→ 一键全批，或一键全拒

**问题**:
- 多文件变更时，UnodeAi 逐个批很繁琐
- 用户想快速审视多个 diff，再一次性决定

**改进方案** (C1: Accept All / Reject All):
- 在 approval card 上方添加两个按钮
- 点 "Accept All" → 所有待批文件一步到位
- 点 "Reject All" → 所有操作拒绝，agent 重来

---

### 2️⃣ @ 上下文 — 可见性与可发现性

**现在** (UnodeAi):
- 用户在聊天输入框输入文本，没有 @ 自动补全提示
- 无法直观看到"我可以 @ 什么"（文件/函数/上文）
- @ 语法隐式（文档有说，但 UI 没有）

**Cline 的做法**:
- 输入框内输 `@` 时，**立即弹出补全面板**
  ```
  "让我改一下 @"
                 ↓
  ┌──────────────────────────────┐
  │ Files:                       │
  │  @src/app.ts                 │
  │  @src/utils.ts               │
  │ Functions:                   │
  │  @handleSubmit (src/app.ts)   │
  │ Earlier context:             │
  │  @conversation#3 (3 msg ago)  │
  │ Web search:                  │
  │  @ Search "topic"            │
  └──────────────────────────────┘
  ```
- 直观看到可 @ 的东西，点一下自动插入

**问题**:
- 用户不知道可以用 @ 上下文
- 输入 @ 后没有补全，只能手工敲文件名
- 难以发现"函数级别上下文"等高级用法

**改进方案** (C2: @ Context Autocomplete):
- 监听输入框 `@` 输入
- 弹出补全面板（包括：files、functions、earlier turns、web search）
- 支持 fuzzy search（输 `@ap` 匹配 `@src/app.ts`）
- 选中后自动插入

---

### 3️⃣ 弱模型死循环 — 防卡顿机制

**现在** (UnodeAi):
- agent 为兼容多家 provider（DeepSeek / Kimi / OpenAI），有重抽象层
- 弱模型（如 Kimi Flash）有时会：
  - 工具循环重复调用同一工具（工具失败 → 再调 → 再失败 → 无限循环）
  - 光说不练（output 是分析文本，没有工具调用 → 下轮继续分析 → 卡住）
  - 输出畸形（JSON 解析失败，agent 无法理解自己的工具调用）
- 目前的 REPEAT_FAIL_LIMIT 和 nudge 机制不够强

**Cline 的做法**:
- Claude 原生支持强的工具调用可靠性
- 无需防死循环机制，Claude 直接就不会重复失败

**问题**:
- UnodeAi 用多家模型，每家的行为不同
- 抽象层（XML 工具调用协议）引入了额外的失败点
- 用户看到 agent 卡住时，无法快速打断和转向

**改进方案** (C3: Loop Detection + Auto-Recovery):
- **Dead loop detection**: 同一工具连续失败 N 次（当前 2，改为 1-2），自动 abort
- **Light-talking detection**: 连续 K 轮（如 2）没有工具调用，自动 nudge 或 abort
- **Output malformed**: JSON 解析失败 → 立即通知用户"agent 产出格式错误"，建议换模型
- **Circuit breaker**: 多次失败后自动降级到可靠的操作（如用 read_file 代替 run_command）
- **User escape hatch**: mid-run steering（v0.5.3 G-001）让用户能打断并重新指引

---

## 三项改进方案详解

### C1: Accept All / Reject All for Write Approvals

**实现位置**: `src/views/ChatViewProvider.ts` + webview

**代码改造**:

```typescript
// approval card 数据结构（现有）
interface ApprovalCard {
  kind: 'write';
  files: Array<{ path: string; diff: string }>;
  // ... 其他字段
}

// 新增批量操作
interface ApprovalCard {
  kind: 'write';
  files: Array<{ path: string; diff: string; approved?: boolean }>;
  
  // 新字段：是否处于"批量选择"模式
  batchMode?: boolean;
  selectedCount?: number;  // 已批准的个数
}
```

**webview 侧** (HTML):
```html
<!-- Approval card footer 改造 -->
<div class="approval-card-footer">
  <div class="approval-summary">
    <span id="approval-count">0/3</span> files approved
  </div>
  <div class="approval-actions">
    <!-- 逐个批模式 -->
    <div id="individual-mode" class="mode-buttons">
      <button class="reject-btn">Reject</button>
      <button class="approve-btn primary">Approve</button>
    </div>
    
    <!-- 批量操作模式 -->
    <div id="batch-mode" class="mode-buttons">
      <button id="reject-all-btn">Reject All</button>
      <button id="accept-all-btn" class="primary">Accept All</button>
      <button id="toggle-mode-btn" class="secondary">Individual Review</button>
    </div>
  </div>
</div>
```

**样式**:
```css
.approval-summary {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
}

.approval-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

#individual-mode {
  /* 原有的逐个批模式 */
}

#batch-mode {
  /* 批量操作，突出 Accept All / Reject All */
}

#reject-all-btn {
  background-color: var(--vscode-errorForeground);
  color: var(--vscode-editor-background);
}

#accept-all-btn {
  background-color: var(--vscode-button-background);
}
```

**事件处理** (webview JS):
```javascript
document.getElementById('accept-all-btn').addEventListener('click', () => {
  vscode.postMessage({
    command: 'approvalBatch',
    action: 'accept-all',
    cardId: currentCardId
  });
});

document.getElementById('reject-all-btn').addEventListener('click', () => {
  vscode.postMessage({
    command: 'approvalBatch',
    action: 'reject-all',
    cardId: currentCardId
  });
});
```

**extension 侧** (ChatViewProvider.ts):
```typescript
// 接收批量操作
private onApprovalBatch(action: 'accept-all' | 'reject-all', cardId: string) {
  const card = this.approvalQueue.get(cardId);
  if (!card || card.kind !== 'write') return;

  const decision: ApprovalDecision = {
    approved: action === 'accept-all',
    files: card.files.map((f) => ({ path: f.path, approved: action === 'accept-all' }))
  };

  this.sessionManager.applyWriteApproval(decision);
  this.approvalQueue.remove(cardId);
}
```

**验收标准**:
- [ ] 显示 "X/Y files approved"
- [ ] "Accept All" 一键批准所有文件
- [ ] "Reject All" 一键拒绝所有
- [ ] 单个文件还能逐个改（toggle Individual Review）
- [ ] agent 收到决策后立即行动（不再阻塞）

**优先级**: P1 (v0.5.3 可纳入，或 v0.5.4)

---

### C2: @ Context Autocomplete

**实现位置**: `src/views/ChatViewProvider.ts` + webview

**现有的 @ 上下文** (假设已有，从 BACKLOG 或设计文档摘):
- `@src/app.ts` — 整个文件
- `@src/app.ts:handleSubmit` — 特定函数
- `#3` — 第 3 轮对话的上下文
- `$web:topic` — 网页搜索结果

**改造**:

**webview 侧** (autocomplete):
```typescript
// 监听输入框变化
const inputBox = document.getElementById('chat-input');

inputBox.addEventListener('input', (e) => {
  const text = e.target.value;
  const cursorPos = e.target.selectionStart;

  // 检查光标前是否有 @
  const atMatch = text.substring(0, cursorPos).match(/@(\w*)$/);
  
  if (atMatch) {
    const prefix = atMatch[1];
    showContextAutocomplete(prefix, cursorPos);
  } else {
    hideContextAutocomplete();
  }
});

async function showContextAutocomplete(prefix: string, cursorPos: number) {
  // 向 extension 请求上下文列表
  const contexts = await vscode.postMessage({
    command: 'getContextSuggestions',
    prefix: prefix
  });

  // 渲染补全面板
  const panel = document.getElementById('context-autocomplete');
  panel.innerHTML = renderContextPanel(contexts, prefix);
  panel.style.display = 'block';
}

function renderContextPanel(contexts, prefix) {
  const sections = {
    files: contexts.filter(c => c.type === 'file'),
    functions: contexts.filter(c => c.type === 'function'),
    turns: contexts.filter(c => c.type === 'turn'),
    web: contexts.filter(c => c.type === 'web')
  };

  let html = '';
  
  if (sections.files.length > 0) {
    html += '<div class="context-section"><strong>Files</strong></div>';
    sections.files.forEach(f => {
      html += `<div class="context-item" data-insert="@${f.id}">${esc(f.label)}</div>`;
    });
  }
  
  if (sections.functions.length > 0) {
    html += '<div class="context-section"><strong>Functions</strong></div>';
    sections.functions.forEach(f => {
      html += `<div class="context-item" data-insert="@${f.id}">${esc(f.label)}</div>`;
    });
  }
  
  // ... 同理处理 turns、web

  return html;
}

// 点选补全项
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('context-item')) {
    const insertText = e.target.dataset.insert;
    insertAtCursor(inputBox, insertText);
    hideContextAutocomplete();
  }
});
```

**样式**:
```css
#context-autocomplete {
  position: absolute;
  bottom: 100%;
  left: 0;
  width: 100%;
  max-height: 200px;
  overflow-y: auto;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  z-index: 100;
}

.context-section {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editorGroupHeader-tabsBackground);
  sticky: top;
}

.context-item {
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--vscode-editor-lineHighlightBackground);
}

.context-item:hover {
  background-color: var(--vscode-list-hoverBackground);
}
```

**extension 侧** (ChatViewProvider.ts):
```typescript
private async getContextSuggestions(prefix: string): Promise<ContextSuggestion[]> {
  const suggestions: ContextSuggestion[] = [];

  // 1. 文件上下文
  const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);
  files
    .filter(f => f.fsPath.toLowerCase().includes(prefix.toLowerCase()))
    .slice(0, 5)
    .forEach(f => {
      suggestions.push({
        type: 'file',
        id: vscode.workspace.asRelativePath(f),
        label: vscode.workspace.asRelativePath(f)
      });
    });

  // 2. 函数/符号上下文
  const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', prefix);
  (symbols as vscode.SymbolInformation[])
    .slice(0, 5)
    .forEach(sym => {
      suggestions.push({
        type: 'function',
        id: `${vscode.workspace.asRelativePath(sym.location.uri)}:${sym.name}`,
        label: `${sym.name} (${vscode.workspace.asRelativePath(sym.location.uri)})`
      });
    });

  // 3. 早期对话轮次
  const history = this.getChatHistory();
  history.slice(-5).forEach((msg, idx) => {
    suggestions.push({
      type: 'turn',
      id: `#${history.length - idx}`,
      label: `Turn #${history.length - idx}: ${msg.content.substring(0, 40)}...`
    });
  });

  // 4. 网页搜索（可选，需要 MCP）
  // suggestions.push({ type: 'web', id: '$web:topic', label: 'Web Search...' });

  return suggestions;
}
```

**验收标准**:
- [ ] 输入 `@` 时弹出补全面板
- [ ] 显示 Files、Functions、Turns、Web（可选）四个分类
- [ ] 支持 fuzzy search（输 `@app` 匹配 `@src/app.ts`）
- [ ] 点选后自动插入，输入框焦点不失
- [ ] 补全面板与输入框位置对齐
- [ ] 无 XSS 风险（内容 escape）

**优先级**: P1 (v0.5.4)

---

### C3: Loop Detection & Auto-Recovery for Weak Models

**实现位置**: `src/backend/OpenAICompatBackend.ts`

**当前的防护** (已有):
- `REPEAT_FAIL_LIMIT = 2`: 同一工具连续失败 2 次就停用
- `MAX_ANNOUNCE_NUDGES = 2`: 光说不练 nudge 最多 2 次
- `MAX_CIRCUIT_BREAKS = 2`: 工具被拒绝 N 次后停止

**改进方案**:

**1. Stricter Dead Loop Detection**

```typescript
const REPEAT_FAIL_LIMIT = 1;  // 改为 1（第一次失败就标记，第二次直接停用）
const MAX_ANNOUNCE_NUDGES = 1;  // 改为 1（光说不练只 nudge 一次）

// 新增：连续失败相同工具的阈值
const SAME_TOOL_FAIL_THRESHOLD = {
  'run_command': 2,     // run_command 失败 2 次就停用
  'read_file': 3,       // read_file 失败 3 次（读文件更常失败）
  'write_file': 1,      // write_file 失败 1 次就停（写入很危险）
  'default': 2
};

// 新增：检测工具重复调用的同一参数
private lastToolCalls: Map<string, { toolId: string; args: string }> = new Map();

private detectSameToolRepeat(toolId: string, args: string, iteration: number): boolean {
  const key = `${toolId}:${args}`;
  const lastCall = this.lastToolCalls.get(toolId);

  if (lastCall && lastCall.args === args && iteration > 5) {
    // 同一工具、同一参数、已经到了第 5+ 轮 → 肯定有问题
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: `[DEAD LOOP] Agent called ${toolId} with same args (${args.substring(0, 50)}) ${iteration} times. Aborting.`
    });
    return true;
  }

  this.lastToolCalls.set(toolId, { toolId, args });
  return false;
}
```

**2. Light-Talking Detection**

```typescript
private consecutiveNoToolCalls = 0;

// 在 runTurn 的工具循环中
if (toolCalls.length === 0) {
  this.consecutiveNoToolCalls++;
  
  if (this.consecutiveNoToolCalls >= MAX_ANNOUNCE_NUDGES) {
    // 已经 nudge 过了，agent 还是不调工具 → abort
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: `[LIGHT TALKING] Agent described action but issued no tool call ${this.consecutiveNoToolCalls} times. Aborting.`
    });
    return this.abortedTurnResult('Light talking loop detected');
  }
  
  // nudge 一次
  this.history.push({
    role: 'user',
    content: '[NUDGE] You described an action but did not call a tool. Please call a tool to execute it.'
  });
} else {
  // 调了工具，重置计数
  this.consecutiveNoToolCalls = 0;
}
```

**3. Output Malformed Detection**

```typescript
// 在解析工具调用前，检查 response 格式
private validateResponse(response: any): { valid: boolean; error?: string } {
  try {
    if (!response.choices?.[0]?.message) {
      return { valid: false, error: 'No choices or message in response' };
    }

    const message = response.choices[0].message;
    
    // 如果有 tool_calls，验证格式
    if (message.tool_calls) {
      for (const call of message.tool_calls) {
        if (!call.id || !call.function?.name || !call.function?.arguments) {
          return { valid: false, error: `Malformed tool call: ${JSON.stringify(call)}` };
        }
        
        // 尝试解析 arguments 为 JSON
        try {
          JSON.parse(call.function.arguments);
        } catch (e) {
          return { valid: false, error: `Invalid JSON in tool arguments: ${call.function.arguments}` };
        }
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}

// 在 chat() 后调用
const validation = this.validateResponse(response);
if (!validation.valid) {
  this.emit({
    kind: 'log',
    stream: 'stderr',
    line: `[MALFORMED OUTPUT] ${validation.error}`
  });
  
  // 通知用户，建议降级模型
  this.emit({
    kind: 'message',
    role: 'system',
    content: `⚠️ Agent produced malformed output. Consider switching to a more reliable model (e.g., Claude, GPT-4) if this persists.`
  });
  
  // 可选：自动降级到备用模型
  if (this.config.fallbackModel) {
    this.emit({
      kind: 'log',
      stream: 'stderr',
      line: `[AUTO-FALLBACK] Switching from ${this.currentParams?.model} to ${this.config.fallbackModel}`
    });
    // 切换模型逻辑...
  }
}
```

**4. Circuit Breaker for Tool Failures**

```typescript
private toolFailureCount: Map<string, number> = new Map();

async routeToolCall(toolCall: ToolCall): Promise<RoutedToolResult> {
  const toolName = toolCall.function.name;
  const failureCount = this.toolFailureCount.get(toolName) ?? 0;

  // 检查是否超过阈值
  const threshold = SAME_TOOL_FAIL_THRESHOLD[toolName] ?? SAME_TOOL_FAIL_THRESHOLD.default;
  if (failureCount >= threshold) {
    return {
      output: `[CIRCUIT BREAKER] Tool ${toolName} has failed ${failureCount} times. Refusing to call it again.`,
      ok: false,
      summary: 'Circuit breaker: tool disabled'
    };
  }

  // 执行工具
  const result = await this.tools.run(toolName, toolCall.function.arguments);

  // 更新失败计数
  if (!result.ok) {
    this.toolFailureCount.set(toolName, failureCount + 1);
    
    // 超过阈值时打破循环
    if (failureCount + 1 >= threshold) {
      this.emit({
        kind: 'log',
        stream: 'stderr',
        line: `[CIRCUIT BREAKER] Tool ${toolName} disabled after ${failureCount + 1} failures`
      });
    }
  } else {
    // 成功后重置计数
    this.toolFailureCount.set(toolName, 0);
  }

  return result;
}
```

**5. User Escape Hatch**

结合 v0.5.3 的 G-001 mid-run steering:
- 当检测到死循环时，不是硬 abort，而是 **暂停 + 通知用户**
- 用户可以：
  - [ ] "Let me interject" — 发送新指令
  - [ ] "Switch model" — 改用更强的模型
  - [ ] "Abort" — 完全放弃

```typescript
// 在检测到死循环时
if (this.detectDeadLoop()) {
  this.emit({
    kind: 'message',
    role: 'system',
    content: `⚠️ Agent appears stuck in a loop. Options:
    1. Interject (⚡) to give a new direction
    2. Switch to a more reliable model
    3. Abort and start over`
  });

  // 暂停而不是直接 abort
  await this.waitForUserAction();  // 等待用户操作
}
```

**验收标准**:
- [ ] 同一工具同参数循环 > 5 次自动 abort
- [ ] 光说不练 > 1 次自动 abort
- [ ] 响应格式验证（工具调用的 JSON 合法）
- [ ] 单个工具失败达阈值后拒绝再调
- [ ] 日志清晰说明为什么 abort（dead loop detection）
- [ ] 用户能通过 interject 打断并重新指引

**优先级**: P1 (v0.5.3 或 v0.5.4)

---

## 集成到 v0.5.3/v0.5.4 的方案

### v0.5.3 (2026-06-18)
- ✅ G-001 mid-run steering (interject 基础)
- ➕ C3 初级版：dead loop detection + abort (低风险，高收益)
- ➕ C1 可选：Accept All / Reject All

### v0.5.4 (2026-07-02)
- ✅ C2: @ Context Autocomplete (与 MCP 工具集成)
- ✅ C3 进阶版：circuit breaker + fallback model

### 优先级排序
1. **C3 (dead loop detection)** — 影响稳定性，应该在 v0.5.3 里
2. **C1 (batch approval)** — UX 优化，可跟 v0.5.3 或推 v0.5.4
3. **C2 (@ autocomplete)** — 需要更多基础设施，v0.5.4

---

## 关键文件变更

| 文件 | 改动 | 版本 |
|------|------|------|
| `src/backend/OpenAICompatBackend.ts` | C3: dead loop detection | v0.5.3 |
| `src/views/ChatViewProvider.ts` | C1: batch approval + C2: @ autocomplete | v0.5.3/v0.5.4 |
| `src/views/approvals.ts` | C1: 批量操作数据结构 | v0.5.3 |
| webview HTML/CSS | C1/C2: UI 改造 | v0.5.3/v0.5.4 |

---

## 预期效果

| 项 | 改进前 | 改进后 | 衡量 |
|----|--------|--------|------|
| **多文件批准** | 逐个点，3 files → 3 clicks | 一键 Accept All | 用户交互 -66% |
| **@ 上下文发现** | 需读文档、手敲名字 | 输 @ 看补全 | 上下文使用率 +50% |
| **弱模型稳定性** | 死循环 → 用户困惑 | 检测到自动 abort | 无效轮数 -40% |

