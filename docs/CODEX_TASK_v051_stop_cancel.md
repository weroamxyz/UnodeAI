# Codex 任务卡 v0.5.1 — Stop/Cancel 传播到 assign_task / await_tasks

**目标**:用户点 **Stop**(或停某个 agent)时,该 agent **pending 的异步委派**(`assign_task_async` 派出去、
`await_tasks` 正在等的)要能**被中断**:等待 teammate 的 promise 及时以"已取消"结束,**释放占用的文件/任务
claim**,不留僵尸 promise。这是团队并行场景下高感知的稳定性 bug(Codex review 指出)。

**范围 = 取消传播,不改委派的正常逻辑**。

## Worktree
```
git worktree add ../roam-crew-codex-stopcancel -b codex/stop-cancel
cd ../roam-crew-codex-stopcancel && npm install
```
基于最新 main(含 v0.5.0 + v0.5.1 已合的 stabilization 提交)。

## 先调研(这几处是关键)
- **`src/backend/TeamTools.ts`**:`assign_task` / `assign_task_async` / `await_tasks` 怎么派活、怎么持有
  pending handle、怎么领/放 claim(配合 TaskClaimRegistry / FileCoordinator)。找到"等待 teammate 结果"的
  那个 promise。
- **`src/session/SessionManager.ts`**:`stop(sessionId)` / cancel 的现有流程——它现在停了什么(HTTP 请求?
  backend?),**没停什么**(pending 委派 promise)。
- **`src/backend/AgentBackend.ts` / `OpenAICompatBackend`**:`cancel()` / cancelRequested 的现有机制
  (HTTP 层已有 abort);看委派 promise 能不能挂到同一个取消信号上。
- **claim 释放**:`TaskClaimRegistry` / `FileCoordinator` 怎么领/放 claim——取消时必须把该 agent 持有的
  pending claim 释放,否则后续会"文件被占用"。

## 要实现
1. **一个取消信号**贯穿委派:当 agent 被 stop,其 TeamTools 持有的 pending `assign_task(_async)` /
   `await_tasks` 的等待 promise 应**尽快 settle 成已取消**(返回一个明确的 "delegation cancelled" 结果/抛
   一个可识别的取消错误),而不是继续挂着等 teammate。
   - 优先复用现有 `cancelRequested` / AbortController 机制(HTTP 已经能 abort);把委派等待也接到同一信号。
2. **释放 claim**:取消时,该 agent 通过 assign_task_async 领取的 file/task claim 必须释放(调用 registry/
   coordinator 的释放 API),让别的 agent 不被这些僵尸 claim 挡住。
3. **被取消的 teammate**:如果可行,通知/停掉正在替它干活的 teammate(至少不要把它们的结果再当有效收回)。
   若太复杂,最少做到"PM 这边不再等、claim 已放、状态干净"。

## 允许改的文件
`src/backend/TeamTools.ts`(核心)、`src/session/SessionManager.ts`(stop 接线)、必要时
`src/backend/AgentBackend.ts`/`OpenAICompatBackend.ts`(暴露/共享取消信号)、相关 claim registry。
**别动** 协议(native/xml)、泄漏恢复、checkpoint、审批、pricing 那些刚改过的区域。

## 测试
- 单测:模拟一个 pending async 委派 + 触发 cancel → 等待 promise 以取消结束、claim 被释放(用现有
  `TaskClaimRegistry` / fake coordinator 断言释放)。
- 不引入对真实网络/agent 的依赖(沿用现有 TeamTools 测试的 fake 注入风格)。

## 自验证 + 验收
```
npm run build && npm run lint && npm test && npm run compile:e2e   # 全绿
```
- 验收场景:PM 并行 `assign_task_async` 派给 2 个 teammate、`await_tasks` 等待时,用户 Stop → 等待**立即**
  结束(不再卡 600s/直到 teammate 自己回)、claim 释放、再发新任务不被旧 claim 挡。
- Claude review 后合并进 v0.5.1。worktree 保持干净。
