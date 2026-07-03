/*---------------------------------------------------------------------------------------------
 *  UnodeAi - PersistenceManager
 *  Persists the team roster (agent configs) and usage stats so the team survives reloads.
 *
 *  Agent CONFIGS live in workspaceState (and optionally a versionable `.unode/team.json`).
 *  API KEYS never go here — they live in SecretStorage (see SecretsManager). The two are joined
 *  at runtime via AgentConfig.provider.apiKeySecretName.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentConfig, MCPServerConfig, Message, WorkflowConfig, WorkflowInstance } from '../types';
import { ConversationSnapshot } from '../backend/AgentBackend';
import { SerializedCheckpoints } from '../backend/Checkpoints';
import { TeamFileDocument, TeamFileValidationError, validateTeamFile } from './TeamFileSchema';
import { keysToReset } from './resetWorkspaceKeys';

const AGENTS_KEY = 'roam.agents';
const SNAPSHOT_PREFIX = 'roam.snapshot.';
const MESSAGES_KEY = 'roam.messages';
const WORKFLOWS_KEY = 'roam.workflows';
const APPROVED_MCP_KEY = 'roam.approvedMcpServers';
const CHECKPOINTS_KEY = 'roam.checkpoints';

/** True when an error means "the file simply isn't there" — across Node fs and vscode.fs shapes. */
export function isFileNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'ENOENT' || code === 'FileNotFound' || code === 'EntryNotFound') {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /\bENOENT\b|FileNotFound|EntryNotFound/i.test(message);
}

export interface PersistedState {
  agents: AgentConfig[];
}

export class PersistenceManager {
  constructor(private context: vscode.ExtensionContext) {}

  loadAgents(): AgentConfig[] {
    return this.context.workspaceState.get<AgentConfig[]>(AGENTS_KEY, []);
  }

  async saveAgents(agents: AgentConfig[]): Promise<void> {
    await this.context.workspaceState.update(AGENTS_KEY, agents);
  }

  // ─── Conversation snapshots (L2 crash recovery) ──────────────────────

  loadSnapshot(agentId: string): ConversationSnapshot | undefined {
    return this.context.workspaceState.get<ConversationSnapshot>(SNAPSHOT_PREFIX + agentId);
  }

  saveSnapshot(agentId: string, snapshot: ConversationSnapshot): void {
    // Fire-and-forget; workspaceState.update returns a Thenable we don't need to await per-turn.
    void this.context.workspaceState.update(SNAPSHOT_PREFIX + agentId, snapshot);
  }

  clearSnapshot(agentId: string): void {
    void this.context.workspaceState.update(SNAPSHOT_PREFIX + agentId, undefined);
  }

  // ─── Message history (P1#5) ──────────────────────────────────────────

  loadMessages(): Message[] {
    return this.context.workspaceState.get<Message[]>(MESSAGES_KEY, []);
  }

  saveMessages(messages: Message[]): void {
    void this.context.workspaceState.update(MESSAGES_KEY, messages);
  }

  // ─── Checkpoints (V1: per-write restore points) ──────────────────────

  loadCheckpoints(): SerializedCheckpoints | undefined {
    return this.context.workspaceState.get<SerializedCheckpoints>(CHECKPOINTS_KEY);
  }

  saveCheckpoints(data: SerializedCheckpoints): void {
    void this.context.workspaceState.update(CHECKPOINTS_KEY, data);
  }

  // ─── In-flight workflow instances (L3 recovery, P1#5) ────────────────

  loadWorkflows(): WorkflowInstance[] {
    return this.context.workspaceState.get<WorkflowInstance[]>(WORKFLOWS_KEY, []);
  }

  saveWorkflows(instances: WorkflowInstance[]): void {
    void this.context.workspaceState.update(WORKFLOWS_KEY, instances);
  }

  // ─── Approved (sensitive) MCP servers (P1#4) ─────────────────────────

  loadApprovedMcpServers(): string[] {
    return this.context.workspaceState.get<string[]>(APPROVED_MCP_KEY, []);
  }

  async saveApprovedMcpServers(ids: string[]): Promise<void> {
    await this.context.workspaceState.update(APPROVED_MCP_KEY, ids);
  }

  // ─── Reset (P2: "UnodeAi: Reset Workspace State") ──────────────────

  /**
   * Wipe this workspace's persisted Roam state: roster, per-agent conversation snapshots, per-agent
   * chat history, the message log, file checkpoints, workflows, approved MCP servers, and the
   * onboarding flag.
   * Secrets (API keys) are NOT touched here — those live in SecretStorage and are cleared separately.
   * Per-agent keys are prefixed, so we enumerate workspaceState and drop anything that matches.
   */
  async resetWorkspaceState(): Promise<void> {
    const ws = this.context.workspaceState;
    const CHAT_PREFIX = 'roam.chat.'; // mirrors CHAT_HISTORY_KEY_PREFIX in views/chatHistory.ts
    const keys = keysToReset(
      ws.keys(),
      [AGENTS_KEY, MESSAGES_KEY, WORKFLOWS_KEY, APPROVED_MCP_KEY, CHECKPOINTS_KEY, 'roam.onboardingComplete'],
      [SNAPSHOT_PREFIX, CHAT_PREFIX]
    );
    for (const key of keys) {
      await ws.update(key, undefined);
    }
  }

  /**
   * Delete the versionable team file (<workspace>/.unode/team.json). Part of a full workspace reset:
   * otherwise an empty workspaceState would re-seed the just-cleared roster from this file on reload.
   * Best-effort — silently ignores an absent file or no workspace.
   */
  async deleteTeamFile(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, '.unode', 'team.json');
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      // Absent or unreadable — nothing to delete.
    }
  }

  /**
   * Best-effort load of a versionable team file at <workspace>/.unode/team.json.
   * Returns undefined if absent or malformed (caller falls back to workspaceState).
   */
  async loadTeamFile(): Promise<AgentConfig[] | undefined> {
    const doc = await this.loadTeamConfig();
    return doc?.members;
  }

  /** Load and validate the full versionable .unode/team.json document. */
  async loadTeamConfig(): Promise<TeamFileDocument | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(folder.uri, '.unode', 'team.json');
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
      return validateTeamFile(parsed);
    } catch (err) {
      this.warnTeamFileIgnored(err);
      return undefined;
    }
  }

  async saveTeamConfig(doc: TeamFileDocument): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('Open a workspace before saving .unode/team.json.');
    }
    const dir = vscode.Uri.joinPath(folder.uri, '.unode');
    const uri = vscode.Uri.joinPath(dir, 'team.json');
    await vscode.workspace.fs.createDirectory(dir);
    const normalized: TeamFileDocument = {
      version: doc.version ?? '1.0',
      members: doc.members ?? [],
      mcpServers: doc.mcpServers ?? [],
      workflows: doc.workflows ?? [],
    };
    await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
  }

  async saveCustomWorkflows(workflows: WorkflowConfig[]): Promise<void> {
    const current = await this.loadTeamConfig();
    await this.saveTeamConfig({
      version: current?.version ?? '1.0',
      members: current?.members ?? this.loadAgents(),
      mcpServers: current?.mcpServers ?? [],
      workflows,
    });
  }

  /** 段2: team-level MCP server registry from .unode/team.json (empty if absent/malformed). */
  async loadTeamMcpServers(): Promise<MCPServerConfig[]> {
    return (await this.loadTeamConfig())?.mcpServers ?? [];
  }

  private warnTeamFileIgnored(err: unknown): void {
    // "File absent" is the normal case (no team.json yet) — never warn. We must cover both error
    // shapes: a Node ErrnoException (code 'ENOENT') and a vscode.FileSystemError, whose code is
    // 'FileNotFound' (or 'Unknown' wrapping a raw ENOENT, in which case only the message carries it).
    if (isFileNotFound(err)) {
      return;
    }
    const message = err instanceof TeamFileValidationError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
    void vscode.window.showWarningMessage(`UnodeAi ignored .unode/team.json: ${message}`);
  }
}
