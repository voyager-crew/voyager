/** Device-local cloud sync bookkeeping; never included in settings backups. */
export const SYNC_STORAGE_KEYS = {
  // Latest pre-apply copy of exactly the storage keys a download will write.
  CLOUD_SYNC_PRE_APPLY_SNAPSHOT: 'gvCloudSyncPreApplySnapshot',
} as const;
