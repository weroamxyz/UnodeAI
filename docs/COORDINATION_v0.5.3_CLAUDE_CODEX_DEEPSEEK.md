# 🤝 三者联动计划 — v0.5.3 G-001 中途转向协调

**参与方**: Claude (复审/把关) · Codex (UI) · DeepSeek/Kimi (后端) · RoamClaw (R2/dogfood)
**周期**: 2026-06-12 ~ 2026-06-18
**更新**: 2026-06-11

> ⚠️ **范围已重定（Opus 复审，2026-06-11）。本文下方的逐日排期与代码片段已过时，仅作流程参考。**
> 权威范围与实现细节以三张任务卡为准：
> - 后端 → [TASK_DEEPSEEK_v0.5.3_G001_BACKEND.md](TASK_DEEPSEEK_v0.5.3_G001_BACKEND.md)
> - UI → [TASK_CODEX_v0.5.3_G001_UI.md](TASK_CODEX_v0.5.3_G001_UI.md)
> - 基准+dogfood → [TASK_ROAMCLAW_v0.5.3.md](TASK_ROAMCLAW_v0.5.3.md)
>
> 关键变化：v0.5.3 **只做 interject**（C1/C3 推迟）；**只一种**消息（砍 instruction/observation 双模式）；**无 AsyncMutex**（单线程，无竞态）；**等待不抢占**；只在**循环顶部**注入以守 tool_call 顺序不变量。流程先跑 **R2 基准**再锁范围。

---

## 角色分工与责任

### 🔵 Claude — 战略 + 把关 + 协调

**职责**:
1. ✅ 接口设计：定义 `interject()` 方法签名、参数、语义
2. 📋 代码审查：Codex PR（UI）+ DeepSeek PR（后端）
3. 📊 风险评估：检查并发安全、历史爆炸、loop 不变量破坏
4. 🐛 Bug triage：联合 E2E 测试时的问题分类与优先级
5. 📝 文档：本协调计划 + roadmap + 发布说明

**时间投入**: 15–20 小时（分散在 7 天里）

---

### 🟡 Codex — 前端 UI

**职责**:
1. 📌 输入框启用：`allowInputWhileBusy` 设置 + conditional 显示
2. ⚡ 打断按钮：button + modal 弹框 + 输入校验
3. 📊 队列 chip：显示待处理 interject 数
4. 🎨 消息卡样式：[INTERJECT] 消息的特殊渲染（金/紫色）
5. 📈 进度条：工具名 + 迭代计数显示
6. ✅ 单测：15–20 个测试，覆盖率 > 85%
7. 📸 截图验证：UI 主要流程的可视化证明

**交付物**:
- PR 到 main（带任务卡链接 + 提交日期）
- 单测全绿
- 截图 5 张

**时间投入**: 24–32 小时（4 天）

**Milestone**:
- [ ] 2026-06-12: 接口规范到手 → 开始 T3.2.1–3
- [ ] 2026-06-13: T3.2.2 完成（按钮 + 弹框）
- [ ] 2026-06-14 中午: T3.2 全部完成，PR ready
- [ ] 2026-06-14 下午: Claude review（1 小时），获得反馈
- [ ] 2026-06-15: 修复 review 意见，最终 PR merge

---

### 🟠 DeepSeek/Kimi — 后端逻辑

**职责**:
1. 🔧 接口实现：AgentBackend.interject() + getInterjectionQueueLength()
2. ⚙️ 队列结构：interjectedMessages FIFO + AsyncMutex 并发安全
3. 🔄 runTurn() 改造：每轮检查队列 → 消息注入历史 → chat() 推进
4. 📜 历史处理：interject 消息不被 rolling summary 删除
5. ✅ 单测：12–15 个单元测试 + 3–4 集成测试，覆盖率 > 90%
6. 🚀 后端集成：与 Codex UI 对接，确保端到端流通

**交付物**:
- PR 到 main（带任务卡链接）
- 单测 + 集成测试全绿
- 与 UI 层联合 E2E 验证

**时间投入**: 28–36 小时（5 天）

**Milestone**:
- [ ] 2026-06-12: 接口规范到手 → 开始 T3.1.1–3
- [ ] 2026-06-13: T3.1.4–5 完成（runTurn 改造）
- [ ] 2026-06-14: T3.1.6–7 完成（ClaudeHeadless stub + 单测）
- [ ] 2026-06-14 下午: Codex PR 出来 → review，确认调用点
- [ ] 2026-06-15: T3.1.8 集成测试完成，PR ready
- [ ] 2026-06-15 下午: Claude review（2 小时），获得反馈
- [ ] 2026-06-16: 修复意见 + 联合 E2E → PR merge ready
- [ ] 2026-06-17 下午: 最终收尾

---

## 日程与同步点

### 第 1 天 (2026-06-12)

**上午**:
- Claude: 最终确认接口规范，发布给 Codex 和 DeepSeek
  - AgentBackend.interject(message, mode) 签名
  - interjectMode = 'instruction' | 'observation'
  - Promise-based（非同步）
  - 消息格式: `[INTERJECT mode] text`
  - 队列长度 getter: `getInterjectionQueueLength?(): number`

**下午**:
- Codex: 启动 T3.2.1–3（输入框、按钮、modal）
- DeepSeek: 启动 T3.1.1–3（接口、队列、interject()）

**晚上**: 双方独立开发，无阻塞

---

### 第 2–3 天 (2026-06-13–14)

**Codex 进度**:
- 完成 T3.2.2（⚡ 打断按钮）
- 完成 T3.2.3（队列 chip）
- 单测开始

**DeepSeek 进度**:
- 完成 T3.1.4–5（runTurn 改造、历史处理）
- 单元测试开始

**交互**: 零（各自独立开发）

---

### 第 4 天上午 (2026-06-14 上午)

**Codex**:
- 完成 T3.2 全部（包括 T3.2.4–5 和单测）
- **PR ready** → 提交到 main（保留为 draft，等 Claude review）

**同时**:
- Claude: 准备 code review（预计 1 小时）
- DeepSeek: 知晓 Codex 的前端调用点
  ```typescript
  // ChatViewProvider.ts 里
  vscode.postMessage({
    command: 'interjectionSend',
    message: userInput,
    type: 'instruction' | 'observation'
  });
  
  // extension 端
  sessionManager.currentBackend?.interject(message, type)
  ```

---

### 第 4 天下午 (2026-06-14 下午)

**Claude**:
- 快速 review Codex PR（1 小时）
- 反馈清单（必做 / 最好有 / 可选）

**Codex**:
- 看 DeepSeek 的 PR draft（如果有）
- 或者开始改 Claude 的反馈

**DeepSeek**:
- 继续 T3.1.6–7（ClaudeHeadless + 单测）
- 看 Claude 对 Codex 的反馈，确认是否影响自己

---

### 第 5 天 (2026-06-15)

**上午**:
- Codex: 改完 Claude 反馈，merged to main
- DeepSeek: 完成 T3.1.7（单元测试），T3.1.8 开始（集成测试）

**下午**:
- DeepSeek: **PR ready** → 提交为 draft
- Claude: review DeepSeek PR（2 小时）
- Codex: 等待，准备 E2E 测试环境

---

### 第 6 天 (2026-06-16)

**上午**:
- 三方同步（30 分钟视频会或文字）
  - Claude 反馈 DeepSeek
  - 确认 E2E 测试场景（A/B/C）
  - 分工：谁测什么

**中午–下午**:
- Codex + DeepSeek: 联合 E2E 测试
  - 场景 A: Instruction interject → agent 改策略
  - 场景 B: 多条 interject → FIFO 处理
  - 场景 C: Observation interject → agent 避免重复
- Claude: 旁听，记录 bug

**晚上**:
- DeepSeek: 修复发现的 bug，更新 PR

---

### 第 7 天 (2026-06-17)

**上午**:
- DeepSeek: bug fix 完成
- Claude: 二轮 review（1 小时），批准 merge

**中午**:
- Codex + DeepSeek: PR merge to main
- 发布前检查：
  - [ ] 所有单测 green
  - [ ] E2E 场景全过
  - [ ] 文档更新（CHANGELOG / API docs）
  - [ ] 截图/视频（发布说明用）

**下午**:
- Claude: 准备 v0.5.3 发布
- 更新 ROADMAP（标记 v0.5.3 complete）

---

### 第 8 天 (2026-06-18)

**发布 v0.5.3**:
- 版本号 + tag
- GitHub release notes
- Marketplace 更新（如需）

---

## 同步机制

### 文档系统
- **ROADMAP** (本文件): 总体计划，Claude 维护
- **TASK_CODEX_…** & **TASK_DEEPSEEK_…**: 详细任务卡，各自维护 + Claude 评审
- **CLAUDE.md** / **BACKLOG.md**: 待办清单更新

### 沟通频道
- **异步**: GitHub PR comments（代码审查、问题讨论）
- **同步**: 
  - 每日 standup（文字，5 分钟）
    - Codex: "完成 T3.2.2，单测 5/20 green"
    - DeepSeek: "完成 T3.1.4，runTurn 改造进行中"
    - Claude: "review 状态，有无阻塞"
  - 第 6 天视频同步（30 分钟，E2E 测试协调）

### 工件溯源
- 每个 PR 引用对应的 task card（为什么做、怎么验证）
- 每个 commit message 带 task ID（如 `TASK_CODEX_T3.2.2: 实现 ⚡ 打断按钮`）
- PR description 包含：
  - What（做了什么）
  - How（怎么做的）
  - Testing（怎么测的）
  - Depends on（依赖什么）

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| **Codex 等待 DeepSeek** | 中 | 第 5–6 天卡壳 | Codex 提前完成 E2E 测试环境准备 |
| **并发竞态** | 低 | runTurn 破裂 | AsyncMutex 从一开始就实现，单测覆盖 |
| **消息历史爆炸** | 低 | token 超额 | rolling summary 照常生效，interject 消息保留但压缩 |
| **UI-backend 接口不匹配** | 中 | E2E 失败 | 第 4 天下午强制对齐调用点 |
| **E2E 场景超时** | 低 | 无法验证 | 设长 timeout（30 秒）+ 调试日志 |
| **Review 意见多** | 中 | 延期一天 | 分成 major/minor，major 必须改，minor 可推 v0.5.4 |

---

## 成功标志

**v0.5.3 ready** 当且仅当：

- [ ] Codex PR merged (T3.2 全部完成)
- [ ] DeepSeek PR merged (T3.1 全部完成)
- [ ] E2E 场景 A/B/C 全过
- [ ] 单测覆盖率 > 85% (Codex) 和 > 90% (DeepSeek)
- [ ] Claude 签字：No known bugs blocking release
- [ ] CHANGELOG 更新
- [ ] 截图 5 张 + 简介视频 (可选)

---

## 关键文件索引

| 文件 | Owner | 何时改 |
|------|-------|--------|
| `src/backend/AgentBackend.ts` | DeepSeek | T3.1.1 |
| `src/backend/OpenAICompatBackend.ts` | DeepSeek | T3.1.2–5 |
| `src/backend/OpenAICompatBackend.test.ts` | DeepSeek | T3.1.7 |
| `src/views/ChatViewProvider.ts` | Codex | T3.2.1–5 |
| `src/views/ChatViewProvider.test.ts` | Codex | T3.2 (测试) |
| webview HTML/CSS | Codex | T3.2.2–5 |
| `docs/ROADMAP_v0.5_…` | Claude | 持续更新 |
| `docs/CHANGELOG.md` | Claude | v0.5.3 发布时 |

---

## 速查表（CLI & Git）

**提交规范**:
```bash
git commit -m "feat(T3.2.2): implement ⚡ interject button and modal

- Adds interject button to ChatViewProvider footer
- Modal for instruction/observation selection
- Character count validation (max 500)
- XSS-safe rendering (no innerHTML)

Relates to TASK_CODEX_v0.5.3_G001_UI.md

Co-Authored-By: Codex <codex@anthropic.com>"
```

**PR 命名**:
```
[TASK] v0.5.3 G-001 UI: Interject Button + Modal (Codex)
[TASK] v0.5.3 G-001 Backend: interject() Implementation (DeepSeek)
```

**分支**:
```bash
git checkout -b feat/g001-interject-ui  # Codex
git checkout -b feat/g001-interject-backend  # DeepSeek
```

---

## 问答 (FAQ)

**Q: 如果 Codex 先完成，要等 DeepSeek 吗？**
A: 不用。Codex 可以写集成测试（mock backend），等 DeepSeek ready 后直接跑真实路径。

**Q: 如果发现接口设计有问题，怎么办？**
A: Claude 在第 4 天上午决定。如果是小问题（参数名改个字母），两边都能快速改。如果是大问题（返回类型改了），可能延期。

**Q: 单测跑在哪个 Node 版本？**
A: 同 UnodeAi 主项目（见 `.nvmrc` 或 `engines.node`）。目前应该是 Node 18+。

**Q: PR review 时间通常多久？**
A: Claude 承诺：
  - Codex PR（UI）: 1 小时
  - DeepSeek PR（后端）: 2 小时
  - 有 blocking issue：同日修复+二轮 review

**Q: 发布前需要什么文档？**
A: 
  - CHANGELOG.md（已有 v0.5.3 section，补充新内容）
  - API docs / inline 注释（interject 方法的说明）
  - 发布说明（50 行以内，新用户能理解）

---

## 意外情况

### 如果 Codex 卡住了

- Claude 或 DeepSeek 可以接手某个 subtask（如样式调整）
- Codex 专注 interject 核心逻辑

### 如果 DeepSeek 卡住了

- Claude 可提供参考实现（伪代码）
- Codex 继续完成单测和集成测试框架

### 如果 E2E 测试失败

- 第 6 天下午 extended 到傍晚
- 可能推到第 7 天上午
- 发布顺延到 2026-06-19（第 9 天）

---

## 总结

**三人联动的关键**:
1. 📋 接口一次定对（第 1 天上午）
2. 🚀 两个 agent 平行（第 2–4 天）
3. 🤝 第 4 天下午对齐（UI-backend 交接）
4. 🧪 第 6 天 E2E 验证（场景 A/B/C）
5. 🎉 第 8 天发布

**成功概率**: 95% on-time（假设无网络故障 / 无重大 bug）

