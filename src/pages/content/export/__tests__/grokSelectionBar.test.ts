import { afterEach, describe, expect, it } from 'vitest';

import type { ExportMessage, ExportMessageRole } from '../conversationCollector';
import { startExportSelectionSession } from '../exportSelectionSession';
import { dockGrokSelectionBar } from '../grokSelectionBar';

function titleRect(bottom: number): void {
  const title = document.querySelector<HTMLElement>('[data-testid="conversation-title"]');
  if (!title) throw new Error('missing title');
  title.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 200,
      height: bottom,
      right: 200,
      bottom,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-gv-platform');
});

describe('Grok export selection bar', () => {
  it('docks the bar between the title and the transcript', () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML =
      '<div id="column">' +
      '<div id="header"><h1 data-testid="conversation-title">LayerFS</h1></div>' +
      '<div data-testid="chat-transcript-scroller"><div id="first">first</div></div>' +
      '</div>';
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const release = dockGrokSelectionBar(bar);

    const header = document.querySelector('#header');
    expect(header?.nextElementSibling).toBe(bar);
    expect(bar.nextElementSibling).toBe(
      document.querySelector('[data-testid="chat-transcript-scroller"]'),
    );
    expect(bar.classList.contains('gv-export-select-bar--docked')).toBe(true);
    expect(bar.style.top).toBe('');
    release?.();
    expect(bar.classList.contains('gv-export-select-bar--docked')).toBe(false);
  });

  it('docks under a title that lives inside the transcript, ahead of the first message', () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML =
      '<div data-testid="chat-transcript-scroller">' +
      '<div id="header"><h1 data-testid="conversation-title">Title</h1></div>' +
      '<div id="first">first message</div>' +
      '</div>';
    const bar = document.createElement('div');
    bar.className = 'gv-export-select-bar';

    dockGrokSelectionBar(bar);

    expect(document.querySelector('#header')?.nextElementSibling).toBe(bar);
    expect(bar.nextElementSibling?.id).toBe('first');
  });

  it('keeps the shared fixed bar on every other site', () => {
    document.body.innerHTML =
      '<div id="header"><h1 data-testid="conversation-title">Title</h1></div>' +
      '<div data-testid="chat-transcript-scroller"></div>';
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    expect(dockGrokSelectionBar(bar)).toBeNull();
    expect(bar.parentElement).toBe(document.body);
    expect(bar.classList.contains('gv-export-select-bar--docked')).toBe(false);
  });

  it('clears the title when the transcript scroller is missing', () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML = '<h1 data-testid="conversation-title">Title</h1>';
    titleRect(48);
    const bar = document.createElement('div');
    document.body.appendChild(bar);

    const release = dockGrokSelectionBar(bar);

    expect(bar.parentElement).toBe(document.body);
    expect(bar.style.top).toBe('56px');
    release?.();
    expect(bar.style.top).toBe('');
  });

  it('places the live selection bar under the Grok title', async () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML =
      '<div id="column">' +
      '<div id="header"><h1 data-testid="conversation-title">LayerFS</h1></div>' +
      '<div data-testid="chat-transcript-scroller">' +
      '<div id="msg" data-testid="user-message">hello</div>' +
      '</div></div>';
    const host = document.querySelector<HTMLElement>('#msg');
    if (!host) throw new Error('missing message');
    const message: ExportMessage = {
      messageId: '1',
      role: 'user',
      hostElement: host,
      text: 'hello',
      starred: false,
    };
    const session = startExportSelectionSession({
      t: (key) => key,
      abortExport: () => {},
      readMessages: () => [message],
      initialSelectedMessageId: null,
      anchors: {
        topUserElement: () => host,
        conversationRoot: () => document.querySelector<HTMLElement>('#column')!,
      },
      isSameConversation: () => true,
      onConfirm: async () => {},
    });

    const bar = document.querySelector<HTMLElement>('[data-gv-export-select-bar="true"]');
    expect(document.querySelector('#header')?.nextElementSibling).toBe(bar);
    expect(bar?.classList.contains('gv-export-select-bar--docked')).toBe(true);
    expect(bar?.parentElement).not.toBe(document.body);

    session.cancel();
    await session.done;
    expect(document.querySelector('[data-gv-export-select-bar="true"]')).toBeNull();
  });
});

function box(el: HTMLElement, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function selectorLeft(host: HTMLElement): string {
  return host.querySelector<HTMLElement>('.gv-export-msg-selector')?.style.left ?? '';
}

async function selectMessages(
  hosts: readonly { id: string; role: ExportMessageRole }[],
): Promise<{ cancel: () => void; done: Promise<void> }> {
  const column = document.querySelector<HTMLElement>('#column');
  if (!column) throw new Error('missing column');
  box(column, 200, 0, 900, 800);
  const messages: ExportMessage[] = hosts.map(({ id, role }) => {
    const hostElement = document.querySelector<HTMLElement>(`#${id}`);
    if (!hostElement) throw new Error(`missing ${id}`);
    return { messageId: id, role, hostElement, text: id, starred: false };
  });
  const session = startExportSelectionSession({
    t: (key) => key,
    abortExport: () => {},
    readMessages: () => messages,
    initialSelectedMessageId: null,
    anchors: {
      topUserElement: () => messages[0]?.hostElement ?? null,
      conversationRoot: () => column,
    },
    isSameConversation: () => true,
    onConfirm: async () => {},
  });
  return session;
}

describe('Grok export checkboxes', () => {
  it('sits each checkbox on its own bubble instead of the far-left column', async () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML =
      '<div id="column">' +
      '<div id="assistant" data-testid="assistant-message">answer</div>' +
      '<div id="user" data-testid="user-message">question</div>' +
      '</div>';
    box(document.querySelector<HTMLElement>('#assistant')!, 280, 140, 500, 120);
    box(document.querySelector<HTMLElement>('#user')!, 640, 80, 180, 40);

    const session = await selectMessages([
      { id: 'assistant', role: 'assistant' },
      { id: 'user', role: 'user' },
    ]);

    expect(selectorLeft(document.querySelector<HTMLElement>('#user')!)).toBe('-28px');
    expect(selectorLeft(document.querySelector<HTMLElement>('#assistant')!)).toBe('-28px');
    session.cancel();
    await session.done;
  });

  it('keeps other sites on one checkbox column', async () => {
    document.body.innerHTML =
      '<div id="column">' +
      '<div id="assistant">answer</div>' +
      '<div id="user">question</div>' +
      '</div>';
    box(document.querySelector<HTMLElement>('#assistant')!, 280, 140, 500, 120);
    box(document.querySelector<HTMLElement>('#user')!, 640, 80, 180, 40);

    const session = await selectMessages([
      { id: 'assistant', role: 'assistant' },
      { id: 'user', role: 'user' },
    ]);

    expect(selectorLeft(document.querySelector<HTMLElement>('#user')!)).toBe('-388px');
    expect(selectorLeft(document.querySelector<HTMLElement>('#assistant')!)).toBe('-28px');
    session.cancel();
    await session.done;
  });

  it('moves the checkbox next to a bubble inset in a wide row', async () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML =
      '<div id="column"><div id="user" data-testid="user-message"><div id="bubble">question</div></div></div>';
    const host = document.querySelector<HTMLElement>('#user')!;
    box(host, 200, 100, 800, 80);
    box(document.querySelector<HTMLElement>('#bubble')!, 700, 110, 250, 40);

    const session = await selectMessages([{ id: 'user', role: 'user' }]);

    const selector = host.querySelector<HTMLElement>('.gv-export-msg-selector');
    expect(selector?.style.left).toBe('472px');
    expect(selector?.style.top).toBe('16px');
    session.cancel();
    await session.done;
  });

  it('keeps a clipped checkbox inside the bubble', async () => {
    document.documentElement.dataset.gvPlatform = 'grok';
    document.body.innerHTML = '<div id="column"><div id="user">question</div></div>';
    const host = document.querySelector<HTMLElement>('#user')!;
    host.style.overflowX = 'hidden';
    box(host, 640, 80, 180, 40);

    const session = await selectMessages([{ id: 'user', role: 'user' }]);

    expect(selectorLeft(host)).toBe('8px');
    expect(host.classList.contains('gv-export-msg-room')).toBe(true);
    session.cancel();
    await session.done;
  });
});
