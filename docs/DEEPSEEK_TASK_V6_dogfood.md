# DeepSeek + UnodeAi 任务卡 — Team 模式 dogfood:V6 共享记忆 + PM 团队 Plan

**前提**:装**最新** `roam-crew-0.5.0-bundled.vsix`(Install from VSIX → **Developer: Reload Window**)。
确认 Extensions 面板 UnodeAi 显示 **0.5.0**。这是带 V6 的本地构建(还没发版)。

**模式:用 Team(PM + 至少 2 个成员)。别用 solo** —— 这两项都需要多 agent / PM。

---

## 任务 A:PM 团队 Plan（新功能,先验这个最快）
1. 起一个团队,给 PM 一个**多步、需要委派**的任务,比如:
   `做一个小工具:写 add(a,b) 函数 + 它的测试,然后跑测试。`
2. **Chat 下拉停在 PM**。
3. ✅ 通过:PM 一开工就在它自己的对话框顶部出现一张**钉住的 Plan 清单**(它拆出来的子任务),
   并随委派/收结果**实时更新**(☐→▸→☑),最后收成 `✓ N/N`。
   - 之前 team 模式 PM 不调 update_todos、看不到 Plan;现在应该有了。
4.（可选)切下拉到某个 worker,看它**自己**有没有 Plan(各 agent 独立)。

---

## 任务 B:V6 团队共享记忆（核心)
验"**agent A 记一条 → agent B 读到**"。
1. 同一个团队里:
2. **让 agent A**(比如 architect/PM)`memory_note` 记一条明确事实,例如:
   `memory_note("接口约定:User 字段为 id:string, email:string, role:Role;别用 username。")`
   - ✅ 返回 `Noted to shared team memory.`;打开 `.roam/memory/notes.md`,出现一行
     `- [时间] [agentA] 接口约定…`。
3. **让 agent B**(另一个 agent,新一轮)问一个**需要那条记忆**的问题:
   `User 类型有哪些字段?按团队共享记忆回答。`
   - ✅ 通过:B 答出 `id/email/role`(来自注入的 `<shared_memory>`),不是瞎编/说不知道。
4. **人类可读 + 热重载**:你手动在 `.roam/memory/notes.md` 末尾加一行保存,再问 B,确认它看得到新加的那条。
5. **缺参降级**:`memory_note("")` → 返回 `Error: memory_note requires a non-empty 'note'.`。

---

## 顺带回归（team 里这些也都应有效)
- **泄漏恢复**:DeepSeek 即使把工具调用吐成 `<｜｜DSML｜｜…>`,工具仍真执行(不卡)。
- **announce-then-act**:它说"让我查一下："却没调工具时,应被自动催着续做、不用你手动催。
- **A/B 防呆**:缺参调用 → `missing required parameter(s): …` 明确纠错、不死循环。

---

## 通过标准 / 报告
- **任务 A**:PM 对话框出现团队 Plan 并实时更新 → ✅。
- **任务 B**:A 写入文件 + B 下一轮引用到 + 手动编辑后 B 也看到 + 缺参报错 → ✅。
- 每项贴证据(`.roam/memory/notes.md` 内容、B 的回答原文、Plan 截图)。

全过 = V6 + 团队 Plan 验收,我就切 **v0.5.0** 正式发版。

> 注:`.roam/memory/notes.md` 是设计内产物(人类可读、git 可追踪),不算污染;别的 scratch 用 `_` 前缀。
