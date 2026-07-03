# UnodeAi(DeepSeek / Kimi)任务卡 — Cline 同模型 UX 基准(R1 全量 + 每版增量轮)

> **2026-06-10 升级**:本基准已成为 **V0.5.x Execution Engine 手术的监护仪**(总计划
> [DEVPLAN_v05x_Execution_Engine.md](DEVPLAN_v05x_Execution_Engine.md))。节奏:
> **R1 = 现在立刻跑**(v0.5.1 术前基线,本卡全量 8 任务)→ 之后每发一版跑**增量轮**(只重跑该刀对应任务,
> 半小时一轮):**R2**(v0.5.2 写后诊断+验证义务 → 重跑 T1/T3,看 U5)· **R3**(v0.5.3 插话 → 重跑 T6,
> 看 U8,G-001 必须翻到 ≥ Cline)· **R4**(v0.5.4 上下文+纠错 → 重跑 T2/T4/T5,看 U2/U5/U9 + token/轮数)。
> 每轮证据照旧回填 [UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md) §四/§五。

**前提**:已装 `roam-crew-0.5.1-bundled.vsix`(Extensions 面板显示 **0.5.1** = 装对了),并已装**同版本 Cline**。
**用 UnodeAi 跑 DeepSeek 或 Kimi**(便宜档),与 Cline 配**完全相同的模型/参数**——这是控制变量,目的是隔离出
「纯交互体验」差距,不是比模型。

**协议权威**:[UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md)。本卡 = 执行它的「首轮基准 checklist」。
**分工**:🤖 = DeepSeek/Kimi 通过 UnodeAi 自主跑 · 👤 = 张手动操作/打分(UI 手感类必须人看)。

---

## 控制变量(开跑前 👤 对齐)
- 两边同一个**便宜档模型**(如 `deepseek-*-flash` 或 `kimi/moonshot-*`),同 temperature/max_tokens,若可同 key/
  同 baseUrl。
- UnodeAi 用 **Solo/Fast 模式**对标(和 Cline 一样单 agent;Team 模式是我们独有优势,**本轮不比**)。
- 目标仓库:选一个中小真实仓库的副本(**别用 RoamCrew 主仓**,避免污染)。每个任务开跑前 `git reset --hard` +
  `git clean -fd` 回到干净基线。

---

## 🤖 + 👤 跑 8 个任务(每个两边各一遍,同 prompt)
按 [UX_BENCHMARK §三](UX_BENCHMARK_vs_Cline.md) 的固定 8 任务,**用同一段标准 prompt**(👤 先把 8 段 prompt 文案
定死,贴进本卡末尾,避免提示词差异污染对比):

| T | 任务 | 谁主跑 | 重点看的维度 |
|---|------|--------|--------------|
| T1 | 改一个函数 + 跑测试验证 | 🤖 | U1 流式 · U3 diff · U5 错误恢复 · U7 终端 |
| T2 | 跨多文件重构(重命名一个导出,改所有引用) | 🤖 | U2 Plan · U3 diff · U4 回退 |
| T3 | 从失败测试修 bug 到绿 | 🤖 | U5 · U7 · U9 成本 |
| T4 | 新增小功能(读现有码 + 写新文件 + 接线) | 🤖 | U2 · U3 · U6 @上下文 |
| T5 | 带 @file/@folder/@problems 的任务 | 🤖 | U6 · U2 |
| **T6** | **运行中改主意**(跑到一半插一句「换个做法」) | 👤(手动插话) | **U8 插话** · U1 |
| T7 | 做个改动后一键撤销/回退 | 👤(点回退) | U4 · U3 |
| T8 | 冷启动:全新装好 → 新用户走到跑通第一个任务 | 👤 | U10 上手 · U1 |

> **T6 是重点**:用户已确认「UnodeAi 也要能插话」。本轮要**实测并取证**两边的差距——UnodeAi 现在运行时输入框
> 禁用(预判明显落后),录屏证明,坐实 [G-001](UX_BENCHMARK_vs_Cline.md#五parity-gap--v05x-迭代清单产出)。

**每个任务记录(填进 §四 scorecard + 留证据)**:完成度(成/败/半)、用时、轮数、token/成本,以及 10 个维度逐项
打分(0–3,Cline 分 / UnodeAi 分)+ **差距证据**(截图/录屏/复现步骤)。

---

## 🤖 DeepSeek/Kimi 能自主做的部分(不依赖 UI 手感)
- T1–T5 的**功能完成度 + 错误恢复行为**:贴两边的原始过程——谁更少空参/畸形工具调用、谁更少死循环、谁更少甩锅
  「环境坏了」(这正是 UnodeAi 弱模型鲁棒四层要赢的地方,U5)。
- **成本/轮数**:记录两边跑完同任务各花多少 token / 轮 / 钱(U9)。
- **自验证**:在仓库副本里 `npm run build` + `npm run lint`(+ 能跑就 `npm test`),退出码为准。

## 👤 张手动看的部分(交互手感,DeepSeek 看不到)
- **U1 流式**:首 token 延迟、流不流畅、滚动会不会打架(UnodeAi v0.5.1 刚上增量渲染,重点验)。
- **U3 diff/审批**、**U4 回退/checkpoint**、**U7 终端可见性**、**U8 插话(T6)**、**U10 上手(T8)** —— 这些必须人看人点。

---

## 产出(本轮交付)
1. 填好的 **§四 scorecard**(便宜档那张;有空再补中档/强档)。
2. **§五 Parity Gap 清单**:把所有「UnodeAi < Cline」的维度列出来 + 证据 + 落后幅度。**G-001(插话)已预立项**,
   本轮负责坐实证据。
3. 一段**结论**:UnodeAi 当前体验在哪几项已 ≥ Cline、哪几项落后、最该先补哪个。

> 交给 Claude:Claude 据此把 P0 gap 转成任务卡,排进 V0.5.2(**P0 gap 不补不发版**)。证据/打分由你录进
> [UX_BENCHMARK_vs_Cline.md](UX_BENCHMARK_vs_Cline.md) 的 §四/§五 表格(那是权威,别另起文档)。

---

## 8 段标准 prompt + 固定沙盒 + 逐步操作
✅ **已定死**,见 → **[bench/ux-sandbox/RUNBOOK_round1.md](../bench/ux-sandbox/RUNBOOK_round1.md)**。
沙盒在 `bench/ux-sandbox/`(纯 JS、零依赖、`node --test`,baseline 5/5 绿 + lint ok 已验)。Runbook 含:阶段0
准备(scratch 副本 + 两边同模型配置)、阶段1 的 T1–T8 原文 prompt(贴谁都一样)、阶段2 汇总。直接照着跑。
