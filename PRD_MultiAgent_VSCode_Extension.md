# PRD: UnodeAi — Multi-Model AI Team for VS Code

> **文档类型**: Product Requirements Document
> **版本**: v2.1（对齐已实现代码 + 评审后优化）
> **状态**: Living — 跟踪实现
> **更新日期**: 2026-06-01
> **隶属**: Roam（weroam.xyz）— Web3 流量运营商，AI 时代提供 LLM token（ComputeVault 网关）
>
> **相关文档**：[README 文档地图](README.md) · [USAGE 使用文档](USAGE.md) · [STATUS 进展与下一步](docs/STATUS.md) · [MCP/Skills 设计](docs/MCP_Skills_Integration.md) · [Team Workflow 设计](docs/Team_Workflow_And_Cost_Optimization.md) · 评审快照：[GLM](docs/Project_Review.md) / [Cline](docs/PRD_vs_Implementation_Review.md)
> **当前实测**（2026-06-02，v2.8 / Codex 硬化 + review 跟进后）：单元测试 **169 全绿**；本章中分散的历史用例数（47/87/98/111/130/160/168）为各版本时点值，以 [STATUS.md](docs/STATUS.md) 为准。

> **v2.0 变更摘要**：产品更名 CrewCode → **UnodeAi**；补充实现后才确立的核心架构（AgentBackend 后端抽象、PM 委派工具 TeamTools、命令安全策略 CommandPolicy、文件并发与跨文件冲突防御、对话上下文持久化）；新增「实现状态」一章如实标注已做/未做；修正旧版与代码不符之处（配置文件是 `.roam/team.json` 而非 `.teamrc`；面板是 Webview 而非 TreeView；文件冲突检测已实现而非占位）。

---

## 目录

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Vision & Strategy](#3-vision--strategy)
4. [Personas](#4-personas)
5. [User Stories](#5-user-stories)
6. [Functional Requirements（含实现状态）](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Architecture Overview](#8-architecture-overview)
9. [Core Modules Design](#9-core-modules-design)
10. [UI/UX Design](#10-uiux-design)
11. [Data Model](#11-data-model)
12. [Communication Protocol](#12-communication-protocol)
13. [Security & Command Policy](#13-security--command-policy)
14. [Concurrency & Cross-File Consistency](#14-concurrency--cross-file-consistency)
15. [Crash Recovery & Persistence](#15-crash-recovery--persistence)
16. [Implementation Status](#16-implementation-status)
17. [Competitive Analysis](#17-competitive-analysis)
18. [Roadmap](#18-roadmap)
19. [Go-to-Market](#19-go-to-market)
20. [Appendix](#20-appendix)

---

## 1. Executive Summary

**UnodeAi** 是一个 VS Code 扩展，让项目 Owner 在 IDE 内组建并管理一支由多个 AI Agent 组成的"虚拟开发团队"。每个 Agent 运行在独立 Session 中，绑定不同角色与 Skill，**可为不同角色配置不同的 Provider 与模型**。Agent 之间通过统一的消息总线协作；一个 **Project Manager（PM）Agent** 可作为协调者动态地把任务派给队友、收集结果、跑验证并驱动修复闭环。

**一句话价值主张**：在 IDE 里按角色把活分派到不同模型——贵的模型干脑力活、便宜的 Roam 模型干体力活，彼此还能交接。**Powered by Roam tokens.**

**商业定位**：本扩展是 Roam LLM token 的消费入口。多 Agent × 多模型天然放大 token 吞吐；"成本套利"（贵模型做架构/推理、便宜模型做实现/测试）正是 Roam 的产品本身。

---

## 2. Problem Statement

| 痛点 | 描述 | 影响 |
|------|------|------|
| **单 Agent 局限** | 现有助手（Cline、Copilot、Cursor）多为单 Agent，一个窗口解决所有 | 缺角色分工，复杂项目要人工切上下文 |
| **无协作机制** | 多 Agent 之间无法直接通信协作 | 需手动把 A 的输出复制给 B |
| **Provider 锁定** | 工具绑定单一 LLM，无法按任务选模型 | 无法做成本/能力优化 |
| **并行编码 agent 各自为政** | Conductor/Claude Squad 类工具靠 worktree 隔离，agent 不互通 | 缺结构化的"团队协作"语义 |
| **成本不可见、不可控** | 多模型混用时无统一成本视图 | 难以做成本套利与预算管理 |

**为什么是现在**：AI Coding Agent 生态成熟（Claude Code、Codex CLI、Aider）；多 Agent 框架兴起（CrewAI/AutoGen/LangGraph）；并行 agent 工具（Conductor、Claude Squad、Vibe Kanban）证明了需求但停在"隔离"层面；多 Provider 竞争使"按角色选模型"成为现实可行的成本杠杆。

---

## 3. Vision & Strategy

### Vision
> 成为 VS Code 里"多模型 AI 团队协作 + 成本编排"的事实标准。

### 差异化护城河（已实现的真实差异，而非旧版的"唯一"宣称）
1. **按角色异构 Provider/模型**——尤其是经 Roam 做成本套利：贵模型做脑力活、便宜开源模型做体力活。多数并行 agent 工具绑死单一 provider（Claude Code 系绑 Anthropic）。
2. **真正的 Agent 间通信 + PM 编排**——押"协作"而非"隔离"。PM 是拿到委派工具的协调者 agent，动态分派并驱动验证-修复闭环。
3. **IDE 原生**——深度集成 VS Code（Webview 面板、SecretStorage、Output 频道、状态栏）。
4. **安全与正确性内建**——命令执行默认白名单、文件并发乐观校验、跨文件冲突的验证门兜底。

### MoSCoW（v1）
| 优先级 | 功能 |
|--------|------|
| Must | 多 Session 管理、角色/Provider/模型配置、Agent 间通信、PM 委派、多 Provider、命令安全门、文件并发保护 |
| Should | 工作流模板、Dashboard、上下文持久化、可观测性面板、跨文件验证门 |
| Could | 团队模板市场、可视化工作流编辑器、worktree 隔离策略、成本预算告警 |
| Won't (v1) | 实时协作编辑（VS Code 无多用户实时协作能力）、云端 Agent 托管、企业 SSO |

---

## 4. Personas

- **Alex（独立开发者 / 项目 Owner）**：一人多项目，需要 AI 团队分担架构/实现/审查，且想控成本。
- **Jordan（小团队 Tech Lead）**：审查与方案对比是瓶颈，想用 AI 做初审与多模型交叉验证。
- **Taylor（开源维护者）**：PR/issue 量大，想要 triage → review → changelog 自动化。

---

## 5. User Stories

| # | 当… | 我想要… | 以便… |
|---|-----|---------|-------|
| 1 | 开新项目 | 一键/快速建预配置 AI 团队 | 立即进入开发 |
| 2 | 给 PM 一个目标 | PM 自动拆解并派给合适角色 | 无需我手动编排 |
| 3 | 多文件改动 | 先定接口契约、再分不重叠文件给各 agent | 避免互相踩 |
| 4 | 实现完成 | 自动跑构建/测试，红了回灌修复 | 抓住跨文件破坏 |
| 5 | 切换模型 | 为特定角色换 Provider/模型 | 成本/能力优化 |
| 6 | 重启 VS Code | Agent 恢复之前的对话上下文 | 不丢工作记忆 |
| 7 | 用不同账号 | 每个 Provider 独立加密存 key | 安全、多账号 |

---

## 6. Functional Requirements

> 状态图例：✅ 已实现 · ⚠️ 部分实现 · ❌ 未实现

### FR-1 团队配置
| ID | 需求 | 优先级 | 状态 | 说明 |
|----|------|--------|------|------|
| FR-1.1 | 通过可版本化文件定义团队 | P0 | ✅ | **`.roam/team.json`**（`{ "members": [...] }`），另持久化到 workspaceState |
| FR-1.2 | 每成员配角色/Skill/Provider/模型/SystemPrompt | P0 | ✅ | RoleConfig + AgentConfigBuilder |
| FR-1.3 | 配置团队工作流 | P1 | ⚠️ | 有预置模板；缺条件路由/DAG |
| FR-1.4 | 导入/导出团队模板 | P2 | ❌ | — |
| FR-1.5 | 项目级/全局级配置层级 | P1 | ❌ | v1 单层配置 |

### FR-2 Session 管理
| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| FR-2.1 | 每 Agent 独立运行时（子进程或进程内） | P0 | ✅ |
| FR-2.2 | 启停/重启单个 Agent | P0 | ✅ |
| FR-2.3 | 一键启停整队 | P0 | ✅ |
| FR-2.4 | 状态实时显示（idle/running/error…） | P0 | ✅ |
| FR-2.5 | 崩溃恢复 + 上下文还原 | P1 | ⚠️ | L1 自动重启✅、L2 对话还原✅、L3 工作流状态还原❌（见 §15） |
| FR-2.6 | 并发数上限 | P1 | ✅ |

### FR-3 Agent 间通信
| ID | 需求 | 优先级 | 状态 | 说明 |
|----|------|--------|------|------|
| FR-3.1 | 点对点消息 | P0 | ✅ | MessageBus.send + SessionManager 路由进后端 |
| FR-3.2 | 广播 | P0 | ✅ | broadcast |
| FR-3.3 | 消息路由（自动转发） | P1 | ⚠️ | routeInbound 按消息类型路由；规则硬编码 |
| FR-3.4 | 消息持久化 | P1 | ❌ | 内存环形缓冲（建议降为 P2）；重启丢历史 |
| FR-3.5 | 消息附件（文件/代码） | P1 | ⚠️ | payload.files 已传递，活动流显示路径，无内联预览 |

### FR-4 多 Provider
| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| FR-4.1 | Roam（ComputeVault, OpenAI 兼容）| P0 | ✅（默认）|
| FR-4.2 | Anthropic（Claude 无头 CLI）| P0 | ⚠️ 实现未集成验证（见 §16）|
| FR-4.3 | OpenAI / 任意 OpenAI 兼容网关 | P0 | ✅ |
| FR-4.4 | 本地模型（Ollama/LM Studio）| P1 | ⚠️ 经 OpenAI 兼容/claude 路径可达，未专测 |
| FR-4.5 | 自定义 Provider（endpoint）| P1 | ✅ |
| FR-4.6 | 每 Agent 独立 key（SecretStorage）| P0 | ✅ |

### FR-5 UI
| ID | 需求 | 优先级 | 状态 | 说明 |
|----|------|--------|------|------|
| FR-5.1 | 团队面板 | P0 | ✅ | **Webview**（非 TreeView）：卡片含状态、模型、当前任务、操作 |
| FR-5.2 | 消息/活动日志 | P0 | ✅ | 活动流显示消息内容，可展开 |
| FR-5.3 | Dashboard | P1 | ⚠️ | 统计卡 + token/成本；缺趋势图、预算告警；openai-compat 的 costUsd 暂未估算 |
| FR-5.4 | 状态栏 | P0 | ✅ |
| FR-5.5 | 每 Agent 独立输出 | P0 | ✅ | 每 Agent 一个 Output 频道（assistant + 工具调用）|

### FR-6 工作流引擎
| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| FR-6.1 | 可视化工作流编辑器 | P2 | ❌（建议先用声明式 JSON）|
| FR-6.2 | 预置模板（Feature/Bug/Review/Docs）| P1 | ⚠️ 线性模板已有，无条件分支 |
| FR-6.3 | 条件路由 | P1 | ❌ |
| FR-6.4 | 执行历史 + 回放 | P2 | ❌ |

### FR-7 PM 编排（新增，核心差异化）
| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| FR-7.1 | PM 查看团队（list_agents）| P0 | ✅ |
| FR-7.2 | PM 派活并等结果（assign_task）| P0 | ✅ |
| FR-7.3 | PM 广播（broadcast）| P1 | ✅ |
| FR-7.4 | PM 跑验证门（run_checks）+ 修复闭环 | P1 | ✅ |
| FR-7.5 | PM 并行委派 | P2 | ❌（当前顺序）|

### FR-8 安全与并发（新增）
| ID | 需求 | 优先级 | 状态 |
|----|------|--------|------|
| FR-8.1 | 命令执行审批策略（默认白名单）| P0 | ✅ CommandPolicy |
| FR-8.2 | 文件沙箱（限工作目录，防遍历）| P0 | ✅ |
| FR-8.3 | 文件并发保护（乐观校验）| P0 | ✅ FileCoordinator |
| FR-8.4 | 跨文件依赖失效预警 | P1 | ✅ 读集失效 |
| FR-8.5 | worktree 隔离（大项目）| P2 | ❌ 预留策略位，回退乐观 |

---

## 7. Non-Functional Requirements

| 类别 | 指标（v2 修正） | 备注 |
|------|------|------|
| 性能 | Agent 启动延迟 < 5s | 区分进程内（快）与 CLI 子进程（慢）|
| 性能 | 消息传递延迟 < 500ms (P95) | 进程内总线 |
| 性能 | 5 Agent 内存 < 2GB | 子进程模式每个约 200–300MB；进程内更省 |
| 可靠性 | 崩溃后自动重启 | autoRestart ≤5 次 + 退避 |
| 可靠性 | 上下文不丢（L2）| 每轮快照持久化 |
| 安全 | key 存 SecretStorage（加密）| ✅ |
| 安全 | 命令执行默认拒绝/白名单 | ✅ 防 LLM-RCE |
| 兼容 | VS Code ≥ 1.85；Win/macOS/Linux | ✅ |
| 可用性 | 首次配置 < 5min | 待 UX 优化 |

### 7.1 性能基准（2026-06-02 更新）
> 基准环境：Windows 11, VS Code 1.90, Node 20, Ryzen 9 5900X, 32GB RAM
> 来源标注：**[实测]** 本轮真实跑出；**[估]** 工程估算，待精确测量。

| 指标 | 值 | 来源 | 备注 |
|------|------|------|------|
| ClaudeHeadlessBackend 单轮 TTFT | ~1.59s | **[实测]** | claude-haiku-4-5，stream-json，`ttft_ms=1591` |
| ClaudeHeadlessBackend 单轮总时长 | ~1.66s | **[实测]** | 短任务（"say OK"），`duration_ms=1664` |
| ClaudeHeadlessBackend 单轮成本 | $0.0105 | **[实测]** | haiku，含 cache_read 27.4k tokens |
| 端到端两轮（经 SessionManager） | 2 轮全绿 | **[实测]** | 同进程复用、跨轮上下文保持、成本累计 $0.0506 |
| OpenAICompatBackend 启动延迟 | ~800ms | [估] | 进程内 HTTP，含 TLS 握手 |
| ClaudeHeadlessBackend 启动延迟 | ~3.2s | [估] | 子进程 spawn + CLI 初始化 |
| 单 Agent 内存占用（进程内） | ~45MB | [估] | 不含 LLM 响应缓存 |
| 单 Agent 内存占用（Claude CLI） | ~220MB | [估] | 含 Node 子进程开销 |
| 5 Agent 并发（进程内）内存 | ~380MB | [估] | 远低于 2GB 上限 |
| MessageBus 消息传递延迟（P95） | ~2ms | [估] | 纯内存 pub/sub，无 IO |
| 消息吞吐 | ~12,000 msg/s | [估] | 单线程 EventEmitter |
| `run_checks` 验证门（tsc --noEmit） | ~4.5s | [估] | 中型 TypeScript 项目 |
| 对话快照序列化/恢复 | ~15ms / ~8ms | [估] | 60 条消息，JSON + workspaceState |

> **集成验证结论（2026-06-02）**：ClaudeHeadlessBackend 经真实 `claude` CLI（v2.1.158）全链路验证通过——stream-json 输出形状、单轮、**多轮上下文保持（同一进程）**、成本上报、优雅停止全绿，且经 SessionManager 真实路由（非裸后端）。本轮还修复了一个**潜在死锁**：claude 的 stdout 块缓冲使 `init`/`ready` 直到收到首个 turn 才 flush，而 SessionManager 在 `ready` 前不下发首个 turn——双向等待死锁。修复：进程 spawn 即视为 `ready`（进程起来 = 可收 turn），`system/init` 仅作元数据。此死锁被早期"只发单轮、不经 SessionManager"的测试掩盖，集成验证才暴露。

**后端模式对比**：

| 维度 | OpenAICompatBackend | ClaudeHeadlessBackend |
|------|---------------------|-----------------------|
| 启动速度 | 快（~800ms） | 慢（~3.2s） |
| 内存占用 | 低（~45MB） | 高（~220MB） |
| 工具调用循环 | 自实现（最多 12 轮） | Claude 原生 |
| PM 委派工具 | ✅ 支持 | ❌ 不支持 |
| 适用场景 | 日常开发、PM 编排 | 需要 Claude 原生能力时 |

---

## 8. Architecture Overview

```
┌────────────────────────── VS Code Extension Host ──────────────────────────┐
│  Team Webview │ Activity Feed │ Dashboard │ Status Bar │ Per-Agent Output  │
│        └──────────────┬───────────────────────────────────┘               │
│                 Extension Controller                                       │
│        ┌────────────┬─┴───────────┬───────────────┬──────────────┐         │
│   SessionManager  MessageBus  WorkflowEngine  FileCoordinator  CommandPolicy│
│        │            │  (pub/sub)                  (并发)         (命令门)   │
│        │ routes msgs│                                                      │
│   ┌────┴─────────────────────────────────────────────────────────────┐    │
│   │  AgentBackend (接口)                                              │    │
│   │   ├─ OpenAICompatBackend  (进程内, /v1/chat/completions, 默认)    │    │
│   │   │     └─ WorkspaceTools(沙箱) + TeamTools(PM委派)               │    │
│   │   └─ ClaudeHeadlessBackend (spawn `claude` stream-json)          │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│  Persistence: SecretStorage(keys) · workspaceState(roster + 对话快照)      │
└────────────────────────────────────────────────────────────────────────────┘
```

**关键数据流（入站/出站双向）**：
`messageBus.send(→agent)` → `SessionManager.routeInbound` → `backend.sendUserTurn` → LLM；
`backend` 完成 → `turn_complete` → `SessionManager` 回发 `task.complete`（带 correlationId）→ WorkflowEngine / PM 的 assign_task await 据此推进。

### 技术栈
| 层 | 选型 |
|----|------|
| Extension | TypeScript + VS Code API |
| 默认后端 | 进程内 HTTP（Node fetch）→ OpenAI 兼容 |
| 备用后端 | `child_process.spawn('claude' stream-json)` |
| 持久化 | SecretStorage / workspaceState / `.roam/team.json` |
| UI | Webview（HTML/CSS）+ Output 频道 |
| 测试 | Vitest（47 用例）|
| 构建/发布 | tsc / vsce |

---

## 9. Core Modules Design

### 9.1 AgentBackend（后端抽象，核心设计）
"一个 Agent 怎么跑"由可插拔后端决定，其余模块不关心。
```
interface AgentBackend {
  agentId; pid;
  onEvent(handler): dispose
  start(env): Promise<void>
  sendUserTurn(instruction, attachments?): void
  stop(): Promise<void>
  isAlive(): boolean
  snapshot?(): ConversationSnapshot      // L2 恢复
  restore?(snapshot): void
}
type BackendEvent = ready | assistant | tool_use | turn_complete | log | error | exit
```
- **OpenAICompatBackend（默认）**：进程内直连 `/v1/chat/completions`，自带工具调用循环（最多 12 轮）、token 计量、对话快照与**有界历史**（保留 system + 最近 60 条，按用户回合边界裁剪以不破坏 tool 配对）。
- **ClaudeHeadlessBackend**：spawn `claude -p --output-format stream-json --input-format stream-json`，解析 stream-json。Windows 用 shell 启动 `.cmd`，长 system prompt 折进首轮以避免引号问题。

### 9.2 SessionManager
生命周期 + 总线桥。状态机：`stopped → starting → idle ⇄ running → (error) → stopping → stopped`。负责：入站消息 → 后端；后端 `turn_complete` → 回发 `task.complete` + 累计 usage + **持久化对话快照**；按 role 或 id 解析（`resolveByRoleOrId`）；崩溃自动重启。

### 9.3 MessageBus
进程内 pub/sub：`send/broadcast/reply/subscribe/onType/onAddressed`，模式订阅、TTL 过期、correlation 线程、环形缓冲（默认上限 10000，**内存，不落盘**）。

### 9.4 TeamTools（PM 委派，核心差异化）
仅注入给协调者 agent（role=`pm` 或 allowedTools 含 `delegate`，且跑在进程内后端）：
- `list_agents` 看团队；`assign_task(agent, instruction)` 派活并 **await** 结果（自生成 correlationId 防同步竞态，带超时）；`broadcast`；`run_checks` 跑验证门。

### 9.5 WorkflowEngine
预置线性模板（feature-implement / bug-fix / code-review / docs）。按 role 解析 agent，发 `task.assign`，靠 `task.complete`（correlationId=实例 id）推进。**当前线性，无条件分支**。

### 9.6 FileCoordinator / CommandPolicy
见 §13、§14。

---

## 10. UI/UX Design

- **Team 面板（Webview）**：每个 Agent 卡片含图标/名称/角色、状态徽章、模型、Provider、当前任务（📝）、Skill 标签、操作（Start/Stop/Restart/Remove/**Output**）。
- **Activity Feed（Messages 面板）**：跨 Agent 对话流，显示 from→to（名字而非 uuid）、类型、**消息内容**（任务指令/结果），点击展开；HTML 转义防注入。
- **Per-Agent Output 频道**：每个 agent 自己的 assistant 文本 + 工具调用。
- **Dashboard**：Agent 总览、token、成本（趋势图待做）。
- **状态栏**：`UnodeAi (active/total)`。

### 10.1 核心交互流程

> 以下描述用户的关键操作路径及对应的 UI 状态变化。

#### 流程 A：添加 Agent（向导式）
```
[用户] 点击 Team 面板 "+" 按钮
  → [UI] 弹出 QuickPick：选择角色（PM/Architect/Dev/QA/…）
    → [UI] 输入 Agent 名称（默认 = 角色名）
      → [UI] QuickPick：选择 Provider（roam / openai / custom）
        → [Extension] 读取 SecretStorage，若该 provider 无 key → 提示 "Set API Key"
          → [UI] QuickPick：选择模型（从 provider 拉取可用模型列表）
            → [Extension] 生成 AgentConfig → 写 workspaceState + 可选写 .roam/team.json
              → [UI] Team 面板刷新，新卡片出现（状态 idle），Toast："Agent <name> added"
```

#### 流程 B：PM 编排 Feature（用户观察视角）
```
[用户] Activity Feed 面板选中 PM，Send Message："给这个项目加 JWT 登录"
  → [Extension] 路由到 PM 的 backend，触发 tool_use：list_agents → 返回团队信息
    → [UI] Activity Feed 新增条目："PM → (tool) list_agents"（可展开看返回结果）
  → [Extension] PM 决定派给 Architect，assign_task("设计 JWT 认证接口契约")
    → [UI] Activity Feed 新增条目："PM → Architect: 设计 JWT 认证接口契约"
    → [UI] Architect 卡片状态变 running（📝 设计 JWT…）
  → [Extension] Architect 返回结果，PM 收到 task.complete
    → [UI] Activity Feed 新增条目："Architect → PM: [完成]"（可展开看内容）
    → [UI] Architect 卡片变 idle
  → [Extension] PM 继续派给 Senior Developer（实现）、QA（测试）…
    → [UI] 重复上述条目流动，最终 PM 汇总结果
```

#### 流程 C：用户查看单个 Agent 输出
```
[用户] 在 Team 面板某 Agent 卡片上点击 "Output" 按钮
  → [Extension] 创建/聚焦该 Agent 的 OutputChannel（name = "UnodeAi: <AgentName>")
  → [UI] Output 频道显示：
       ───────────────────────────────
       [Assistant] 思考过程…
       ───────────────────────────────
       [Tool: run_command] {command: "npm test"}
       [Tool Result] {stdout: "…", exitCode: 0}
       ───────────────────────────────
       [Assistant] 测试通过，结果…
       ───────────────────────────────
```

#### 流程 D：Dashboard 用户旅程（目标：查看成本）
```
[用户] 命令面板 → "UnodeAi: Show Dashboard"
  → [UI] Dashboard Webview 打开，默认显示：
       ┌──────────────────────────────────────────────────────┐
       │  UnodeAi Dashboard                                  │
       │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
       │  │ 活跃 Agent│  │ 总消息数 │  │ 总 Token │  │ 预估成本 │ │
       │  │    3    │  │  1,247  │  │  845K   │  │  $0.42   │ │
       │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
       │  ┌─────────────────────────────────────────────────┐  │
       │  │  Token 消耗趋势（近 7 天，柱状图，待实现）         │  │
       │  └─────────────────────────────────────────────────┘  │
       │  ┌──────────────┐ ┌──────────────┐                  │
       │  │ Agent 排行    │ │ Provider 分布 │                  │
       │  │ PM: 45%      │ │ roam: 80%   │                  │
       │  │ Dev: 30%     │ │ openai: 20% │                  │
       │  └──────────────┘ └──────────────┘                  │
       └──────────────────────────────────────────────────────┘
```

---

## 11. Data Model

```typescript
interface AgentConfig {
  id; name; role; skill; skills?;
  provider: { providerId; apiKeySecretName };
  model; systemPrompt; autoApprove; allowedTools;
  maxTokens?; temperature?; workingDirectory?; env?;
  backend?: 'claude' | 'openai-compat';   // 缺省按 provider 推断
  baseUrl?;                                // HTTP 后端 endpoint（Roam/算力仓等）
  autoRestart?;
}
interface ConversationSnapshot { version: 1; messages: unknown[]; }
```

### 持久化
| 数据 | 位置 | 说明 |
|------|------|------|
| 团队配置 | `.roam/team.json` + workspaceState | 可版本控制 |
| API Keys | SecretStorage（`roam.secret.*`）| 加密，不入 Git |
| 对话快照 | workspaceState（`roam.snapshot.<id>`）| L2 恢复 |
| 消息历史 | 内存 | 重启丢失（待落盘）|

### 11.2 `.roam/team.json` 完整示例

```json
{
  "version": "1.0",
  "name": "My Project Team",
  "description": "Full-stack team with PM orchestration",
  "members": [
    {
      "id": "pm-001",
      "name": "Project Manager",
      "role": "pm",
      "skill": "project-management",
      "provider": { "providerId": "roam", "apiKeySecretName": "ROAM_API_KEY" },
      "model": "deepseek-v4-pro",
      "systemPrompt": "You are the Project Manager...",
      "autoApprove": false,
      "allowedTools": ["read", "search", "delegate"],
      "maxTokens": 8192,
      "temperature": 0.7
    },
    {
      "id": "arch-001",
      "name": "System Architect",
      "role": "architect",
      "skill": "architecture",
      "provider": { "providerId": "roam", "apiKeySecretName": "ROAM_API_KEY" },
      "model": "deepseek-v4-pro",
      "systemPrompt": "You are a System Architect...",
      "autoApprove": false,
      "allowedTools": ["read", "write", "search", "execute"],
      "maxTokens": 8192
    },
    {
      "id": "dev-001",
      "name": "Senior Developer",
      "role": "senior-dev",
      "skill": "code-generation",
      "provider": { "providerId": "roam", "apiKeySecretName": "ROAM_API_KEY" },
      "model": "deepseek-v4-flash",
      "systemPrompt": "You are a Senior Developer...",
      "autoApprove": false,
      "allowedTools": ["read", "write", "search", "execute"],
      "maxTokens": 4096
    },
    {
      "id": "qa-001",
      "name": "QA Engineer",
      "role": "tester",
      "skill": "testing",
      "provider": { "providerId": "roam", "apiKeySecretName": "ROAM_API_KEY" },
      "model": "deepseek-v4-flash",
      "systemPrompt": "You are a QA Engineer...",
      "autoApprove": false,
      "allowedTools": ["read", "write", "search", "execute"],
      "maxTokens": 4096
    }
  ],
  "workflows": [
    {
      "id": "feature-dev",
      "name": "Feature Development",
      "steps": [
        { "from": "user", "to": "pm", "action": "assign", "autoTransition": true },
        { "from": "pm", "to": "architect", "action": "design", "autoTransition": true },
        { "from": "architect", "to": "pm", "action": "handoff", "autoTransition": true },
        { "from": "pm", "to": "senior-dev", "action": "implement", "autoTransition": true },
        { "from": "senior-dev", "to": "pm", "action": "handoff", "autoTransition": true },
        { "from": "pm", "to": "tester", "action": "test", "autoTransition": true },
        { "from": "tester", "to": "pm", "action": "complete", "autoTransition": false }
      ]
    }
  ],
  "settings": {
    "maxConcurrentAgents": 3,
    "logLevel": "info",
    "messageRetentionDays": 7,
    "autoSaveInterval": 30
  }
}
```

---

## 12. Communication Protocol

- **OpenAI 兼容后端 ↔ 网关**：`POST {baseUrl}/chat/completions`，`Authorization: Bearer <key>`，标准 `messages`/`tools`/`tool_calls`。已对 Roam ComputeVault 真实验证（chat、tool_calls、usage）。
- **Claude 后端 ↔ CLI**：stdin/stdout NDJSON（stream-json）。
- **Agent ↔ Agent（经 Extension）**：MessageBus `Message`（`from/to/type/payload/correlationId/...`），类型含 `task.assign/complete`、`review.request/feedback`、`ask.question/answer`、`handoff`、`broadcast.info`、`system.error`。

---

## 13. Security & Command Policy

### 13.1 命令执行门（CommandPolicy，防 LLM-RCE）
`run_command` 的命令是 LLM 生成的，等于潜在任意代码执行。策略 `roam.commandApproval`：
- `none`（**默认，v2.8 起**）：禁止执行——开箱即默认拒绝(default-deny)；
- `allowlist`：命令须前缀匹配 `roam.allowedCommands`，且**不含 shell 控制符**（`;`/`&&`/`|`/重定向/反引号/`$()`），防走私第二条命令；
- `all`：放开（仅沙箱/VM）。
任何模式都套**灾难命令硬黑名单**（`rm -rf /`、`curl|sh`、`sudo`、fork bomb、`mkfs`、`format C:` 等）。命令执行带超时（默认 120s）。
> **v2.8 收紧**：默认 `allowlist`→`none`（默认不执行任何命令）；默认 allowlist 收窄（移除宽泛的 `node`/`npm run`/`ls`/`cat`，保留 `npm test`/`npm run build`/`npm run compile`/`npx tsc`/`git status|diff|log`）。**影响**：`run_checks` 与 gated 工作流的验证门默认不运行——需用户显式设 `roam.commandApproval='allowlist'` + `roam.verifyCommand`。门被 policy 拦时，gated 工作流会**暂停并给出启用指引**（不再误判为质量失败去升 tier/重试）。

### 13.2 文件沙箱
Agent 只能读写其 `workingDirectory`（默认工作区根）。**v2.8 起**除字符串 `../` 拒绝外，再加 **realpath 校验**（读/列/写均解析真实路径；写操作回溯到最近已存在祖先再校验）——堵住 **symlink / Windows junction** 越界沙箱。

### 13.3 密钥与隐私
所有 key 存 SecretStorage；绝不入配置/日志/Git；每 Provider 独立 key。数据本地存储，无 telemetry（除非显式 opt-in）。

### 13.4 验证门（run_checks）的安全模型
`run_checks` / gated 工作流跑的是**用户配置的** `roam.verifyCommand`（非 LLM 选）。**v2.8 起**它也走 `CommandPolicy.check()`（PM `run_checks` 与 gated `verifyCommand` 统一过门）——即默认 `none` 下不执行，须显式 allowlist。这与早期"验证门不过 CommandPolicy"的设计**有意改变**：以"默认不执行"换取更小的攻击面，代价是验证-修复闭环需用户主动启用。

### 13.4b MCP 最小权限（v2.8 强化）
- **执行期授权**：`MCPHub.executeTool` 不再只校验"server 已注册"，而是校验该 (namespaced) 工具**对当前 agent 的 grant 真实可用**（防混淆代理/越权调用别 agent 的 server 工具）。
- **审批指纹**：敏感 server 审批从"server id"改为 **workspace + 启动指纹(sha256: command/args/env/url/timeout)**——改配置即失效重新审批；同一过滤在生成 claude `--mcp-config` 前也应用（claude agent 不能绕过）。默认 stdio/http/sse 或带 env 的 server 即视为敏感、需审批。
- **子进程环境最小化**：stdio MCP 子进程只继承 PATH 等 OS 基线，**不灌入扩展进程的全量 env**（API key 不外泄给 `npx`）。

### 13.4c Webview CSP（v2.8）
4 个 webview 统一加 CSP：Dashboard `script-src 'none'`；Team/MessageLog/Settings 用 **crypto 级 nonce**（`crypto.randomBytes`）；内联 onclick 改事件委托；Settings 的密钥操作限定在快照里的 provider 名。`style-src` 暂保留 `'unsafe-inline'`（内联 `<style>`，低风险，后续可外联）。

### 13.5 威胁模型与防护矩阵

> 基于 STRIDE 方法，识别扩展面临的实际威胁及当前防护。

| 威胁 | 描述 | 风险等级 | 当前防护 | 待加强 |
|------|------|---------|---------|--------|
| **Prompt Injection → 工具参数篡改** | LLM 输出被注入恶意指令，导致 `run_command` 执行非预期操作 | 高 | CommandPolicy 白名单 + 灾难命令黑名单 + shell 控制符过滤 | 增加语义校验（如禁止命令中出现 `curl` + `\|` 同现） |
| **Agent 横向移动（A2A 攻击）** | 一个被攻破的 Agent 通过 MessageBus 向其他 Agent 发送恶意 payload | 中 | payload 为纯文本 JSON，无代码执行；`from` 字段由 SessionManager 强制设置，不可伪造 | 增加 Agent 间消息签名/验签 |
| **密钥泄露** | Agent 通过 `read_file` 读到 `.env`、Git 历史中的密钥 | 中 | SecretStorage 隔离；Agent 文件沙箱限工作目录；日志过滤 | 增加敏感路径黑名单（`.env`、`.git`） |
| **资源耗尽（DoS）** | 恶意/异常 Agent 无限循环工具调用、生成超大文件 | 低 | 工具调用循环上限 12 轮；token 上限；`maxTokens` 限制 | 增加单 Agent CPU 时间上限 |
| **供应链污染** | `.roam/team.json` 被篡改植入恶意配置 | 低 | 文件沙箱；无外部网络拉取 | 增加 team.json schema 校验 + 签名 |
| **LLM-RCE（远程代码执行）** | LLM 生成并执行恶意 shell 命令 | 高 | CommandPolicy 多层拦截；超时机制；工作目录限制 | 增加更细粒度 allowlist（正则匹配而非前缀） |

**已知风险敞口**：
1. **ClaudeHeadlessBackend 的 stream-json 解析**：未对 LLM 输出做完整 schema 校验，理论上存在 JSON 注入导致解析异常的风险。
2. **工作流模板 JSON 注入**：WorkflowEngine 解析模板时未做深度校验， malformed JSON 可能导致扩展崩溃。
3. **Output Channel 内容注入**：Agent 输出直接写入 OutputChannel，若包含 VS Code 控制序列理论上可能影响 UI（当前 HTML 转义仅在 Activity Feed 中，Output Channel 未转义）。

---

## 14. Concurrency & Cross-File Consistency

### 14.1 文件并发（同文件 write-write）
策略 `roam.concurrencyStrategy`：
- `optimistic`（**默认**，已实现）：无锁。每 agent 记 read 时的文件 hash；write 时与磁盘当前内容比对（compare-and-swap），不一致/未读过则拒绝并提示重读。不相交文件全并行；无锁、无死锁、无任务时长阻塞。
- `worktree`（**规划中**，大项目）：每 agent 一个 git worktree + 合并（Conductor/Claude Squad 式）。当前未实现，选择后回退乐观并发。

### 14.2 跨文件语义冲突（A 改 X，B 改了 X 依赖的 Y）三层防御
单文件并发挡不住"跨文件依赖被改坏"。三层：
1. **L1 读集失效预警**：B 写 Y 时，标记所有读过 Y 的其他在飞 agent；其下次工具调用收到"你依赖的 Y 变了，先重读"。
2. **L2 验证门（兜底）**：PM `run_checks` 跑构建/测试整个项目——唯一可靠的跨文件破坏检测器（编译器/测试）；红了回灌 PM → 派定向修复 → 再验，直到绿。
3. **L3 契约先行（预防）**：architect 先定公共契约（签名/类型/API 形状），契约视为固定、不可静默改；PM 据此给各 agent 划不重叠文件范围。

---

## 15. Crash Recovery & Persistence

恢复分三级（如实标注）：
- **L1 进程重启**（✅）：异常退出后 `autoRestart` 退避重启（≤5 次）。
- **L2 对话上下文还原**（✅）：每轮完成后把后端对话快照存 workspaceState；重启时 `restore()` 注入，不重复 system 消息；历史有界（防膨胀）。
- **L3 工作流/任务状态机还原**（❌）：进行中的工作流实例状态尚未持久化，重启后丢失。

消息历史（MessageBus）仍为内存，重启丢失（落盘待办，建议 P2）。

---

## 16. Implementation Status

> 本章如实记录"已做 vs 未做"，并修正旧版/外部评审中的事实错误。

### 已实现且测试覆盖（169 个 Vitest 用例，实测 2026-06-02 v2.8 轮 / Codex 硬化 + review 跟进后）
- **Skill 即能力声明（段1）**：`AgentSkill.implementation`（builtin/composite/mcp-server）；`SkillResolver` 把 skills 推导成 `allowedTools` 能力令牌（环路安全），角色模板不再手写工具
- **MCP 集成引擎（段2，后端感知）**：`MCPHub`（仅 openai-compat，注入式 client、`serverId__tool` 命名空间、default-deny、per-skill 过滤、超时、`${VAR}` 经 SecretStorage 解析）；`buildClaudeMcpConfig`（claude 原生 `--mcp-config`）；`RealMcpClient`（懒加载 SDK，未装也能 build/test）
- AgentBackend 抽象 + OpenAICompatBackend（已对真实 Roam 端点验证：chat / tool_calls / usage）
- **ClaudeHeadlessBackend 已对真实 `claude` v2.1.158 全链路集成验证**（单轮 + 多轮上下文 + 成本上报 + 经 SessionManager 路由；修复了 ready/init 块缓冲死锁）
- **OpenAICompatBackend HTTP 超时 + 退避重试**（AbortController 超时；network/timeout/429/5xx 退避重试，4xx 快速失败；5 个用例）
- SessionManager 双向路由、PM 委派（TeamTools）、WorkflowEngine 推进
- CommandPolicy（命令门，防注入/灾难命令）
- FileCoordinator（乐观并发 + 读集失效）
- 跨文件三层防御（run_checks 验证门 + 契约先行 prompt）
- 对话上下文持久化（L2）+ 有界历史
- SecretStorage、团队持久化、可观测性（活动流 + 每 agent Output）

### 已知未做 / 风险（按优先级）

> P0+P1 大轮（2026-06-02，v2.6）已清掉下表多数中优项；进度权威源见 [docs/STATUS.md](docs/STATUS.md)。

| 项 | 优先级 | 说明 |
|----|--------|------|
| ~~模型降级（fallback）~~ | 中 | ✅ 已做：连续 2 次失败 + `fallbackModel` → `SessionManager` 自动切换并发 `session.modelSwitched` |
| ~~消息历史落盘~~ | 中 | ✅ 已做：MessageBus export/import + workspaceState 防抖落盘 |
| ~~L3 工作流状态还原~~ | 中 | ✅ 已做：WorkflowEngine export/restore，重启重发当前步续跑 |
| ~~Dashboard 趋势图 + 成本估算~~ | 中 | ✅ 已做：成本趋势 sparkline + Agent 排行 + Provider 分布；costUsd 估算 v2.4 已做 |
| ~~API Key 可见性~~ | 中 | ✅ 已做：Settings 面板（`roam.openSettings`），只显示已设/未设、不 reveal |
| MCP server live 验证 | 中 | 引擎/审批门✅；对真实 github/playwright server 的联网验证仍待（需 token，本地跑）|
| 在 UI 内编辑已建 agent | 中 | 仍需删后重建（Settings 面板已留 agent 编辑落点，未实现）|
| Skill 真实落地 | 中 | 现仅作为 prompt 元数据 |
| worktree 并发策略 | 低 | 已留扩展点 |
| PM 并行委派 | 低 | 现顺序 |
| ~~打包用 `images/icon.png`~~ | 低 | ✅ 已补（官方 WeRoam logomark） |

### 修正外部评审的事实性偏差
- ❌"文件冲突检测是占位/未实现" → **实为完整实现**（乐观 CAS + 读集失效，含 10 个测试）。
- ❌"支持 `.teamrc`" → **实为 `.roam/team.json`**。
- ❌"团队面板是 TreeView" → **实为 Webview**。
- ❌"消息附件仅显示数量" → 活动流已显示文件路径与完整内容。
- ⚠️ 内存评估按"Claude 子进程"计 → 默认后端是进程内，更省。

---

## 17. Competitive Analysis

| 产品 | 形态 | 多 Agent | 多 Provider | Agent 间通信 | PM 编排 | 备注 |
|------|------|:---:|:---:|:---:|:---:|------|
| Cline / Roo Code / Kilo Code | VS Code 扩展 | ⚠️(子任务) | ✅ | ❌ | ⚠️ | 单对话树派生子任务 |
| GitHub Copilot | 扩展 | ❌ | ⚠️ | ❌ | ❌ | |
| Cursor（background agents）| 闭源 IDE | ✅ | ⚠️ | ❌ | ❌ | 不让自由混 provider |
| **Claude Code（subagents）** | CLI | ✅ | ❌(仅 Anthropic) | ⚠️ | ⚠️ | 单进程内子 agent |
| **Codex CLI** | CLI | ❌ | ❌ | ❌ | ❌ | 单 agent |
| Conductor / Claude Squad / Vibe Kanban | App/TUI/看板 | ✅ | ⚠️ | ❌(隔离) | ❌ | worktree 隔离，不通信 |
| CrewAI / AutoGen / LangGraph | 框架 | ✅ | ✅ | ✅ | ✅ | 非 IDE 集成 |
| **UnodeAi** | VS Code 扩展 | ✅ | ✅ | ✅ | ✅ | IDE 内 + 异构 provider + 通信 + PM + 成本套利 |

**差异化**：IDE 内、按角色异构 provider（成本套利经 Roam）、真正的 A2A 通信 + PM 编排、安全/并发内建。最直接竞争来自 Claude Code subagents（绑 Anthropic）与 Conductor/Squad 类（靠隔离、不通信）。

---

## 18. Roadmap

### Phase 1 — MVP（2026-05 ~ 2026-06，已完成 ✅）
| 功能 | 估时 | 状态 |
|------|------|------|
| 脚手架 + 构建链 | 2 天 | ✅ |
| 团队配置系统（`.roam/team.json`）| 3 天 | ✅ |
| Session 管理（启停/重启/并发控制）| 4 天 | ✅ |
| AgentBackend 双后端抽象 | 4 天 | ✅ |
| MessageBus + 消息路由 | 3 天 | ✅ |
| PM 委派工具（TeamTools）| 3 天 | ✅ |
| 命令安全门（CommandPolicy）| 2 天 | ✅ |
| 文件并发 + 跨文件三层防御 | 4 天 | ✅ |
| 上下文持久化（L2）| 2 天 | ✅ |
| Webview UI（Team/Activity/Dashboard）| 4 天 | ✅ |
| 测试覆盖（Vitest 47 用例）| 3 天 | ✅ |
| **总计** | **~34 天** | **6 周** |

### Phase 2 — 稳定与体验（2026-Q3，进行中）
| 功能 | 优先级 | 估时 | 关键路径 |
|------|--------|------|----------|
| ~~ClaudeHeadlessBackend 集成验证~~ | 高 | ✅ 完成 | 真实 claude 全链路验证，修复 ready 死锁 |
| ~~HTTP 超时/重试~~（模型降级仍待做）| 中 | ✅ 超时/重试完成 | 影响稳定性 |
| 消息落盘 + L3 工作流状态还原 | 中 | 3 天 | **Phase 3 前提** |
| Dashboard 趋势图 + 成本估算 | 中 | 2 天 | — |
| UI 内编辑 agent、一键默认团队 | 中 | 2 天 | 改善 UX |
| 打包 + Marketplace 发布 | 高 | 2 天 | **Go-to-Market 前提** |
| **Phase 2 总计** | | **~14 天** | **3 周** |

### Phase 3 — 进阶（2026-Q4）
| 功能 | 优先级 | 估时 | 依赖 |
|------|--------|------|------|
| Skill 真实加载（非仅 prompt 元数据）| 中 | 5 天 | Phase 2 完成 |
| worktree 隔离策略 | 低 | 5 天 | Phase 2 完成 |
| PM 并行委派 | 低 | 3 天 | Phase 2 完成 |
| 可视化工作流编辑器 | 低 | 5 天 | Phase 2 完成 |
| 团队模板市场 | 低 | 4 天 | Phase 2 完成 |
| **Phase 3 总计** | | **~22 天** | **5 周** |

**关键里程碑**：
- **2026-06**：MVP 代码冻结，内部测试
- **2026-07**：Phase 2 完成，Marketplace 发布 v1.0
- **2026-09**：Phase 3 完成，发布 v2.0 Pro

---

## 19. Go-to-Market

- **漏斗**：扩展默认 Provider = Roam（ComputeVault）；新建 agent 预填 Roam endpoint；多 agent × 多模型放大 token 消费。
- **渠道**：Marketplace（关键词 multi-agent / AI team / multi-model / Roam）、GitHub、Product Hunt、r/ChatGPTCoding、演示视频（"PM 指挥一支 AI 团队完成一个 feature"）。
- **定价（示意）**：Free（≤2 agent）/ Pro（≤5 agent + Dashboard）/ Team（≤10 agent + 模板）。Roam token 按量计费独立于扩展订阅。

---

## 20. Appendix

### A. 术语
| 术语 | 定义 |
|------|------|
| Agent | 运行在独立 Session、有角色/Skill/模型配置的 AI 实例 |
| Backend | 驱动 Agent 运行的可插拔运行时（OpenAICompat / ClaudeHeadless）|
| PM / Coordinator | 拿到委派工具、编排其余 agent 的 Agent |
| TeamTools | PM 的委派工具集（list_agents/assign_task/broadcast/run_checks）|
| MessageBus | Agent 间消息路由总线 |
| FileCoordinator | 文件并发协调（乐观/worktree）|
| CommandPolicy | 命令执行审批策略 |
| ConversationSnapshot | 可序列化的对话上下文，用于 L2 恢复 |
| Roam / ComputeVault | Roam 的 OpenAI 兼容 LLM token 网关 |

### B. 参考
- VS Code Extension API · Claude Code（Agent Skills/headless）· Conductor / Claude Squad / Vibe Kanban · CrewAI / AutoGen / LangGraph

### C. 测试策略

| 类别 | 覆盖范围 | 工具 | 用例数 | CI |
|------|---------|------|--------|----|
| 单元测试 | AgentBackend、SessionManager、MessageBus、CommandPolicy、FileCoordinator | Vitest | 47 | ✅ |
| 集成测试 | OpenAICompatBackend ↔ Roam ComputeVault（真实端点） | Vitest + `node-fetch` | 6 | 手动 |
| E2E 测试 | VS Code Extension Test Runner | `@vscode/test-e2e` | 0（待建）| — |
| 安全测试 | CommandPolicy 注入用例、灾难命令黑名单 | Vitest | 12 | ✅ |

**集成测试策略**：与 LLM 真实 API 的集成测试在 CI 中不跑（需 API Key），采用"本地手动 + mock 兜底"：
- 本地开发：配 `ROAM_API_KEY` 跑真实 Roam 端点，验证 chat/tool_calls/usage
- CI：用 `nock` mock `/v1/chat/completions`，返回 fixture 数据，保证代码路径覆盖

**E2E 测试待建**：
- 扩展激活 → 添加 Agent → 启动 → 发送消息 → 观察 Activity Feed
- 当前阻塞：VS Code Extension Test Runner 配置复杂，需 `vscode-test` + `playwright-vscode` 组合

### D. 架构决策记录（ADR）

#### ADR-1：默认后端为何选进程内 HTTP（OpenAICompatBackend）而非子进程？
- **考虑**：子进程（ClaudeHeadlessBackend）隔离好但启动慢（~3.2s）、内存高（~220MB/Agent）、不支持 PM 委派工具
- **决策**：默认进程内 HTTP（~800ms 启动，~45MB/Agent），ClaudeHeadlessBackend 作为可选后端
- **影响**：PM 编排只能在进程内后端使用（TeamTools 需直接调用 Extension API）

#### ADR-2：为何乐观并发作为默认？
- **考虑**：worktree 隔离（Conductor/Claude Squad 式）确实无冲突，但实现复杂、需 git 操作、大项目才需要
- **决策**：默认乐观并发（CAS + 读集失效），worktree 作为可选策略（预留扩展点）
- **影响**：日常开发体验好（全并行），极端场景（>5 Agent 改同一文件）需靠 L2 验证门兜底

#### ADR-3：为何 PM 委派是 `await` 同步而非异步回调？
- **考虑**：异步回调（event-driven）解耦好但代码复杂（需状态机追踪 correlationId）
- **决策**：`await assign_task()` 同步等待结果（内部用 correlationId + Promise 封装），PM 的 system prompt 写死"派一个等一个"
- **影响**：当前顺序委派，并行委派（FR-7.5）需后续改造为 Promise.all

#### ADR-4：为何 MessageBus 是内存总线而非持久化队列？
- **考虑**：持久化队列（如 SQLite/LevelDB）可保证重启不丢消息，但引入 IO 延迟和序列化复杂度
- **决策**：内存 EventEmitter + 环形缓冲（上限 10,000），重启丢历史
- **影响**：调试时无法追溯重启前的消息；落盘为 P2 待办

### E. 国际化与可访问性

**国际化（i18n）**：
- 当前状态：UI 全英文，无 i18n 框架
- 计划：v1.x 暂无中文界面计划（目标用户为英文开发者）；v2.0 评估引入 `vscode-nls` 做本地化
- 已知：RoleConfig 中的 systemPrompt 为英文，但支持用户自定义中文 prompt

**可访问性（a11y）**：
- 当前状态：Webview 使用 VS Code 主题色变量（`var(--vscode-*)`），支持高对比度；但无键盘导航、无 ARIA 标签
- 待改进：
  - Team 面板卡片增加 `tabindex` 和 `aria-label`
  - Activity Feed 条目增加键盘展开（Enter/Space）
  - Dashboard 表格增加 `role="table"`、`role="row"`、`role="cell"`
  - 颜色对比度验证（当前状态徽章颜色 `#28a745` / `#dc3545` 需验证 WCAG AA）

### F. 变更记录
| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-05-31 | 初始（CrewCode）|
| v2.0 | 2026-06-01 | 更名 UnodeAi；对齐实现；补后端/PM/安全/并发/持久化章节；新增实现状态；修正事实偏差 |
| v2.1 | 2026-06-01 | 补充性能基准、Roadmap 时间表、威胁模型、测试策略、ADR、国际化/i18n |
| v2.2 | 2026-06-02 | ClaudeHeadlessBackend 真实集成验证（单轮+多轮+成本）；修复 ready/init 块缓冲死锁；OpenAICompatBackend HTTP 超时+退避重试；性能基准补实测值并标注来源；测试 47→52 |
| v2.3 | 2026-06-02 | Skill 即能力声明（段1，SkillResolver 推导 allowedTools）；MCP 集成引擎（段2，后端感知 MCPHub + claude --mcp-config + 懒加载 SDK）；修订 docs/MCP_Skills_Integration.md v2；测试 52→87。MCP 收尾未做：真实 npm i + live 验证、UI 面板/命令、requiresApproval 审批 |
| v2.4 | 2026-06-02 | TTV 冲刺（回应 GLM/Cline 评审）：添加 Agent 模型选择改 QuickPick + 可远程配置 ModelCatalog（/v1/models + roam.modelCatalogUrl + 静态兜底）；添加 Agent 自定义名称 + 去重；One-Click Demo Team 命令 + 空状态 CTA；costUsd 估算（ModelPricing 价目表，SessionManager 注入，Dashboard 自动显示）。测试 87→98 |
| v2.5 | 2026-06-02 | 文档体系整理：新增 [README](README.md)（项目入口 + 文档地图）与 [docs/STATUS.md](docs/STATUS.md)（进展+下一步唯一权威源）；全文档加交叉引用；评审文档标注为时点快照。实测校正：测试 **111 全绿**（本 PRD 历史用例数 47/87/98 为各版本时点值）。下一步工作方向统一迁移至 STATUS.md 维护。 |
| v2.6 | 2026-06-02 | **P0+P1 大轮**（一次清掉发布前与稳定性两档）：P0 — 补官方 WeRoam logo 图标、`vsce package` 跑通出干净 vsix、Dashboard 成本可视化（趋势 sparkline + Agent 排行 + Provider 分布）。P1 — 模型 fallback（`fallbackModel` + `session.modelSwitched`）、消息落盘 + L3 工作流还原、MCP `requiresApproval` 审批门、Settings 面板 + API Key 可见性（`roam.openSettings`，不 reveal）、E2E scaffold（`@vscode/test-cli`，`test-e2e/`）、拆 extension.ts（对话框入 `src/dialogs.ts`）+ 事件类型化（`SessionEventData`，去 any）。测试 **98→130**。仅剩需账号/联网的收尾：`vsce publish`、MCP 对真实 server 的 live 验证。详见 [docs/STATUS.md](docs/STATUS.md)。 |
| v2.8 | 2026-06-02 | **Codex 发布硬化 pass + review 跟进**（详见 [docs/CODEX_RELEASE_HARDENING_LOG.md](docs/CODEX_RELEASE_HARDENING_LOG.md)、[docs/AUDIT_NOTES.md](docs/AUDIT_NOTES.md)）：文件沙箱 realpath 防 symlink/junction 越界；MCP 执行期授权 + 审批指纹 + 子进程 env 最小化；命令默认 `allowlist`→`none` 且 run_checks/verifyCommand 过 CommandPolicy；4 webview CSP/nonce；team.json schema 校验；ESLint + GitHub Actions CI + MIT LICENSE。**review 跟进**：nonce 改 `crypto.randomBytes`(原 Math.random)；gated 工作流区分"门被 policy 拦(配置问题→暂停给指引)"与"质量失败(升 tier 重试)"；同步 §13.1/§13.2/§13.4 与文档。测试 **160→169**。遗留(已记录)：package-lock 未同步 e2e devDeps → `compile:e2e` 不过、CI 用 `npm install` 非 `npm ci`；未 bundle。 |
| v2.7 | 2026-06-02 | **P2「成本套利真机制」大轮**：`SessionManager.setModel` 热切换 + `TierController`（tier→模型矩阵，按 provider 解析）；`WorkflowEngine` `gated` 类型（run_checks 客观门 → pass 降 tier / fail 升 tier 重试 ≤maxRetries / 耗尽转人工，内置 `feature-gated` 模板 + `runVerifyChecks` 接线）；`TokenCounter` + 70% 软门 / 80% 硬门（`OpenAICompatBackend` 工具循环内拒绝继续防 128K 退化）；工作流条件路由（`resolveBranch` + `step.branches`，if/else + loop + `MAX_TRANSITIONS`，`run()` 可收模板对象为 req4 铺路）；UI 内编辑 agent（`showEditAgentDialog` + Team 卡片 Edit + `roam.agentEdit`：改名/换模型/fallback）；`TeamMcpBridge`（把 TeamTools 适配成 MCP client，#12 可复用核心）。测试 **130→160**。仍待独立 epic / 外部：#12 把 TeamMcpBridge 托管为本地 MCP 端点 + claude `--mcp-config` + live 验证、结构化 Session Digest 压缩、req4（tier/gated 进 `.roam/team.json`）、`vsce publish`。详见 [docs/STATUS.md](docs/STATUS.md)。 |
