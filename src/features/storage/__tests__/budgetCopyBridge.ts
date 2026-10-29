/**
 * The background end of `runtime.sendMessage` for page tests: a fresh storage
 * budget over the mocked `chrome.storage.local`, writing admitted copies with
 * `write` (usually the mocked `browser.storage.local.set`).
 */
import { storageQuotaService } from '@/core/services/StorageQuotaService';
import { writeBudgetCopy } from '@/pages/background/budgetCopies';
import { cleanUndoneBudgetCopies } from '@/pages/background/budgetCopyUndo';

import { isCleanUndoneCopiesMessage, isWriteCopyMessage } from '../budgetCopyMessage';
import { createStorageBudget } from '../storageBudget';

export function budgetCopyBridge(
  write: (items: Record<string, string>) => Promise<unknown>,
): (message: unknown) => Promise<unknown> {
  const budget = createStorageBudget({
    measure: (keys) => storageQuotaService.getLocalHeadroom(keys),
    quota: async () => (await storageQuotaService.resolveEffectiveLocalQuota()).quotaBytes,
    barrier: async () => undefined,
  });
  return async (message) => {
    if (isCleanUndoneCopiesMessage(message))
      return cleanUndoneBudgetCopies(budget, chrome.storage.local);
    if (!isWriteCopyMessage(message)) throw new Error('unexpected message');
    return writeBudgetCopy(message.key, message.value, {
      budget,
      write: async (items) => void (await write(items)),
    });
  };
}
