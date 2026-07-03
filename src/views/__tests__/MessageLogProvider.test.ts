import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { MessageBus } from '../../bus/MessageBus';
import { MessageLogProvider } from '../MessageLogProvider';

interface FakeView {
  visible: boolean;
  webview: {
    cspSource: string;
    html: string;
    options?: unknown;
    postMessage: ReturnType<typeof vi.fn>;
  };
  onDidChangeVisibility: ReturnType<typeof vi.fn>;
  onDidDispose: ReturnType<typeof vi.fn>;
  fireVisible: () => void;
  fireDispose: () => void;
}

function makeView(): FakeView {
  let visibilityHandler: (() => void) | undefined;
  let disposeHandler: (() => void) | undefined;
  return {
    visible: true,
    webview: {
      cspSource: 'test:',
      html: '',
      postMessage: vi.fn(),
    },
    onDidChangeVisibility: vi.fn((handler: () => void) => {
      visibilityHandler = handler;
      return { dispose: vi.fn() };
    }),
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: vi.fn() };
    }),
    fireVisible: () => visibilityHandler?.(),
    fireDispose: () => disposeHandler?.(),
  };
}

describe('MessageLogProvider', () => {
  it('broadcasts one feed to every attached webview and drops disposed views', () => {
    const bus = new MessageBus();
    const provider = new MessageLogProvider(bus, (id) => ({ pm: 'PM', dev: 'Developer' }[id] ?? id));
    const sidebar = makeView();
    const panel = makeView();

    provider.resolveWebviewView(sidebar as never);
    provider.resolveWebviewView(panel as never);

    bus.send('pm', 'dev', 'task.assign', { instruction: 'Fix the bug.' }, 'normal');

    expect(sidebar.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'newItem' }));
    expect(panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'newItem' }));
    expect(provider.exportItems()).toHaveLength(1);

    sidebar.fireDispose();
    bus.send('dev', 'pm', 'task.complete', { instruction: 'Done.' }, 'normal');

    expect(sidebar.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);

    bus.dispose();
  });

  it('refreshes all attached views for shared actions like clear and compact', () => {
    const bus = new MessageBus();
    const provider = new MessageLogProvider(bus);
    const sidebar = makeView();
    const panel = makeView();

    provider.resolveWebviewView(sidebar as never);
    provider.resolveWebviewView(panel as never);
    bus.send('a', 'b', 'ask.question', { instruction: 'Can you check this?' }, 'normal');

    provider.clear();

    expect(sidebar.webview.html).toContain('No activity yet');
    expect(panel.webview.html).toContain('No activity yet');

    provider.setCompact(true);

    expect(sidebar.webview.html).toContain('<body class="compact">');
    expect(panel.webview.html).toContain('<body class="compact">');

    bus.dispose();
  });
});
