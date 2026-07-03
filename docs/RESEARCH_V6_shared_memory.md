# V6 调研：共享工作记忆 / 项目知识库

> 产出给 Claude 做架构决策。调研 UnodeAi 多 agent 协作中跨 agent 共享上下文的方案。
> 日期：2026-06-08 · 作者：DeepSeek (Solo)

---

## 1. 同类做法调研

### 1.1 Cline — `.clinerules` + Cline Memory

**项目记忆（.clinerules）：**
- 数据结构：单一 Markdown 文件，位于项目根目录。
- 写入时机：人类手动编辑；agent 不写入。
- 读取方式：每次对话开始时注入 system prompt（`<project_context>` 包裹）。
- 冲突处理：无——人类单写者，不存在 agent 并发写。

**Cline Memory（持久化记忆）：**
- 数据结构：文件-backed KV store（`~/.cline/memory/` 下 JSON 文件）。
- 写入时机：agent 在对话中主动调用 `update_memory` 工具（key + value）。
- 读取方式：每次对话时从 KV store 加载相关记忆注入 system prompt；agent 也可通过工具查询。
- 冲突处理：key 级别 last-write-wins；单 agent 场景无并发问题。
- 评价：简单实用，但 KV 缺乏结构——大量记忆后难以发现、易腐烂。

### 1.2 Kilo Code — `.clinerules` + Orchestrator 模式

- 数据结构：`.clinerules`（同 Cline）+ Modes 配置。
- 跨 agent 共享：Orchestrator 通过 prompt 级联转发子任务结果，无持久化的共享记忆。子 agent 之间不直接通信，全部经 Orchestrator 中转。
- 评价：Orchestrator 本身充当了"活记忆"——但一旦对话结束，所有上下文丢失。适合单次会话内的多步委派，不适合跨会话持续性知识。

### 1.3 Cursor — `.cursorrules` + Notepads + Rules for AI

- 数据结构：
  - `.cursorrules`：项目级 Markdown 规则文件，注入 system prompt。
  - "Rules for AI"：Settings UI 中的结构化规则片段（可多段）。
  - **Notepads**：工作区内的共享便签文件（`.cursor/notepads/*.md`），人类和 AI 都可读写。
- 写入时机：Notepads 由人类或 agent 在对话中编辑（agent 使用 `edit_file` 工具）。
- 读取方式：`.cursorrules` + Rules 注入 system prompt；Notepads 由 agent 按需 `read_file`。
- 冲突处理：Notepads 本质是文件——依赖编辑器的文件同步 + 用户手动解决冲突。
- 评价：Notepads 是最接近"agent 可写的共享记忆"的轻量方案——本质是文件系统作为共享状态，成本极低。但缺乏结构、查询能力、和并发控制。

### 1.4 Claude Projects / Claude Code — 项目知识库 + CLAUDE.md

- **Claude Projects（Web UI）：**
  - 数据结构：上传的文档集 + "Custom Instructions"（文本块）。
  - 写入时机：人类在项目设置中上传/编辑；agent 不可写。
  - 读取方式：每次对话自动注入 context window。
  - 评价：静态、人类策展的知识库。适合项目入门文档，但不适合 agent 动态记录决策。

- **Claude Code（CLI 工具）：**
  - `CLAUDE.md`：类 `.clinerules` 的 Markdown 文件，人类编辑。
  - Memory 功能：agent 可将提取的事实写入持久存储（具体实现未公开，推测为 KV 或向量库），跨会话可用。
  - 评价：Anthropic 的"记忆"方向确认了 agent 主动写入是有价值的。

### 1.5 Windsurf (Codeium) — Cascade + 向量化项目索引

- 数据结构：项目文件的向量嵌入 + 语义索引。
- 写入时机：自动索引（文件变更时增量更新）。
- 读取方式：agent 使用语义搜索（`@semantic` 或自动检索相关代码段）。
- 冲突处理：只读索引，无写入冲突。
- 评价：重基础设施（需 embedding 模型 + 向量库），但提供了强大的"自动发现相关上下文"能力。偏向代码理解而非决策记录。

### 1.6 小结：五种模式

| 模式 | 代表 | 数据结构 | Agent 可写 | 查询方式 | 并发支持 |
|------|------|----------|-----------|----------|----------|
| 静态规则文件 | .clinerules / CLAUDE.md | 单文件 Markdown | ❌ | 注入 prompt | n/a |
| Agent KV 记忆 | Cline Memory | 文件-JSON KV | ✅ write | 注入 + 工具查询 | 单 agent |
| 共享便签文件 | Cursor Notepads | 目录下 .md 文件 | ✅ edit_file | read_file 按需 | 乐观锁(编辑器) |
| 向量项目索引 | Windsurf Cascade | 向量嵌入 + 语义索引 | ❌(自动) | 语义搜索 | 只读 |
| 对话级转发 | Kilo Orchestrator | 无持久化 | n/a | 轮次级 prompt | 单 Orchestrator |

---

## 2. 对 UnodeAi 的选型建议

### 2.1 现有架构盘点

UnodeAi 已有的基础设施（v0.3.0）：

| 组件 | 能力 | 与共享记忆的关系 |
|------|------|-----------------|
| **MessageBus** | 进程内 pub/sub + 环形消息存储 + query/filter | 已有的"短期记忆"——消息可查询但不可变、不跨会话 |
| **SessionManager** | agent 生命周期 + 对话快照持久化(workspaceState) | 每个 agent 的私有记忆已持久化 |
| **`.roam/rules.md`** | 项目级 Markdown 注入 system prompt | 已有的"项目长期记忆"入口，但目前仅人类编辑 |
| **FileCoordinator** | 乐观并发控制(read hash → compare-and-swap) | 已解决多 agent 并发写同一文件的问题 |
| **TeamTools** | `assign_task` / `broadcast` / `await_tasks` | PM 是信息中转站，但无持久化 |
| **WorkspaceTools** | `read_file` / `write_file` / `list_dir` | agent 已具备文件读写能力 |

关键洞察：**UnodeAi 已经有了一套多 agent 并发写文件的安全机制（FileCoordinator + TaskClaimRegistry），以及一个项目记忆入口（`.roam/rules.md`）。** 共享记忆不需要从零搭建——它是对 `.roam/` 目录的扩展 + agent 可调用工具的封装。

### 2.2 三种方案

#### 方案 A（推荐）：扩展 `.roam/` 结构化文件 + `memory_write` / `memory_query` 工具

**核心思路：** 在 `.roam/` 下增加一个 `memory/` 子目录，存结构化 Markdown/JSON 文件。给 agent 暴露两个工具：`memory_write`（写入一条记忆）和 `memory_query`（全文搜索/列出记忆）。FileCoordinator 已有的乐观并发控制直接复用。

**数据结构：**
```
.roam/
├── rules.md              # 现有：人类编辑的项目规则
└── memory/               # 新增：agent 共享记忆
    ├── decisions.md      # 架构决策记录（ADL），追加式
    ├── contracts.md      # 模块接口契约
    ├── facts.md          # 团队共享便签 / 事实
    └── index.json        # 轻量索引（按 tag/agent/时间）
```

- `decisions.md`：每行一条决策，格式 `[2026-06-08] [architect] 决定用 X 而不是 Y，因为 Z。`
- `contracts.md`：`## src/auth/types.ts` → "User 类型包含 id:string, email:string, role:Role"。
- `facts.md`：自由格式便签，agent 可以追加 "PM 要求所有 API 调用加超时处理"。
- `index.json`：`[{ "id":"d3f2", "tag":"api-design", "agent":"architect", "ts":"...", "file":"decisions.md", "line":42 }]`。

**工具定义：**
```
memory_write(tag, content, kind="fact"|"decision"|"contract")
  → 追加到对应 .md 文件 + 更新 index.json
  → FileCoordinator 保证并发安全（compare-and-swap）

memory_query(query?, tag?, kind?, limit=20)
  → 全文搜索（substring/grep）所有 memory 文件
  → 或按 tag/kind 过滤列出
  → 返回匹配条目
```

**写入时机：**
- agent 完成任务后，由 agent 自己决定是否写入（工具驱动）。
- PM 在 `assign_task` 时可以携带 "记录决策到 shared memory" 的 expectedOutput。
- 未来可以 hook 到 SessionManager 的 `turn_complete`，自动提示 agent 是否要记录。

**读取/检索方式：**
- 每次 agent start 时，将 `index.json` 摘要注入 system prompt（类似 ProjectConventions 的注入方式）。
- agent 在任务中主动调用 `memory_query` 按需检索。
- PM 在分配任务时，可以 `memory_query` 后将相关内容放入 instruction。

**冲突处理：**
- 复用 FileCoordinator 的乐观并发：agent 读 memory 文件时 recordRead，写时 compare-and-swap。
- 追加式文件（decisions.md / facts.md）天然冲突概率低——只是尾部追加。
- index.json 的更新可以走原子操作：读取→修改→写回，失败则重读重试。

**取舍：**
- ✅ 极低成本——文件系统是现成的，FileCoordinator 已解决并发，WorkspaceTools 已提供读写。
- ✅ 人类可读——`.roam/memory/` 下的 Markdown 可直接在编辑器中查看/编辑。
- ✅ Git 可追踪——记忆随项目版本控制，团队共享。
- ✅ 渐进式——可以从一个 `facts.md` 追加文件开始（MVP），逐步加结构。
- ⚠️ 全文搜索简陋——grep/substring 匹配，没有语义搜索。
- ⚠️ 大规模时性能——数百条记忆后 grep 变慢，需要索引优化。

#### 方案 B（备选）：进程内共享 Store + `memory_write` / `memory_query` 工具

**核心思路：** 在 MessageBus 所在进程内维护一个内存 KV store（Map + TTL + 持久化到 workspaceState），agent 通过工具读写。

**数据结构：**
```
// 内存中（MessageBus 同一进程）
class SharedMemory {
  private store: Map<string, { value: string; tag: string; agent: string; ts: number }>;
  write(key, value, tag): void;
  query(filter): Entry[];
  // 持久化：每 N 秒或每次写入后 snapshot 到 workspaceState
}
```

**工具定义：** 同方案 A，但底层不走文件系统，而是直接操作内存 store。

**取舍：**
- ✅ 快速——纯内存操作，无文件 I/O 开销。
- ✅ 结构化查询——可支持 tag 过滤、agent 过滤、时间范围等。
- ⚠️ 不跨会话——需要可靠的持久化/恢复机制（workspaceState 有容量限制且 VS Code 重启后可能丢失）。
- ⚠️ 人类不可见——无法在编辑器里直接查看/编辑，需要额外 UI。
- ⚠️ 非 Git 可追踪——记忆不属于项目源码，团队其他成员不可见。
- ⚠️ 新增组件——需要设计持久化、序列化、恢复、TTL 过期等。

#### 方案 C（备选）：MCP Server — 外部记忆服务

**核心思路：** 共享记忆作为一个 MCP server 运行，提供 `memory_write` / `memory_query` 工具。所有 agent 通过 MCP 协议访问。

**数据结构：** 由 MCP server 决定——可以是 SQLite、向量库、或远程服务。

**取舍：**
- ✅ 完全解耦——记忆服务独立于 UnodeAi，可独立演进、替换。
- ✅ 可扩展——未来可接入真正的向量库（Chroma / Qdrant / Pinecone），支持语义搜索。
- ✅ 标准化——MCP 是开放协议，其他工具也能接入同一记忆服务。
- ⚠️ 额外进程——需要管理 MCP server 的生命周期（启动、停止、健康检查）。
- ⚠️ 依赖外部——用户需要安装/配置 MCP server，增加入门门槛。
- ⚠️ 网络延迟——IPC/HTTP 调用比本地文件/内存慢。
- ⚠️ v0.4 过度工程——在目前阶段，内存/文件方案完全够用，MCP 是过早的架构投资。

### 2.3 推荐结论

| | 方案 A（.roam/ 文件） | 方案 B（内存 Store） | 方案 C（MCP） |
|---|---|---|---|
| 实现成本 | 🟢 极低 | 🟡 中 | 🔴 高 |
| 复用现有架构 | 🟢 FileCoordinator + WorkspaceTools | 🟡 MessageBus 进程 | 🔴 新增进程 |
| 人类可读 | 🟢 直接编辑 | 🔴 不可见 | 🔴 需额外 UI |
| Git 可追踪 | 🟢 是 | 🔴 否 | 🔴 取决于实现 |
| 查询能力 | 🟡 grep/全文 | 🟢 结构化 | 🟢 可语义搜索 |
| 跨会话持久 | 🟢 文件系统 | 🟡 workspaceState | 🟢 取决于后端 |

**推荐方案 A**，理由：
1. UnodeAi 已有的 FileCoordinator 直接解决了多 agent 并发写文件的信任问题——这是其他工具（Cline、Cursor）没有的。
2. `.roam/` 目录已经存在且被 agent 认知（rules.md 已在 system prompt 中），扩展它是最小认知负担。
3. Markdown 文件是人类可读的——团队成员可以在编辑器里直接浏览/编辑记忆，不需要额外 UI。
4. 版本控制天然支持——记忆随代码一起被 git 追踪、diff、review。
5. 渐进式落地——可以从一个 `facts.md` 追加文件开始，不需要一次建完整结构。

**备选方案 B（内存 Store）** 适合后续优化查询性能时作为缓存层（文件 → 内存索引），但不适合作为主要持久化。

**备选方案 C（MCP）** 是远期愿景——当共享记忆需要语义搜索、跨工作区共享、或与外部系统集成时再引入。

---

## 3. 最小可用切口（v0.4 MVP）

### 建议：团队共享便签（append-only shared notepad）

**只做一件事：** 给 agent 一个 `memory_write` 工具，内容追加写入 `.roam/memory/notes.md`。所有 agent 的 system prompt 里注入该文件的摘要（最近 N 条），agent 也可以在任务中 `read_file` 或 `grep` 检索。

**范围精简：**
- ❌ 不做 index.json（MVP 阶段用 grep 够了）
- ❌ 不做分类（decisions / contracts / facts ——先全部进 notes.md）
- ❌ 不做 tag、不做结构化查询
- ✅ 只做 `memory_write(note: string)` → 追加一行到 `.roam/memory/notes.md`
- ✅ 注入到 system prompt：`<shared_memory>` 里列出最近 20 条便签
- ✅ FileCoordinator 复用：agent 写 notes.md 时自动走 compare-and-swap

**为什么从便签开始？**
- 它覆盖最高频的需求：agent A 发现一个坑 → 写下来 → agent B 不会踩。
- 附加（append）比修改（update）冲突概率低得多——两个 agent 同时追加几乎不可能冲突。
- 实现量极小：一个工具定义 + 一个文件路径 + 注入一行 system prompt。
- 人类也能编辑：打开 `.roam/memory/notes.md` 就能看/删/整理。

**MVP 之外的下一步（v0.5）：**
1. 加 `memory_query` 工具（全文搜索 + tag 过滤）。
2. 加 tag 支持（`memory_write "xxx" --tag api-design`）。
3. 注入最近记忆时按 tag 相关度排序（agent 当前任务的关键词匹配 tag）。
4. 加自动过期/归档（超过 N 条后最旧的归档到 `notes.archive.md`）。
