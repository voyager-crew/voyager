import { useCallback } from 'react';

import {
  markSiteIncluded,
  parseCloudSyncScope,
  setSyncScopeRow,
} from '@/core/services/CloudSyncScope';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import type { UndoOffer, WithdrawUndoOffer } from '@/pages/popup/hooks/useUndoToast';
import type { TranslationKey } from '@/utils/translations';

import { siteAddedLabel } from './syncCopy';

const KEY = StorageKeys.CLOUD_SYNC_SCOPE;

async function readRaw(): Promise<unknown> {
  const stored: Record<string, unknown> = await chrome.storage.local.get(KEY);
  return stored[KEY];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Undo is offered only when including the site wrote, so the site was off
 * before. While the key still holds what including wrote, it goes back
 * exactly; after a later change only the row turns off again, and only while
 * it is still on (a later choice for it wins).
 */
async function putBack(siteId: string, before: unknown, written: unknown): Promise<void> {
  const current = await readRaw();
  if (same(current, written)) {
    await chrome.storage.local.set({ [KEY]: before });
    return;
  }
  if (parseCloudSyncScope(current).sites[siteId] === true)
    await setSyncScopeRow({ kind: 'site', siteId }, false);
}

/**
 * Turning a site on anywhere in the panel adds it to sync: "<site> now syncs ·
 * Undo". Call it as the browser asks: what syncs is read then, because the
 * background's grant listener may include the site before the answer arrives
 * here. The returned call, once granted, includes the site; Undo is offered
 * only when the grant changed what syncs.
 */
export function useSiteSyncInclusion(
  toast: (offer: UndoOffer) => WithdrawUndoOffer,
  t: (key: TranslationKey) => string,
) {
  return useCallback(
    (
      site: { readonly id: string; readonly label: string },
      returnFocus?: () => HTMLElement | null,
    ): (() => void) => {
      const asked = readRaw();
      asked.catch(() => undefined);
      return () =>
        void (async () => {
          try {
            const before = await asked;
            await markSiteIncluded(site.id);
            const written = await readRaw();
            toast({
              message: siteAddedLabel(t, site.label),
              undo: same(before, written)
                ? undefined
                : () => void putBack(site.id, before, written).catch(() => undefined),
              returnFocus,
            });
          } catch (error) {
            // The site is on either way; its sync row keeps whatever the key held.
            logger.warn('Could not include the site in sync', {
              site: site.id,
              error: String(error),
            });
          }
        })();
    },
    [t, toast],
  );
}
