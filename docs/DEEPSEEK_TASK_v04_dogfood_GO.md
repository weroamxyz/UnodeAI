# DeepSeek + UnodeAi 任务卡 — v0.4.0 dogfood（已装 0.4.0 构建,正式开测）

**前提**:已装 `roam-crew-0.4.0-bundled.vsix`(Extensions 面板显示 **0.4.0**,Team 卡片有 🕘 Restore、活动栏有
Console 面板 = 装对了)。**上次在 v0.3.0 上的结果作废**,这次才是真的。

**分工原则**:UI 功能(弹窗、面板、按钮)由**张手动验**;DeepSeek 只做**能自主验证**的部分。下面 🤖 = DeepSeek 做,👤 = 张做。

---

## 🤖 任务 1(最重要)：XML vs native 工具调用对比
这是验证 UnodeAi 核心差异化("让便宜模型能干活")的关键数据。

**步骤**:
1. 👤 张:Edit-Agent → 🔧 Tool calling,先确认这个 DeepSeek agent 是 **Native**。
2. 🤖 DeepSeek:做下面这个**真·多步任务**(native 模式):
   ```
   在工作区 _xmltest/ 目录下:写 calc.js（导出 add/sub/mul 三个函数），
   再写 calc.test.js（每个函数 2 个用例，共 6 个），然后用 node 跑测试。
   开工前先用 update_todos 列步骤,每步更新状态。
   ```
3. 🤖 记录 native 模式表现:有没有空参数/畸形 write_file、有没有重复失败、Todo 有没有正常更新、最终 6/6 过没过。
4. 👤 张:Edit-Agent → 🔧 Tool calling 切成 **XML**。
5. 🤖 DeepSeek:在 `_xmltest2/` 下做**同样的任务**(xml 模式)。
6. 🤖 **产出对比报告**:native vs xml 哪个工具调用更干净(更少空参/畸形/重试)、哪个一次过的步骤更多。贴两次的原始过程。

> 这一项的结论直接决定我们要不要把 XML 作为 v0.4.0 的卖点。**最高优先级。**

---

## 🤖 任务 2：A/B 弱模型防呆
1. 故意制造容易犯错的场景(比如让你写一个结构复杂、参数多的工具调用)。
2. ✅ 通过:即使你发了**缺参数/畸形**的调用,系统**不再诡异死循环**——要么"缺少必填参数 X"明确纠正,要么"同样失败几次后被拦下提示换法"。贴出现纠正/熔断的原始输出。

---

## 🤖 任务 3：自主回归(确认 0.4.0 没把旧功能改坏)
- `@folder` / `@problems` / `@url`:在任务里用,让 agent **只根据注入内容**复述,确认对得上。
- 真终端:跑 `npm test`(在 RoamCrew 仓库的一个副本里,别污染主仓),退出码为准,确认全绿。
- 自验证统一:`npm run build` + `npm run lint` + `npm test`。

---

## 👤 张手动验(点几下,DeepSeek 不用管)
- **V2 写审批**:设 `roam.writeApproval=ask`(即时生效)→ 让 agent 写文件 → 弹 diff → 试 Approve / Approve all / **Deny with note**(看 agent 是否收到你的留言并调整)。
- **命令审批**(默认已 ask):让 agent 跑个新命令 → 弹四选一 → 试 **Deny with note** + **Allow this session**(第二次同命令不再问)。
- **V1 还原**:agent 改文件后点 🕘 Restore → 选一条 → 文件回滚(新建=删除/覆盖=回旧内容)。
- **V3 Console**:起多个 agent → 看实时状态/任务/ctx%/成本。
- **C3 Plan 收起**:多步任务 Plan 跑满 → 自动缩成一行 `✓ N/N`。

---

## 报告格式
每项:**通过/失败** + 原始输出/截图。任务 1 的 native-vs-xml 对比单独成段(这是重点)。发现 bug 立刻单独报。

⚠️ 产物放 `_xmltest*/`(下划线前缀,已 gitignore),别污染仓库根。
