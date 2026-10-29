import { useCallback, useEffect, useMemo } from 'react';

import { prepareCloudDownload, prepareCloudUpload } from '@/core/services/CloudSyncTransfer';
import {
  type SyncPageLookup,
  readIncludedRows,
  resolveCloudSyncContext,
} from '@/core/services/CloudSyncTransferContext';
import type { SyncPlatform } from '@/core/types/sync';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

export type { CloudDownloadData } from '@/core/services/CloudSyncDownloadService';

type TargetTab = () => Promise<chrome.tabs.Tab | undefined>;

/** The popup reaches its page through `tabs`: the active tab, asked by its id. */
function tabPage(getTargetTab: TargetTab): SyncPageLookup {
  return async () => {
    const tab = await getTargetTab();
    if (!tab) return undefined;
    const id = tab.id;
    return {
      key: id,
      url: tab.url,
      ...(id ? { ask: (request) => chrome.tabs.sendMessage(id, request) } : {}),
    };
  };
}

/**
 * Captures each operation's scope, with what syncs here and the current tab,
 * through the shared transfer (src/core/services/CloudSyncTransfer.ts); the
 * download's restore keeps that captured context.
 */
export function useCloudSyncTransfer(
  platform: SyncPlatform,
  includeHighlights: boolean,
  getTargetTab: TargetTab,
) {
  const lifetime = useMemo(
    () => ({
      controller: new AbortController(),
      platform,
      includeHighlights,
      page: tabPage(getTargetTab),
    }),
    [platform, includeHighlights, getTargetTab],
  );
  useEffect(() => {
    const machine = startMachine<{ status: 'mounted' }, { type: 'unused' }>(
      {
        id: `popup-cloud-transfer:${lifetime.platform}`,
        transition: (state) => state,
        effects: {
          mounted: (stay) => {
            stay.scope.effect(() => () => lifetime.controller.abort());
          },
        },
      },
      { status: 'mounted' },
    );
    return () => {
      void machine.stop();
    };
  }, [lifetime]);

  const resolveContext = useCallback(async () => {
    const included = await readIncludedRows(lifetime.platform);
    return resolveCloudSyncContext({
      platform: lifetime.platform,
      included,
      selection: included.site ? 'all' : 'shared',
      includeHighlights: lifetime.includeHighlights,
      page: lifetime.page,
    });
  }, [lifetime]);

  const prepareUpload = useCallback(
    async () => prepareCloudUpload(await resolveContext(), lifetime.page),
    [lifetime, resolveContext],
  );

  const prepareDownload = useCallback(
    async () =>
      prepareCloudDownload({
        context: await resolveContext(),
        page: lifetime.page,
        send: (message) => chrome.runtime.sendMessage(message),
        signal: lifetime.controller.signal,
      }),
    [lifetime, resolveContext],
  );

  return { prepareUpload, prepareDownload };
}
