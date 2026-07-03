# 设计文档 C — XML/prompt 工具调用模式（弱模型 parity，对标 Cline）

> 状态：**设计稿,待 Claude/Codex 评审**。作者：Claude。日期：2026-06-09。
> 关联记忆:[[agent-robustness-insight]]。前置已落地:A(必填参数预校验)、B(重复失败熔断)已在 main(`5174c8f`)。

## 1. 动机（为什么做）

UnodeAi 现在对所有 openai-compat agent 用 **native function calling**(OpenAI `tools` + 响应里的
`tool_calls`)。实测:**DeepSeek 这类模型的 native 工具调用是它们的弱项**——空参数、畸形 JSON、谈论工具
时误触发(见 [[agent-robustness-insight]] 的 2026-06-09 episode)。

**Cline 让 DeepSeek 干得不错的根因**:它不用 native function calling,而是**在 prompt 里用 XML 式工具调用**
+ 严格"一次一个工具 + 等结果再下一步"。弱/开源模型**跟着明确的文本格式走,远比吐 native fn-call JSON 可靠**。
这就是 UnodeAi 要补的差异化能力:**"让便宜模型也能干活"**——这是我们 cost-arbitrage 定位的核心卖点。

A/B 把"畸形调用→死循环"降级成"一句纠正后停下";**C 才是治本**:换一条弱模型更擅长的工具调用通道。

## 2. 目标

- 给 agent/provider 增加一个**可选的 XML 工具调用协议**,与现有 native 协议并存、可切换。
- **复用现有执行层**(WorkspaceTools / TeamTools / MCP / `routeToolCall`)——只换"工具怎么广告给模型"
  和"怎么从响应里解析调用",执行与门禁/checkpoint/normalize 全不变。
- 默认仍是 native(零回归);弱模型显式 opt-in `xml`。

## 3. 架构

核心抽象:一个 `ToolProtocol`,封装两件协议相关的事——**渲染**(把工具广告给模型)和**解析**(从模型响应
里取出工具调用)。其余(执行、结果回灌、循环、A/B 熔断)协议无关、原样复用。

```
interface ToolProtocol {
  // 是否在 API 请求里带 native `tools` 字段(native=true；xml=false)
  readonly sendsNativeTools: boolean;
  // 把工具定义渲染进 system prompt 的附加段(native 返回 ''；xml 返回 XML 工具手册 + 规则)
  renderToolGuide(specs: ToolSpec[]): string;
  // 从一条 assistant 消息里解析出工具调用(native: 读 msg.tool_calls；xml: 解析 msg.content)
  parseCalls(msg: AssistantMessage): ParsedToolCall[];
  // 把一次工具结果格式化成"喂回模型"的消息(native: role:'tool'；xml: role:'user' 文本块)
  formatResult(call: ParsedToolCall, output: string): HistoryMessage;
}
type ParsedToolCall = { id: string; name: string; args: Record<string, any> };
```

- `NativeToolProtocol`:现状抽出来——`sendsNativeTools=true`,`renderToolGuide=()=>''`,
  `parseCalls` 读 `msg.tool_calls` + `safeParse`,`formatResult` 推 `role:'tool'`。**纯重构,行为不变。**
- `XmlToolProtocol`:见下。

**接入点**(`OpenAICompatBackend`):
- 请求构造 `buildChatBody`:`sendsNativeTools` 决定带不带 `tools`。
- system prompt 拼接:追加 `protocol.renderToolGuide(toolSpecs)`(和 `<project_context>` 同一注入通道)。
- 工具循环(现 `for (const call of msg.tool_calls)`):改成 `for (const call of protocol.parseCalls(msg))`。
- 结果回灌(现 `this.history.push({role:'tool',...})`):改成 `this.history.push(protocol.formatResult(...))`。
- **A(必填校验)、B(熔断)、emit(tool_use/tool_result)、routeToolCall、checkpoint、normalize 全部不动**——
  它们在 `parseCalls` 之后,协议无关。

## 4. XmlToolProtocol 细节

### 4.1 XML 格式（Cline 风格,一次一个工具）
模型在**正文里**输出一个工具块:
```
<use_tool>
<tool>write_file</tool>
<path>src/foo.ts</path>
<content>export const x = 1;
</content>
</use_tool>
```
- 用一个外层 `<use_tool>` 包裹,降低与正文里偶发尖括号的误判;`<tool>` 指定名字,其余子标签 = 参数。
- **一条消息只处理第一个 `<use_tool>` 块**(强制 one-tool-per-message);块后的正文忽略并提示模型。
- 参数值取标签间原文(支持多行,如 content);按工具 schema 做类型 coerce(数字/布尔/数组 JSON)。

### 4.2 renderToolGuide（注入 system prompt 的工具手册）
列出每个工具:名字、用途、参数(名/类型/必填/说明),再加**硬规则**:
- 一次只调用一个工具,然后停下等结果;不要在同一条消息里写多个工具块。
- 必须用上面的 XML 格式,标签名精确;必填参数必须给。
- 不需要工具时,直接用普通文字回复,**不要**写 `<use_tool>`。
- 工具失败时:读错误、对照参数、修正或换法,**不要原样重试**(和 B 协同)。

### 4.3 parseCalls
- 正则/小型扫描器提取第一个 `<use_tool>...</use_tool>`;取 `<tool>` 与各子标签。
- 解析失败/缺 `<tool>` → 返回空(当作无工具调用,正常文字回复),**绝不抛异常**(沿用 FileMentions/Checkpoints
  的 never-throw 契约)。
- 生成稳定 `id`(如 `xml-${turn}-${index}`)供 emit/结果配对。

### 4.4 formatResult
- 回灌为 `role:'user'` 的文本:`[Tool result: write_file]\n<output>`(native 模型用 role:'tool',但很多
  开源模型对显式 role:'tool' 支持差,用 user 文本块更稳——Cline 也是这么干的)。

## 5. 配置

- `AgentConfig.toolProtocol?: 'native' | 'xml'`,默认 `'native'`。
- 可选:provider 级默认(如 `DEFAULT_PROVIDER_CONFIGS` 给某些已知弱 provider 默认 `'xml'`)——**v1 先不做
  自动,显式 opt-in**,避免惊吓。
- UI:Add/Edit Agent 里一个下拉(Tool calling: Native / XML (for weaker models))。

## 6. 分期

- **Phase 1(本卡范围)**:`ToolProtocol` 抽象 + `NativeToolProtocol`(纯重构,零回归)+ `XmlToolProtocol`
  覆盖 **WorkspaceTools 工具**(read/write/run/list/fetch/update_todos),one-tool-per-message,config flag +
  Edit-Agent 下拉。native 路径行为逐字节不变。
- **Phase 2**:team 工具(assign_task 等)+ MCP 工具纳入 XML 渲染/解析;provider 级默认;streaming 下的
  增量 XML 解析(v1 可先只在完整消息上解析,不支持流式工具调用——流式仅用于纯文本回复)。

## 7. 风险与取舍
- **更多往返**:one-tool-per-message 比 native 的多工具/并行慢——可接受(弱模型本就该走稳)。
- **prompt 膨胀**:工具手册进每个 system prompt——可接受(几百 token),且只在 xml 模式。
- **XML 健壮性**:模型可能写畸形 XML→parseCalls 容错(当作无调用 + 下一轮提示格式)。和 B 协同防循环。
- **流式**:v1 不在流式增量里解析工具块(先攒完整消息再解析);纯文本回复仍可流式。
- **history 形态**:xml 用 user 文本块回灌,native 用 role:'tool'——两条历史不可混用(同一 agent 不可中途切协议;
  切换需清历史,和导入/清空对齐)。

## 8. 测试
- 纯 `XmlToolProtocol` 单测:解析正常块/多行 content/缺 tool/畸形/多块只取第一/类型 coerce。
- `NativeToolProtocol` 单测:与现状等价(回归护栏)。
- 后端集成测(scriptedFetch):xml 模式一个 read_file 往返——断言请求**不带** `tools` 字段、system prompt
  含工具手册、结果以 user 文本回灌、turn 正常完成。

## 9. 给评审的开放问题
1. v1 是否要给 deepseek-* provider 默认 `xml`?(我倾向**否**,先显式 opt-in + dogfood 验证再说。)
2. 结果回灌用 `role:'user'` 文本 vs `role:'tool'`——我倾向 user 文本(开源模型更稳),需评审认可。
3. one-tool-per-message 是否够?(Cline 就这么干且有效;native 多工具留给强模型。)

## 10. 分工建议
- **抽象 + NativeToolProtocol 重构**:Claude(碰 OpenAICompatBackend 核心,且要保证零回归)。
- **XmlToolProtocol + parser + 手册渲染 + 测试**:**Codex**(自包含的新模块 `src/backend/toolProtocol/`,
  纯逻辑可测;Claude 提供 `ToolProtocol` 接口契约 + 接入点 PR)。
- **Edit-Agent 下拉 + config**:Codex 小改。
- **dogfood**:DeepSeek 在 xml 模式下真跑多步任务,对比 native 模式的可靠性(这才是验收)。
