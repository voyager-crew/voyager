import browser from 'webextension-polyfill';

import {
  PANEL_MESSAGE,
  type PanelGrantTarget,
  type PanelRuntimeMessage,
  type PanelSessionId,
  parsePanelActionReply,
} from '@/features/panel/protocol';
import type { PluginManifest } from '@/features/plugins/types';

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
 * popup on its site access card instead, offering `grant` there when a feature
 * switch asked for it. False when that failed too.
 */
export function openSiteAccessFallback(
  sessionId: PanelSessionId,
  grant?: PanelGrantTarget,
): Promise<boolean> {
  return confirmed({
    type: PANEL_MESSAGE.siteAccessFallback,
    payload: grant ? { sessionId, grant } : { sessionId },
  } satisfies PanelRuntimeMessage);
}

/**
 * A feature switch this frame cannot get access for: the popup offers the
 * plugin's grant for `pageUrl`, the page the panel's rows were read for.
 * `onFailed` runs when neither the popup nor the options page opened.
 */
export function handOffPluginGrant(
  sessionId: PanelSessionId,
  plugin: Pick<PluginManifest, 'id'>,
  pageUrl: string,
  onFailed: () => void,
): void {
  void openSiteAccessFallback(sessionId, { pluginId: plugin.id, pageUrl }).then((opened) => {
    if (!opened) onFailed();
  });
}
