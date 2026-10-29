import { useCallback, useState } from 'react';

import type { TranslationKey } from '@/utils/translations';

import type { PlacedEntry } from '../utils/coverageEntries';
import { requestPluginContentScriptSync } from '../utils/pluginEnablement';
import {
  type AccessSite,
  originsStillNeeded,
  siteCoverageEntries,
  siteGrantsToRemove,
} from '../utils/siteAccessSites';
import {
  entryHostAllowed,
  holdsAny,
  listGrants,
  removeGrants,
  requiredHostPermissions,
} from '../utils/sitePermissions';
import type { useCustomWebsites } from './useCustomWebsites';
import type { UndoOffer, WithdrawUndoOffer } from './useUndoToast';

type Coverage = Pick<
  ReturnType<typeof useCustomWebsites>,
  'customWebsites' | 'removeEntries' | 'restoreEntries' | 'restoreAccess' | 'handleRemoveWebsite'
>;

export interface SiteAccessActionsOptions {
  readonly coverage: Coverage;
  /** The plugins that are on, wherever they run: a grant one of them uses elsewhere stays. */
  readonly enabledPlugins: readonly { readonly matches: readonly string[] }[];
  readonly t: (key: TranslationKey) => string;
  readonly onUndoOffer: (offer: UndoOffer) => WithdrawUndoOffer;
  /** Called once a change has settled, so the card shows the browser's answer. */
  readonly onSettled: () => void;
}

const named = (text: string, site: string) => text.replace('{site}', () => site);

/**
 * Removing a site's access, or an added website, with an undo that gives back
 * exactly what went: the grants removed and the entries at their positions.
 * A grant something else still uses is kept, and the message says so; a
 * refused removal or re-grant is reported, never shown as done.
 */
export function useSiteAccessActions({
  coverage,
  enabledPlugins,
  t,
  onUndoOffer,
  onSettled,
}: SiteAccessActionsOptions) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const { customWebsites, removeEntries, restoreEntries, restoreAccess, handleRemoveWebsite } =
    coverage;

  const offerUndo = useCallback(
    (
      label: string,
      kept: boolean,
      origins: readonly string[],
      entries: readonly PlacedEntry[],
      returnFocus?: () => HTMLElement | null,
    ): void => {
      const message = named(t(kept ? 'siteAccessKept' : 'siteAccessRemoved'), label);
      // Nothing left to give back (only a grant for every site reached it): no undo.
      if (origins.length === 0 && entries.length === 0) {
        onUndoOffer({ message });
        return;
      }
      onUndoOffer({
        message,
        // Not awaited before the request inside: Firefox needs it first in the gesture.
        undo: () =>
          void restoreAccess(origins, entries).then((restored) => {
            if (restored && origins.length > 0) void requestPluginContentScriptSync();
            if (!restored) {
              onUndoOffer({ message: named(t('siteAccessRestoreFailed'), label), tone: 'error' });
            }
            onSettled();
          }),
        returnFocus,
      });
    },
    [onSettled, onUndoOffer, restoreAccess, t],
  );

  const reportRemoveFailed = useCallback(
    (label: string) =>
      onUndoOffer({ message: named(t('siteAccessRemoveFailed'), label), tone: 'error' }),
    [onUndoOffer, t],
  );

  /** Removes the grants that reach the site and its Prompt Manager entries. */
  const revoke = useCallback(
    async (site: AccessSite, returnFocus?: () => HTMLElement | null): Promise<void> => {
      setRevoking(site.id);
      try {
        const entries = siteCoverageEntries(customWebsites, site);
        const remaining = customWebsites.filter((entry) => !entries.includes(entry));
        const required = requiredHostPermissions();
        const origins = siteGrantsToRemove(
          site,
          await listGrants(),
          entries,
          originsStillNeeded(site, remaining, enabledPlugins),
        ).filter((origin) => !required.has(origin));
        const removed = await removeEntries(entries);
        if (origins.length > 0 && !(await removeGrants(origins))) {
          await restoreEntries(removed);
          reportRemoveFailed(site.label);
          return;
        }
        offerUndo(site.label, await holdsAny(site.origins), origins, removed, returnFocus);
      } finally {
        setRevoking(null);
        onSettled();
      }
    },
    [
      customWebsites,
      enabledPlugins,
      offerUndo,
      onSettled,
      removeEntries,
      reportRemoveFailed,
      restoreEntries,
    ],
  );

  /** Removes an added website and the grants only it used. */
  const removeWebsite = useCallback(
    async (website: string, returnFocus?: () => HTMLElement | null): Promise<void> => {
      const removed = await handleRemoveWebsite(website);
      if (removed.failed) reportRemoveFailed(website);
      else {
        const kept = await entryHostAllowed(website);
        offerUndo(website, kept, removed.origins, removed.entries, returnFocus);
      }
      onSettled();
    },
    [handleRemoveWebsite, offerUndo, onSettled, reportRemoveFailed],
  );

  return { revoking, revoke, removeWebsite };
}
