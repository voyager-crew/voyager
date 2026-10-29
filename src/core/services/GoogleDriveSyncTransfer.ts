import type { DriveHistoryRestoreFile, DriveHistoryRestoreTarget } from '@/core/types/driveHistory';
import type { SyncState } from '@/core/types/sync';
import type { SyncAccountScope } from '@/core/types/sync';

import type { GoogleDriveBookkeepingTurn } from './GoogleDriveBookkeepingTurn';
import type { GoogleDriveCatalogTransfers } from './GoogleDriveCatalogTransfers';
import type { GoogleDriveFolderTransfers } from './GoogleDriveFolderTransfers';
import type { GoogleDriveSharedTransfers } from './GoogleDriveSharedTransfers';

/** A service is queued; only an explicitly marked turn port may be used inside its callback. */
export interface GoogleDriveSyncTransfer {
  readonly kind: 'sync-turn';
  beginDownloadBookkeeping(): void;
  getFileStatus: GoogleDriveBookkeepingTurn['status'];
  getDownloadBookkeeping: GoogleDriveBookkeepingTurn['reads'];
  commitBookkeeping: GoogleDriveBookkeepingTurn['commit'];
  commitAppliedBookkeeping: GoogleDriveBookkeepingTurn['applied'];
  getState(): Promise<SyncState>;
  /** Capture the stable cloud destination identity for this turn. */
  confirmAccountScope(scope: SyncAccountScope | null): Promise<string | null>;
  restorePreviousVersion(
    targets: readonly DriveHistoryRestoreTarget[],
    interactive?: boolean,
  ): Promise<DriveHistoryRestoreFile[]>;
  upload: GoogleDriveFolderTransfers['upload'];
  download: GoogleDriveFolderTransfers['download'];
  uploadPromptsOnly: GoogleDriveSharedTransfers['uploadPromptsOnly'];
  downloadPromptsOnly: GoogleDriveSharedTransfers['downloadPromptsOnly'];
  uploadHighlightsOnly: GoogleDriveSharedTransfers['uploadHighlightsOnly'];
  downloadHighlightsOnly: GoogleDriveSharedTransfers['downloadHighlightsOnly'];
  downloadHighlightsResult: GoogleDriveSharedTransfers['downloadHighlightsResult'];
  uploadCatalogData: GoogleDriveCatalogTransfers['uploadCatalogData'];
  downloadCatalogTimeline: GoogleDriveCatalogTransfers['downloadCatalogTimeline'];
  downloadCatalogStars: GoogleDriveCatalogTransfers['downloadCatalogStars'];
  downloadCatalogDataResult: GoogleDriveCatalogTransfers['downloadCatalogDataResult'];
}
