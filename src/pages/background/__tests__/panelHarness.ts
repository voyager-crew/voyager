import { vi } from 'vitest';

import {
  PANEL_MESSAGE,
  PANEL_PORT_MESSAGE,
  PANEL_PORT_NAME,
  type PanelContext,
  type PanelSession,
  parsePanelTokenIssueReply,
  parsePanelTokenRedeemReply,
} from '@/features/panel/protocol';

import { registerBackgroundRuntimeMessages } from '../runtimeMessages';

type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  reply: (value: unknown) => void,
) => boolean | undefined;
export const CONTEXT: PanelContext = {
  pageUrl: 'https://gemini.google.com/u/1/app/example',
  siteId: 'gemini',
  accountSlot: '1',
  scheme: 'dark',
  direction: 'ltr',
};

function event<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    getRules: vi.fn(),
    addRules: vi.fn(),
    removeRules: vi.fn(),
    hasListener: (listener: (...args: Args) => void) => listeners.has(listener),
    hasListeners: () => listeners.size > 0,
    addListener: vi.fn((listener: (...args: Args) => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: (...args: Args) => void) => {
      listeners.delete(listener);
    }),
    emit: (...args: Args) => {
      // Listeners added by a transition start with the next browser event.
      const currentListeners = [...listeners];
      for (const listener of currentListeners) listener(...args);
    },
    clear: () => listeners.clear(),
  };
}

export function startPanelHarness() {
  const session = new Map<string, unknown>();
  const tabs = new Map([
    [7, CONTEXT.pageUrl],
    [8, CONTEXT.pageUrl],
  ]);
  const onConnect = event<[chrome.runtime.Port]>();
  const onRemoved = event<[number, chrome.tabs.OnRemovedInfo]>();
  const onUpdated = event<[number, chrome.tabs.OnUpdatedInfo, chrome.tabs.Tab]>();
  let listener: Listener | undefined;
  const area = {
    get: vi.fn(async (key: string) =>
      session.has(key) ? { [key]: structuredClone(session.get(key)) } : {},
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) session.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (key: string) => {
      session.delete(key);
    }),
  };
  const openPopup = vi.fn(async () => {});
  const tabGet = vi.fn(async (id: number) => {
    const url = tabs.get(id);
    if (!url) throw new Error('No tab');
    return { id, url };
  });
  const tabSend = vi.fn(async (_id: number, _message: unknown, _options: unknown) => ({
    ok: true,
    result: 'from tab',
  }));
  const contains = vi.fn(async () => true);
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: {
      ...chrome.runtime,
      onConnect,
      onMessage: {
        addListener: (value: Listener) => {
          listener = value;
        },
      },
    },
    storage: { ...chrome.storage, session: area },
    tabs: {
      ...chrome.tabs,
      get: tabGet,
      sendMessage: tabSend,
      onRemoved,
      onUpdated,
      create: vi.fn(async () => ({ id: 20 })),
    },
    permissions: { contains },
    action: { openPopup },
  });

  function restart() {
    listener = undefined;
    onConnect.clear();
    onRemoved.clear();
    onUpdated.clear();
    const ignore = () => null;
    registerBackgroundRuntimeMessages({
      handlePluginMessage: ignore,
      handleGeneratedUiMessage: ignore,
      handleNotificationMessage: ignore,
      handleStarredMessage: ignore,
      handleForkMessage: ignore,
      handleCloudSyncMessage: ignore,
      handleBridgeMessage: ignore,
      announcements: {
        getPendingAnnouncements: async () => [],
        acknowledgeAnnouncement: async () => {},
      },
    });
  }

  function topSender(
    tabId = 7,
    pageUrl = tabs.get(tabId) ?? CONTEXT.pageUrl,
  ): chrome.runtime.MessageSender {
    return {
      id: chrome.runtime.id,
      frameId: 0,
      url: pageUrl,
      tab: { id: tabId, url: pageUrl } as chrome.tabs.Tab,
    };
  }

  function frameSender(panelUrl: string, tabId = 7, frameId = 4): chrome.runtime.MessageSender {
    return {
      id: chrome.runtime.id,
      frameId,
      documentId: `panel-document-${tabId}-${frameId}`,
      url: panelUrl,
      tab: { id: tabId, url: tabs.get(tabId) } as chrome.tabs.Tab,
    };
  }

  function send(message: unknown, sender = topSender()): Promise<unknown> {
    return new Promise((resolve) => {
      if (!listener) throw new Error('No background listener');
      if (listener(message, sender, resolve) !== true) resolve(undefined);
    });
  }

  async function issue(tabId = 7) {
    const reply = parsePanelTokenIssueReply(
      await send(
        { type: PANEL_MESSAGE.tokenIssue, payload: { context: CONTEXT } },
        topSender(tabId),
      ),
    );
    if (!reply?.ok) throw new Error(`Issue refused: ${JSON.stringify(reply)}`);
    return reply;
  }

  async function redeem() {
    const issued = await issue();
    const sender = frameSender(issued.panelUrl);
    const reply = parsePanelTokenRedeemReply(
      await send({ type: PANEL_MESSAGE.tokenRedeem, payload: { token: issued.token } }, sender),
    );
    if (!reply?.ok) throw new Error(`Redeem refused: ${JSON.stringify(reply)}`);
    return { ...issued, sender, session: reply.session };
  }

  function connect(sender: chrome.runtime.MessageSender, session: PanelSession) {
    const onMessage = event<[unknown, chrome.runtime.Port]>();
    const onDisconnect = event<[chrome.runtime.Port]>();
    const port: chrome.runtime.Port = {
      name: PANEL_PORT_NAME,
      sender,
      onMessage,
      onDisconnect,
      postMessage: vi.fn(),
      disconnect: vi.fn(() => onDisconnect.emit(port)),
    };
    onConnect.emit(port);
    onMessage.emit(
      { type: PANEL_PORT_MESSAGE.connect, payload: { sessionId: session.sessionId } },
      port,
    );
    return { port, onDisconnect };
  }

  async function context(context: PanelContext, sender = topSender()) {
    return await send({ type: PANEL_MESSAGE.contextUpdate, payload: { context } }, sender);
  }

  restart();
  return {
    session,
    area,
    tabs,
    contains,
    openPopup,
    tabGet,
    tabSend,
    restart,
    topSender,
    frameSender,
    send,
    issue,
    redeem,
    connect,
    context,
    onRemoved,
    onUpdated,
  };
}
