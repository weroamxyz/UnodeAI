# Codex 任务卡 C — XmlToolProtocol（弱模型的 XML 工具调用,对标 Cline）

**目标**：实现 `XmlToolProtocol`——让模型在**正文里用 XML 调用工具**(Cline 风格),弱模型(DeepSeek 等)
跟着这个明确文本格式走,比吐 native function-call JSON 可靠得多。这是 UnodeAi "让便宜模型能干活" 的
差异化能力。完整设计见 [DEVPLAN_C](DEVPLAN_C_xml_tool_calling.md)。

**范围**：只做 `XmlToolProtocol` 这个**自包含纯模块** + 测试。**不碰** `OpenAICompatBackend`(Claude 接入)、
不碰 WorkspaceTools/执行层。你实现的是已经在 main 上的稳定接口 `ToolProtocol`。

## Worktree（隔离 — 必须）
```
git worktree add ../roam-crew-codex-c -b codex/xml-tool-protocol
cd ../roam-crew-codex-c && npm install
```
基于最新 main(含 `src/backend/toolProtocol/ToolProtocol.ts` 接口契约 `4fd24b9`)。

## 你要实现的契约（已在 main,别改它）
`src/backend/toolProtocol/ToolProtocol.ts` 里的 `ToolProtocol` 接口 + `ParsedToolCall` /
`AssistantMessageView` / `ProtocolHistoryMessage` 类型。`ToolSpec` 来自 `../WorkspaceTools`
(`spec.function.name` / `.description` / `.parameters.{properties,required}`)。

## 允许改/加的文件
1. `src/backend/toolProtocol/XmlToolProtocol.ts` —— **新建**,`export class XmlToolProtocol implements ToolProtocol`。
2. `src/backend/toolProtocol/__tests__/XmlToolProtocol.test.ts` —— **新建**,纯逻辑单测。
3. (可选)`src/backend/toolProtocol/xmlParse.ts` —— 如果想把解析器单拆成纯函数更好测,可新建。
> 只在 `src/backend/toolProtocol/` 下加文件。**别动** ToolProtocol.ts(契约)、OpenAICompatBackend、
> WorkspaceTools。

## 实现要求

### `sendsNativeTools = false`
xml 模式不带 native `tools` 字段(由 backend 据此决定;你只暴露这个只读属性)。

### `renderToolGuide(specs): string`
返回要追加进 system prompt 的**工具手册**。对每个 spec 列出:名字、用途(description)、参数(名/类型/
是否必填/说明,从 `parameters.properties` + `required` 取),再加一段**硬规则**:
- 需要用工具时,在回复里输出**恰好一个** `<use_tool>` 块,然后停下等结果;**一条消息只调一个工具**。
- 必须用下面的精确格式;`<tool>` 是工具名,其余子标签是参数;必填参数必须给。
- 不需要工具时,直接用普通文字回复,**不要**写 `<use_tool>`。
- 工具报错时:读错误、对照参数修正或换法,**不要原样重试**。
- 给一个**格式示例**(见下)。

### XML 格式（一次一个工具）
```
<use_tool>
<tool>write_file</tool>
<path>src/foo.ts</path>
<content>export const x = 1;
</content>
</use_tool>
```
- 外层 `<use_tool>` 包裹降低误判;`<tool>` 指定名字;其余子标签 = 参数,值取标签间**原文**(支持多行,如
  content)。

### `parseCalls(msg): ParsedToolCall[]`
- 从 `msg.content`(可能为 null)里提取**第一个** `<use_tool>...</use_tool>` 块(强制 one-tool-per-message;
  忽略后续块)。
- 取 `<tool>` 作为 name;其余直接子标签作为 args(`{ [tagName]: rawText }`)。
- **按工具 schema 做类型 coerce**:`parameters.properties[param].type` 为 `integer`/`number` → Number;
  `boolean` → true/false;`array`/`object` → 尝试 `JSON.parse`,失败则保留原文。string 保持原文(trim 两端
  换行但保留内部)。需要 specs 才能 coerce → `parseCalls` 拿不到 specs,所以**构造函数接收 specs**
  (`new XmlToolProtocol(specs)`),renderToolGuide 也用它。**注意:接口的 parseCalls 只收 msg**,所以 specs
  存在实例上。
- 生成稳定 `id`:如 `xml-${Date.now()}-${n}` 或自增计数,够唯一即可。
- **绝不抛异常**:没有 `<use_tool>` / 缺 `<tool>` / 畸形 → 返回 `[]`(当作纯文字回复)。沿用 never-throw 契约。

### `formatResult(call, output): ProtocolHistoryMessage`
- 返回 `{ role: 'user', content: '[Tool result: ' + call.name + ']\n' + output }`。
  (xml 模式用 user 文本块回灌——很多开源模型对显式 `role:'tool'` 支持差;Cline 也这么干。)

## 测试（提交前全绿）
`XmlToolProtocol.test.ts` 覆盖:
- 解析正常块(单参数/多参数);多行 `content` 原文保留;数字/布尔/数组参数 coerce(给带 schema 的 specs)。
- 缺 `<tool>` / 没有 `<use_tool>` / 畸形未闭合 → `parseCalls` 返回 `[]`(不抛)。
- 多个 `<use_tool>` 块 → 只取第一个。
- `renderToolGuide` 输出含每个工具名 + 必填参数 + 格式示例 + "一次一个工具" 规则。
- `formatResult` 形态正确(role:'user',含工具名 + output)。
- `sendsNativeTools === false`。
```
npm run build && npm run lint && npm test     # 全绿,用项目脚本
```
> worktree 保持干净(不提交 `_*` / tmp 产物)。

## 验收
- `XmlToolProtocol` 实现 `ToolProtocol` 接口、纯逻辑、never-throw、有单测。
- Claude review 后:Claude 做 `NativeToolProtocol` 重构 + 在 `OpenAICompatBackend` 里按
  `AgentConfig.toolProtocol` 选择协议并接入(parseCalls/formatResult/renderToolGuide/sendsNativeTools),
  然后合并你的模块。**你不需要碰 backend**——只把这个模块和测试做扎实。
- 之后 DeepSeek 在 xml 模式 dogfood,对比 native 的可靠性(真正验收)。
