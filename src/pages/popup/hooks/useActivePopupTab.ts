import { useCallback, useEffect, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import {
  type AccountPlatform,
  detectAccountPlatformFromUrl,
} from '@/core/services/AccountIsolationService';

/** The inspected tab can be supplied by an embedded popup or resolved from the active window. */
export function useActivePopupTab(sourceTabId?: number) {
  const [activeUrl, setActiveUrl] = useState('');
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  // `null`: the tab is a web page without a folder bucket (ChatGPT, Claude, DeepSeek, …).
  const [activeAccountPlatform, setActiveAccountPlatform] = useState<AccountPlatform | null>(
    'gemini',
  );
  const [activeTabContextLoaded, setActiveTabContextLoaded] = useState(false);
  const [resolvedSourceTabId, setResolvedSourceTabId] = useState<number | undefined>(undefined);
  // Older reads must not replace the context after another read or source-tab change.
  const requestVersion = useRef(0);

  const refreshActiveTabContext = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      let tab =
        typeof sourceTabId === 'number'
          ? await browser.tabs.get(sourceTabId).catch(() => null)
          : null;
      tab ??= (await browser.tabs.query({ active: true, currentWindow: true }))[0] ?? null;
      if (version !== requestVersion.current) return;
      const url = tab?.url || '';
      setActiveUrl(url);
      setActiveTabId(typeof tab?.id === 'number' ? tab.id : null);
      setActiveAccountPlatform(detectAccountPlatformFromUrl(url));
    } catch {
      // Keep the previous context when tab inspection fails.
    } finally {
      if (version === requestVersion.current) {
        setResolvedSourceTabId(sourceTabId);
        setActiveTabContextLoaded(true);
      }
    }
  }, [sourceTabId]);

  useEffect(() => {
    void refreshActiveTabContext();
    return () => {
      requestVersion.current += 1;
    };
  }, [refreshActiveTabContext]);

  return {
    activeUrl,
    activeTabId,
    activeAccountPlatform,
    // A newly supplied options source is unresolved even while the previous tab is still cached.
    activeTabContextLoaded: activeTabContextLoaded && resolvedSourceTabId === sourceTabId,
    refreshActiveTabContext,
  };
}
