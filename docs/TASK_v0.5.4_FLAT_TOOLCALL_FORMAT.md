# TASK — v0.5.4 · Flat tool-call format (Cline-style, tool-name-as-tag)

**Owner**: TBD (backend) · **Reviewer**: Claude · **Target**: v0.5.4 (leads the release)
**Goal**: replace UnodeAi's two-level `<use_tool><tool>X</tool>…</use_tool>` XML format with a **flat, tool-name-as-tag** format (`<X>…</X>`), eliminating a whole class of weak-model tool-call failures **structurally** instead of patching symptoms.

> ⚠️ Verified against the real parser in [XmlToolProtocol.ts](../src/backend/toolProtocol/XmlToolProtocol.ts). Don't invent APIs. This change touches the prompt guide + parser + tests together — keep them in sync.

---

## Why (the root cause we hit in dogfooding)

DeepSeek (Solo mode) emitted a valid call but **mis-closed the wrapper**:
```
<use_tool>
<tool>read_file</tool>
<path>src/foo.ts</path>
</tool>           ← echoed the inner <tool>, should be </use_tool>
```
→ parser found no `</use_tool>` → call vanished → agent stalled. **Cline doesn't have this** because its format has no wrapper — the tool name *is* the tag, one matched pair, nothing to mis-close:
```
<read_file>
<path>src/foo.ts</path>
</read_file>
```
The two-level nesting is the cause. Today's tolerance-fix ([firstUseToolBody](../src/backend/toolProtocol/XmlToolProtocol.ts#L136)) patches the symptom; this task removes the cause.

---

## The new format

**Prompt guide** (`renderToolGuide`, [lines 34–52](../src/backend/toolProtocol/XmlToolProtocol.ts#L34)) — emit the tool name as the tag:
```
To use a tool, output exactly one block whose tag is the tool name, then stop:
<read_file>
<path>src/foo.ts</path>
</read_file>

Each child tag is an argument. Required arguments must be present. Call one tool per message.
```
Render each spec with its real tag (`<write_file>…</write_file>`) and its args as child tags — reuse the existing `renderToolSpec` arg rendering, just reframe the wrapper.

**Parser** (`parseCalls`) — anchor on known tool names:
1. For the tools in `this.specs`, find the **first** top-level block `<toolName>…</toolName>` whose `toolName` matches a spec name (build the regex from the known names, escaped).
2. `directChildTags(body)` → args (the existing machinery already does coercion + schema filtering — reuse it unchanged).
3. Return `{ id, name: toolName, args }`.

**Keep three fallbacks, in order (robustness ladder):**
1. Flat `<toolName>…</toolName>` (new, primary).
2. Legacy `<use_tool><tool>…</tool>…</use_tool>` (today's tolerant `firstUseToolBody`) — so in-flight sessions and models that still emit the old shape keep working.
3. `recoverLeakedToolCalls` (DSML etc.) — unchanged.

This makes the parser **multi-format tolerant** with the flat form preferred. Anchoring on known tool names is actually *more* robust than the generic wrapper — a stray `<tool>` in prose can't be mistaken for a call.

---

## Edge cases to handle
- **Tool name with content that contains XML** (e.g. `write_file` with `<content>` holding code that has tags): `directChildTags` + schema-known-param filtering already guards this ([lines 79–93](../src/backend/toolProtocol/XmlToolProtocol.ts#L79)) — keep taking only declared params, first occurrence wins.
- **Multiple tool blocks**: take the first (matches current "one tool per message" rule + existing test).
- **Tool name appearing in prose without a closing tag**: require a complete `<name>…</name>` pair; ignore lone tags.
- **A tool whose name collides with a common HTML tag** (none currently: read_file/write_file/run_command/etc. are safe) — note for future tool naming.

---

## Tests — [XmlToolProtocol.test.ts](../src/backend/toolProtocol/__tests__/XmlToolProtocol.test.ts)
Update existing tests to the flat format and add:
1. Flat block parses with multiple args + coercion (port the existing `run_command` test to `<run_command>…</run_command>`).
2. Multiline `<content>` preserved in `<write_file>…</write_file>`.
3. Unknown/stray top-level tag → no call (not a known tool name).
4. **Back-compat**: a legacy `<use_tool><tool>read_file</tool>…</use_tool>` still parses (fallback ladder).
5. First-block-wins with two flat blocks.
6. Keep the DSML recovery test.

---

## Verification (this is a reliability change — measure it)
After it lands, **re-run the benchmark task suite** (T1–T5 on DeepSeek/Kimi flash) and compare **tool-call success rate** and **stall count** vs the pre-change build. Expectation: the mis-close/parse-stall class drops to ~0. Record in the benchmark doc as the R-after-v0.5.4 row. *If it doesn't measurably improve tool-call success, reconsider before calling it done.*

## Definition of Done
- [ ] Prompt guide emits flat tool-name-as-tag format.
- [ ] Parser: flat (primary) → legacy `<use_tool>` (fallback) → leaked-call recovery, anchored on known tool names.
- [ ] Existing tests ported to flat format; 5–6 tests above green; full `npm test` + `npm run build` clean.
- [ ] Benchmark re-run shows tool-call success ↑ / stalls ↓ (recorded).
- [ ] Diff stays within XmlToolProtocol + its test (and the guide text). PR references this card.
