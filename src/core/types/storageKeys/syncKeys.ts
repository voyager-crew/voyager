/** Device-local cloud sync bookkeeping; never included in settings backups. */
export const SYNC_STORAGE_KEYS = {
  CLOUD_SYNC_SCOPE: 'gvCloudSyncScope',
  CLOUD_SYNC_BOOKKEEPING: 'gvCloudSyncBookkeeping',
  // Latest pre-apply copy of exactly the storage keys a download will write.
  CLOUD_SYNC_PRE_APPLY_SNAPSHOT: 'gvCloudSyncPreApplySnapshot',
  // One newest unreadable pre-apply slot, retained verbatim for recovery or inspection.
  CLOUD_SYNC_SNAPSHOT_QUARANTINE: 'gvCloudSyncSnapshotQuarantine',
  // Safari: when the popup handed a Google Drive connect to the Voyager app.
  GOOGLE_DRIVE_CONNECT_PENDING: 'gvGoogleDriveConnectPending',
} as const;
