# UX 基准首轮 — 操作 Runbook(UnodeAi vs Cline,同模型)

> 配套:[../../docs/UX_BENCHMARK_vs_Cline.md](../../docs/UX_BENCHMARK_vs_Cline.md)(协议)·
> [../../docs/DEEPSEEK_TASK_ux_benchmark_round1.md](../../docs/DEEPSEEK_TASK_ux_benchmark_round1.md)(任务卡)
> 固定沙盒在本目录(`bench/ux-sandbox/`),纯 JS、零依赖、`node --test`,**baseline 5/5 绿、lint ok(已验)**。

---

## 阶段 0 — 准备(一次性,约 10 分钟)

### 0.1 准备 scratch 工作副本(每次 task 前可快速重置)
把沙盒**复制出去**(不要直接在 RoamCrew 仓库里跑 agent,会污染),并 `git init` 以便一键重置:
```powershell
Copy-Item -Recurse "c:\AI_Program\RoamCrew\bench\ux-sandbox" "c:\AI_Program\ux-scratch"
cd c:\AI_Program\ux-scratch
git init -q; git add -A; git commit -q -m baseline
node --test   # 确认 5/5 绿
```
> **每个 task / 每换一个工具前重置**:`git reset --hard -q; git clean -fdq`(回到 baseline)。

### 0.2 两边配**完全相同**的模型(控制变量 = 这一步最关键)
选一个**便宜档模型 id**(如 `deepseek-chat` / `deepseek-v3`,或 `kimi`/`moonshot-v1-8k`),两边填**同一个**。

- **Cline**:设置 → API Provider 选 **OpenAI Compatible** → Base URL `https://www.unodetech.xyz/v1` →
  API Key 填 Roam key → Model ID 填上面那个 id → **Temperature = 0**。
- **UnodeAi**:⚡ 起一个 **Solo agent** → provider `roam`(默认 baseUrl 即 `…unodetech.xyz/v1`)→ model 填**同一个
  id** → Edit-Agent 把 **temperature 设 0**、Tool calling 先用 **Native**。

> 目标:两边模型/参数一致,只比**交互体验**。UnodeAi 用 **Solo 模式**对标(和 Cline 一样单 agent)。

### 0.3 打开记分表
打开 [UX_BENCHMARK_vs_Cline.md](../../docs/UX_BENCHMARK_vs_Cline.md) §四 的便宜档 scorecard,准备逐格填
`Cline分 / RoamCrew分`(0–3)。每个 task 录屏或截图存证。

---

## 阶段 1 — 8 个任务(每个:Cline 一遍 + UnodeAi 一遍,同 prompt,跑前各自 `git reset --hard`)

> 每个 task 都把下面这段 prompt **原样**贴给两边。记录:完成度(成/半/败)、用时、轮数、token/成本、10 维度打分 + 差距证据。

### T1 — 改一个函数 + 跑测试 〔U1 U3 U5 U7〕
```
给 src/mathUtils.js 的 add 加输入校验:任一参数不是 number 时抛 TypeError('add expects numbers')。
在 test/math.test.js 加一个用例验证非法输入会抛错。然后跑测试，确认全绿。开工前先用清单列出步骤。
```

### T2 — 跨多文件重构(重命名导出)〔U2 U3 U4〕
```
把 src/mathUtils.js 导出的 subtract 重命名为 minus（函数名和导出名都改），
更新项目里所有引用（calculator.js、测试文件等），跑测试确认仍然全绿。
```
> 这会触及 3 个文件(mathUtils / calculator / test),看两边的 diff 呈现 + Plan。

### T3 — 从失败测试修 bug 〔U5 U7 U9〕
**先手动埋 bug**(两边各自重置后、跑 T3 前):把 `src/mathUtils.js` 里 `multiply` 的 `return a * b;` 改成
`return a + b;`(`node --test` 会有 2 个用例红)。然后贴:
```
跑测试，有用例失败。定位根因并修复，直到测试全绿。报告你改了什么、为什么。
```

### T4 — 新增小功能 〔U2 U3 U6〕
```
新增 src/power.js，导出 power(base, exp) 返回 base 的 exp 次方（exp 为非负整数）。
在 Calculator 上加一个 toThe(n) 方法，把当前 value 作为 base、n 作为 exp。
在测试里加 power 和 toThe 的用例。跑测试确认全绿。
```

### T5 — 带 @ 上下文 〔U6 U2〕
```
@src/mathUtils.js @src/calculator.js 根据这两个文件的真实内容，在 docs/USAGE.md 写一份
Calculator 用法说明（列出所有方法 + 一个链式调用示例）。只依据注入的文件内容，不要编造不存在的方法。
```
> 看 @file 注入保真度:有没有编出不存在的方法。Cline 用它的 @ 语法塞同样两个文件。

### T6 — 运行中插话(本轮重点)〔U8 U1〕
让两边做和 T4 一样的任务,**在它刚开始动手时**插一句:
```
停，别自己实现幂运算，直接用 Math.pow。
```
> **重点取证**:UnodeAi 现在运行时输入框**禁用**(预判),Cline 可中途追加 → 录屏坐实 **G-001**。

### T7 — 改动后一键回退 〔U4 U3〕
```
把 src/formatter.js 的 sum 改成用 for 循环重写（保持行为不变），跑测试确认还是全绿。
```
完成后:UnodeAi 点 🕘 **Restore** 选这条 / Cline 用它的 checkpoint,把 `formatter.js` 撤回改动前,确认回原样。

### T8 — 冷启动 〔U10 U1〕
新窗口 / 新用户视角,打开 scratch 沙盒,从零走到「跑通第一个任务」(做一遍 T1)。**计时**:从打开到第一个任务跑完;记卡点。

---

## 阶段 2 — 汇总(交给 Claude)
1. 填完 §四 scorecard(便宜档)。
2. 列 §五 Parity Gap(每条:维度 / 现象+证据 / 落后幅度)。**G-001 插话**本轮坐实。
3. 一句话结论:哪几项已 ≥ Cline、哪几项落后、最该先补哪个。
→ Claude 据此把 P0 gap 转任务卡排进 V0.5.2。
