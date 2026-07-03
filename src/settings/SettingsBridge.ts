/*---------------------------------------------------------------------------------------------
 *  UnodeAi - SettingsBridge (P1#4b / P1#8)
 *  One place that reads & writes everything "settings": VS Code config (roam.*), API keys
 *  (SecretStorage), and the MCP server registry. Centralizing this both powers the Settings panel
 *  AND pulls the scattered getConfiguration('unode') calls out of extension.ts (the GLM-flagged
 *  refactor). Dependencies are injected as small interfaces so the bridge is unit-testable without
 *  the vscode module.
 *
 *  SECURITY: the bridge NEVER returns API-key plaintext. Provider status is derived from
 *  SecretStorage.has() only — a boolean, never the secret itself — so nothing sensitive can reach
 *  the webview.
 *--------------------------------------------------------------------------------------------*/

import { MCPServerConfig } from '../types';

/** Minimal SecretStorage surface (satisfied by SecretsManager). */
export interface SecretStore {
  has(name: string): Promise<boolean>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Minimal config surface (satisfied by a thin vscode.workspace.getConfiguration adapter). */
export interface ConfigStore {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Promise<void>;
}

/** A provider the Settings panel knows how to show. usesCliAuth = key not used by us (claude). */
export interface ProviderDef {
  providerId: string;
  name: string;
  apiKeySecretName: string;
  baseUrl?: string;
  usesCliAuth?: boolean;
}

export interface ProviderStatus {
  providerId: string;
  name: string;
  apiKeySecretName: string;
  /** True if a key is stored. The key VALUE is never included (security). */
  hasApiKey: boolean;
  baseUrl?: string;
  usesCliAuth: boolean;
}

export interface McpServerStatus {
  id: string;
  name: string;
  transport: MCPServerConfig['transport'];
  requiresApproval: boolean;
  /** Whether this server is currently connected in the in-process Hub (openai-compat agents). */
  connected: boolean;
  toolCount: number;
  /** Agent ids granted this server (default-deny visibility). */
  grantedTo: string[];
}

/** Live MCP state the bridge needs (injected from MCPHub + the team registry + grant resolver). */
export interface McpStateSource {
  registry: Map<string, MCPServerConfig>;
  connected(id: string): { ready: boolean; toolCount: number } | undefined;
  grantedTo(id: string): string[];
}

export interface SettingsSnapshot {
  providers: ProviderStatus[];
  mcpServers: McpServerStatus[];
}

export class SettingsBridge {
  constructor(
    private secrets: SecretStore,
    private config: ConfigStore,
    private providers: ProviderDef[],
    private mcp?: McpStateSource
  ) {}

  /** Whole-panel snapshot. Contains NO secret values — only hasApiKey booleans. */
  async getSnapshot(): Promise<SettingsSnapshot> {
    return {
      providers: await this.getProviderStatuses(),
      mcpServers: this.getMcpServers(),
    };
  }

  async getProviderStatuses(): Promise<ProviderStatus[]> {
    return Promise.all(
      this.providers.map(async (p) => ({
        providerId: p.providerId,
        name: p.name,
        apiKeySecretName: p.apiKeySecretName,
        hasApiKey: p.usesCliAuth ? false : await this.secrets.has(p.apiKeySecretName),
        baseUrl: p.baseUrl,
        usesCliAuth: p.usesCliAuth ?? false,
      }))
    );
  }

  getMcpServers(): McpServerStatus[] {
    if (!this.mcp) {
      return [];
    }
    return [...this.mcp.registry.values()].map((cfg) => {
      const conn = this.mcp!.connected(cfg.id);
      return {
        id: cfg.id,
        name: cfg.name,
        transport: cfg.transport,
        requiresApproval: cfg.requiresApproval ?? false,
        connected: !!conn?.ready,
        toolCount: conn?.toolCount ?? 0,
        grantedTo: this.mcp!.grantedTo(cfg.id),
      };
    });
  }

  async setApiKey(secretName: string, value: string): Promise<void> {
    if (!value) {
      throw new Error('Empty API key.');
    }
    await this.secrets.set(secretName, value);
  }

  async deleteApiKey(secretName: string): Promise<void> {
    await this.secrets.delete(secretName);
  }

  /** Pass-through config writes (single source of truth: the same roam.* config the native UI edits). */
  getConfig<T>(key: string, fallback: T): T {
    return this.config.get(key, fallback);
  }

  async setConfig(key: string, value: unknown): Promise<void> {
    await this.config.update(key, value);
  }
}
