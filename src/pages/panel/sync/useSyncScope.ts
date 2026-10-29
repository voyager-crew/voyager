import { useEffect, useState } from 'react';

import {
  type CloudSyncScope,
  parseCloudSyncScope,
  readCloudSyncScope,
} from '@/core/services/CloudSyncScope';
import { StorageKeys } from '@/core/types/common';

/** The device's sync scope key, followed live: the sheet's switches and site access both write it. */
export function useSyncScope(): CloudSyncScope | null {
  const [scope, setScope] = useState<CloudSyncScope | null>(null);
  useEffect(() => {
    let active = true;
    void readCloudSyncScope().then(
      (value) => active && setScope(value),
      () => active && setScope(parseCloudSyncScope(undefined)),
    );
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && StorageKeys.CLOUD_SYNC_SCOPE in changes)
        setScope(parseCloudSyncScope(changes[StorageKeys.CLOUD_SYNC_SCOPE]?.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  return scope;
}
