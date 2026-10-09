import type { AccountScope } from '@/core/services/AccountIsolationService';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';

import type { FolderData } from './types';

export type SyncMessageHost = {
  /** False until the folders load; an unloaded bucket's empty data must not reach the cloud. */
  canEdit: () => boolean;
  data: () => FolderData;
  /** The account the folders belong to, on a site with account isolation. */
  accountScope?: () => AccountScope | null;
  /** Reloads the folders from storage and shows them; the reply waits for it. */
  reload?: () => Promise<unknown>;
};

/** A runtime message listener, for either the polyfill's `onMessage` or Chrome's. */
export type SyncMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => true | undefined;

/**
 * Serves the popup's cloud sync on a folder site: `gv.sync.requestData` (before
 * an upload) answers with the folders in memory, which may be newer than storage
 * after a failed save; `gv.folders.reload` (after a download) reloads them.
 */
export function createSyncMessageListener(host: SyncMessageHost): SyncMessageListener {
  return (message, _sender, sendResponse) => {
    const type = (message as { type?: unknown } | null)?.type;
    if (type === 'gv.sync.requestData') {
      if (!host.canEdit()) {
        sendResponse({ ok: false });
        return true;
      }
      sendResponse(
        host.accountScope
          ? { ok: true, data: host.data(), accountScope: toSyncAccountScope(host.accountScope()) }
          : { ok: true, data: host.data() },
      );
      return true;
    }
    if (type === 'gv.folders.reload' && host.reload) {
      void host.reload().then(() => {
        try {
          sendResponse({ ok: true });
        } catch {
          // The popup may have closed meanwhile.
        }
      });
      return true;
    }
    // An unknown message must settle the sender's promise now: `true` would
    // promise a response that never comes and leave broadcasts hanging.
    return undefined;
  };
}
