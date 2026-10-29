import browser from 'webextension-polyfill';

import {
  PANEL_MESSAGE,
  type PanelRuntimeMessage,
  type PanelSessionId,
  parsePanelActionReply,
} from '@/features/panel/protocol';

/** What Prompt Manager's settings button sends: the popup, or the options page where it can't open. */
const OPEN_POPUP_MESSAGE = 'gv.openPopup';

async function confirmed(message: unknown): Promise<boolean> {
  try {
    return parsePanelActionReply(await browser.runtime.sendMessage(message))?.ok === true;
  } catch {
    return false;
  }
}

/** 完整设置: false when neither the popup nor the options page opened. */
export function openFullSettings(): Promise<boolean> {
  return confirmed({ type: OPEN_POPUP_MESSAGE });
}

/**
 * Where the browser cannot ask from inside the panel, the background opens the
 * popup on its site access card instead. False when that failed too.
 */
export function openSiteAccessFallback(sessionId: PanelSessionId): Promise<boolean> {
  return confirmed({
    type: PANEL_MESSAGE.siteAccessFallback,
    payload: { sessionId },
  } satisfies PanelRuntimeMessage);
}
