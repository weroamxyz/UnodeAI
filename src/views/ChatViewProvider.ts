import * as vscode from 'vscode';
import {
  appendChatMessage,
  chatHistoryKey,
  ChatHistoryMessage,
  deserializeChatHistory,
  serializeChatHistory,
} from './chatHistory';
import {
  ChatToolActivity,
  chatToolsKey,
  CHAT_TOOLS_LIMIT,
  deserializeToolActivities,
  serializeToolActivities,
} from './chatToolHistory';
import {
  ArchivedChat,
  CHAT_ARCHIVE_KEY,
  deserializeArchives,
  makeArchiveId,
  serializeArchives,
} from './chatArchive';
import { summarizeToolUse } from '../backend/toolSummary';
import { TurnContext } from '../backend/AgentBackend';
import { AgentBackendKind, ChatMode } from '../types';
import { contextLabel, ContextLabel } from './contextLabel';
import { MarkdownBlock, renderMarkdown } from './markdown';
import { ChatTranscriptAgent } from './transcriptPort';
import { TodoItem, parseTodos } from '../backend/Todos';
import { csp, esc, escAttr, nonce } from './webviewSecurity';
import { ApprovalQueue, ApprovalKind, ApprovalSettings, ApprovalRequest, ApprovalDecision } from './approvals';
import { DelegationProgressSummary } from './orchestrationProgress';

export { ApprovalKind, ApprovalSettings, ApprovalRequest, ApprovalDecision } from './approvals';

export interface ChatAgent {
  id: string;
  name: string;
  role: string;
  icon?: string;
  backend?: AgentBackendKind;
}

export interface ChatReply {
  from: string;
  fromName: string;
  text: string;
  isError: boolean;
}

export interface ChatViewDeps {
  listAgents: () => ChatAgent[];
  send: (agentId: string, text: string, mode: ChatMode) => void;
  /** Steer a running agent (G-001). Routed to the backend's interject(). */
  interject: (agentId: string, text: string) => void;
  interrupt: (agentId: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onReply: (cb: (reply: ChatReply) => void) => () => void;
  state: vscode.Memento;
  /** Current approval settings, surfaced in the chat footer selector. */
  getApprovals: () => ApprovalSettings;
  /** Persist an approval setting changed from the chat footer selector. */
  setApproval: (kind: ApprovalKind, value: string) => void;
}

interface ChatViewMessage extends ChatHistoryMessage {
  kind?: 'message';
  blocks?: MarkdownBlock[];
  live?: boolean;
}

export interface ChatToolEvent {
  phase: 'use' | 'result';
  name: string;
  input?: unknown;
  ok?: boolean;
  summary?: string;
  detail?: string;
  diff?: string;
}

interface ChatMarker {
  kind: 'marker';
  id: string;
  ts: string;
  text: string;
}

interface ChatReasoning {
  kind: 'reasoning';
  id: string;
  ts: string;
  text: string;
  live?: boolean;
}

interface ChatDelegationItem extends DelegationProgressSummary {
  kind: 'delegation';
  ts: string;
}

type ChatTranscriptItem = ChatViewMessage | ChatToolActivity | ChatMarker | ChatReasoning | ChatDelegationItem;

interface ChatViewState {
  agents: ChatAgent[];
  selectedAgentId: string;
  messages: ChatTranscriptItem[];
  runningAgentIds: string[];
  context: ContextLabel;
  mode: ChatMode;
  compact: boolean;
  todos: TodoItem[];
  approvals: ApprovalSettings;
  pendingApprovals: ApprovalRequest[];
}

type WebviewMessage =
  | { command?: 'send'; agentId?: unknown; text?: unknown; mode?: unknown }
  | { command?: 'interrupt'; agentId?: unknown }
  | { command?: 'selectAgent'; agentId?: unknown }
  | { command?: 'setMode'; agentId?: unknown; mode?: unknown }
  | { command?: 'approvalDecision'; id?: unknown; action?: unknown; note?: unknown }
  | { command?: 'setApproval'; kind?: unknown; value?: unknown };

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'roam.chat';

  private view?: vscode.WebviewView;
  private readonly replyDisposer: () => void;
  private selectedAgentId = '';
  private histories = new Map<string, ChatHistoryMessage[]>();
  private liveMessages = new Map<string, ChatHistoryMessage>();
  // F-live-analysis: the agent's in-flight reasoning ("Analysis") for the current turn, plus the
  // finalized reasoning blocks (transient — kept in memory like tool activities, not persisted).
  private liveReasoning = new Map<string, { id: string; text: string; ts: string }>();
  private reasoningItems = new Map<string, ChatReasoning[]>();
  private toolActivities = new Map<string, ChatToolActivity[]>();
  private delegations: DelegationProgressSummary[] = [];
  // C3: the agent's live checklist (latest update_todos snapshot per agent; transient, not persisted).
  private todos = new Map<string, TodoItem[]>();
  private compactionMarkers = new Map<string, ChatMarker[]>();
  private contexts = new Map<string, TurnContext>();
  private modes = new Map<string, ChatMode>();
  private runningAgentIds = new Set<string>();
  private agentIds = new Set<string>();
  private compact = false;
  private disposables: vscode.Disposable[] = [];
  // In-panel approvals (replace native modals): queued requests + their pending promise resolvers.
  private readonly approvals = new ApprovalQueue(() => this.postState());

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: ChatViewDeps
  ) {
    this.replyDisposer = this.deps.onReply((reply) => this.onReply(reply));
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
    // Re-sync whenever the view becomes visible: a refresh posted while the chat was hidden/collapsed
    // may not reach the webview, which could leave a stale agent list (e.g. showing a removed agent
    // while the Team panel shows the current roster). Re-syncing on show keeps the two in lockstep.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    }, null, this.disposables);
    webviewView.webview.html = this.getHtml(webviewView.webview);
  }

  refresh(): void {
    this.syncAgents();
    this.postState();
  }

  setDelegationProgress(summaries: DelegationProgressSummary[]): void {
    this.delegations = summaries;
    this.postState();
  }

  selectAgent(agentId: string): void {
    this.syncAgents(agentId);
    this.postState();
  }

  /** True when the chat webview is available to host an approval card (else the caller falls back). */
  canPromptApproval(): boolean {
    return !!this.view;
  }

  /**
   * Ask the user to approve a pending action inside the chat panel (styled card) instead of a native
   * modal. Reveals the panel, renders the card, and resolves when the user chooses. The caller should
   * only use this when `canPromptApproval()` is true; otherwise fall back to a native prompt so the
   * agent never deadlocks waiting on a hidden webview.
   */
  requestApproval(req: Omit<ApprovalRequest, 'id'>): Promise<ApprovalDecision> {
    try {
      this.view?.show?.(true); // bring the chat into view so the request isn't missed
    } catch {
      /* best-effort reveal */
    }
    return this.approvals.request(req);
  }

  appendDelta(agentId: string, delta: string): void {
    this.syncAgents();
    if (!this.agentIds.has(agentId) || delta.length === 0) {
      return;
    }
    const live = this.liveMessages.get(agentId) ?? {
      role: 'agent',
      text: '',
      ts: new Date().toISOString(),
      fromName: this.agentName(agentId),
    };
    live.text += delta;
    this.liveMessages.set(agentId, live);
    this.runningAgentIds.add(agentId);
    if (agentId === this.selectedAgentId) {
      this.view?.webview.postMessage({ command: 'delta', agentId, delta, fromName: live.fromName ?? 'Agent' });
    }
  }

  /** Stream the agent's reasoning/"thinking" for the current turn into a live Analysis card. */
  appendReasoning(agentId: string, delta: string): void {
    this.syncAgents();
    if (!this.agentIds.has(agentId) || delta.length === 0) {
      return;
    }
    const live = this.liveReasoning.get(agentId) ?? {
      id: `reason-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: '',
      ts: new Date().toISOString(),
    };
    live.text += delta;
    this.liveReasoning.set(agentId, live);
    this.runningAgentIds.add(agentId);
    if (agentId === this.selectedAgentId) {
      this.view?.webview.postMessage({ command: 'reasoningDelta', agentId, delta });
    }
  }

  /** Move the current turn's live reasoning into the finalized (collapsed) transcript on turn end. */
  private finalizeReasoning(agentId: string): void {
    const live = this.liveReasoning.get(agentId);
    if (!live) {
      return;
    }
    this.liveReasoning.delete(agentId);
    if (!live.text.trim()) {
      return;
    }
    const items = this.reasoningItems.get(agentId) ?? [];
    items.push({ kind: 'reasoning', id: live.id, ts: live.ts, text: live.text });
    this.reasoningItems.set(agentId, trimTransientItems(items));
  }

  appendToolActivity(agentId: string, event: ChatToolEvent): void {
    this.syncAgents();
    if (!this.agentIds.has(agentId)) {
      return;
    }
    // C3: update_todos isn't a transcript card — it (re)sets the pinned checklist. Capture the
    // snapshot from the call input and suppress both phases from the tool-card stream.
    if (event.name === 'update_todos') {
      if (event.phase === 'use') {
        this.todos.set(agentId, parseTodos(event.input));
        this.runningAgentIds.add(agentId);
        if (agentId === this.selectedAgentId) {
          this.postState();
        }
      }
      return;
    }
    const current = this.loadTools(agentId);
    const next = event.phase === 'result'
      ? updateLastPendingTool(current, event)
      : [...current, toolActivityFromEvent(event)];
    const trimmed = trimTransientItems(next, CHAT_TOOLS_LIMIT);
    this.toolActivities.set(agentId, trimmed);
    // Durable tool cards (0.6.13): persist on finalize so diffs/output survive a reload. We persist
    // only on 'result' (pending cards are filtered out by serializeToolActivities), which also keeps
    // the write frequency to one per completed tool rather than one per phase.
    if (event.phase === 'result') {
      void this.deps.state.update(chatToolsKey(agentId), serializeToolActivities(trimmed));
    }
    this.runningAgentIds.add(agentId);
    if (agentId === this.selectedAgentId) {
      this.postState();
    }
  }

  setContext(agentId: string, context: TurnContext): void {
    this.syncAgents();
    if (!this.agentIds.has(agentId)) {
      return;
    }
    this.contexts.set(agentId, context);
    if (agentId === this.selectedAgentId) {
      this.postState();
    }
  }

  appendCompactionMarker(agentId: string, dropped: number): void {
    this.syncAgents();
    if (!this.agentIds.has(agentId)) {
      return;
    }
    const markers = this.compactionMarkers.get(agentId) ?? [];
    markers.push({
      kind: 'marker',
      id: `compact-${Date.now()}-${markers.length}`,
      ts: new Date().toISOString(),
      text: dropped === 1 ? 'Compacted 1 older message' : `Compacted ${dropped} older messages`,
    });
    this.compactionMarkers.set(agentId, trimTransientItems(markers));
    if (agentId === this.selectedAgentId) {
      this.postState();
    }
  }

  /** Display name of the currently selected agent (for confirmation prompts), or undefined if none. */
  getSelectedAgentName(): string | undefined {
    return this.selectedAgentId ? this.agentName(this.selectedAgentId) : undefined;
  }

  /** Id of the currently selected chat agent (for the ⚡ Solo/team toggle), or undefined if none. */
  getSelectedAgentId(): string | undefined {
    return this.selectedAgentId || undefined;
  }

  /** Post a UnodeAi notice into an agent's chat transcript (in-panel, not an OS toast). Clears the
   *  agent's "running" state, because a notice is posted in PLACE of a turn — otherwise the composer
   *  would stay stuck on "Stop" with the input disabled (no turn_complete will ever arrive). */
  postNotice(agentId: string, text: string): void {
    this.syncAgents();
    if (!this.agentIds.has(agentId)) {
      return;
    }
    this.runningAgentIds.delete(agentId);
    this.liveMessages.delete(agentId);
    this.append(agentId, { role: 'agent', text, ts: new Date().toISOString(), fromName: 'UnodeAi' });
    if (agentId === this.selectedAgentId) {
      this.postState();
    }
  }

  exportSelected(): { agent: ChatTranscriptAgent; messages: ChatHistoryMessage[] } | undefined {
    const agents = this.syncAgents();
    const agent = agents.find((a) => a.id === this.selectedAgentId);
    if (!agent) {
      return undefined;
    }
    return {
      agent: { id: agent.id, name: agent.name, role: agent.role },
      messages: serializeChatHistory(this.loadHistory(agent.id)),
    };
  }

  hasSelectedMessages(): boolean {
    return (this.exportSelected()?.messages.length ?? 0) > 0;
  }

  importToSelected(messages: ChatHistoryMessage[]): boolean {
    const agents = this.syncAgents();
    const agent = agents.find((a) => a.id === this.selectedAgentId);
    if (!agent) {
      return false;
    }
    const next = serializeChatHistory(messages);
    this.histories.set(agent.id, next);
    this.liveMessages.delete(agent.id);
    this.liveReasoning.delete(agent.id);
    this.reasoningItems.delete(agent.id);
    this.toolActivities.delete(agent.id);
    this.todos.delete(agent.id);
    this.compactionMarkers.delete(agent.id);
    this.contexts.delete(agent.id);
    void this.deps.state.update(chatHistoryKey(agent.id), next);
    void this.deps.state.update(chatToolsKey(agent.id), undefined);
    this.postState();
    return true;
  }

  setCompact(compact = !this.compact): boolean {
    this.compact = compact;
    this.postState();
    return this.compact;
  }

  /** One-click clear of the CURRENTLY selected agent's chat transcript (keeps it selected). */
  clearSelectedAgent(): void {
    const agentId = this.selectedAgentId;
    if (!agentId) {
      return;
    }
    this.wipeAgentView(agentId);
    this.postState();
  }

  /**
   * Archive the CURRENTLY selected agent's transcript: save it to the durable archive store, then
   * wipe it from the live panel (like clear, but recoverable via "View Archived Chats"). Returns the
   * number of messages archived (0 when there's nothing to archive / no selection).
   */
  archiveSelectedAgent(): number {
    const agentId = this.selectedAgentId;
    if (!agentId) {
      return 0;
    }
    const messages = this.loadHistory(agentId);
    if (messages.length === 0) {
      return 0;
    }
    const agent = this.syncAgents().find((a) => a.id === agentId);
    const entry: ArchivedChat = {
      id: makeArchiveId(),
      agentId,
      agentName: agent?.name ?? this.agentName(agentId),
      role: agent?.role,
      archivedAt: new Date().toISOString(),
      messages: serializeChatHistory(messages),
    };
    const list = deserializeArchives(this.deps.state.get(CHAT_ARCHIVE_KEY));
    void this.deps.state.update(CHAT_ARCHIVE_KEY, serializeArchives([entry, ...list]));
    this.wipeAgentView(agentId);
    this.postState();
    return messages.length;
  }

  /** Archived chats (newest first), for the picker. */
  listArchivedChats(): ArchivedChat[] {
    return deserializeArchives(this.deps.state.get(CHAT_ARCHIVE_KEY));
  }

  /** Messages currently held for an agent (used to confirm before a restore would replace them). */
  getMessageCount(agentId: string): number {
    return this.loadHistory(agentId).length;
  }

  /**
   * Restore an archived chat back into its agent and select it. Removes the entry from the archive
   * (it's now live again). Fails if the agent is no longer in the team, or the id is unknown.
   */
  restoreArchive(id: string): { ok: boolean; reason?: 'not-found' | 'agent-gone' } {
    const list = this.listArchivedChats();
    const entry = list.find((a) => a.id === id);
    if (!entry) {
      return { ok: false, reason: 'not-found' };
    }
    this.syncAgents();
    if (!this.agentIds.has(entry.agentId)) {
      return { ok: false, reason: 'agent-gone' };
    }
    this.selectedAgentId = entry.agentId;
    this.deps.onSelectAgent?.(entry.agentId);
    this.importToSelected(entry.messages); // sets history + posts state
    void this.deps.state.update(CHAT_ARCHIVE_KEY, serializeArchives(list.filter((a) => a.id !== id)));
    return { ok: true };
  }

  /** Drop every in-memory + persisted trace of an agent's live transcript (shared by clear/archive). */
  private wipeAgentView(agentId: string): void {
    this.histories.delete(agentId);
    this.liveMessages.delete(agentId);
    this.liveReasoning.delete(agentId);
    this.reasoningItems.delete(agentId);
    this.toolActivities.delete(agentId);
    this.todos.delete(agentId);
    this.compactionMarkers.delete(agentId);
    this.contexts.delete(agentId);
    void this.deps.state.update(chatHistoryKey(agentId), undefined);
    void this.deps.state.update(chatToolsKey(agentId), undefined);
  }

  clearAgent(agentId: string): void {
    this.histories.delete(agentId);
    this.liveMessages.delete(agentId);
    this.liveReasoning.delete(agentId);
    this.reasoningItems.delete(agentId);
    this.toolActivities.delete(agentId);
    this.todos.delete(agentId);
    this.compactionMarkers.delete(agentId);
    this.contexts.delete(agentId);
    this.runningAgentIds.delete(agentId);
    void this.deps.state.update(chatHistoryKey(agentId), undefined);
    void this.deps.state.update(chatToolsKey(agentId), undefined);
    if (this.selectedAgentId === agentId) {
      this.selectedAgentId = '';
    }
    this.refresh();
  }

  dispose(): void {
    this.replyDisposer();
    // Release any in-flight approval waiters as a deny so a torn-down panel never hangs the agent.
    this.approvals.denyAll();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  private onMessage(msg: WebviewMessage): void {
    if (!msg || typeof msg.command !== 'string') {
      return;
    }
    if (msg.command === 'selectAgent') {
      const agentId = typeof msg.agentId === 'string' ? msg.agentId : '';
      if (this.agentIds.has(agentId)) {
        this.selectedAgentId = agentId;
        this.loadHistory(agentId);
        this.deps.onSelectAgent?.(agentId);
        this.postState();
      }
      return;
    }
    if (msg.command === 'setMode') {
      const agentId = typeof msg.agentId === 'string' ? msg.agentId : '';
      if (this.agentIds.has(agentId)) {
        this.modes.set(agentId, normalizeChatMode(msg.mode));
        this.postState();
      }
      return;
    }
    if (msg.command === 'send') {
      const agentId = typeof msg.agentId === 'string' ? msg.agentId : '';
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text || !this.agentIds.has(agentId) || agentId !== this.selectedAgentId) {
        return;
      }
      if (this.runningAgentIds.has(agentId)) {
        // Show the steer in the transcript (the normal send path below does this too). Without it the
        // box just clears and the steer feels IGNORED even when the backend folds it in.
        this.append(agentId, { role: 'user', text, ts: new Date().toISOString() });
        this.deps.interject(agentId, text);
        this.postState();
        return;
      }
      const mode = normalizeChatMode(msg.mode ?? this.modes.get(agentId));
      this.modes.set(agentId, mode);
      this.append(agentId, { role: 'user', text, ts: new Date().toISOString() });
      this.runningAgentIds.add(agentId);
      this.deps.send(agentId, text, mode);
      this.postState();
      return;
    }
    if (msg.command === 'interrupt') {
      const agentId = typeof msg.agentId === 'string' ? msg.agentId : '';
      if (this.agentIds.has(agentId) && this.runningAgentIds.has(agentId)) {
        this.deps.interrupt(agentId);
      }
      return;
    }
    if (msg.command === 'approvalDecision') {
      const id = typeof msg.id === 'string' ? msg.id : '';
      this.approvals.resolve(id, {
        action: typeof msg.action === 'string' ? msg.action : 'deny',
        note: typeof msg.note === 'string' && msg.note.trim() ? msg.note.trim() : undefined,
      });
      return;
    }
    if (msg.command === 'setApproval') {
      const kind: ApprovalKind = msg.kind === 'write' ? 'write' : 'command';
      const value = typeof msg.value === 'string' ? msg.value : '';
      if (value) {
        this.deps.setApproval(kind, value);
        this.postState();
      }
      return;
    }
  }

  private onReply(reply: ChatReply): void {
    this.syncAgents();
    if (!this.agentIds.has(reply.from)) {
      return;
    }
    this.runningAgentIds.delete(reply.from);
    this.finalizeReasoning(reply.from);
    this.liveMessages.delete(reply.from);
    this.append(reply.from, {
      role: 'agent',
      text: reply.text,
      ts: new Date().toISOString(),
      fromName: reply.fromName,
      isError: reply.isError,
    });
    if (reply.from === this.selectedAgentId) {
      this.postState();
    }
  }

  private append(agentId: string, message: ChatHistoryMessage): void {
    const next = appendChatMessage(this.loadHistory(agentId), message);
    this.histories.set(agentId, next);
    void this.deps.state.update(chatHistoryKey(agentId), serializeChatHistory(next));
  }

  private loadHistory(agentId: string): ChatHistoryMessage[] {
    const cached = this.histories.get(agentId);
    if (cached) {
      return cached;
    }
    const restored = deserializeChatHistory(this.deps.state.get(chatHistoryKey(agentId)));
    this.histories.set(agentId, restored);
    return restored;
  }

  /** Tool-card analogue of loadHistory: restores an agent's persisted (finalized) tool cards on first
   *  access so diffs/command output reappear after a reload. */
  private loadTools(agentId: string): ChatToolActivity[] {
    const cached = this.toolActivities.get(agentId);
    if (cached) {
      return cached;
    }
    const restored = deserializeToolActivities(this.deps.state.get(chatToolsKey(agentId)));
    this.toolActivities.set(agentId, restored);
    return restored;
  }

  private syncAgents(preferredAgentId?: string): ChatAgent[] {
    const agents = this.deps.listAgents();
    const previousAgentId = this.selectedAgentId;
    this.agentIds = new Set(agents.map((a) => a.id));
    const preferred = preferredAgentId && this.agentIds.has(preferredAgentId) ? preferredAgentId : undefined;
    if (preferred) {
      this.selectedAgentId = preferred;
    } else if (!this.selectedAgentId || !this.agentIds.has(this.selectedAgentId)) {
      this.selectedAgentId = agents[0]?.id ?? '';
    }
    if (this.selectedAgentId) {
      this.loadHistory(this.selectedAgentId);
      if (!this.modes.has(this.selectedAgentId)) {
        this.modes.set(this.selectedAgentId, 'act');
      }
    }
    if (this.selectedAgentId !== previousAgentId) {
      this.deps.onSelectAgent?.(this.selectedAgentId);
    }
    return agents;
  }

  private currentState(): ChatViewState {
    const agents = this.syncAgents();
    const selected = agents.find((a) => a.id === this.selectedAgentId);
    const messages = this.selectedAgentId
      ? this.transcriptItems(this.selectedAgentId)
      : [];
    return {
      agents,
      selectedAgentId: this.selectedAgentId,
      messages,
      runningAgentIds: Array.from(this.runningAgentIds),
      context: contextLabel(this.contexts.get(this.selectedAgentId), selected?.backend),
      mode: this.currentMode(this.selectedAgentId),
      compact: this.compact,
      todos: this.selectedAgentId ? this.todos.get(this.selectedAgentId) ?? [] : [],
      approvals: this.deps.getApprovals(),
      pendingApprovals: this.approvals.list(),
    };
  }

  private postState(): void {
    this.view?.webview.postMessage({ command: 'state', state: this.currentState() });
  }

  private transcriptItems(agentId: string): ChatTranscriptItem[] {
    return this.withLiveItems(
      agentId,
      [
        ...this.loadHistory(agentId).map((m): ChatViewMessage => ({
          ...m,
          kind: 'message',
          blocks: m.role === 'agent' ? renderMarkdown(m.text) : undefined,
        })),
        ...(this.reasoningItems.get(agentId) ?? []),
        ...this.delegationItems(agentId),
        ...this.loadTools(agentId),
        ...(this.compactionMarkers.get(agentId) ?? []),
      ]
    ).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  private delegationItems(agentId: string): ChatDelegationItem[] {
    return this.delegations
      .filter((summary) =>
        summary.coordinatorId === agentId ||
        summary.items.some((item) => item.agentId === agentId)
      )
      .map((summary) => ({
        ...summary,
        kind: 'delegation',
        ts: summary.startedAt,
        items: summary.items.map((item) => ({ ...item })),
      }));
  }

  /** Append the current turn's live reasoning (Analysis) and live reply, in stream order. */
  private withLiveItems(agentId: string, messages: ChatTranscriptItem[]): ChatTranscriptItem[] {
    const out = [...messages];
    const liveR = this.liveReasoning.get(agentId);
    if (liveR && liveR.text) {
      out.push({ kind: 'reasoning', id: liveR.id, ts: liveR.ts, text: liveR.text, live: true });
    }
    const live = this.liveMessages.get(agentId);
    if (live) {
      out.push({ ...live, kind: 'message', live: true });
    }
    return out;
  }

  private agentName(agentId: string): string {
    return this.deps.listAgents().find((a) => a.id === agentId)?.name ?? 'Agent';
  }

  private currentMode(agentId: string): ChatMode {
    if (!agentId) {
      return 'act';
    }
    const mode = this.modes.get(agentId);
    return mode === 'plan' ? 'plan' : 'act';
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptNonce = nonce();
    const initialState = this.currentState();
    const initialJson = jsonForScript(initialState);
    const options = initialState.agents.length === 0
      ? '<option value="">No agents yet</option>'
      : initialState.agents.map((a) =>
          `<option value="${escAttr(a.id)}"${a.id === initialState.selectedAgentId ? ' selected' : ''}>${esc(a.name)} (${esc(a.role)})</option>`
        ).join('');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp(webview, scriptNonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UnodeAi Chat</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-sideBar-background);
    }
    .topbar { display: flex; align-items: center; gap: 6px; min-height: 28px; }
    .topbar label { color: var(--vscode-descriptionForeground); font-size: 11px; }
    select {
      flex: 1 1 auto;
      min-width: 0;
      height: 28px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 3px 6px;
    }
    .mode-toggle {
      display: inline-flex;
      flex: 0 0 auto;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-input-background);
    }
    .mode-toggle button {
      min-width: 42px;
      height: 22px;
      border: 1px solid transparent;
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
    }
    .mode-toggle button.active.plan {
      color: #fff;
      background: var(--vscode-charts-blue);
      border-color: var(--vscode-charts-blue);
    }
    .mode-toggle button.active.act {
      color: #fff;
      background: var(--vscode-charts-green);
      border-color: var(--vscode-charts-green);
    }
    .context {
      display: grid;
      gap: 3px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .context-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .meter {
      height: 3px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .meter-fill {
      height: 100%;
      width: 0;
      background: var(--vscode-progressBar-background);
      transition: width .15s ease;
    }
    .meter-fill.medium { background: var(--vscode-charts-yellow); }
    .meter-fill.high { background: var(--vscode-errorForeground); }
    #transcript {
      flex: 1 1 auto;
      min-height: 120px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 1px;
    }
    body.compact #transcript { gap: 4px; }
    .empty {
      margin: auto;
      max-width: 240px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }
    .msg {
      max-width: 94%;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 7px 9px;
      line-height: 1.45;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    body.compact .msg {
      max-width: 100%;
      padding: 4px 7px;
      line-height: 1.28;
    }
    body.compact .msg .body,
    body.compact .msg .md {
      max-height: 2.7em;
      overflow: hidden;
      opacity: .78;
    }
    .msg.user {
      align-self: flex-end;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-color: var(--vscode-button-background);
    }
    .msg.agent {
      align-self: flex-start;
      background: var(--vscode-editor-background);
      position: relative;
    }
    /* Compact, icon-only copy button, always visible (no hover needed) at the bubble's top-right. */
    .copy-msg {
      position: absolute;
      top: 4px;
      right: 4px;
      width: 20px;
      height: 20px;
      padding: 0;
      font-size: 12px;
      line-height: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.65;
      transition: opacity 0.1s, background 0.1s;
    }
    .copy-msg:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }
    /* Keep the icon clear of long first lines. */
    .msg.agent .body, .msg.agent .md { padding-right: 22px; }
    .msg.error { border-color: #dc3545; }
    /* In the flex column, transcript items must not shrink (otherwise long messages/cards collapse
       and overlap). Keeps each bubble/card/marker at its natural height. */
    .msg, .tool-card, .marker, .reasoning, .delegation-card { flex-shrink: 0; }
    /* Claude-style status dot: gray (pulsing) = running, green = done, red = blocked/error. */
    .dot {
      flex: 0 0 auto;
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      display: inline-block;
    }
    .dot.running { background: var(--vscode-descriptionForeground); animation: roamPulse 1.1s infinite ease-in-out; }
    .dot.ok { background: var(--vscode-charts-green, #3fb950); }
    .dot.err { background: var(--vscode-errorForeground, #f85149); }
    @keyframes roamPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    /* Analysis (reasoning) card — the agent's thinking for the current turn. */
    .reasoning {
      align-self: stretch;
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-charts-purple, #a371f7);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
      overflow: hidden;
    }
    .reasoning > summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 8px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }
    .reasoning > summary::-webkit-details-marker { display: none; }
    .reasoning .reasoning-body {
      padding: 6px 9px 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
      font-style: italic;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      border-top: 1px solid var(--vscode-panel-border);
    }
    body.compact .reasoning .reasoning-body { display: none; }
    .delegation-card {
      align-self: stretch;
      border: 1px solid var(--vscode-panel-border);
      border-left: 3px solid var(--vscode-charts-blue, #58a6ff);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 86%, transparent);
      overflow: hidden;
    }
    .delegation-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
    }
    .delegation-title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .delegation-count {
      flex: 0 0 auto;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .delegation-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px 8px 7px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .delegation-row {
      display: grid;
      grid-template-columns: minmax(74px, 0.9fr) auto minmax(0, 1.8fr);
      gap: 6px;
      align-items: center;
      min-width: 0;
    }
    .delegation-agent,
    .delegation-task {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .delegation-status {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      padding: 1px 6px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .delegation-status.working { color: var(--vscode-charts-yellow, #d29922); }
    .delegation-status.done { color: var(--vscode-charts-green, #3fb950); }
    .delegation-status.blocked { color: var(--vscode-errorForeground, #f85149); }
    body.compact .delegation-list { display: none; }
    body.compact .delegation-head { border-bottom: none; padding: 5px 7px; }
    .tool-card {
      align-self: stretch;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 84%, transparent);
      overflow: hidden;
    }
    .tool-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .tool-title {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .tool-title-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tool-state {
      flex: 0 0 auto;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .tool-body {
      padding: 6px 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    body.compact .tool-head { padding: 4px 7px; border-bottom: none; }
    body.compact .tool-body { display: none; }
    .tool-card.blocked { border-color: var(--vscode-errorForeground); }
    .tool-card.edit { border-left: 3px solid var(--vscode-charts-green); }
    .tool-card.run { border-left: 3px solid var(--vscode-charts-yellow); }
    .tool-card.read { border-left: 3px solid var(--vscode-charts-blue); }
    .tool-card.mcp, .tool-card.tool { border-left: 3px solid var(--vscode-charts-purple); }
    details.tool-detail {
      margin-top: 6px;
      color: var(--vscode-foreground);
    }
    details.tool-detail summary {
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    details.tool-detail pre {
      margin-top: 4px;
      padding: 6px 8px;
      background: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--vscode-editor-background) 60%, transparent));
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 320px;
      overflow: auto;
    }
    /* Diff coloring (Cline-style); the Diff/Output details open expanded so changes are visible at a glance. */
    .diff-line { display: block; }
    .diff-add { background: color-mix(in srgb, var(--vscode-charts-green) 16%, transparent); color: var(--vscode-charts-green); }
    .diff-del { background: color-mix(in srgb, var(--vscode-charts-red) 16%, transparent); color: var(--vscode-charts-red); }
    .diff-meta { color: var(--vscode-descriptionForeground); }
    .marker {
      align-self: center;
      max-width: 92%;
      padding: 3px 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 999px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      background: var(--vscode-sideBar-background);
    }
    .thinking {
      align-self: flex-start;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .thinking .dots { display: inline-flex; gap: 3px; }
    .thinking .dots span {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      animation: roamBlink 1.2s infinite ease-in-out both;
    }
    .thinking .dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking .dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes roamBlink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
    .who {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 4px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .who-icon {
      width: 16px;
      height: 16px;
      border-radius: 4px;
      object-fit: cover;
      flex: 0 0 auto;
    }
    .who-icon-text {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      max-width: 18px;
      overflow: hidden;
      line-height: 1;
    }
    .user .who { color: color-mix(in srgb, var(--vscode-button-foreground) 72%, transparent); }
    .body { white-space: pre-wrap; }
    .md { display: flex; flex-direction: column; gap: 6px; }
    .md p, .md h1, .md h2, .md h3, .md ul { margin: 0; }
    .md h1 { font-size: 17px; }
    .md h2 { font-size: 15px; }
    .md h3 { font-size: 13px; }
    .md ul { padding-left: 18px; }
    .md table { border-collapse: collapse; width: 100%; margin: 2px 0; font-size: 12px; display: block; overflow-x: auto; }
    .md th, .md td { border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); padding: 4px 8px; text-align: left; vertical-align: top; }
    .md th { background: var(--vscode-editorWidget-background, rgba(127,127,127,0.1)); font-weight: 600; }
    .md tr:nth-child(even) td { background: rgba(127, 127, 127, 0.05); }
    .md code.inline {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .md a { color: var(--vscode-textLink-foreground); }
    .code {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--vscode-textCodeBlock-background);
    }
    .code-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 26px;
      padding: 3px 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .code button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      padding: 2px 7px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
      font-size: 10px;
    }
    pre {
      margin: 0;
      padding: 8px;
      overflow-x: auto;
      white-space: pre;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .composer { display: flex; gap: 6px; align-items: stretch; }
    .steer-hint { margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    textarea {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 46px;
      max-height: 140px;
      resize: vertical;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      padding: 7px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font: inherit;
      line-height: 1.35;
    }
    button.send {
      flex: 0 0 72px;
      border: none;
      border-radius: 6px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
      font-weight: 600;
    }
    button.send:hover { background: var(--vscode-button-hoverBackground); }
    button.stop {
      flex: 0 0 64px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 6px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      cursor: pointer;
      font-weight: 600;
    }
    button.stop:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled, textarea:disabled, select:disabled { opacity: .55; cursor: default; }
    /* C3: pinned live checklist (the agent's plan for the current task). */
    .plan {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      margin-bottom: 6px;
      background: var(--vscode-sideBar-background);
    }
    .plan[hidden] { display: none; }
    .plan > summary {
      cursor: pointer;
      list-style: none;
      padding: 5px 9px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .plan > summary::-webkit-details-marker { display: none; }
    .plan .plan-count { margin-left: auto; opacity: .8; }
    .plan.done > summary { color: var(--vscode-charts-green); }
    .plan ul { margin: 0; padding: 2px 9px 7px 9px; list-style: none; display: flex; flex-direction: column; gap: 3px; }
    .plan li { display: flex; align-items: baseline; gap: 7px; font-size: 12px; line-height: 1.3; }
    .plan li .tick { flex: 0 0 auto; width: 13px; text-align: center; }
    .plan li.done .label { text-decoration: line-through; opacity: .6; }
    .plan li.active .label { color: var(--vscode-foreground); font-weight: 600; }
    .plan li.active .tick { color: var(--vscode-charts-yellow); }
    .plan li.done .tick { color: var(--vscode-charts-green); }
    .plan li.pending { color: var(--vscode-descriptionForeground); }
    body.compact .plan ul { display: none; }

    /* In-panel approval cards (replace native modals) */
    .approvals { display: flex; flex-direction: column; gap: 6px; margin: 0 0 6px; }
    .appr-card { border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-charts-yellow));
      border-radius: 6px; background: var(--vscode-editorWidget-background); padding: 8px; font-size: 12px; }
    .appr-card .appr-title { font-weight: 600; margin-bottom: 5px; display: flex; align-items: center; gap: 6px; }
    .appr-card .appr-title .ico { color: var(--vscode-charts-yellow); }
    .appr-card pre { margin: 0 0 6px; max-height: 180px; overflow: auto; background: var(--vscode-textCodeBlock-background);
      padding: 6px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
    .appr-card .appr-cmd { font-family: var(--vscode-editor-font-family, monospace); }
    .appr-card .appr-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .appr-card .appr-actions button { font-size: 11px; padding: 3px 9px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
    .appr-card .appr-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .appr-card .appr-actions button.danger { background: transparent; color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    .appr-card .appr-note { width: 100%; margin-top: 6px; box-sizing: border-box; font-size: 11px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 6px; }

    /* Footer auto-approve selector (à la Cline/Codex) */
    .approval-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 4px 2px 6px;
      font-size: 11px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); }
    .approval-bar .appr-bar-label { display: flex; align-items: center; gap: 4px; font-weight: 600; }
    .approval-bar label { display: flex; align-items: center; gap: 4px; }
    .approval-bar select { font-size: 11px; padding: 1px 4px; background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 4px; }
  </style>
</head>
<body>
  <div class="topbar">
    <label for="agent">Agent</label>
    <select id="agent">${options}</select>
    <div class="mode-toggle" role="group" aria-label="Chat mode">
      <button id="planMode" type="button" class="plan">Plan</button>
      <button id="actMode" type="button" class="act">Act</button>
    </div>
  </div>
  <div class="context">
    <div class="context-row">
      <span id="contextText"></span>
      <span id="contextPercent"></span>
    </div>
    <div class="meter" aria-hidden="true"><div id="contextFill" class="meter-fill"></div></div>
  </div>
  <details class="plan" id="plan" open hidden>
    <summary><span>Plan</span><span class="plan-count" id="planCount"></span></summary>
    <ul id="planList"></ul>
  </details>
  <div id="transcript"></div>
  <div id="approvals" class="approvals" hidden></div>
  <div class="composer">
    <textarea id="input" placeholder="Message the selected agent"></textarea>
    <button class="send" id="send">Send</button>
    <button class="stop" id="stop" hidden title="Stop the running agent">&#9632; Stop</button>
  </div>
  <div class="steer-hint" id="steerHint" hidden>${esc('Agent is working — your message will steer it. Use Stop to cancel.')}</div>
  <div class="approval-bar">
    <span class="appr-bar-label" title="What agents may do without asking. Each prompt also appears here in the panel.">⚙ Auto-approve</span>
    <label>Commands
      <select id="cmdApproval">
        <option value="none">Disabled</option>
        <option value="ask">Ask each</option>
        <option value="allowlist">Allowlist</option>
        <option value="all">All (unsafe)</option>
      </select>
    </label>
    <label>Writes
      <select id="writeApproval">
        <option value="none">Auto (checkpointed)</option>
        <option value="ask">Ask each</option>
      </select>
    </label>
  </div>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const initialState = JSON.parse('${initialJson}');
    const agentSelect = document.getElementById('agent');
    const transcript = document.getElementById('transcript');
    const input = document.getElementById('input');
    const sendButton = document.getElementById('send');
    const stopButton = document.getElementById('stop');
    const steerHint = document.getElementById('steerHint');
    const contextText = document.getElementById('contextText');
    const contextPercent = document.getElementById('contextPercent');
    const contextFill = document.getElementById('contextFill');
    const planMode = document.getElementById('planMode');
    const actMode = document.getElementById('actMode');
    const planEl = document.getElementById('plan');
    const planList = document.getElementById('planList');
    const planCount = document.getElementById('planCount');
    const approvalsEl = document.getElementById('approvals');
    const cmdApprovalSel = document.getElementById('cmdApproval');
    const writeApprovalSel = document.getElementById('writeApproval');
    let state = initialState;

    function renderState(next) {
      state = next;
      renderCompact();
      renderAgents();
      renderMode();
      renderContext();
      renderPlan();
      renderTranscript();
      renderApprovalBar();
      renderApprovals();
      updateComposer();
    }

    function renderApprovalBar() {
      const a = state.approvals || { command: 'ask', write: 'none' };
      if (cmdApprovalSel && cmdApprovalSel.value !== a.command) cmdApprovalSel.value = a.command;
      if (writeApprovalSel && writeApprovalSel.value !== a.write) writeApprovalSel.value = a.write;
    }

    function approvalActions(req) {
      // Returns [{action, label, cls}] for the request kind.
      if (req.kind === 'write') {
        return [
          { action: 'once', label: 'Approve', cls: 'primary' },
          { action: 'always', label: 'Approve all', cls: '' },
          { action: 'deny', label: 'Deny', cls: 'danger' },
        ];
      }
      const proj = req.template ? 'Allow for "' + req.template + '"' : 'Allow for project';
      return [
        { action: 'once', label: 'Allow once', cls: 'primary' },
        // "This session" alone read as ambiguous (allow or deny?). Make every allow option start with
        // "Allow" so the choice is unmistakable and parallel with the native modal's labels.
        { action: 'session', label: 'Allow this session', cls: '' },
        { action: 'project', label: proj, cls: '' },
        { action: 'deny', label: 'Deny', cls: 'danger' },
      ];
    }

    function renderApprovals() {
      const pending = state.pendingApprovals || [];
      approvalsEl.replaceChildren();
      approvalsEl.hidden = pending.length === 0;
      for (const req of pending) {
        const card = document.createElement('div');
        card.className = 'appr-card';

        const title = document.createElement('div');
        title.className = 'appr-title';
        const ico = document.createElement('span');
        ico.className = 'ico';
        ico.textContent = '⚠';
        const titleText = document.createElement('span');
        if (req.kind === 'write') {
          titleText.textContent = req.agentName + ' wants to ' + (req.verb || 'write') + ' ' + req.path;
        } else {
          titleText.textContent = req.agentName + ' wants to run a command';
        }
        title.append(ico, titleText);
        card.appendChild(title);

        const body = document.createElement('pre');
        if (req.kind === 'write') {
          body.textContent = req.diff || '(no preview)';
        } else {
          body.className = 'appr-cmd';
          body.textContent = req.command || '';
        }
        card.appendChild(body);

        const note = document.createElement('input');
        note.type = 'text';
        note.className = 'appr-note';
        note.placeholder = 'Optional note to the agent (used if you deny)';

        const actions = document.createElement('div');
        actions.className = 'appr-actions';
        for (const a of approvalActions(req)) {
          const btn = document.createElement('button');
          btn.type = 'button';
          if (a.cls) btn.className = a.cls;
          btn.textContent = a.label;
          btn.addEventListener('click', () => {
            vscode.postMessage({
              command: 'approvalDecision',
              id: req.id,
              action: a.action,
              note: a.action === 'deny' ? note.value : '',
            });
          });
          actions.appendChild(btn);
        }
        if (req.kind === 'command') {
          card.appendChild(note);
        }
        card.appendChild(actions);
        approvalsEl.appendChild(card);
      }
    }

    const TICK = { completed: '☑', in_progress: '▸', pending: '☐' };

    function renderPlan() {
      const todos = (state.todos || []);
      if (!todos.length) {
        planEl.hidden = true;
        planList.replaceChildren();
        return;
      }
      planEl.hidden = false;
      const done = todos.filter((t) => t.status === 'completed').length;
      const allDone = done === todos.length;
      planCount.textContent = (allDone ? '✓ ' : '') + done + '/' + todos.length;
      // Once every step is done, auto-collapse the pinned plan to its one-line summary so it stops
      // eating chat height; expand again if a new (unfinished) plan starts. Click to re-open.
      planEl.open = !allDone;
      planEl.classList.toggle('done', allDone);
      planList.replaceChildren();
      for (const t of todos) {
        const li = document.createElement('li');
        const cls = t.status === 'completed' ? 'done' : (t.status === 'in_progress' ? 'active' : 'pending');
        li.className = cls;
        const tick = document.createElement('span');
        tick.className = 'tick';
        tick.textContent = TICK[t.status] || '☐';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = t.content;
        li.append(tick, label);
        planList.appendChild(li);
      }
    }

    function renderCompact() {
      document.body.classList.toggle('compact', !!state.compact);
    }

    let lastAgentsSig = null;
    function renderAgents() {
      const agents = state.agents.length ? state.agents : [{ id: '', name: 'No agents yet', role: '' }];
      const sig = agents.map((a) => a.id + '|' + a.name + '|' + a.role + '|' + (a.icon || '')).join('~~');
      if (sig !== lastAgentsSig) {
        // The roster actually changed — rebuild the option list.
        lastAgentsSig = sig;
        const previous = agentSelect.value || state.selectedAgentId;
        agentSelect.replaceChildren();
        for (const agent of agents) {
          const option = document.createElement('option');
          option.value = agent.id;
          option.textContent = agent.role ? agent.name + ' (' + agent.role + ')' : agent.name;
          agentSelect.appendChild(option);
        }
        agentSelect.value = state.selectedAgentId || previous || '';
      } else if (state.selectedAgentId && agentSelect.value !== state.selectedAgentId) {
        // Roster unchanged — only sync the selected value. Do NOT rebuild the <select>: during active
        // work there are many state pushes per second, and replaceChildren() on each one wipes an open
        // dropdown (you'd see only the selected agent until activity calmed down).
        agentSelect.value = state.selectedAgentId;
      }
    }

    function renderMode() {
      const mode = state.mode === 'plan' ? 'plan' : 'act';
      planMode.classList.toggle('active', mode === 'plan');
      actMode.classList.toggle('active', mode === 'act');
      planMode.setAttribute('aria-pressed', mode === 'plan' ? 'true' : 'false');
      actMode.setAttribute('aria-pressed', mode === 'act' ? 'true' : 'false');
    }

    function renderContext() {
      const context = state.context || { text: 'Context not measured yet', percent: 0, level: 'none' };
      contextText.textContent = context.text;
      contextPercent.textContent = context.percent > 0 ? context.percent + '%' : '';
      contextFill.className = 'meter-fill ' + (context.level || 'none');
      contextFill.style.width = Math.max(0, Math.min(100, context.percent || 0)) + '%';
    }

    // Incremental render: reuse existing DOM nodes keyed by item identity so a state update doesn't
    // rebuild the whole transcript (no flicker, no perf cliff on long chats), and only stick to the
    // bottom when the user is already there (don't yank them down while they read history).
    let nodeByKey = new Map();
    let lastRenderedAgentId = null;

    function isNearBottom() {
      return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 48;
    }

    function itemKey(m) {
      if (m.live) return m.kind === 'reasoning' ? 'live:reasoning' : 'live:message';
      // Tool cards are NOT immutable: they go use→result (the result phase adds the diff/output). Key by
      // phase too, so the result re-renders instead of reusing the frozen use-phase (input-only) node.
      if (m.kind === 'tool') return 'tool:' + m.id + ':' + m.phase + (m.ok === false ? ':err' : '');
      if (m.kind === 'delegation') return 'delegation:' + m.id + ':' + m.done + ':' + m.blocked + ':' + m.working;
      if (m.kind === 'reasoning' || m.kind === 'marker') return m.kind + ':' + m.id;
      return 'msg:' + m.role + ':' + m.ts + ':' + (m.text ? m.text.length : 0);
    }

    function renderTranscript() {
      if (state.selectedAgentId !== lastRenderedAgentId) {
        nodeByKey.clear(); // different agent → its keys don't carry over
        lastRenderedAgentId = state.selectedAgentId;
      }
      if (!state.selectedAgentId) {
        transcript.replaceChildren(empty('No agents yet.'));
        nodeByKey.clear();
        return;
      }
      const stick = isNearBottom();
      const items = state.messages;
      const seen = new Set();
      const ordered = [];
      for (const m of items) {
        const key = itemKey(m);
        seen.add(key);
        let node;
        if (m.live) {
          // The streaming element is owned by the delta path (#live-message / #live-reasoning) — reuse it
          // so in-flight tokens aren't clobbered by a state update.
          const liveId = m.kind === 'reasoning' ? 'live-reasoning' : 'live-message';
          node = document.getElementById(liveId) || nodeByKey.get(key) || renderMessage(m);
        } else {
          node = nodeByKey.get(key) || renderMessage(m); // immutable items: reuse, never rebuild
        }
        nodeByKey.set(key, node);
        ordered.push(node);
      }
      for (const key of Array.from(nodeByKey.keys())) {
        if (!seen.has(key)) nodeByKey.delete(key);
      }
      // Move the (reused or new) nodes into order in one pass; only brand-new items are constructed.
      const frag = document.createDocumentFragment();
      for (const n of ordered) frag.appendChild(n);
      transcript.replaceChildren(frag);

      const running = state.runningAgentIds.includes(state.selectedAgentId);
      const hasLive = items.some((m) => m.live);
      if (running && !hasLive) {
        transcript.appendChild(thinkingIndicator());
      } else if (!items.length) {
        transcript.appendChild(empty('No messages with this agent yet.'));
      }
      if (stick) {
        transcript.scrollTop = transcript.scrollHeight;
      }
    }

    // Rotating present-progressive verbs so a working agent never looks frozen (Claude-Code style).
    const THINKING_VERBS = [
      'Thinking', 'Pondering', 'Analyzing', 'Reasoning', 'Working', 'Cooking', 'Noodling',
      'Mulling', 'Brewing', 'Crunching', 'Synthesizing', 'Percolating', 'Considering', 'Computing',
    ];
    let thinkingVerbIdx = Math.floor(Math.random() * THINKING_VERBS.length);

    function thinkingIndicator() {
      const node = document.createElement('div');
      node.className = 'thinking';
      node.id = 'thinking-indicator';
      const label = document.createElement('span');
      label.className = 'thinking-label';
      label.textContent = THINKING_VERBS[thinkingVerbIdx % THINKING_VERBS.length];
      const dots = document.createElement('span');
      dots.className = 'dots';
      dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
      node.append(label, dots);
      return node;
    }

    // One page-lifetime timer rotates the verb wherever the indicator currently lives. Cheap no-op
    // when no indicator is on screen.
    setInterval(() => {
      const label = document.querySelector('#thinking-indicator .thinking-label');
      if (label) {
        thinkingVerbIdx = (thinkingVerbIdx + 1) % THINKING_VERBS.length;
        label.textContent = THINKING_VERBS[thinkingVerbIdx];
      }
    }, 2200);

    function empty(text) {
      const node = document.createElement('div');
      node.className = 'empty';
      node.textContent = text;
      return node;
    }

    function copyButton(text) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-msg';
      btn.title = 'Copy reply';
      btn.textContent = '⧉'; // icon-only to save space
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '⧉'; }, 1200);
        });
      });
      return btn;
    }

    function selectedAgent() {
      return (state.agents || []).find((agent) => agent.id === state.selectedAgentId);
    }

    function renderWhoIcon(icon) {
      if (typeof icon === 'string' && /^data:image\\/(?:png|jpeg|webp|svg\\+xml);base64,/.test(icon)) {
        const img = document.createElement('img');
        img.className = 'who-icon';
        img.src = icon;
        img.alt = '';
        return img;
      }
      const span = document.createElement('span');
      span.className = 'who-icon-text';
      span.textContent = icon || 'A';
      return span;
    }

    function renderMessage(message) {
      if (message.kind === 'tool') {
        return renderTool(message);
      }
      if (message.kind === 'reasoning') {
        return renderReasoning(message);
      }
      if (message.kind === 'delegation') {
        return renderDelegation(message);
      }
      if (message.kind === 'marker') {
        const marker = document.createElement('div');
        marker.className = 'marker';
        marker.textContent = message.text;
        return marker;
      }
      const node = document.createElement('div');
      node.className = 'msg ' + (message.role === 'user' ? 'user' : 'agent') + (message.isError ? ' error' : '');
      const who = document.createElement('div');
      who.className = 'who';
      if (message.role === 'user') {
        who.textContent = 'You';
      } else {
        const label = document.createElement('span');
        label.textContent = message.fromName || 'Agent';
        who.append(renderWhoIcon(selectedAgent()?.icon), label);
      }
      node.appendChild(who);
      if (message.role === 'agent' && message.live) {
        node.id = 'live-message';
        const body = document.createElement('div');
        body.className = 'body';
        body.dataset.liveBody = 'true';
        body.textContent = message.text;
        node.appendChild(body);
      } else if (message.role === 'agent') {
        // Copy button (top-right) so a finalized agent reply can be copied and relayed.
        if (message.text) {
          node.appendChild(copyButton(message.text));
        }
        node.appendChild(renderBlocks(message.blocks || []));
      } else {
        const body = document.createElement('div');
        body.className = 'body';
        body.textContent = message.text;
        node.appendChild(body);
      }
      return node;
    }

    function renderDelegation(summary) {
      const node = document.createElement('div');
      node.className = 'delegation-card';
      const head = document.createElement('div');
      head.className = 'delegation-head';

      const title = document.createElement('div');
      title.className = 'delegation-title';
      title.appendChild(statusDot(summary.working > 0, summary.blocked === 0));
      const titleText = document.createElement('span');
      titleText.textContent = summary.coordinatorName + ' ' + (summary.working > 0 ? 'delegating' : 'delegated') + ' to the crew';
      title.appendChild(titleText);

      const count = document.createElement('div');
      count.className = 'delegation-count';
      const settled = (summary.done || 0) + (summary.blocked || 0);
      count.textContent = settled + ' / ' + summary.total + ' agents complete';
      head.append(title, count);

      const list = document.createElement('div');
      list.className = 'delegation-list';
      for (const item of summary.items || []) {
        const row = document.createElement('div');
        row.className = 'delegation-row';
        const agent = document.createElement('span');
        agent.className = 'delegation-agent';
        agent.textContent = item.agentName;
        const status = document.createElement('span');
        status.className = 'delegation-status ' + item.status;
        status.textContent = item.status === 'working' ? 'Working' : (item.status === 'blocked' ? 'Blocked' : 'Done');
        const task = document.createElement('span');
        task.className = 'delegation-task';
        task.title = item.instruction || '';
        task.textContent = item.instruction || '(no instruction)';
        row.append(agent, status, task);
        list.appendChild(row);
      }

      node.append(head, list);
      return node;
    }

    function statusDot(running, ok) {
      const dot = document.createElement('span');
      dot.className = 'dot ' + (running ? 'running' : (ok === false ? 'err' : 'ok'));
      return dot;
    }

    function renderReasoning(item) {
      const node = document.createElement('details');
      node.className = 'reasoning';
      if (item.live) {
        node.id = 'live-reasoning';
        node.open = true;
      }
      const summary = document.createElement('summary');
      summary.appendChild(statusDot(!!item.live, true));
      const label = document.createElement('span');
      label.textContent = item.live ? 'Analyzing' : 'Analysis';
      summary.appendChild(label);
      const body = document.createElement('div');
      body.className = 'reasoning-body';
      body.dataset.reasonBody = 'true';
      body.textContent = item.text;
      node.append(summary, body);
      return node;
    }

    function renderTool(tool) {
      const node = document.createElement('div');
      node.className = 'tool-card ' + (tool.category || 'tool') + (tool.ok === false ? ' blocked' : '');
      const head = document.createElement('div');
      head.className = 'tool-head';
      const running = tool.phase === 'use';
      const title = document.createElement('div');
      title.className = 'tool-title';
      const titleText = document.createElement('span');
      titleText.className = 'tool-title-text';
      titleText.textContent = tool.title || tool.name;
      title.append(statusDot(running, tool.ok), titleText);
      const stateNode = document.createElement('div');
      stateNode.className = 'tool-state';
      stateNode.textContent = running ? 'Running' : (tool.ok === false ? 'Blocked' : 'Done');
      head.append(title, stateNode);
      const body = document.createElement('div');
      body.className = 'tool-body';
      body.textContent = tool.summary || tool.name;
      if (tool.input) {
        body.appendChild(renderToolDetail('Input', tool.input)); // args — least important, stays collapsed
      }
      if (tool.diff) {
        body.appendChild(renderDiffDetail(tool.diff)); // G-004: expanded + colored
      }
      if (tool.detail && tool.detail !== tool.summary) {
        // G-005: command/test output (run cards) opens expanded and is labeled "Output" — no more
        // clicking to see what npm test printed. Other tools keep a collapsed "Details".
        const isRun = tool.category === 'run';
        body.appendChild(renderToolDetail(isRun ? 'Output' : 'Details', tool.detail, isRun));
      }
      node.append(head, body);
      return node;
    }

    function renderToolDetail(label, text, open) {
      const details = document.createElement('details');
      details.className = 'tool-detail';
      if (open) { details.open = true; }
      const summary = document.createElement('summary');
      summary.textContent = label;
      const pre = document.createElement('pre');
      pre.textContent = text;
      details.append(summary, pre);
      return details;
    }

    // G-004: write diffs render EXPANDED + red/green colored, so you see what changed without clicking.
    function renderDiffDetail(text) {
      const details = document.createElement('details');
      details.className = 'tool-detail';
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'Diff';
      const pre = document.createElement('pre');
      for (const line of String(text).split('\\n')) {
        const span = document.createElement('span');
        const cls =
          (line.startsWith('+') && !line.startsWith('+++')) ? 'diff-add' :
          (line.startsWith('-') && !line.startsWith('---')) ? 'diff-del' :
          (line.startsWith('@@') || line.startsWith('+++') || line.startsWith('---')) ? 'diff-meta' : '';
        span.className = 'diff-line' + (cls ? ' ' + cls : '');
        span.textContent = line;
        pre.appendChild(span);
      }
      details.append(summary, pre);
      return details;
    }

    function renderBlocks(blocks) {
      const root = document.createElement('div');
      root.className = 'md';
      for (const block of blocks) {
        if (block.type === 'heading') {
          const h = document.createElement('h' + block.level);
          appendSpans(h, block.spans);
          root.appendChild(h);
        } else if (block.type === 'paragraph') {
          const p = document.createElement('p');
          appendSpans(p, block.spans);
          root.appendChild(p);
        } else if (block.type === 'list') {
          const ul = document.createElement('ul');
          for (const item of block.items) {
            const li = document.createElement('li');
            appendSpans(li, item);
            ul.appendChild(li);
          }
          root.appendChild(ul);
        } else if (block.type === 'code') {
          root.appendChild(renderCode(block));
        } else if (block.type === 'table') {
          const table = document.createElement('table');
          const thead = document.createElement('thead');
          const htr = document.createElement('tr');
          (block.header || []).forEach((cell, idx) => {
            const th = document.createElement('th');
            if (block.align && block.align[idx]) th.style.textAlign = block.align[idx];
            appendSpans(th, cell);
            htr.appendChild(th);
          });
          thead.appendChild(htr);
          table.appendChild(thead);
          const tbody = document.createElement('tbody');
          for (const row of (block.rows || [])) {
            const tr = document.createElement('tr');
            (row || []).forEach((cell, idx) => {
              const td = document.createElement('td');
              if (block.align && block.align[idx]) td.style.textAlign = block.align[idx];
              appendSpans(td, cell);
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          }
          table.appendChild(tbody);
          root.appendChild(table);
        }
      }
      return root;
    }

    function appendSpans(parent, spans) {
      for (const span of spans) {
        if (span.type === 'text') {
          parent.appendChild(document.createTextNode(span.text));
        } else if (span.type === 'strong') {
          const node = document.createElement('strong');
          node.textContent = span.text;
          parent.appendChild(node);
        } else if (span.type === 'em') {
          const node = document.createElement('em');
          node.textContent = span.text;
          parent.appendChild(node);
        } else if (span.type === 'code') {
          const node = document.createElement('code');
          node.className = 'inline';
          node.textContent = span.text;
          parent.appendChild(node);
        } else if (span.type === 'link') {
          const node = document.createElement('a');
          node.href = span.href;
          node.textContent = span.text;
          parent.appendChild(node);
        }
      }
    }

    function renderCode(block) {
      const wrap = document.createElement('div');
      wrap.className = 'code';
      const head = document.createElement('div');
      head.className = 'code-head';
      const lang = document.createElement('span');
      lang.textContent = block.language || 'code';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(block.code).then(() => {
          copy.textContent = 'Copied';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
        });
      });
      head.append(lang, copy);
      const pre = document.createElement('pre');
      pre.textContent = block.code;
      wrap.append(head, pre);
      return wrap;
    }

    function updateComposer() {
      const disabled = !state.selectedAgentId;
      const running = state.runningAgentIds.includes(state.selectedAgentId);
      input.disabled = disabled;
      sendButton.disabled = disabled;
      sendButton.textContent = running ? 'Steer ⚡' : 'Send';
      sendButton.title = running ? 'Send a steering message to the running agent' : '';
      stopButton.hidden = !running;
      stopButton.disabled = disabled || !running;
      steerHint.hidden = !running;
      input.placeholder = state.mode === 'plan'
        ? '[PLAN] Discuss, analyze, and plan only — @file to attach'
        : 'Message the selected agent — @path to attach a file';
      planMode.disabled = disabled || running;
      actMode.disabled = disabled || running;
      agentSelect.disabled = state.agents.length === 0;
    }

    function selectedIsRunning() {
      return state.runningAgentIds.includes(state.selectedAgentId);
    }

    function send() {
      const text = input.value.trim();
      const agentId = agentSelect.value;
      if (!text || !agentId) return;
      vscode.postMessage({ command: 'send', agentId, text, mode: state.mode || 'act' });
      input.value = '';
    }

    function stop() {
      const agentId = state.selectedAgentId;
      if (!agentId || !selectedIsRunning()) return;
      vscode.postMessage({ command: 'interrupt', agentId });
    }

    function setMode(mode) {
      if (!state.selectedAgentId || selectedIsRunning()) return;
      state.mode = mode === 'plan' ? 'plan' : 'act';
      renderMode();
      updateComposer();
      vscode.postMessage({ command: 'setMode', agentId: state.selectedAgentId, mode: state.mode });
    }

    agentSelect.addEventListener('change', () => {
      vscode.postMessage({ command: 'selectAgent', agentId: agentSelect.value });
    });
    planMode.addEventListener('click', () => setMode('plan'));
    actMode.addEventListener('click', () => setMode('act'));
    cmdApprovalSel.addEventListener('change', () => {
      vscode.postMessage({ command: 'setApproval', kind: 'command', value: cmdApprovalSel.value });
    });
    writeApprovalSel.addEventListener('change', () => {
      vscode.postMessage({ command: 'setApproval', kind: 'write', value: writeApprovalSel.value });
    });
    sendButton.addEventListener('click', send);
    stopButton.addEventListener('click', stop);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    function appendDelta(msg) {
      if (msg.agentId !== state.selectedAgentId) return;
      const stick = isNearBottom();
      if (!state.runningAgentIds.includes(msg.agentId)) {
        state.runningAgentIds.push(msg.agentId);
      }
      const indicator = document.getElementById('thinking-indicator');
      if (indicator) indicator.remove();
      let live = document.getElementById('live-message');
      if (!live) {
        const emptyNode = transcript.querySelector('.empty');
        if (emptyNode) emptyNode.remove();
        live = renderMessage({ role: 'agent', text: '', ts: new Date().toISOString(), fromName: msg.fromName || 'Agent', live: true });
        transcript.appendChild(live);
      }
      const body = live.querySelector('[data-live-body="true"]');
      if (body) {
        body.appendChild(document.createTextNode(msg.delta));
      }
      if (stick) transcript.scrollTop = transcript.scrollHeight;
      updateComposer();
    }
    function appendReasoning(msg) {
      if (msg.agentId !== state.selectedAgentId) return;
      const stick = isNearBottom();
      if (!state.runningAgentIds.includes(msg.agentId)) {
        state.runningAgentIds.push(msg.agentId);
      }
      const indicator = document.getElementById('thinking-indicator');
      if (indicator) indicator.remove();
      let card = document.getElementById('live-reasoning');
      if (!card) {
        const emptyNode = transcript.querySelector('.empty');
        if (emptyNode) emptyNode.remove();
        card = renderReasoning({ text: '', ts: new Date().toISOString(), live: true });
        const live = document.getElementById('live-message');
        if (live) {
          transcript.insertBefore(card, live);
        } else {
          transcript.appendChild(card);
        }
      }
      const body = card.querySelector('[data-reason-body="true"]');
      if (body) {
        body.appendChild(document.createTextNode(msg.delta));
      }
      if (stick) transcript.scrollTop = transcript.scrollHeight;
      updateComposer();
    }
    window.addEventListener('message', (event) => {
      if (event.data.command === 'state') {
        renderState(event.data.state);
      } else if (event.data.command === 'delta') {
        appendDelta(event.data);
      } else if (event.data.command === 'reasoningDelta') {
        appendReasoning(event.data);
      }
    });
    renderState(initialState);
  </script>
</body>
</html>`;
  }
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function toolActivityFromEvent(event: ChatToolEvent): ChatToolActivity {
  const base = summarizeToolUse(event.name, event.input);
  return {
    kind: 'tool',
    id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ts: new Date().toISOString(),
    phase: event.phase,
    name: event.name,
    title: base.title,
    summary: event.summary ?? base.summary,
    category: base.category,
    input: formatToolInput(event.input),
    ok: event.ok,
    detail: event.detail,
    diff: event.diff,
  };
}

function updateLastPendingTool(current: ChatToolActivity[], event: ChatToolEvent): ChatToolActivity[] {
  const next = [...current];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].name === event.name && next[i].phase === 'use') {
      next[i] = {
        ...next[i],
        phase: 'result',
        ok: event.ok,
        summary: event.summary ?? next[i].summary,
        detail: event.detail,
        diff: event.diff,
      };
      return next;
    }
  }
  return [...next, toolActivityFromEvent(event)];
}

function trimTransientItems<T>(items: T[], limit = 40): T[] {
  return items.slice(-limit);
}

function formatToolInput(input: unknown): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function normalizeChatMode(mode: unknown): ChatMode {
  return mode === 'plan' ? 'plan' : 'act';
}
