/*---------------------------------------------------------------------------------------------
 *  UnodeAi - TeamMcpBridge (P2#12, foundation)
 *  Adapts the existing PM delegation tools (TeamTools: list_agents / assign_task / broadcast /
 *  run_checks) to the MCP client surface (listTools / callTool). This is the reusable CORE of
 *  "let a Claude-backed PM delegate too": today TeamTools is injected only into the in-process
 *  OpenAICompatBackend; a claude agent can only get team tools through MCP.
 *
 *  STATUS: this bridge is the transport-agnostic core. To actually hand it to claude it must be
 *  hosted behind an MCP endpoint (a local streamable-http server, or a stdio server subprocess)
 *  and added to claude's --mcp-config. That hosting/IPC layer + live verification is the remaining
 *  work (see docs/STATUS.md P2#12). The bridge itself is unit-tested here so the core logic — tool
 *  discovery + call routing back through the MessageBus — is proven independently of transport.
 *--------------------------------------------------------------------------------------------*/

import { McpClient, McpToolDef } from './MCPHub';
import { ToolSpec } from '../backend/WorkspaceTools';

/** The slice of TeamTools the bridge needs (TeamTools satisfies this structurally). */
export interface TeamToolset {
  specs(): ToolSpec[];
  has(name: string): boolean;
  run(name: string, args: Record<string, unknown>): Promise<string>;
  cancelPending?(reason?: string): number;
}

/**
 * Exposes a TeamToolset as an MCP client. listTools() maps the OpenAI-style tool specs to MCP tool
 * defs; callTool() routes back through TeamTools (which delegates over the MessageBus and awaits).
 */
export class TeamMcpBridge implements McpClient {
  constructor(private team: TeamToolset) {}

  async listTools(): Promise<McpToolDef[]> {
    return this.team.specs().map((s: ToolSpec) => ({
      name: s.function.name,
      description: s.function.description,
      inputSchema: s.function.parameters as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.team.has(name)) {
      return `Error: unknown team tool "${name}".`;
    }
    return this.team.run(name, args);
  }

  async close(): Promise<void> {
    this.team.cancelPending?.('delegation cancelled by team bridge shutdown');
  }
}
