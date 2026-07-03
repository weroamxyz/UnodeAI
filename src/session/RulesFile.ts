/*---------------------------------------------------------------------------------------------
 *  UnodeAi - RulesFile (v0.1.1 F4 — Session Memory)
 *  A project-level memory file at `<workspaceRoot>/.unode/rules.md` (à la .clinerules). Its contents
 *  are appended to every agent's system prompt at start, wrapped in <project_context> tags, so all
 *  sessions share the same architecture decisions / conventions / active context.
 *
 *  Kept vscode-free (file reading is injectable) so it's unit-testable; the FileSystemWatcher that
 *  triggers reloads is wired in extension.ts.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

export type FileReader = (filePath: string) => Promise<string>;
export type FileWriter = (filePath: string, content: string) => Promise<void>;
export type DirCreator = (dirPath: string) => Promise<void>;

const defaultReader: FileReader = (p) => fs.readFile(p, 'utf8');
const defaultWriter: FileWriter = (p, content) => fs.writeFile(p, content, { encoding: 'utf8', flag: 'wx' });
const defaultMkdir: DirCreator = (p) => fs.mkdir(p, { recursive: true }).then(() => undefined);

export class RulesFile {
  private content = '';

  constructor(
    private filePath: string,
    private readFile: FileReader = defaultReader,
    private writeFile: FileWriter = defaultWriter,
    private mkdir: DirCreator = defaultMkdir
  ) {}

  /** Absolute path of the rules file (`.unode/rules.md`). */
  get path(): string {
    return this.filePath;
  }

  /** (Re)read the file into the cache. Missing/unreadable file → empty string (not an error). */
  async load(): Promise<string> {
    try {
      this.content = (await this.readFile(this.filePath)) ?? '';
    } catch {
      this.content = '';
    }
    return this.content;
  }

  /**
   * Create an empty rules file if missing. Existing content is never overwritten.
   * Fully fault-tolerant: a failed mkdir/write (e.g. no workspace open → path resolves under an
   * unwritable cwd like `/` on macOS launched from the Dock) must NEVER throw, or it would abort
   * extension activation before the webview providers register (panels show titles but no content).
   */
  async ensureExists(): Promise<void> {
    try {
      await this.mkdir(path.dirname(this.filePath));
      await this.writeFile(this.filePath, '');
    } catch {
      // No workspace / unwritable location / existing file / creator race: load() handles absence safely.
    }
  }

  /** Last-loaded content ('' if the file is absent). */
  get(): string {
    return this.content;
  }
}

/** Build the `.unode/rules.md` path under a workspace root. */
export function rulesFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.unode', 'rules.md');
}

/**
 * Wrap project memory for appending to a system prompt. Returns '' when there's nothing to add, so
 * callers can concatenate unconditionally. Appended AFTER the agent's own systemPrompt, so the
 * role's instructions take precedence while project facts stay available.
 */
export function projectContextBlock(content: string): string {
  const trimmed = content.trim();
  return trimmed ? `\n\n<project_context>\n${trimmed}\n</project_context>` : '';
}

const PROJECT_CONTEXT_RE = /\n\n<project_context>\n[\s\S]*?\n<\/project_context>/g;

/** Remove any existing UnodeAi project-context block from a prompt/message. */
export function stripProjectContextBlock(content: string): string {
  return content.replace(PROJECT_CONTEXT_RE, '');
}

/** Replace any existing project-context block with the supplied current content. */
export function replaceProjectContextBlock(content: string, projectContext: string): string {
  return stripProjectContextBlock(content) + projectContextBlock(projectContext);
}
