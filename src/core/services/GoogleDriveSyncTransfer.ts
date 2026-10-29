import type { SyncState } from '@/core/types/sync';

import type { GoogleDriveCatalogTransfers } from './GoogleDriveCatalogTransfers';
import type { GoogleDriveFolderTransfers } from './GoogleDriveFolderTransfers';
import type { GoogleDriveSharedTransfers } from './GoogleDriveSharedTransfers';

/** A service is queued; only an explicitly marked turn port may be used inside its callback. */
export interface GoogleDriveSyncTransfer {
  readonly kind: 'sync-turn';
  getState(): Promise<SyncState>;
  upload: GoogleDriveFolderTransfers['upload'];
  download: GoogleDriveFolderTransfers['download'];
  uploadPromptsOnly: GoogleDriveSharedTransfers['uploadPromptsOnly'];
  downloadPromptsOnly: GoogleDriveSharedTransfers['downloadPromptsOnly'];
  uploadHighlightsOnly: GoogleDriveSharedTransfers['uploadHighlightsOnly'];
  downloadHighlightsOnly: GoogleDriveSharedTransfers['downloadHighlightsOnly'];
  uploadCatalogData: GoogleDriveCatalogTransfers['uploadCatalogData'];
  downloadCatalogTimeline: GoogleDriveCatalogTransfers['downloadCatalogTimeline'];
  downloadCatalogStars: GoogleDriveCatalogTransfers['downloadCatalogStars'];
}
