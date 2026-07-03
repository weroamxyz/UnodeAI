# 竞品三方对比 — UnodeAi vs Cline vs Kilo Code

> **状态**：时点快照 · **日期**：2026-06-17 · **UnodeAi 基线**：v0.8.31（冲 1.0）
> **口径来源**：[KILO_GAP_ANALYSIS.md](KILO_GAP_ANALYSIS.md)（Kilo/Roo 公开文档实查，2026-06-16）+ [UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md)（同模型对标）+ [STATUS.md](STATUS.md) 实现状态。
> **维护提醒**：本文是快照，"会变的数字/状态"以 STATUS.md 为权威源，勿在此回填。Kilo 标注的能力多来自其公开文档，部分实现细节官方未披露（下表标 *未证实*）。

---

## 0. 一句话定位

| | 本质 | 主战场 | 模型假设 |
|---|---|---|---|
| **Cline** | 成熟的**单 agent** 编码助手 | 单人 / 单任务 / 要稳要快 | 默认接强模型 |
| **Kilo Code** | Cline/Roo 的 fork，**功能大杂烩 + 并行 worktree** | 想"全都要"的高级玩家 | 默认接强模型 |
| **UnodeAi** | **编排式多 agent 运行时**（弱模型 + 强执行框架） | 团队式分工 / 成本套利 / 可验证交付 | 赌"弱模型 + 强框架" |

> 三者不是同一品类。Cline 是"一个很强的助手"；UnodeAi 是"让一群普通助手干成活、且不绿不合并的流水线"。

---

## 1. 编排与多 agent

| 能力 | UnodeAi | Cline | Kilo Code |
|---|---|---|---|
| 单 agent 顺滑体验 | 🟡 Solo/Fast 模式补齐中 | ✅ 强项 | ✅ |
| 多 agent 团队分工（PM 编排） | ✅ PM `assign_task` 编排核心 | ❌ | 🟡 并行会话但无父子编排/共享内存* |
| 角色/模式切换 | 🟡 启动时定角色，会话内不可切 | ✅ Plan/Act | ✅ Architect/Coder/Debugger + 自定义 |
| 子任务隔离上下文（Boomerang 式） | ❌ 共享上下文 | ❌ | 🟡 源自 Roo（已关停）；Kilo 自身*未证实* |
| 弱模型纪律（错误自恢复、不甩锅） | ✅ 弱模型鲁棒四层 + 命令改写 | 🟡 靠强模型兜底 | 🟡 靠强模型兜底 |

## 2. 并行隔离与合并（关键差异区）

| 能力 | UnodeAi | Cline | Kilo Code |
|---|---|---|---|
| 每-agent git worktree 隔离 | ✅ worktree fan-out（0.6.7 实验已发） | ❌ | ✅ Agent Manager（`.kilo/worktrees/`） |
| 同 prompt 多实现并行（A/B） | 🟡 可派多 agent，未做版本对比 UI | ❌ | ✅ Multi-Version（≤4，可多模型） |
| 合并回主干 | ✅ **编排式自动合并 + 验证门** | ❌ | 🟡 手动 "Apply to local"，**无 auto-merge** |
| 完成门禁（不绿不准报完成） | ✅ **verifier-as-gate**（0.8.27，决策核证明必然终止） | ❌ | ❌ |

> **护城河在这一格**：并行本身 Kilo 也有；Roam 的差异是 **隔离 + 编排 + 自动合并 + 验证门** 这条闭环。

## 3. 信任与安全

| 能力 | UnodeAi | Cline | Kilo Code |
|---|---|---|---|
| Checkpoints / 回退 | ✅ Checkpoints/Restore | ✅ | ✅（源自 Roo shadow-git） |
| Plan/Act 工具层硬隔离 | ✅ 非提示词，单测证明伪造 mode 绕不过 | 🟡 Plan/Act（提示词层为主） | 🟡 模式 tool-group 权限 |
| 命令策略 + 灾难命令黑名单 | ✅ 三模式 + shell 控制符过滤 | 🟡 审批为主 | 🟡 审批为主 |
| 文件沙箱（realpath / 拒遍历） | ✅ | 🟡 | 🟡 |
| MCP 执行授权审批门 | ✅ 首挂模态 + 指纹持久化 | ✅ | ✅ |

## 4. 模型与成本

| 能力 | UnodeAi | Cline | Kilo Code |
|---|---|---|---|
| 多 provider / 双后端 | ✅ Claude headless + OpenAI-compat（Roam 默认） | ✅ 多 provider | ✅ 多 provider |
| 成本可视化（趋势/排行/分布） | ✅ Dashboard | 🟡 基础 token 计量 | 🟡 |
| 成本套利运行时机制 | ✅ tier 热切 + gated 工作流 + 上下文压缩 | ❌ | ❌ |
| Smart Mode 按任务选档 | ✅ | ❌ | 🟡 模式可绑模型 |

## 5. 扩展与生态

| 能力 | UnodeAi | Cline | Kilo Code |
|---|---|---|---|
| MCP 支持 | ✅ 注入式 + 命名空间 + default-deny | ✅ | ✅ |
| MCP Marketplace / 一键发现 | 🟡 curated catalog 打通中 | 🟡 推荐列表 | ✅ 宣传为头牌特性（机制*未证实*） |
| 自定义 agent/skill 定义 | ✅ Agent Builder（0.8.6）+ capability tokens | 🟡 `.clinerules` | ✅ `.kilo/agents/*.md`（md+frontmatter，更易 review） |
| 项目约定注入 | ✅ A1/A2 自动注入（弱模型护栏） | 🟡 `.clinerules` 手写 | 🟡 rules 文件 |
| 分层 rules（global/project/role） | 🟡 单 `.roam/rules.md` | ❌ | ✅（源自 Roo 分层） |

## 6. 成熟度与生态位（诚实项）

| 维度 | UnodeAi | Cline | Kilo Code |
|---|---|---|---|
| 装机量 / 社区 | ❌ 近乎从零 | ✅ 数十万级、社区成熟 | ✅ 继承 Cline/Roo 生态 |
| 真实规模化检验 | 🟡 5-agent 受控压测过，缺野外锤炼 | ✅ 海量真实项目 | ✅ |
| 简单任务的轻量度 | 🟡 多 agent 偏重（Solo 补齐中） | ✅ 最轻 | 🟡 设置项爆炸 |
| 迭代/文档成熟度 | 🟡 快速演进中 | ✅ | ✅ |

> 图例：✅ 强项/已具备 · 🟡 部分/进行中 · ❌ 缺失 · `*未证实` = Kilo 官方文档未披露实现细节

---

## 7. 选型建议

- **单人写代码、要稳要快** → **Cline**。
- **想要全功能、愿意自己折腾并行 worktree** → **Kilo Code**。
- **要团队式分工 / 跑弱模型省钱 / 要"交付可验证（不绿不合并）"** → **UnodeAi**；前提是接受它生态尚空、简单任务偏重（Solo 模式补齐后缓解）。

## 8. UnodeAi 的差异化主张（对外叙事可复用）

1. **编排式隔离 + 自动合并 + 验证门** 三件套闭环 —— Kilo 有并行无 auto-merge，Cline 连并行都没有。
2. **弱模型 + 强执行框架** 的成本套利，配 tier 热切 / gated 工作流 / 项目约定注入。
3. **工具层（非提示词层）的安全隔离**，Plan/Act 与命令策略均有单测背书。

> ⚠️ 风险提示（写文案时自查）：① 生态/装机是硬短板，别用"已被广泛验证"这类话术；② 弱模型套利依赖强模型不降价，需软话术；③ Kilo 的部分能力来自其官方"宣传"，对比时标清"已证实/未证实"，别拿未证实点做攻击性对比。
