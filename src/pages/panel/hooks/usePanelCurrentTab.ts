import { useEffect, useMemo, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  PANEL_MESSAGE,
  PANEL_PORT_MESSAGE,
  PANEL_PORT_NAME,
  type PanelContext,
  type PanelPortConnectMessage,
  type PanelRuntimeMessage,
  type PanelSession,
  type PanelSessionId,
  parsePanelPortContextMessage,
  parsePanelTabRequestReply,
} from '@/features/panel/protocol';
import type { CurrentTab, TabRequester } from '@/pages/popup/hooks/currentTab';

export interface PanelCurrentTab extends CurrentTab {
  /** The shell's tab-scoped context: page URL, site id, account slot, scheme and direction. */
  readonly context: PanelContext;
}

/**
 * Asks the page's content script through the background relay. The background
 * picks the tab from this frame's own registration, never from the panel.
 */
export function panelTabRequester(sessionId: PanelSessionId): TabRequester {
  return async (request) => {
    const reply = parsePanelTabRequestReply(
      await browser.runtime.sendMessage({
        type: PANEL_MESSAGE.tabRequest,
        payload: { sessionId, request },
      } satisfies PanelRuntimeMessage),
    );
    if (!reply) throw new Error('invalid_reply');
    if (!reply.ok) throw new Error(reply.error);
    return reply.response;
  };
}

/** The panel's current tab: the redeemed context, then each update the background forwards. */
export function usePanelCurrentTab(session: PanelSession): PanelCurrentTab {
  const [context, setContext] = useState(session.context);
  const { sessionId } = session;

  useEffect(() => {
    let port: browser.Runtime.Port;
    try {
      port = browser.runtime.connect({ name: PANEL_PORT_NAME });
    } catch {
      // Background unavailable: keep the context the session was redeemed with.
      return undefined;
    }
    const onMessage = (message: unknown) => {
      const update = parsePanelPortContextMessage(message);
      if (update?.payload.sessionId === sessionId) setContext(update.payload.context);
    };
    port.onMessage.addListener(onMessage);
    try {
      port.postMessage({
        type: PANEL_PORT_MESSAGE.connect,
        payload: { sessionId },
      } satisfies PanelPortConnectMessage);
    } catch {
      // A port the background already closed delivers nothing more.
    }
    return () => {
      port.onMessage.removeListener(onMessage);
      try {
        port.disconnect();
      } catch {
        // Already disconnected.
      }
    };
  }, [sessionId]);

  const requestTab = useMemo(() => panelTabRequester(sessionId), [sessionId]);
  return { activeUrl: context.pageUrl, activeTabContextLoaded: true, requestTab, context };
}
