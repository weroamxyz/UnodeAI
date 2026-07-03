# IDE/Agent 对标 — UnodeAi + VS Code vs Cursor / Claude Code / Codex

> **状态**：时点快照 · **日期**：2026-06-17 · **UnodeAi 基线**：v0.8.31（冲 1.0）
> **姊妹文档**：[COMPARISON_RoamCrew_vs_Cline_vs_Kilo.md](COMPARISON_RoamCrew_vs_Cline_vs_Kilo.md)（VS Code AI 扩展三方对比）。本文换一条轴：把 UnodeAi 放进 **"日常编码主操作面"** 的赛道，对标 Cursor / Claude Code / Codex。
> **维护提醒**：快照，"会变的数字/状态"以 [STATUS.md](STATUS.md) 为权威源。对手能力随各大厂快速演进，引用前请复核。

---

## 0. 先分清品类（关键）

| | 它到底是什么 | 你的编辑器界面 |
|---|---|---|
| **UnodeAi + VS Code** | VS Code **扩展**（多 agent 编排层） | 还是原版 VS Code |
| **Cursor** | VS Code 的**闭源 fork**（完整 AI-native IDE） | 换成 Cursor |
| **Claude Code** | Anthropic 的 **agent**（CLI 优先 + IDE 扩展 + web） | 贴在任意编辑器旁 / 终端 |
| **Codex** | OpenAI 的 **agent**（CLI + 云端 + IDE 扩展） | 贴在任意编辑器旁 / 终端 / 云 |

> 真正的 IDE 只有 Cursor。UnodeAi 是"在原版 VS Code 上加一支 AI 团队"；Claude Code / Codex 是"挂在你现有编辑器旁的自主 agent"。**"作为 IDE 对标"= 比你每天写代码时的主操作面长什么样。**

---

## 1. 编辑器与日常手感

| 能力 | UnodeAi + VS Code | Cursor | Claude Code | Codex |
|---|---|---|---|---|
| 完整 VS Code 编辑/调试/插件生态 | ✅ 原生（配置全保留） | 🟡 fork，多数插件兼容但非 100% | ✅ 不动你的编辑器 | ✅ 不动你的编辑器 |
| 要不要换 IDE | ❌ 不用换 | ✅ 必须换到 Cursor | ❌ 不用换 | ❌ 不用换 |
| Tab / 行内补全（autocomplete） | ❌ 无（非编辑器 AI） | ✅ **业界最强** | ❌ 无 | ❌ 无 |
| 主交互入口 | 侧边栏多 agent 面板 | 编辑器内 Composer/Tab | 终端 / IDE 扩展 | 终端 / 云 / 扩展 |

## 2. agent 自主性

| 能力 | UnodeAi + VS Code | Cursor | Claude Code | Codex |
|---|---|---|---|---|
| 单 agent 自主编码深度 | 🟡 弱模型 + 强框架补强 | ✅ Agent/Composer 强 | ✅ **顶级**（前沿模型原生） | ✅ 强（GPT-5-codex） |
| 多 agent 团队编排（PM 派活） | ✅ **独有主场** | ❌ | 🟡 subagents（仍单主线） | ❌ |
| 并行 worktree + 自动合并 + 验证门 | ✅ 闭环 | 🟡 Background Agents（云并行，无验证门） | 🟡 git worktree 可手动 | 🟡 云端并行任务 |
| 云端异步跑任务 / 开 PR | ❌ 本地为主 | ✅ Background Agents | 🟡 可（需自建） | ✅ **云原生主打** |

## 3. 模型与成本

| 能力 | UnodeAi + VS Code | Cursor | Claude Code | Codex |
|---|---|---|---|---|
| 模型选择 | ✅ 多 provider / BYO / 自建网关 | ✅ 多模型（其路由） | ❌ **只 Claude** | ❌ **只 OpenAI** |
| 便宜模型套利 | ✅ tier 热切 + gated 工作流 | ❌ 偏前沿模型 | ❌ 锁 Claude | ❌ 锁 OpenAI |
| 计费 | 自带 key / Roam 网关 | 订阅 $20+ / 用量 | 订阅(Pro/Max) / API | 订阅(Plus/Pro) / API |
| 成本可视化 | ✅ Dashboard | 🟡 | 🟡 | 🟡 |

## 4. 安全与可信

| 能力 | UnodeAi + VS Code | Cursor | Claude Code | Codex |
|---|---|---|---|---|
| 命令策略 + 灾难命令黑名单 | ✅ 三模式 | 🟡 审批 | ✅ 权限模式 + hooks | ✅ 沙箱审批 |
| Plan/Act 工具层硬隔离 | ✅ 单测背书 | 🟡 | 🟡 plan mode | 🟡 |
| MCP / 扩展协议 | ✅ | ✅ | ✅（+ hooks/skills） | ✅ |

## 5. 成熟度与生态位（诚实项）

| 维度 | UnodeAi + VS Code | Cursor | Claude Code | Codex |
|---|---|---|---|---|
| 背后实力 | ❌ 初创/小团队 | ✅ 独角兽 | ✅ Anthropic | ✅ OpenAI |
| 装机 / 社区 | ❌ 近乎从零 | ✅ 数百万 | ✅ 大且增长快 | ✅ 大 |
| 模型护城河 | ❌ 不自研模型 | 🟡 不自研 | ✅ 自研前沿 | ✅ 自研前沿 |

> 图例：✅ 强 · 🟡 部分/可行但非主打 · ❌ 缺失

---

## 6. 怎么读这张表

**UnodeAi 不是"取代它们"，而是占一个它们都不在的角：**

1. **不换 IDE** —— Cursor 要你迁到 fork；UnodeAi 让你留在原版 VS Code，插件/配置/快捷键全不动。这是对 Cursor 的最大差异。
2. **不锁模型** —— Claude Code 锁 Claude、Codex 锁 OpenAI；UnodeAi 多 provider + 便宜模型套利，是对这两家最大的差异。
3. **多 agent 编排闭环** —— "隔离 + 自动合并 + 不绿不合并"是四家里只有 Roam 把全链做完的。

## 7. 必须诚实承认的硬伤（写文案时自查）

1. **没有 Tab 补全** —— 日常写代码的"爽点"在 Cursor 那边，UnodeAi 不碰这块（它是编排层不是编辑器 AI）。**别在文案里和 Cursor 比"编辑体验"。**
2. **单 agent 自主深度打不过前沿模型原生的 Claude Code / Codex** —— Roam 赌"弱模型 + 强框架"，对手是"强模型 + 成熟框架"。**软话术，别正面比单 agent 智力。**
3. **背后无自研模型、无大厂资源、装机近乎零** —— 三家是 Anthropic/OpenAI/独角兽。生态差距短期无解，**别用"已被广泛验证"类话术**。

## 8. 选型一句话

- **要最爽的编辑体验** → Cursor
- **要最强的自主 agent** → Claude Code / Codex
- **要"留在 VS Code + 多 agent 团队 + 便宜模型省钱"** → UnodeAi
