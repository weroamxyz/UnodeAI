# Codex 任务卡 C1 — @-context 扩展：`@folder` / `@problems` / `@url`（v0.3.0 gate）

**目标**：在聊天里把 `@` 引用从「只有 `@file`」扩展到 **`@folder`**、**`@problems`**、**`@url`**。和 `@file`
一样，发消息前把引用展开成 `<attached_files>`（或并列的 `<attached_context>`）块附在用户消息后，让 agent
不用用户手动粘贴就看到内容。这是 **v0.3.0 的门禁项之一**（另一个是 C2 诊断 或 C3 Todo）。

已有基础设施：`src/session/FileMentions.ts` 里的 `parseMentions()` + `expandFileMentions()`（纯函数、可
注入、sandbox 守卫、size cap）。`@file` 已上线并在 `extension.ts:288` 接入：
```ts
const expanded = await expandFileMentions(text, workspaceRoot(), (p) => fs.readFile(p, 'utf8'));
```

## Worktree（隔离 — 必须）
```
git worktree add ../roam-crew-codex-c1 -b codex/at-context
cd ../roam-crew-codex-c1 && npm install
```
基于**最新 main**（已含 v0.2.32）。

## 设计要求（关键）
1. **保持纯核心 + 注入 vscode/网络依赖**，沿用 `FileMentions.ts` 的风格——纯逻辑可单测、不 import vscode。
   - `@folder`：纯 fs 即可（列目录，sandbox 守卫，复用 `safeResolve` + realpath 守卫）。
   - `@problems`：**需要 vscode** (`vscode.languages.getDiagnostics()`) → 用**注入的 provider**，签名形如
     `() => DiagnosticsSnapshot`，extension 负责注入真实实现，核心模块只接收数据。
   - `@url`：**需要网络** → 注入 `fetch` 风格的 reader `(url) => Promise<{ok, text}>`，extension 注入真实
     实现；核心只做解析/拼装/截断。
2. **不要把 vscode/fetch import 进 `FileMentions.ts`**。可以新建 `src/session/ContextMentions.ts`
   做统一展开器（把 file/folder/problems/url 都路由进去），或扩展现有模块 + 新增注入参数，二选一，保持
   既有 `@file` 行为与测试不破。

## 各 mention 行为
- **`@folder`**（如 `@src/views`）：解析为工作区内目录 → 输出一棵**浅层文件树**（相对路径列表，限定条目数
  如 ≤ 200，深度 cap，跳过 `node_modules`/`.git`/`out`/`dist`）。**不**读文件内容（那会爆 context）；只给结构。
  块形如：
  ```
  --- @src/views (folder) ---
  ChatViewProvider.ts
  MessageLogProvider.ts
  TeamViewProvider.ts
  …(N more)
  ```
- **`@problems`**：拉 `vscode.languages.getDiagnostics()` → 汇总当前工作区的 error/warning（按文件分组，
  含 `file:line:col severity message`），**cap 条目数**（如前 100 条，error 优先）。块形如：
  ```
  --- @problems (12 errors, 3 warnings) ---
  src/foo.ts:42:5 error TS2304: Cannot find name 'bar'
  …
  ```
  无诊断 → `--- @problems --- (none)`。
- **`@url`**（如 `@https://example.com/x`）：用注入的 fetch 抓取 → **只取文本**（HTML 粗略去标签即可，
  或保留原文截断），**per-source cap**（复用 `PER_FILE_MAX` 量级）+ **总 cap**（`TOTAL_MAX`）+ **超时**
  （如 8s）。失败/超时/非文本 → 静默跳过（和 `@file` 一样：当普通文本留着，不破坏消息）。块形如：
  ```
  --- @https://example.com/x (url) ---
  <fetched text, truncated>
  ```

## 解析层
- `parseMentions()` 现在抓 `@<non-space>`。`@url` 含 `://`、`@folder`/`@file` 是路径。建议：在展开器里按
  形态分流——`/^https?:\/\//` → url；否则 fs 解析，是目录 → folder、是文件 → file；字面量 `@problems`
  （无路径分隔/不存在的特殊关键字）→ diagnostics。保证 `@teammate` 这种非路径仍当普通文本（保持 #8 行为）。
- ⚠️ `@problems` 是关键字而非路径——确保它不被 `safeResolve` 当文件名误解析。

## 安全 / 校验
- **`@folder` / `@file`**：维持现有 sandbox + realpath 守卫（不能逃出工作区，符号链接也挡）。
- **`@url`**：用户主动键入才抓（非自动）；超时 + size cap；只 `JSON.parse`/文本处理，不 eval；**注意 SSRF**——
  够用的最小防护是超时 + 大小上限 + 只在用户显式 `@url` 时触发。给一句注释说明。
- 任意来源失败都**不得破坏消息**或抛异常（核心 never throws，沿用 `expandFileMentions` 契约）。

## 允许改的文件
1. `src/session/FileMentions.ts` 或新建 `src/session/ContextMentions.ts`（推荐后者做聚合展开器）。
2. `src/extension.ts` —— 把第 288 行的 `expandFileMentions(...)` 换成新的聚合展开器，注入
   `getDiagnostics`（包一层把 `vscode.languages.getDiagnostics()` 转成纯快照）+ `fetchText`（`undici`/全局
   `fetch`，带超时）。**只动这一处接入点**，别碰 clear/terminal/EI/命令执行逻辑。
3. `src/session/__tests__/` —— 为 folder 树、problems 格式化、url 截断/失败、解析分流写**纯逻辑单测**
   （注入 fake fs/diagnostics/fetch，不依赖真实 vscode/网络）。

> ⚠️ **共享文件提醒**：`extension.ts` Claude 也在动（C3 实时 Todo）。你提交到 `codex/at-context` 分支即可，
> Claude 审查合并时处理 rebase。第 288 行那处接入点尽量**小改面**（只替换调用 + 注入），降低冲突。

## 自验证（提交前必须，全绿）
```
npm run build      # 期望 exit 0
npm run lint       # 期望 0 error
npm test           # 期望全绿（在你新增测试后条数增加）
```
> 用项目脚本（`npm test` = vitest run），**别**用裸 `npx vitest`。worktree 保持干净（不提交 `_*` 临时文件）。

## 验收
- 聊天里输入 `@src/views`、`@problems`、`@https://…`、`@somefile.ts` 混合，发消息后 agent 收到的内容里
  各自展开成对应块；非法/抓取失败的当普通文本留着；现有 `@file` 行为与测试不变。
- Claude review 后合并入 main。C1 + (C2 或 C3) 都绿 → 一起切 **v0.3.0**。
