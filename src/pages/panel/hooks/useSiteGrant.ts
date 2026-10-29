import { useCallback, useState } from 'react';

import browser from 'webextension-polyfill';

import { markSiteIncluded } from '@/core/services/CloudSyncScope';
import { logger } from '@/core/services/LoggerService';
import type { PanelSessionId } from '@/features/panel/protocol';
import { requestPluginContentScriptSync } from '@/pages/popup/utils/pluginEnablement';
import type { AccessSite } from '@/pages/popup/utils/siteAccessSites';

import { openSiteAccessFallback } from './panelRequests';

/**
 * Turning a supported site on. The browser asks only inside the click, so the
 * request is the first thing the handler does, with nothing awaited before it.
 * Where the browser refuses to ask from this frame (it throws, or reports no
 * gesture), the popup opens on its site access card instead. A site turned on
 * joins cloud sync, even one turned off there before.
 */
export function useSiteGrant(sessionId: PanelSessionId, onFailed: () => void) {
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
      setWaiting(site.id);
      void answer
        .then(
          (granted) => {
            // The site's row follows the browser's permission events; this only starts the scripts.
            if (!granted) return;
            void requestPluginContentScriptSync();
            void markSiteIncluded(site.id).catch((error: unknown) =>
              logger.warn('Could not include the site in sync', {
                site: site.id,
                error: String(error),
              }),
            );
          },
          () => fallback(),
        )
        .finally(() => setWaiting((current) => (current === site.id ? null : current)));
    },
    [fallback],
  );

  return { waiting, grant };
}
