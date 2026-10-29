import type { SyncState } from '@/core/types/sync';

import type { GoogleDriveAuth } from './GoogleDriveAuth';
import { GoogleDriveCatalogTimeline } from './GoogleDriveCatalogTimeline';
import {
  GoogleDriveCatalogTransfers,
  createCatalogTransferRunner,
} from './GoogleDriveCatalogTransfers';
import type { GoogleDriveFiles } from './GoogleDriveFiles';
import { GoogleDriveFolderTransfers } from './GoogleDriveFolderTransfers';
import { GoogleDriveSharedTransfers } from './GoogleDriveSharedTransfers';
import { GoogleDriveSyncPayloads } from './GoogleDriveSyncPayloads';
import type { GoogleDriveSyncSession } from './GoogleDriveSyncSession';
import type { GoogleDriveSyncTransfer } from './GoogleDriveSyncTransfer';
import { GoogleDriveUploadFiles } from './GoogleDriveUploadFiles';
import { StarDriveSyncCoordinator } from './StarDriveSyncCoordinator';
import { createStarTransferSession } from './StarTransferSession';

interface TurnOptions {
  session: GoogleDriveSyncSession;
  files: GoogleDriveFiles;
  auth: GoogleDriveAuth;
  getState(): Promise<SyncState>;
  updateState(state: Partial<SyncState>): void;
  saveState(): Promise<void>;
}

export function createGoogleDriveTurnPort(options: TurnOptions): GoogleDriveSyncTransfer {
  const { session, auth, getState, updateState, saveState } = options;
  const files: Pick<
    GoogleDriveFiles,
    'find' | 'ensure' | 'upload' | 'download' | 'prepareDownload'
  > = {
    find: (token, name) => session.run(() => options.files.find(token, name)),
    ensure: (token, name, known) => session.run(() => options.files.ensure(token, name, known)),
    upload: (token, id, data) => session.run(() => options.files.upload(token, id, data)),
    download: <T>(token: string, id: string) =>
      session.run(() => options.files.download<T>(token, id)),
    prepareDownload: (token) => session.run(() => options.files.prepareDownload(token)),
  };
  const uploads = new GoogleDriveUploadFiles(files);
  const payloads = new GoogleDriveSyncPayloads(files, uploads);
  const stars = new StarDriveSyncCoordinator();
  const shared = new GoogleDriveSharedTransfers(auth, payloads, session, updateState, saveState);
  const folders = new GoogleDriveFolderTransfers(
    auth,
    payloads,
    stars,
    session,
    updateState,
    saveState,
  );
  const catalog = new GoogleDriveCatalogTransfers(
    createCatalogTransferRunner({
      getSession: () => session,
      getToken: (interactive) => session.run(() => auth.getToken(interactive)),
      updateState,
    }),
    new GoogleDriveCatalogTimeline(files, uploads),
    payloads,
    stars,
    (token) => createStarTransferSession(token, payloads, null, session).catalogPort,
  );
  return {
    kind: 'sync-turn',
    getState,
    upload: (...args) => session.run(() => folders.upload(...args)),
    download: (...args) => session.run(() => folders.download(...args)),
    uploadPromptsOnly: (...args) => session.run(() => shared.uploadPromptsOnly(...args)),
    downloadPromptsOnly: (...args) => session.run(() => shared.downloadPromptsOnly(...args)),
    uploadHighlightsOnly: (...args) => session.run(() => shared.uploadHighlightsOnly(...args)),
    downloadHighlightsOnly: (...args) => session.run(() => shared.downloadHighlightsOnly(...args)),
    uploadCatalogData: (...args) => session.run(() => catalog.uploadCatalogData(...args)),
    downloadCatalogTimeline: (...args) =>
      session.run(() => catalog.downloadCatalogTimeline(...args)),
    downloadCatalogStars: (...args) => session.run(() => catalog.downloadCatalogStars(...args)),
  };
}
