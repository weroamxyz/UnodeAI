/*---------------------------------------------------------------------------------------------
 *  UnodeAi - CommandPolicy
 *  Gatekeeper for the run_command tool. Without this, an agent can run ANY shell command the
 *  model emits (LLM-driven RCE). Default posture is deny; the user opts into specific commands.
 *
 *  Layers of defense:
 *    1. mode 'none'      — run_command is disabled entirely.
 *       mode 'allowlist' — only commands whose first token-run matches a configured prefix, AND
 *                          that contain no shell control characters (so a teammate can't smuggle a
 *                          second command via `;`, `&&`, `|`, backticks, `$(...)`, redirects).
 *       mode 'all'       — anything goes (explicit opt-in for trusted/sandboxed setups).
 *    2. A hard denylist of catastrophic patterns is applied in EVERY mode as a final seatbelt.
 *
 *  F2: Added pure reload(mode, allowlist) so the policy can be updated at runtime without
 *       importing vscode (keeps the class testable in plain Node.js). approvalMode getter
 *       exposes the current mode for external queries. SAFE_COMMAND_PREFIXES and
 *       isApprovalNeeded live here so tests can import them without pulling in vscode.
 *  F2.3: onFirstBlock callback — one-shot hook fired the first time a command is blocked in
 *       'none' mode, so the caller can show a non-modal warning with an "Enable Commands" button.
 *--------------------------------------------------------------------------------------------*/

export type CommandApprovalMode = 'none' | 'allowlist' | 'all' | 'ask';

export interface CommandVerdict {
  allowed: boolean;
  reason?: string;
  /**
   * 'ask' mode only: the command is safe to run but not yet allowlisted — the caller should prompt the
   * user (Run once / Always allow / Deny). Already-allowlisted commands return `allowed:true` (no prompt).
   */
  ask?: boolean;
}

/** Shell metacharacters that allow chaining/smuggling a second command. Rejected in allowlist mode. */
const SHELL_CONTROL = /[;&|`\n\r]|\$\(|\$\{|>|</;

/** Catastrophic patterns blocked in every mode (defense in depth, not the primary control). */
const CATASTROPHIC: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf / -fr (any flag order)
  /\brm\s+-[rf]\w*\s+(\/|~|\.\.)(\s|$)/i,           // rm -r/-f targeting /, ~, ..
  /\bmkfs\b/i,
  /\bdd\b[^\n]*\bof=\/dev\//i,
  /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/,                // fork bomb :(){ :|:& };:
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bsudo\b/i,
  /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh|powershell|pwsh|cmd)\b/i, // pipe-to-shell
  /\bformat\s+[a-z]:/i,                              // Windows format C:
  /\bdel\s+\/[sfq]/i,                                // Windows recursive/forced delete
  />\s*\/dev\/(sd|nvme|disk)/i,
];

/**
 * Safe command TEMPLATES for guided enablement. Deliberately narrow: read-only / build / test only.
 * NOT bare tool names — `git`, `node`, `python` as prefixes would silently allow `git reset --hard`,
 * `node evil.js`, `python evil.py`. We seed two-token templates so destructive siblings still hit the
 * 'ask' prompt. Anything not listed here prompts the user (Run once / Always allow / Deny).
 */
// SINGLE SOURCE OF TRUTH for the safe default command set. Both the new-install default
// (package.json → unode.allowedCommands) and the "Enable Safe Commands" action seed from this, so the two
// can't drift (a test asserts package.json matches this list). Read-only / verify / lint / build only —
// never bare tools ('git'/'node'/'npm' would allow 'git reset --hard'/'node evil.js'/'npm publish'); and
// never prefix footguns like 'git branch' (matches 'git branch -D x'). Anything else hits the 'ask' prompt.
export const SAFE_COMMAND_TEMPLATES = [
  // read-only git inspection
  'git status',
  'git diff',
  'git log',
  'git show',
  // read-only npm inspection
  'npm ls',
  'npm audit',
  // verify / build / typecheck / lint — EXPLICIT scripts only. NOT bare 'npm run' (runs any project
  // script) and NOT install/ci (lifecycle scripts execute arbitrary code) — those go to 'ask'.
  'npm test',
  'npm run test',
  'npm run build',
  'npm run compile',
  'npm run lint',
  'npm run typecheck',
  'pnpm test',
  'yarn test',
  'npx tsc',
  'npx eslint',
  'npx prettier',
  'npx vitest',
  'tsc',
  'eslint',
  'prettier',
  // other ecosystems' non-destructive verify
  'pytest',
  'go test',
  'go vet',
  'go build',
  'cargo test',
  'cargo check',
  'cargo build',
];

/** @deprecated kept as an alias for back-compat; prefer SAFE_COMMAND_TEMPLATES. */
export const SAFE_COMMAND_PREFIXES = SAFE_COMMAND_TEMPLATES;

/** F2: Pure predicate — true when the user should be prompted to enable commands. */
export function isApprovalNeeded(mode: CommandApprovalMode): boolean {
  return mode === 'none';
}

export class CommandPolicy {
  private allowlist: string[];

  /**
   * F2.3: Optional callback invoked exactly once when the first command is blocked
   * due to 'none' mode. The caller (extension.ts) wires this to showBlockedWarning().
   */
  onFirstBlock?: () => void;

  private _blockPrompted = false;

  constructor(
    private mode: CommandApprovalMode = 'none',
    allowlist: string[] = []
  ) {
    // Normalize allowlisted prefixes for case-insensitive, whitespace-tolerant matching.
    this.allowlist = allowlist.map((p) => p.trim().toLowerCase()).filter(Boolean);
  }

  /** F2: public getter so external code can check the current mode. */
  get approvalMode(): CommandApprovalMode {
    return this.mode;
  }

  /**
   * F2: Update the policy with new mode and allowlist at runtime.
   * Pure — the caller reads VS Code settings and passes them in, so this
   * class stays testable in plain Node.js without the vscode module.
   */
  reload(mode: CommandApprovalMode, allowlist: string[]): void {
    this.mode = mode;
    this.allowlist = (allowlist ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  }

  check(rawCommand: string): CommandVerdict {
    const command = (rawCommand ?? '').trim();
    if (!command) {
      return { allowed: false, reason: 'empty command' };
    }

    // Catastrophic patterns are blocked regardless of mode.
    for (const pattern of CATASTROPHIC) {
      if (pattern.test(command)) {
        return { allowed: false, reason: 'matches a blocked destructive pattern' };
      }
    }

    switch (this.mode) {
      case 'none': {
        // F2.3: fire the one-shot callback so the user sees a non-modal
        // "Enable Commands" button the first time an agent tries to run a command.
        if (this.onFirstBlock && !this._blockPrompted) {
          this._blockPrompted = true;
          this.onFirstBlock();
        }
        return {
          allowed: false,
          reason: 'command execution is disabled. The user can enable it via "unode.commandApproval".',
        };
      }

      case 'all':
        return { allowed: true };

      case 'allowlist': {
        if (SHELL_CONTROL.test(command)) {
          return {
            allowed: false,
            reason:
              'contains shell control characters (; & | > ` $()). Allowlisted commands must be a single simple command.',
          };
        }
        const lower = command.toLowerCase();
        const ok = this.allowlist.some(
          (prefix) => lower === prefix || lower.startsWith(prefix + ' ')
        );
        return ok
          ? { allowed: true }
          : {
              allowed: false,
              reason: `not in the allowlist. Allowed prefixes: ${this.allowlist.join(', ') || '(none configured)'}.`,
            };
      }

      case 'ask': {
        // Ask mode: user gets the final say on any command (except catastrophic patterns, which are
        // blocked above). Don't pre-reject shell syntax — legitimate pipes, chains, etc. are fine if the
        // user approves them. (UnodeAi's P0: restore tool call reliability by unblocking PowerShell syntax.)
        const lower = command.toLowerCase();
        const ok = this.allowlist.some(
          (prefix) => lower === prefix || lower.startsWith(prefix + ' ')
        );
        // A matching allowlist prefix must NOT silently run a CHAINED/redirected command: e.g.
        // "npm test && npm publish" starts with the allowlisted "npm test " but the second command was
        // never approved. If shell-control chars are present, fall through to the prompt (don't auto-allow).
        // This is ASK, not BLOCK — the user can still approve it; catastrophic patterns are blocked above.
        if (ok && !SHELL_CONTROL.test(command)) {
          return { allowed: true };
        }
        return { allowed: false, ask: true, reason: 'awaiting user approval' };
      }
    }
  }

  /** First whitespace-delimited token of a command, lowercased. */
  static commandPrefix(command: string): string {
    return (command ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  }

  /**
   * Tools whose first argument is a sub-verb: we whitelist TWO tokens (e.g. "git status") so that
   * approving one subcommand does not silently allow a dangerous sibling ("git reset --hard").
   */
  private static readonly MULTI_VERB = new Set([
    'git', 'npm', 'npx', 'pnpm', 'yarn', 'cargo', 'go', 'dotnet', 'make',
    'docker', 'kubectl', 'pip', 'pip3', 'python', 'python3', 'node', 'deno', 'bun',
  ]);

  /** Package managers where `<pm> run <script>` indirects through an arbitrary script name. */
  private static readonly RUN_SCRIPT_PM = new Set(['npm', 'pnpm', 'yarn', 'bun']);

  /**
   * The command template we whitelist on "Always allow": two tokens for multi-verb tools
   * ("git status", "node server.js"), one token otherwise. Narrower than the bare first token, so
   * "Always allow git status" never green-lights "git reset --hard".
   *
   * Special case `<pm> run <script>`: keep THREE tokens ("npm run build", not "npm run") — otherwise
   * approving one script would silently green-light every other `npm run <anything>` (e.g. deploy).
   */
  static commandTemplate(command: string): string {
    const tokens = (command ?? '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return '';
    }
    const first = tokens[0].toLowerCase();
    if (CommandPolicy.MULTI_VERB.has(first) && tokens[1]) {
      const second = tokens[1].toLowerCase();
      if (CommandPolicy.RUN_SCRIPT_PM.has(first) && second === 'run' && tokens[2]) {
        return `${first} run ${tokens[2].toLowerCase()}`;
      }
      return `${first} ${second}`;
    }
    return first;
  }
}
