/**
 * The page side of the scripted crash guard, a permanent page service in the
 * top frame of every site creations can target (Chrome and Edge builds only,
 * the only ones that run them):
 *
 * - once the document is complete, and again after each same-document
 *   navigation, it waits `SCRIPTED_LOADED_DELAY_MS` and sends
 *   `scriptedLoadedMessage()`. A timer fires only when the main thread is free,
 *   so a page a creation froze never confirms; the background turns off what
 *   ran on a load that never did. A tab update Chrome reports for an in-app
 *   navigation is confirmed the same way.
 * - it shows each crash notice the background left for this site once, naming
 *   the creations it turned off, then asks the background to clear them.
 * - it reloads the page when the popup or panel relays the user's click on
 *   "Reload this page".
 */
import { StorageKeys } from '@/core/types/common';
import { createToaster } from '@/core/ui/toast/toaster';
import { getVoyagerBuildTarget } from '@/core/utils/browser';
import { authoringSiteForUrl } from '@/features/plugins/local/authoringSites';
import {
  type LocalPluginRecordMap,
  loadLocalPluginRecords,
} from '@/features/plugins/local/localPluginStore';
import {
  SCRIPTED_LOADED_DELAY_MS,
  SCRIPTED_RELOAD_PAGE_REQUEST,
  type ScriptedMessage,
  scriptedClearNoticeMessage,
  scriptedLoadedMessage,
} from '@/features/plugins/scripted/messages';
import { parseScriptedState } from '@/features/plugins/scripted/parseState';
import type { ScriptedStateV1 } from '@/features/plugins/scripted/types';
import { getTranslationSync } from '@/utils/i18n';
import { fillPlaceholders } from '@/utils/translations';

import type { StopNativeFeature } from '../featureLifecycle';

type MessageListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];

const NOTICE_MS = 15_000;

export interface ScriptedGuardDeps {
  readonly send?: (message: ScriptedMessage) => Promise<unknown>;
  readonly readState?: () => Promise<ScriptedStateV1>;
  readonly readRecords?: () => Promise<LocalPluginRecordMap>;
  readonly reload?: () => void;
}

async function readStoredState(): Promise<ScriptedStateV1> {
  const stored = await chrome.storage.local.get(StorageKeys.PLUGIN_SCRIPTED_STATE);
  return parseScriptedState(stored?.[StorageKeys.PLUGIN_SCRIPTED_STATE]);
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function nameOf(records: LocalPluginRecordMap, id: string): string {
  const name = records[id]?.manifest.name;
  return typeof name === 'string' && name.trim() !== '' ? name : id;
}

/** Ids of the creations turned off after a freeze on this site, oldest notice first. */
export function noticesForOrigin(state: ScriptedStateV1, origin: string): string[] {
  return Object.entries(state.crashNotices)
    .filter(([, notice]) => sameOrigin(notice.url, origin))
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([id]) => id);
}

export function startScriptedPageGuard(deps: ScriptedGuardDeps = {}): StopNativeFeature {
  if (window.top !== window) return () => {};
  const target = getVoyagerBuildTarget();
  if ((target !== 'chrome' && target !== 'edge') || !authoringSiteForUrl(location.href)) {
    return () => {};
  }
  const send = deps.send ?? ((message: ScriptedMessage) => chrome.runtime.sendMessage(message));
  const reload = deps.reload ?? (() => location.reload());
  const toaster = createToaster();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const confirmSoon = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) void send(scriptedLoadedMessage()).catch(() => {});
    }, SCRIPTED_LOADED_DELAY_MS);
  };
  const onLoad = (): void => confirmSoon();
  if (document.readyState === 'complete') confirmSoon();
  else window.addEventListener('load', onLoad, { once: true });

  const navigation = (window as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener('navigatesuccess', confirmSoon);
  window.addEventListener('popstate', confirmSoon);

  const showNotices = async (): Promise<void> => {
    const state = await (deps.readState ?? readStoredState)();
    const ids = noticesForOrigin(state, location.origin);
    if (stopped || ids.length === 0) return;
    const records = await (deps.readRecords ?? loadLocalPluginRecords)();
    if (stopped) return;
    const names = ids.map((id) => nameOf(records, id));
    toaster.show({
      message:
        names.length === 1
          ? fillPlaceholders(getTranslationSync('scriptedCrashOne'), { name: names[0] })
          : fillPlaceholders(getTranslationSync('scriptedCrashMany'), {
              names: names.map((name) => `“${name}”`).join(', '),
            }),
      tone: 'warning',
      durationMs: NOTICE_MS,
    });
    for (const id of ids) void send(scriptedClearNoticeMessage(id)).catch(() => {});
  };
  void showNotices().catch(() => {});

  const listener: MessageListener = (message, _sender, sendResponse) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      message.type !== SCRIPTED_RELOAD_PAGE_REQUEST
    ) {
      return;
    }
    sendResponse({ ok: true });
    reload();
  };
  chrome.runtime.onMessage.addListener(listener);

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    window.removeEventListener('load', onLoad);
    window.removeEventListener('popstate', confirmSoon);
    navigation?.removeEventListener('navigatesuccess', confirmSoon);
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch {
      // The extension may have been reloaded while the page stayed open.
    }
    toaster.destroy();
  };
}
