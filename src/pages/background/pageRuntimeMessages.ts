import {
  type AccountPlatform,
  accountIsolationService,
  detectAccountPlatformFromUrl,
} from '@/core/services/AccountIsolationService';
import { FORM_FACTOR_MESSAGE, formFactorResponse } from '@/core/utils/formFactor';
import { LIBRARY_OPEN_MESSAGE, LIBRARY_PAGE_PATH } from '@/features/savedLibrary/openLibraryPage';

async function openSettingsPageFallback(sourceTabId?: number): Promise<void> {
  if (typeof sourceTabId === 'number') {
    const url = chrome.runtime.getURL(`src/pages/options/index.html?sourceTabId=${sourceTabId}`);
    await chrome.tabs.create({ url });
    return;
  }

  if (chrome.runtime.openOptionsPage) {
    await chrome.runtime.openOptionsPage();
    return;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/options/index.html') });
}

export function handlePageRuntimeMessage(
  message: { type: string; payload?: unknown; url?: unknown; data?: unknown; timeout?: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> | null {
  if (
    ![
      LIBRARY_OPEN_MESSAGE,
      FORM_FACTOR_MESSAGE,
      'gv.account.resolve',
      'gv.openPopup',
      'gv.syncToIDE',
      'gv.checkSyncStatus',
    ].includes(message.type)
  )
    return null;
  // Content scripts have no getPlatformInfo; they ask here (`core/utils/formFactor.ts`).
  if (message.type === FORM_FACTOR_MESSAGE) return formFactorResponse();
  return (async () => {
    if (message.type === LIBRARY_OPEN_MESSAGE) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(LIBRARY_PAGE_PATH) });
      return { ok: true };
    }

    if (message?.type === 'gv.account.resolve') {
      const payload = message.payload as {
        pageUrl?: string;
        routeUserId?: string | null;
        email?: string | null;
        platform?: AccountPlatform;
        persist?: unknown;
      };
      const resolvedPlatform =
        payload?.platform ??
        detectAccountPlatformFromUrl(payload?.pageUrl ?? sender.tab?.url ?? null);
      const hints = {
        pageUrl: payload?.pageUrl ?? sender.tab?.url ?? null,
        routeUserId: payload?.routeUserId ?? null,
        email: payload?.email ?? null,
      };
      const scope =
        payload?.persist === false
          ? await accountIsolationService.resolveAccountScope(hints, false)
          : await accountIsolationService.resolveAccountScope(hints);
      return {
        ok: true,
        scope,
        enabled: await accountIsolationService.isIsolationEnabled({
          platform: resolvedPlatform,
          pageUrl: payload?.pageUrl ?? sender.tab?.url ?? null,
        }),
      };
    }

    // Handle popup opening request
    if (message && message.type === 'gv.openPopup') {
      try {
        await chrome.action.openPopup();
        return { ok: true };
      } catch (e) {
        console.warn('[GV] Failed to open popup programmatically:', e);
        try {
          await openSettingsPageFallback(sender.tab?.id);
          return { ok: true, fallback: 'options' };
        } catch (fallbackError) {
          return {
            ok: false,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          };
        }
      }
    }

    // Handle sync to IDE (bypasses page CSP)
    if (message?.type === 'gv.syncToIDE') {
      const url = String(message.url || '');
      const data = message.data || [];
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          mode: 'cors',
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}` };
        } else {
          const result = await response.json();
          return { ok: true, data: result };
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    // Handle check sync server status (bypasses page CSP)
    if (message?.type === 'gv.checkSyncStatus') {
      const url = String(message.url || '');
      const timeout = Number(message.timeout || 200);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });
        return { ok: response.ok };
      } catch {
        return { ok: false };
      } finally {
        clearTimeout(timeoutId);
      }
    }
  })();
}
