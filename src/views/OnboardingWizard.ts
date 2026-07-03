import * as vscode from 'vscode';
import { DemoTask } from '../state/DemoTasks';
import { csp, nonce, sanitizeHref } from './webviewSecurity';

const PRICING_URL = 'https://ai.weroam.xyz/pricing?lang=en';

export interface OnboardingDeps {
  getBaseUrl: () => string;
  saveProvider: (apiKey: string | undefined, baseUrl: string) => Promise<void>;
  createQuickStartTeam: () => Promise<void>;
  createSolo: () => Promise<void>;
  createCustomAgent: () => Promise<void>;
  runDemoTask: (taskId: string) => Promise<void>;
  complete: () => Promise<void>;
  openCommand: (command: string) => Promise<void>;
  openExternal: (href: string) => Promise<void>;
  demoTasks: DemoTask[];
}

type WizardMessage =
  | { command: 'saveProvider'; apiKey?: unknown; baseUrl?: unknown }
  | { command: 'createTeam'; mode?: unknown }
  | { command: 'runDemo'; taskId?: unknown }
  | { command: 'finish' | 'skip' }
  | { command: 'openCommand'; target?: unknown }
  | { command: 'openExternal'; href?: unknown };

export class OnboardingWizard {
  public static current: OnboardingWizard | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, deps: OnboardingDeps): void {
    if (OnboardingWizard.current) {
      OnboardingWizard.current.panel.reveal(vscode.ViewColumn.One);
      OnboardingWizard.current.postInitialData();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'roamOnboarding',
      'UnodeAi Setup',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] }
    );
    OnboardingWizard.current = new OnboardingWizard(panel, deps);
  }

  private constructor(panel: vscode.WebviewPanel, private deps: OnboardingDeps) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg as WizardMessage), null, this.disposables);
    this.panel.webview.html = this.html();
  }

  private async onMessage(msg: WizardMessage): Promise<void> {
    if (!msg || typeof msg.command !== 'string') {
      return;
    }
    try {
      switch (msg.command) {
        case 'saveProvider':
          await this.deps.saveProvider(
            typeof msg.apiKey === 'string' && msg.apiKey.trim() ? msg.apiKey.trim() : undefined,
            typeof msg.baseUrl === 'string' && msg.baseUrl.trim() ? msg.baseUrl.trim() : this.deps.getBaseUrl()
          );
          this.postStatus('Provider settings saved.');
          break;
        case 'createTeam':
          if (msg.mode === 'solo') {
            await this.deps.createSolo();
            this.postStatus('Solo agent ready — opening chat.');
          } else if (msg.mode === 'custom') {
            await this.deps.createCustomAgent();
            this.postStatus('Custom agent flow opened.');
          } else {
            await this.deps.createQuickStartTeam();
            this.postStatus('Quick Start team created.');
          }
          break;
        case 'runDemo':
          if (typeof msg.taskId === 'string') {
            await this.deps.runDemoTask(msg.taskId);
            this.postStatus('Demo task sent to the Project Manager.');
          }
          break;
        case 'openCommand':
          if (typeof msg.target === 'string' && allowedWizardCommand(msg.target)) {
            await this.deps.openCommand(msg.target);
          }
          break;
        case 'openExternal':
          if (typeof msg.href === 'string') {
            const href = sanitizeHref(msg.href);
            if (href) {
              await this.deps.openExternal(href);
            }
          }
          break;
        case 'finish':
        case 'skip':
          await this.deps.complete();
          this.panel.dispose();
          break;
      }
    } catch (err) {
      this.postStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  private postInitialData(): void {
    void this.panel.webview.postMessage({
      command: 'initialData',
      baseUrl: this.deps.getBaseUrl(),
      pricingUrl: sanitizeHref(PRICING_URL) ?? PRICING_URL,
      demoTasks: this.deps.demoTasks.slice(0, 3),
    });
  }

  private postStatus(text: string, isError = false): void {
    void this.panel.webview.postMessage({ command: 'status', text, isError });
  }

  private dispose(): void {
    OnboardingWizard.current = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  private html(): string {
    const scriptNonce = nonce();
    const initial = safeJson({
      baseUrl: this.deps.getBaseUrl(),
      pricingUrl: sanitizeHref(PRICING_URL) ?? PRICING_URL,
      demoTasks: this.deps.demoTasks.slice(0, 3),
    });

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp(this.panel.webview, scriptNonce)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UnodeAi Setup</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
    }
    .shell { min-height: 100vh; display: grid; grid-template-rows: 1fr auto; }
    main { width: min(760px, calc(100vw - 40px)); margin: 0 auto; padding: 42px 0 24px; }
    section { display: none; }
    section.active { display: block; }
    h1 { font-size: 26px; margin: 0 0 8px; letter-spacing: 0; }
    h2 { font-size: 20px; margin: 0 0 8px; letter-spacing: 0; }
    p { line-height: 1.55; }
    .lead { color: var(--vscode-descriptionForeground); font-size: 14px; margin: 0 0 22px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
    .card {
      position: relative;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-input-background);
      border-radius: 8px;
      padding: 14px;
      cursor: pointer;
      min-height: 118px;
    }
    .card:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
    .card.selected {
      border-color: var(--vscode-charts-yellow, #f5c542);
      background: rgba(245, 197, 66, 0.16);
      color: var(--vscode-foreground);
      box-shadow: inset 3px 0 0 var(--vscode-charts-yellow, #f5c542), 0 0 0 1px var(--vscode-charts-yellow, #f5c542);
    }
    .card.selected .card-text {
      color: var(--vscode-foreground);
    }
    /* Solo ⚡: muted until its card is selected, then a glowing yellow bolt. */
    .card .zap { filter: grayscale(0.7); opacity: 0.7; transition: filter 0.15s ease, opacity 0.15s ease; }
    .card.selected .zap {
      filter: drop-shadow(0 0 4px var(--vscode-charts-yellow, gold)) drop-shadow(0 0 9px var(--vscode-charts-yellow, gold)) brightness(1.15);
      opacity: 1;
    }
    .card-title { font-weight: 700; margin-bottom: 6px; }
    .card-text { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0; }
    label { display: block; font-weight: 600; margin: 14px 0 5px; }
    input[type="text"], input[type="password"] {
      width: 100%;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 8px;
    }
    .radio-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0 4px; }
    .radio-row label { margin: 0; font-weight: 500; display: flex; align-items: center; gap: 6px; }
    a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .status { min-height: 18px; margin-top: 14px; color: var(--vscode-descriptionForeground); }
    .status.error { color: var(--vscode-errorForeground); }
    footer {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 12px 20px;
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      background: var(--vscode-sideBar-background);
    }
    .dots { display: flex; gap: 6px; align-items: center; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); opacity: 0.45; }
    .dot.active { opacity: 1; background: var(--vscode-focusBorder); }
    .actions { display: flex; gap: 8px; }
    button {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 7px 12px;
      cursor: pointer;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.primary { border: none; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.45; cursor: default; }
  </style>
</head>
<body>
  <div class="shell">
    <main>
      <section class="active" data-step="0">
        <h1>Welcome to UnodeAi</h1>
        <p class="lead">AI agents that work together, right in VS Code.</p>
        <div class="grid">
          <button class="card" data-goto="1" type="button"><div class="card-title">Set a provider</div><p class="card-text">Connect an OpenAI-compatible gateway or use Claude Headless.</p></button>
          <button class="card" data-goto="2" type="button"><div class="card-title">Create your team</div><p class="card-text">Start with the ready-made crew and send a task to the PM.</p></button>
          <button class="card" data-goto="3" type="button"><div class="card-title">Get moving</div><p class="card-text">Run a demo task and open Chat, Dashboard, or Settings.</p></button>
        </div>
      </section>

      <section data-step="1">
        <h2>Provider</h2>
        <p class="lead">Use the default Roam OpenAI-compatible gateway, or choose Claude Headless if you already use the Claude CLI.</p>
        <div class="radio-row">
          <label><input type="radio" name="provider" value="openai-compatible" checked> OpenAI Compatible</label>
          <label><input type="radio" name="provider" value="claude-headless"> Claude Headless</label>
        </div>
        <label for="base-url">Base URL</label>
        <input id="base-url" type="text">
        <label for="api-key">API Key</label>
        <input id="api-key" type="password" autocomplete="off" placeholder="Paste your key or skip for now">
        <p><a id="pricing-link" href="#">Browse models &amp; pricing</a></p>
        <button data-action="saveProvider">Save Provider</button>
      </section>

      <section data-step="2">
        <h2>How do you want to work?</h2>
        <p class="lead">Solo is one fast agent for everyday asks. Team is a PM-led crew with an independent review gate for complex, multi-file work. You can switch or add more anytime.</p>
        <div class="grid" id="team-options">
          <button class="card selected" data-team-mode="solo" type="button">
            <div class="card-title"><span class="zap">⚡</span> Solo — one agent, fast</div>
            <p class="card-text">A single full-stack agent that codes the whole task itself (read → edit → run → verify). Best for simple/everyday work.</p>
          </button>
          <button class="card" data-team-mode="quick" type="button">
            <div class="card-title">👥 Team — PM + specialists + review</div>
            <p class="card-text">PM + Architect + Developer + Reviewer. Best for complex, multi-file work that wants an independent review gate.</p>
          </button>
          <button class="card" data-team-mode="custom" type="button">
            <div class="card-title">Custom</div>
            <p class="card-text">Open the standard Add Agent flow.</p>
          </button>
        </div>
        <button class="primary" data-action="createTeam" style="margin-top:14px">Start</button>
      </section>

      <section data-step="3">
        <h2>Demo</h2>
        <p class="lead">Pick one task and send it to the Project Manager through the normal message path.</p>
        <div class="grid" id="demo-grid"></div>
      </section>

      <section data-step="4">
        <h2>You're all set!</h2>
        <p class="lead">Open your preferred workspace view or finish setup.</p>
        <div class="grid">
          <button class="card" data-open-command="roam.showDashboard" type="button"><div class="card-title">Dashboard</div><p class="card-text">See activity and team status.</p></button>
          <button class="card" data-open-command="roam.openChat" type="button"><div class="card-title">Chat</div><p class="card-text">Talk to a selected agent.</p></button>
          <button class="card" data-open-command="roam.openSettings" type="button"><div class="card-title">Settings</div><p class="card-text">Manage keys, models, and MCP.</p></button>
        </div>
        <button class="primary" data-action="finish" style="margin-top:14px">Finish</button>
      </section>
      <div id="status" class="status" role="status"></div>
    </main>
    <footer>
      <div class="dots" id="dots" aria-label="Setup progress"></div>
      <div class="actions">
        <button data-action="back">Back</button>
        <button data-action="skip">Skip</button>
        <button class="primary" data-action="next">Get Started</button>
      </div>
    </footer>
  </div>

  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const initial = ${initial};
    let step = 0;
    let teamMode = 'solo';
    const maxStep = 4;
    const sections = Array.from(document.querySelectorAll('section[data-step]'));
    const dots = document.getElementById('dots');
    const statusEl = document.getElementById('status');
    const nextButton = document.querySelector('button[data-action="next"]');
    const backButton = document.querySelector('button[data-action="back"]');
    const baseUrl = document.getElementById('base-url');
    const apiKey = document.getElementById('api-key');
    const pricingLink = document.getElementById('pricing-link');
    baseUrl.value = initial.baseUrl || '';
    pricingLink.href = initial.pricingUrl || '#';

    function setStatus(text, isError) {
      statusEl.textContent = text || '';
      statusEl.classList.toggle('error', !!isError);
    }

    function renderDots() {
      dots.replaceChildren();
      for (let i = 0; i <= maxStep; i += 1) {
        const dot = document.createElement('span');
        dot.className = i === step ? 'dot active' : 'dot';
        dots.appendChild(dot);
      }
    }

    function renderStep() {
      sections.forEach((section) => section.classList.toggle('active', Number(section.dataset.step) === step));
      backButton.disabled = step === 0;
      nextButton.textContent = step === 0 ? 'Get Started' : step === maxStep ? 'Finish' : 'Next';
      renderDots();
    }

    function renderDemos(tasks) {
      const grid = document.getElementById('demo-grid');
      grid.replaceChildren();
      tasks.forEach((task) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card';
        button.dataset.taskId = task.id;
        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = task.title;
        const desc = document.createElement('p');
        desc.className = 'card-text';
        desc.textContent = task.description;
        const outcome = document.createElement('p');
        outcome.className = 'card-text';
        outcome.textContent = task.expectedOutcome;
        button.append(title, desc, outcome);
        grid.appendChild(button);
      });
    }

    document.addEventListener('click', (event) => {
      const target = event.target;
      const action = target.closest('[data-action]')?.dataset.action;
      if (action === 'next') {
        if (step === maxStep) {
          vscode.postMessage({ command: 'finish' });
          return;
        }
        step = Math.min(maxStep, step + 1);
        setStatus('');
        renderStep();
      } else if (action === 'back') {
        step = Math.max(0, step - 1);
        setStatus('');
        renderStep();
      } else if (action === 'skip') {
        vscode.postMessage({ command: 'skip' });
      } else if (action === 'saveProvider') {
        vscode.postMessage({ command: 'saveProvider', baseUrl: baseUrl.value, apiKey: apiKey.value });
      } else if (action === 'createTeam') {
        vscode.postMessage({ command: 'createTeam', mode: teamMode });
      } else if (action === 'finish') {
        vscode.postMessage({ command: 'finish' });
      }

      const team = target.closest('[data-team-mode]');
      if (team) {
        teamMode = team.dataset.teamMode || 'quick';
        document.querySelectorAll('[data-team-mode]').forEach((card) => card.classList.toggle('selected', card === team));
      }

      const demo = target.closest('[data-task-id]');
      if (demo) {
        vscode.postMessage({ command: 'runDemo', taskId: demo.dataset.taskId });
      }

      const open = target.closest('[data-open-command]');
      if (open) {
        vscode.postMessage({ command: 'openCommand', target: open.dataset.openCommand });
      }

      // Welcome-screen overview cards jump to their step (they looked clickable but did nothing before).
      const goto = target.closest('[data-goto]');
      if (goto) {
        step = Math.max(0, Math.min(maxStep, Number(goto.dataset.goto) || 0));
        setStatus('');
        renderStep();
      }
    });

    pricingLink.addEventListener('click', (event) => {
      event.preventDefault();
      vscode.postMessage({ command: 'openExternal', href: pricingLink.href });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'status') {
        setStatus(msg.text, msg.isError);
      } else if (msg.command === 'initialData') {
        baseUrl.value = msg.baseUrl || '';
        pricingLink.href = msg.pricingUrl || '#';
        renderDemos(msg.demoTasks || []);
      }
    });

    renderDemos(initial.demoTasks || []);
    renderStep();
  </script>
</body>
</html>`;
  }
}

function allowedWizardCommand(command: string): boolean {
  return command === 'roam.showDashboard' || command === 'roam.openChat' || command === 'roam.openSettings';
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
