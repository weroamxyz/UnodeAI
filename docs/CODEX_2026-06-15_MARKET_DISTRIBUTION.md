# CODEX 市场拓展与分销报告

日期：2026-06-15  
目标：为 UnodeAi 制定市场进入、分销、增长与商业化落地策略。本报告文件名包含 CODEX，用于区别 UnodeAi 自身分析。

## 一、市场切入点

UnodeAi 最适合从“已经在使用 AI coding 工具、但开始感到不可控”的用户群切入，而不是教育完全不了解 AI coding 的新手。

核心市场矛盾：

- Cline、Kilo、Cursor、Claude Code、Codex 等工具让代码生成更快。
- 但速度越快，用户越需要计划、隔离、验证、审计和成本控制。
- 单 Agent 适合短任务；复杂任务需要 crew workflow。

UnodeAi 的分销叙事应围绕：

> AI agents are fast. UnodeAi makes them accountable.

## 二、优先 ICP

### ICP 1：AI coding power users

画像：

- 已经使用 Cline、Kilo、Cursor、Claude Code 或 Codex。
- 熟悉 VS Code。
- 经常同时尝试多个模型。
- 愿意配置 BYOK、MCP、rules。

痛点：

- Agent 改太多。
- review 成本高。
- 长任务容易失控。
- 多工具上下文分散。

切入产品：

- VS Code extension。
- Chat Participant `@roam`。
- Crew Mission Control。
- Verifier Gate。

### ICP 2：小型工程团队

画像：

- 3-20 人。
- backlog 多，review 人手紧。
- 希望 AI 帮忙处理 bug、测试、文档、迁移。

痛点：

- 不敢让 AI 直接动主分支。
- AI 产物质量不稳定。
- 缺少团队级策略。

切入产品：

- worktree isolation。
- reviewer/verifier gate。
- team policy。
- task evidence report。

### ICP 3：AI dev agencies / consultants

画像：

- 为客户交付软件、自动化、迁移、内部工具。
- 需要快速产出，但也需要可解释交付。

痛点：

- 多客户项目上下文复杂。
- 需要交付报告。
- 需要模板化团队流程。

切入产品：

- reusable team packs。
- project memory。
- report export。
- private marketplace。

### ICP 4：平台工程 / DevEx 团队

画像：

- 在组织内部推广 AI coding。
- 关心安全、权限、审计、成本。

痛点：

- 员工各用各的 agent，难以治理。
- API key 与工具权限分散。
- 缺少可审计记录。

切入产品：

- policy bundle。
- private team pack registry。
- audit log。
- model/cost governance。

## 三、分销渠道

### 1. VS Code Marketplace

这是首要渠道。优化方向：

- 标题突出 “AI Crew / Multi-Agent / Mission Control”。
- 首屏截图必须展示多 Agent lane、验证结果、worktree/merge 状态。
- 视频演示控制在 90 秒内：issue -> PM 分解 -> agent 并行 -> verifier -> report。
- 关键词覆盖：AI agent、coding agent、multi-agent、Cline alternative、Kilo alternative、MCP、worktree、code review。

Marketplace 转化页必须回答：

- 它和 Cline/Kilo 有什么不同？
- 会不会乱改代码？
- 如何验证？
- 是否支持我的模型和 MCP？
- 免费版能做什么？

### 2. GitHub

GitHub 是开发者信任渠道。

建议：

- README 首屏给出 1 个动图：多 Agent 完成一个真实 bugfix。
- 添加 `docs/comparisons/roam-crew-vs-cline.md`。
- 添加 `docs/comparisons/roam-crew-vs-kilo.md`。
- 添加 `examples/team-packs/`。
- 公开 roadmap 和 issue labels。
- 用 GitHub Discussions 收集 team pack 需求。

增长机制：

- 每个 team pack 都可单独被搜索和分享。
- 每个真实 demo 都链接到 issue、diff、evidence report。

### 3. 内容营销

优先主题：

- “Why single coding agents fail on long tasks”
- “Multi-agent coding needs verification, not more autonomy”
- “Cline vs Kilo vs UnodeAi: agent execution vs crew orchestration”
- “How to safely let AI agents work in parallel worktrees”
- “AI coding cost control for teams”

中文市场可写：

- “AI 编程工具不是越自动越好，真正缺的是可控交付”
- “从 Cline 到 Kilo：下一代 AI IDE 插件会往哪里走”
- “为什么多 Agent 编程需要 PM 和 Reviewer”

渠道：

- Hacker News。
- Reddit：`r/LocalLLaMA`、`r/vscode`、`r/programming`、`r/ClaudeAI`。
- X / LinkedIn。
- Bilibili / 小红书 / 即刻 / 掘金。
- YouTube demo。

### 4. 生态合作

可合作对象：

- MCP server 作者。
- 模型网关/聚合平台。
- 开源项目维护者。
- AI coding 课程作者。
- DevOps / security 工具。
- 技术咨询公司。

合作方式：

- 联合 team pack。
- “works with UnodeAi” badge。
- MCP pack 安装模板。
- 真实 repo 修 bug 直播。
- agency partner plan。

### 5. Marketplace 内循环

UnodeAi 自己的 Marketplace 可以成为增长飞轮：

- 用户安装 team pack。
- 用户修改 team pack。
- 用户导出并分享。
- 优质 pack 被官方精选。
- pack 页面带回 VS Code Marketplace 安装。

关键是让 pack 不只是 prompt，而是可执行的 crew workflow。

## 四、定位与信息架构

### 主定位

UnodeAi is the mission control for accountable AI coding crews.

中文：

UnodeAi 是可审计 AI 编程小队的任务控制台。

### 支撑卖点

1. PM 拆解任务，不只是单 Agent 聊天。
2. 多 Agent 并行，但每个都在隔离 worktree。
3. Verifier 先验收，再合并。
4. 权限、命令、MCP 都可控。
5. 每个任务都有 evidence report。
6. 成本按 agent 与任务可见。

### 反定位

不是：

- 另一个聊天框。
- 另一个 autocomplete。
- 让 AI 无限制操作仓库的工具。

而是：

- 让 AI agents 像一个受管理的小团队一样工作。

## 五、销售与定价建议

### Free

目的：获取开发者心智与安装量。

包含：

- 基础 crew。
- BYOK。
- 基础 command policy。
- 基础 Chat Participant。
- 官方精选 team packs。

### Pro

价格方向：个人月付，面向 power user。

包含：

- 更多并行 agent。
- 高级 verifier。
- 成本 dashboard。
- 长任务历史。
- team pack 自定义。
- priority local features。

### Team

价格方向：按 seat 或 workspace。

包含：

- shared policies。
- shared memory。
- private packs。
- audit log。
- team cost reporting。
- GitHub issue/PR flow。

### Enterprise

价格方向：年度合同。

包含：

- SSO。
- 私有 marketplace。
- air-gapped/local-only。
- 合规导出。
- custom model gateway。
- SLA/support。

## 六、发布计划

### 第 1 阶段：可信 MVP

时间：0-4 周  
目标：让早期用户相信 UnodeAi 的差异。

动作：

- 修复安全和测试稳定性问题。
- 发布 `@roam` Chat Participant。
- 做 3 个高质量演示：
  - Bugfix crew。
  - Test writer + reviewer crew。
  - Refactor with verifier crew。
- 写 Cline/Kilo 对比文档。
- 建立 waitlist 或 Discord/社区入口。

### 第 2 阶段：Power User 扩散

时间：4-8 周  
目标：让 AI coding 重度用户试用并分享。

动作：

- 发布 Team Pack Marketplace MVP。
- 做 “parallel worktree challenge” demo。
- 找 10 个开源项目做 issue-to-PR demo。
- 邀请 Cline/Kilo 用户试用“长任务更可控”的场景。
- 开放 pack 投稿。

### 第 3 阶段：团队商业化

时间：8-12 周  
目标：验证 team/agency 付费。

动作：

- 发布 team policy。
- 发布 evidence report export。
- 发布 cost dashboard。
- 与 3-5 个 AI dev agency 做合作试点。
- 输出案例：AI crew 每周节省多少 review/triage 时间。

## 七、分销素材清单

必须准备：

- 90 秒产品视频。
- 3 张 Marketplace 截图。
- 1 张架构图：User -> PM -> Agents -> Verifier -> Merge。
- Cline 对比页。
- Kilo 对比页。
- Security / policy 页。
- Team Pack 示例页。
- Evidence Report 示例。
- “No code changed unless verified” 说明。

首批 Demo 建议：

1. “修复 flaky test”：展示 UnodeAi 如何发现、隔离、验证。
2. “给遗留模块补测试”：展示 Test Writer + Reviewer。
3. “安全审计”：展示 Security Crew 只输出报告、不修改代码。
4. “三方案并行”：展示多个 agent 同题竞争，PM 选择最佳方案。

## 八、SEO 与关键词

英文关键词：

- AI coding agent
- multi-agent coding
- VS Code AI agent
- Cline alternative
- Kilo Code alternative
- AI code review agent
- MCP marketplace
- coding agent worktree
- AI software engineering team
- autonomous coding with review

中文关键词：

- AI 编程 Agent
- 多 Agent 编程
- VS Code AI 插件
- Cline 替代
- Kilo Code 替代
- AI 代码审查
- AI 软件工程团队
- MCP 插件市场
- AI 自动写代码风险

## 九、增长飞轮

建议设计 UnodeAi 的增长飞轮：

1. 用户用 UnodeAi 完成一个真实任务。
2. UnodeAi 生成 evidence report。
3. 用户分享 report、demo 或 team pack。
4. 新用户通过 report 理解“可验证交付”的价值。
5. 新用户安装 extension 并复用 pack。
6. 优质 pack 进入 marketplace。
7. marketplace 提升更多任务成功率。

这个飞轮比单纯比拼模型数量更有护城河。

## 十、竞争风险与应对

### 风险 1：Cline/Kilo 快速补齐多 Agent UI

应对：

- 抢先定义“Verifier Gate / Evidence Report / PM-led Crew”心智。
- 用真实工程任务 demo 建立可信度。
- 让 team pack marketplace 成为差异资产。

### 风险 2：用户认为多 Agent 成本太高

应对：

- 默认小 crew。
- 明确预算。
- 低成本模型处理低风险任务。
- 结束后展示 cost saved / time saved。

### 风险 3：AI Agent 产物不稳定导致负面口碑

应对：

- 默认不自动 merge。
- 默认开启 verifier。
- 明确未验证项。
- 对高风险命令强审批。

### 风险 4：Marketplace 质量参差

应对：

- 官方精选。
- pack 签名。
- 权限声明。
- 安装前展示风险。
- 社区评分与使用统计。

## 十一、90 天目标

建议设定：

- VS Code Marketplace 安装量：5,000-10,000。
- 每周活跃任务：1,000+。
- 官方 team packs：10 个。
- 社区 team packs：30 个。
- 公开 demo/case study：10 个。
- 早期 Team/Agency 试点：5 家。
- Pro 付费验证：100 个个人用户。

## 十二、参考来源

- Cline 官网：https://cline.bot/
- Cline GitHub：https://github.com/cline/cline
- Kilo 官网：https://kilo.ai/
- Kilo Code GitHub：https://github.com/Kilo-Org/kilocode
- VS Code Chat API：https://code.visualstudio.com/api/extension-guides/chat
- How Coding Agents Fail Their Users：https://arxiv.org/abs/2605.29442
- Impact of AI Coding Assistants on Developer Productivity and Experience：https://arxiv.org/abs/2605.23135
- Programming by Chat: How Developers Use Generative AI to Assist in Coding：https://arxiv.org/abs/2604.00436
- Coding Agents Don't Know When to Act：https://arxiv.org/abs/2605.07769
- The Future of Agentic Code Review：https://arxiv.org/abs/2605.17548

