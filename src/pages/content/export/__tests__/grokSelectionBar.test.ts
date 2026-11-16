import { afterEach, describe, expect, it } from 'vitest';

import { readContentStyle } from '@/tests/contentStyle';

import type { ExportMessage } from '../conversationCollector';
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

  it('takes the docked bar out of the fixed top slot', () => {
    const css = readContentStyle();
    const block =
      css.match(
        /html\[data-gv-platform='grok'\] \.gv-export-select-bar\.gv-export-select-bar--docked\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(block).toContain('position: relative;');
    expect(block).toContain('top: auto;');
    expect(block).toContain('margin: 8px auto;');
    expect(css).toMatch(/\.gv-export-select-bar\s*\{[^}]*\btop:\s*12px;/);
  });
});
