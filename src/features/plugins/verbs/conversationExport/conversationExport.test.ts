// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/?temporary-chat=true" }
import { type Mock, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CHATGPT_EXPORT_OPEN_MESSAGE } from '@/features/plugins/builtin/chatgptExport/openMessage';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import type { SiteAdapter } from '../../types';
import { conversationExportPrimitive } from './index';

type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => void;

const chatgpt = requireBundledSiteAdapter('chatgpt');
const deepseek = requireBundledSiteAdapter('deepseek');
const listeners = new Set<MessageListener>();
const toolbar = () =>
  document.querySelector<HTMLElement>('[data-gv-component="persistent-export-toolbar"]');

/** Deliver a runtime message the way Chrome does and collect the responses. */
function askToOpen(): unknown[] {
  const responses: unknown[] = [];
  for (const listener of listeners) {
    listener({ type: CHATGPT_EXPORT_OPEN_MESSAGE }, {}, (response) => responses.push(response));
  }
  return responses;
}

function activate(adapter: SiteAdapter = chatgpt): PluginScope {
  const scope = new PluginScope();
  void conversationExportPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter,
      pluginId: 'voyager.chatgpt-export',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  return scope;
}

let scope: PluginScope | null = null;

beforeEach(() => {
  listeners.clear();
  (chrome.runtime.onMessage.addListener as unknown as Mock).mockImplementation(
    (listener: MessageListener) => listeners.add(listener),
  );
  (chrome.runtime.onMessage.removeListener as unknown as Mock).mockImplementation(
    (listener: MessageListener) => listeners.delete(listener),
  );
  (chrome.storage.sync.get as unknown as Mock).mockImplementation(
    (_keys: unknown, callback?: (items: Record<string, unknown>) => void) => callback?.({}),
  );
  document.body.innerHTML = '';
});

afterEach(async () => {
  await scope?.dispose();
  scope = null;
  document.body.innerHTML = '';
});

describe('conversationExport on ChatGPT', () => {
  it('mounts ChatGPT’s own exporter, which also covers a temporary chat on the home route', async () => {
    document.body.innerHTML = '<main><article data-turn-key="t1"></article></main>';

    scope = activate();

    // The catalog reader would need an export descriptor and a `/c/<id>` route; ChatGPT has neither.
    await expect.poll(toolbar).not.toBeNull();
    expect(toolbar()?.getAttribute('data-gv-platform')).toBe('chatgpt');
  });

  it('answers the popup: no conversation until the toolbar mounts, then opens the dialog', async () => {
    document.body.innerHTML = '<main><article data-turn-key="t1"></article></main>';

    scope = activate();
    expect(askToOpen()).toEqual([{ ok: false, reason: 'no-conversation' }]);

    await expect.poll(toolbar).not.toBeNull();
    expect(askToOpen()).toEqual([{ ok: true }]);
    await expect.poll(() => document.querySelector('.gv-export-dialog')).not.toBeNull();
  });

  it.each([
    ['another packaged id', { ...chatgpt, id: 'gemini' }],
    [
      'a catalog id with an export descriptor',
      { ...chatgpt, id: 'deepseek', export: deepseek.export },
    ],
  ])('keeps ChatGPT’s exporter when a remote site override names %s', async (_label, override) => {
    document.body.innerHTML = '<main><article data-turn-key="t1"></article></main>';

    scope = activate(override);

    // Gemini's exporter would add menus and a preload click; the catalog one no toolbar on `/`.
    await expect.poll(toolbar).not.toBeNull();
    expect(toolbar()?.getAttribute('data-gv-platform')).toBe('chatgpt');
  });

  it('stops answering the popup the moment the plugin is switched off, before the mount settles', async () => {
    scope = activate();
    expect(listeners.size).toBe(1);

    const disposal = scope.dispose();
    expect(askToOpen()).toEqual([]);
    await disposal;
    scope = null;
    expect(listeners.size).toBe(0);
  });

  it('answers the popup once, not twice, after the plugin is switched off and on again', async () => {
    document.body.innerHTML = '<main><article data-turn-key="t1"></article></main>';
    await activate().dispose();

    scope = activate();

    await expect.poll(toolbar).not.toBeNull();
    expect(askToOpen()).toEqual([{ ok: true }]);
  });

  it('stops answering the popup when the export mount throws', async () => {
    // With no body to watch, the entry gate's observer throws inside the real mount.
    document.body.remove();
    try {
      scope = activate();
      expect(listeners.size).toBe(1);
      await expect.poll(() => listeners.size).toBe(0);
    } finally {
      document.documentElement.append(document.createElement('body'));
    }
  });
});
