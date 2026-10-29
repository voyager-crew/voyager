import { useCallback, useState } from 'react';

import browser from 'webextension-polyfill';

import type { PanelSessionId } from '@/features/panel/protocol';
import type { AccessSite } from '@/features/plugins/sites/siteAccessSites';
import { requestPluginContentScriptSync } from '@/pages/popup/utils/pluginEnablement';

import { openSiteAccessFallback } from './panelRequests';

/**
 * Turning a supported site on. The browser asks only inside the click, so the
 * request is the first thing the handler does, with nothing awaited before it.
 * Where the browser refuses to ask from this frame (it throws, or reports no
 * gesture), the popup opens on its site access card instead. A site turned on
 * joins cloud sync, even one turned off there before: `onAsked` starts as the
 * browser asks, and the call it returns runs once the browser granted the site
 * here (not through the popup fallback).
 */
export function useSiteGrant(
  sessionId: PanelSessionId,
  onFailed: () => void,
  onAsked: (site: AccessSite) => () => void,
) {
  /** The site whose browser prompt is up. */
  const [waiting, setWaiting] = useState<string | null>(null);

  const fallback = useCallback(async () => {
    if (!(await openSiteAccessFallback(sessionId))) onFailed();
  }, [onFailed, sessionId]);

  const grant = useCallback(
    (site: AccessSite) => {
      let answer: Promise<boolean>;
      try {
        answer = browser.permissions.request({ origins: [...site.origins] });
      } catch {
        void fallback();
        return;
      }
      const included = onAsked(site);
      setWaiting(site.id);
      void answer
        .then(
          (granted) => {
            // The site's row follows the browser's permission events; this only starts the scripts.
            if (!granted) return;
            void requestPluginContentScriptSync();
            included();
          },
          () => fallback(),
        )
        .finally(() => setWaiting((current) => (current === site.id ? null : current)));
    },
    [fallback, onAsked],
  );

  return { waiting, grant };
}
