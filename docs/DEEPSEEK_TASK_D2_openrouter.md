# DeepSeek 任务卡 D2 — OpenRouter provider 预设

**目标**:新增 **OpenRouter** 作为内置 provider。OpenRouter 一把 key 可路由上百个模型,是触达面最大
的杠杆(ROADMAP v0.3 "更多网关")。OpenRouter 是 **OpenAI 兼容** 网关,所以走现有 openai-compat 后端,
基本只是加配置数据。

> 先做完 D1 再做本卡(两者都改 `RoleConfig.ts`,串行避免冲突;若 D1 已合并,先 `git pull`/rebase)。

---

## 只动这些文件(不要碰其它)
1. `src/roles/RoleConfig.ts` —— 往 `DEFAULT_PROVIDERS` 和 `DEFAULT_PROVIDER_CONFIGS` 各加一个
   `openrouter` 条目。
2. `src/roles/__tests__/RoleConfig.openrouter.test.ts` —— **新建**测试。
3. (如确有必要)`src/backend/__tests__/openAICompatBaseUrl.test.ts` —— 若该测试套件存在,加一条
   openrouter base URL 解析用例;**不要**改 `openAICompatBaseUrl.ts` 的逻辑本身(它已对非-roam provider
   读取 `DEFAULT_PROVIDER_CONFIGS[id].baseUrl`,加了配置就自动生效)。

> ⛔ 不要改:provider 选择 UI、SecretsManager、SettingsPanel、后端逻辑。本卡只加 provider **数据**。

## 具体步骤(照 `openai` / `google` 条目仿制)
1. `DEFAULT_PROVIDERS` 加:
   ```ts
   openrouter: { providerId: 'openrouter', apiKeySecretName: 'OPENROUTER_API_KEY' },
   ```
2. `DEFAULT_PROVIDER_CONFIGS` 加(`type: 'custom'` 即 openai 兼容;baseUrl 必须是 OpenRouter 的 v1):
   ```ts
   openrouter: {
     id: 'openrouter',
     name: 'OpenRouter (Multi-Model Gateway)',
     type: 'custom',
     baseUrl: 'https://openrouter.ai/api/v1',
     apiKeySecretName: 'OPENROUTER_API_KEY',
     models: [ /* 3~5 个常见模型,字段照现有 models 仿制:id/name/maxTokens/supportsStreaming/supportsVision */ ],
   },
   ```
   models 用 OpenRouter 的真实 id(形如 `anthropic/claude-3.5-sonnet`、`openai/gpt-4o`、
   `google/gemini-2.5-flash`、`meta-llama/llama-3.1-70b-instruct`)。不确定就选这几个稳的。

## DoD(全部满足才算完成)
- [ ] `npm run build` / `npm run lint` / `npm test` 全通过(**用 `npm test`,不要 `npx vitest`**)。
- [ ] 新测试覆盖:
  - `DEFAULT_PROVIDERS.openrouter.apiKeySecretName === 'OPENROUTER_API_KEY'`;
  - `DEFAULT_PROVIDER_CONFIGS.openrouter.baseUrl === 'https://openrouter.ai/api/v1'` 且 `models.length >= 3`;
  - 用 `resolveOpenAICompatBaseUrl('openrouter', DEFAULT_PROVIDER_CONFIGS.openrouter.baseUrl, undefined)`
    解析结果指向 openrouter 的 base(去尾斜杠后等于 `https://openrouter.ai/api/v1`)。先看
    [openAICompatBaseUrl.ts](../src/backend/openAICompatBaseUrl.ts) 的真实签名再写,**按它实际签名调用**。
- [ ] 没改任何后端/UI 逻辑,只加了 provider 数据 + 测试。

## 硬性提醒(rule)
- 跑测试一律 `npm test` / `npm run build` / `npm run lint`,**不要** `npx vitest` / `tsc` / `eslint`。
- 报错先核对命令与本卡;**不要**归因"环境坏了"。
- 先读 `openAICompatBaseUrl.ts` 确认 `resolveOpenAICompatBaseUrl` 的**真实参数个数与顺序**,别照搬记忆。
- 完成后一句话汇报:改了哪些文件、加了几个 openrouter 模型、`npm test` 用例数。

**完成后 Claude 复审 + 接 provider 选择 UX,再纳入 v0.3.0。**
