# Codex 任务卡 G — OpenRouter provider（v0.3.0 触达面）

**目标**：把 **OpenRouter** 加成内置 provider。OpenRouter 一把 key 路由上百个模型,是触达面最大杠杆。
它是 **OpenAI 兼容**网关 → 走现有 openai-compat 后端,基本是加配置数据 + provider 选择 UX。

## Worktree（隔离,必做）
```
git worktree add ../roam-crew-codex-openrouter -b codex/openrouter
cd ../roam-crew-codex-openrouter
npm install            # worktree 不共享 node_modules
```
在这个目录里干活、提交到 `codex/openrouter` 分支。**别在主 worktree / main 上改。** Claude 审查后合并。

## 允许改的文件（不要超出）
1. `src/roles/RoleConfig.ts` —— `DEFAULT_PROVIDERS` + `DEFAULT_PROVIDER_CONFIGS` 各加 `openrouter`。
2. `src/backend/openAICompatBaseUrl.ts` —— **仅当确有必要**(先读它,确认 base URL 解析对非-roam provider 是否已自动从 `DEFAULT_PROVIDER_CONFIGS[id].baseUrl` 取;大概率不用改)。
3. `src/dialogs.ts` —— provider QuickPick 的 label（可选,小;`showAddAgentDialog` 已自动列出所有 provider）。
4. 新测试：`src/roles/__tests__/RoleConfig.openrouter.test.ts`；如改了 base-url,补 `src/backend/__tests__/openAICompatBaseUrl.test.ts` 一例。

> ⛔ 不要碰命令执行路径(`WorkspaceTools`/`TeamTools`/`commandNormalize`/`commandEnv`/`extension.ts` 的 backend 接线)——Claude 正在那块做终端执行 Phase 1。也不要碰 `TEAM_PRESETS`/角色模板区域。

## 实现要点
- `DEFAULT_PROVIDERS.openrouter = { providerId: 'openrouter', apiKeySecretName: 'OPENROUTER_API_KEY' }`。
- `DEFAULT_PROVIDER_CONFIGS.openrouter`：`type: 'custom'`(openai 兼容)、`baseUrl: 'https://openrouter.ai/api/v1'`、`apiKeySecretName: 'OPENROUTER_API_KEY'`、`models: [...]` 用 3~5 个真实 OpenRouter 模型 id（形如 `anthropic/claude-3.5-sonnet`、`openai/gpt-4o`、`google/gemini-2.5-flash`、`meta-llama/llama-3.1-70b-instruct`），字段照现有 `openai`/`google` 条目仿制。
- 确认 `resolveOpenAICompatBaseUrl('openrouter', …)` 能解析到 openrouter 的 base（去尾斜杠后 == `https://openrouter.ai/api/v1`）——**先读该函数的真实签名再写测试**,别照记忆。

## DoD（全满足）
- [ ] `npm run build` / `npm run lint` 通过(0 error)。
- [ ] `npm test` 通过(本 worktree 已 `npm install`,vitest 4)。新测试覆盖：
  - `DEFAULT_PROVIDERS.openrouter.apiKeySecretName === 'OPENROUTER_API_KEY'`；
  - `DEFAULT_PROVIDER_CONFIGS.openrouter.baseUrl === 'https://openrouter.ai/api/v1'` 且 `models.length >= 3`；
  - base URL 解析指向 openrouter。
- [ ] 只动了上面列的文件;没碰命令执行/角色模板区域。

## 提交规则
- 不要 `git add -A`；只 `git add` 你改的文件。提交前删掉任何临时/scratch 文件,`git status` 必须干净。
- 提交到 `codex/openrouter` 分支。完成后一句话汇报：改了哪些文件、加了几个模型、`npm test` 用例数。**Claude 复审 + 合并 + 接 provider 选择 UX 收尾。**
