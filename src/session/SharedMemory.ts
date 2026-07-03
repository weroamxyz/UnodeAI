/*---------------------------------------------------------------------------------------------
 *  UnodeAi - SharedMemory
 *  Team-shared append-only notes at `<workspaceRoot>/.unode/memory/notes.md`.
 *
 *  Kept vscode-free (file IO is injectable) so it is unit-testable; extension.ts wires the
 *  FileSystemWatcher that refreshes the cache when the file changes.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

export type FileReader = (filePath: string) => Promise<string>;
export type FileAppender = (filePath: string, content: string) => Promise<void>;
export type DirCreator = (dirPath: string) => Promise<void>;

const defaultReader: FileReader = (p) => fs.readFile(p, 'utf8');
const defaultAppender: FileAppender = (p, content) => fs.appendFile(p, content, 'utf8');
const defaultMkdir: DirCreator = (p) => fs.mkdir(p, { recursive: true }).then(() => undefined);

export class SharedMemory {
  private content = '';

  constructor(
    private filePath: string,
    private readFile: FileReader = defaultReader,
    private appendFile: FileAppender = defaultAppender,
    private mkdir: DirCreator = defaultMkdir
  ) {}

  /** Absolute path of the shared memory notes file (`.unode/memory/notes.md`). */
  get path(): string {
    return this.filePath;
  }

  /** Append one sanitized note. Never throws; returns true if it actually wrote, false on failure
   *  (no workspace / unwritable location) so the caller can tell the agent honestly. */
  async append(agentId: string, note: string): Promise<boolean> {
    try {
      await this.mkdir(path.dirname(this.filePath));
      const safeAgent = oneLine(agentId || 'agent');
      const safeNote = oneLine(note).slice(0, 500);
      await this.appendFile(this.filePath, `- [${new Date().toISOString()}] [${safeAgent}] ${safeNote}\n`);
      return true;
    } catch {
      return false; // No workspace / unwritable location / creator race.
    }
  }

  /** (Re)read the notes into the cache. Missing/unreadable file -> empty string (not an error). */
  async load(): Promise<string> {
    try {
      this.content = (await this.readFile(this.filePath)) ?? '';
    } catch {
      this.content = '';
    }
    return this.content;
  }

  /** Last-loaded content wrapped for prompt injection, limited to the most recent notes. */
  block(maxNotes = 30): string {
    const lines = this.content
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    const count = Math.max(0, Math.floor(maxNotes));
    if (count === 0) {
      return '';
    }
    const recent = lines.slice(-count);
    if (recent.length === 0) {
      return '';
    }
    return `\n\n<shared_memory>\n${recent.join('\n')}\n</shared_memory>`;
  }
}

/** Build the `.unode/memory/notes.md` path under a workspace root. */
export function memoryFilePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.unode', 'memory', 'notes.md');
}

/** Collapse newlines and surrounding whitespace into a single readable line. */
export function oneLine(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}
