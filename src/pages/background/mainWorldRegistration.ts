import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { getVoyagerBuildTarget, isFirefox } from '@/core/utils/browser';
import { readPlatformFormFactor } from '@/core/utils/formFactor';
import { WATERMARK_STORAGE_KEYS, resolveWatermarkSettings } from '@/core/utils/watermarkSettings';
import { packagedPluginRunsOn } from '@/features/plugins/runtime/packagedFormFactor';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { NATIVE_START_POINT_MATCHES, PACKAGED_MATCHES } from '@/features/plugins/sites/hostPolicy';

import { injectWatermarkInterceptorIntoOpenTabs } from './watermarkOpenTabs';

const FETCH_INTERCEPTOR_SCRIPT_ID = 'gv-fetch-interceptor';
const RESPONSE_COMPLETE_OBSERVER_SCRIPT_ID = 'gv-response-complete-observer';

// Business has no watermark interception, so fetch only runs at native start points.
const GEMINI_FETCH_INTERCEPTOR_MATCHES = [...NATIVE_START_POINT_MATCHES];
// Completion observation also serves Business, so it covers every packaged host.
const GEMINI_RESPONSE_COMPLETE_OBSERVER_MATCHES = [...PACKAGED_MATCHES];

export function createMainWorldRegistration() {
  async function doRegisterFetchInterceptor(injectOpenTabs: boolean): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;

    // Safari ships the interceptor as a static MAIN-world content script. A
    // dynamic copy can outlive a rebuilt temporary extension and win the
    // double-injection guard with stale code.
    if (getVoyagerBuildTarget() === 'safari') {
      try {
        await chrome.scripting.unregisterContentScripts({ ids: [FETCH_INTERCEPTOR_SCRIPT_ID] });
      } catch {
        // No-op if an older Safari build never registered it.
      }
      return;
    }

    // The fetch interceptor only matters for the download path. Preview-time
    // watermark removal happens in the content script and never touches fetch.
    const result = await chrome.storage.sync.get([...WATERMARK_STORAGE_KEYS]);
    const { download: downloadEnabled } = resolveWatermarkSettings(result);
    // On a device the download plugin skips (a phone), nothing would answer the interceptor.
    const downloadRuns = await packagedPluginRunsOn(
      OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload,
      await readPlatformFormFactor(),
    );

    try {
      // Always unregister first to update settings
      await chrome.scripting.unregisterContentScripts({ ids: [FETCH_INTERCEPTOR_SCRIPT_ID] });
    } catch {
      // No-op if script was not registered
    }

    if (!downloadEnabled || !downloadRuns) {
      logger.info('[Background] Fetch interceptor not registered (download path disabled)');
      return;
    }

    try {
      await chrome.scripting.registerContentScripts([
        {
          id: FETCH_INTERCEPTOR_SCRIPT_ID,
          js: ['fetchInterceptor.js'],
          matches: GEMINI_FETCH_INTERCEPTOR_MATCHES,
          world: 'MAIN',
          runAt: 'document_start',
          persistAcrossSessions: true,
        },
      ]);
      logger.info('[Background] Fetch interceptor registered for MAIN world');
      if (injectOpenTabs) {
        await injectWatermarkInterceptorIntoOpenTabs(GEMINI_FETCH_INTERCEPTOR_MATCHES);
      }
    } catch (error) {
      console.error('[Background] Failed to register fetch interceptor:', error);
    }
  }

  // Serialize startup and storage-triggered syncs so rapid toggle changes cannot
  // leave an older registration result as the final state.
  let fetchInterceptorRegistrationQueue: Promise<void> = Promise.resolve();

  function registerFetchInterceptor(injectOpenTabs = false): Promise<void> {
    const next = fetchInterceptorRegistrationQueue.then(() =>
      doRegisterFetchInterceptor(injectOpenTabs),
    );
    fetchInterceptorRegistrationQueue = next.catch(() => {});
    return next;
  }

  async function unregisterResponseCompleteObserver(): Promise<void> {
    if (!chrome.scripting?.unregisterContentScripts) return;

    try {
      await chrome.scripting.unregisterContentScripts({
        ids: [RESPONSE_COMPLETE_OBSERVER_SCRIPT_ID],
      });
    } catch {
      // No-op if script was not registered
    }
  }

  async function syncResponseCompleteObserverRegistration(): Promise<void> {
    if (!chrome.scripting?.registerContentScripts) return;

    await unregisterResponseCompleteObserver();

    // Firefox supports the MAIN world for registered content scripts only in
    // newer versions than this extension's Firefox minimum. Safari already has
    // this observer as a manifest MAIN-world script so page CSP cannot block it.
    if (isFirefox() || getVoyagerBuildTarget() === 'safari') return;

    const setting = await chrome.storage.sync.get({
      [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
    });
    if (setting[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED] !== true) return;

    try {
      await chrome.scripting.registerContentScripts([
        {
          id: RESPONSE_COMPLETE_OBSERVER_SCRIPT_ID,
          js: ['response-complete-observer.js'],
          matches: GEMINI_RESPONSE_COMPLETE_OBSERVER_MATCHES,
          world: 'MAIN',
          runAt: 'document_start',
          persistAcrossSessions: true,
        },
      ]);
    } catch (error) {
      console.error('[Background] Failed to register response complete observer:', error);
    }
  }

  return { registerFetchInterceptor, syncResponseCompleteObserverRegistration };
}
