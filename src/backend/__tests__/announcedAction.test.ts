import { describe, it, expect } from 'vitest';
import { looksLikeAnnouncedAction, looksLikeUnverifiedCompletion, looksLikeToolDistrustRefusal } from '../announcedAction';

describe('looksLikeToolDistrustRefusal', () => {
  it('detects the "it\'s a prompt-injection hook / check your hooks" refusal', () => {
    expect(looksLikeToolDistrustRefusal("I'm seeing the same prompt injection hook from the previous session.")).toBe(true);
    expect(looksLikeToolDistrustRefusal('Please check your Claude Code hooks configuration.')).toBe(true);
    expect(looksLikeToolDistrustRefusal('The UnodeAi extension is intercepting my tool calls and returning errors.')).toBe(true);
  });
  it('detects "those aren\'t my tools / run it manually in your terminal" (with a refusal signal)', () => {
    expect(looksLikeToolDistrustRefusal("assign_task aren't part of my defined toolset. My actual tools are Edit, Write, Bash.")).toBe(true);
    expect(looksLikeToolDistrustRefusal("I can't edit them through this environment. To add the line, you could manually run in your terminal: echo \"x\" >> README.md")).toBe(true);
  });
  it('does NOT flag a legitimate instructional answer that mentions the terminal (Codex false-positive)', () => {
    expect(looksLikeToolDistrustRefusal('To run the tests locally, run `npm test` in your terminal.')).toBe(false);
    expect(looksLikeToolDistrustRefusal('You can run the build with `npm run build` in your terminal whenever you want.')).toBe(false);
    expect(looksLikeToolDistrustRefusal('Here is how to start the dev server: run `npm run dev` in your terminal.')).toBe(false);
  });
  it('does NOT fire on a normal reply', () => {
    expect(looksLikeToolDistrustRefusal('Added the line to README.md and the tests pass.')).toBe(false);
    expect(looksLikeToolDistrustRefusal('I delegated the task to the senior developer.')).toBe(false);
    expect(looksLikeToolDistrustRefusal('')).toBe(false);
  });
});

describe('looksLikeAnnouncedAction', () => {
  it('detects a message that ends announcing an action (colon)', () => {
    expect(looksLikeAnnouncedAction('我无法直接知道版本，但可以读取 package.json。让我查一下：')).toBe(true);
    expect(looksLikeAnnouncedAction('Let me check the package.json:')).toBe(true);
    expect(looksLikeAnnouncedAction('OK, I will read the file now:')).toBe(true);
  });

  it('detects an intent-to-act phrase near the end (no colon)', () => {
    expect(looksLikeAnnouncedAction("Sounds good. I'll run the tests now.")).toBe(true);
    expect(looksLikeAnnouncedAction('明白了，我来读取一下那个文件。')).toBe(true);
  });

  it('detects the PM-style announcements that previously slipped through', () => {
    expect(looksLikeAnnouncedAction('我会 A→B 验证 V6——先让 A 记下事实，然后 B 读取。')).toBe(true);
    expect(looksLikeAnnouncedAction('现在切到任务 A：给我自己分配任务。')).toBe(true);
    expect(looksLikeAnnouncedAction('接下来我将委派给 senior-dev 实现这个函数。')).toBe(true);
    expect(looksLikeAnnouncedAction("I'm going to delegate this to the developer.")).toBe(true);
  });

  it('does NOT flag a normal final answer', () => {
    expect(looksLikeAnnouncedAction('The file exports add, sub, and mul. All 6 tests pass.')).toBe(false);
    expect(looksLikeAnnouncedAction('Done — calc.js created and tests are green.')).toBe(false);
    expect(looksLikeAnnouncedAction('版本是 0.5.0。')).toBe(false);
  });

  it('handles empty/blank input', () => {
    expect(looksLikeAnnouncedAction('')).toBe(false);
    expect(looksLikeAnnouncedAction('   \n ')).toBe(false);
  });
});

describe('looksLikeUnverifiedCompletion (P2)', () => {
  it('detects "already done / no changes needed" completion claims', () => {
    expect(looksLikeUnverifiedCompletion("That's already done — src/math.js currently returns a - b, no changes needed.")).toBe(true);
    expect(looksLikeUnverifiedCompletion('No changes needed; the function is already correct.')).toBe(true);
    expect(looksLikeUnverifiedCompletion('Nothing to change here.')).toBe(true);
    expect(looksLikeUnverifiedCompletion('这个已经完成了，无需更改。')).toBe(true);
    expect(looksLikeUnverifiedCompletion('add 已经是正确的，不需要修改。')).toBe(true);
  });

  it('does NOT flag a normal substantive answer', () => {
    expect(looksLikeUnverifiedCompletion('I changed add to use reduce and reran the tests — all green.')).toBe(false);
    expect(looksLikeUnverifiedCompletion('The file exports add, sub, and mul.')).toBe(false);
    expect(looksLikeUnverifiedCompletion('MVC separates model, view, and controller.')).toBe(false);
  });

  it('handles empty/blank input', () => {
    expect(looksLikeUnverifiedCompletion('')).toBe(false);
    expect(looksLikeUnverifiedCompletion('   ')).toBe(false);
  });
});
