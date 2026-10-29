import type { SyncState } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import type { GoogleDriveAuth } from './GoogleDriveAuth';
import { GoogleDriveCatalogTimeline } from './GoogleDriveCatalogTimeline';
import {
  GoogleDriveCatalogTransfers,
  createCatalogTransferRunner,
} from './GoogleDriveCatalogTransfers';
import type { GoogleDriveFiles, DriveFilesPort } from './GoogleDriveFiles';
import { GoogleDriveFolderTransfers } from './GoogleDriveFolderTransfers';
import { restoreDrivePreviousVersion } from './GoogleDriveHistoryTransfers';
import { GoogleDriveIdentity } from './GoogleDriveIdentity';
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
  const files: DriveFilesPort = {
    find: (token, name) => session.run(() => options.files.find(token, name)),
    ensure: (token, name, known) => session.run(() => options.files.ensure(token, name, known)),
    upload: (token, id, data) => session.run(() => options.files.upload(token, id, data)),
    download: <T>(token: string, id: string) =>
      session.run(() => options.files.download<T>(token, id)),
    prepareDownload: (token) => session.run(() => options.files.prepareDownload(token)),
    supportsHistory: () => {
      session.assertActive();
      return options.files.supportsHistory();
    },
    downloadText: (token, id) => session.run(() => options.files.downloadText(token, id)),
    uploadText: (token, id, text) => session.run(() => options.files.uploadText(token, id, text)),
    createHistory: (token, name, source, text) =>
      session.run(() => options.files.createHistory(token, name, source, text)),
    listHistory: (token, name) => session.run(() => options.files.listHistory(token, name)),
    trash: (token, id) => session.run(() => options.files.trash(token, id)),
  };
  const uploads = new GoogleDriveUploadFiles(files);
  const identity = new GoogleDriveIdentity();
  const payloads = new GoogleDriveSyncPayloads(files, uploads, identity);
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
      getToken: (interactive, persist) => session.run(() => auth.getToken(interactive, persist)),
      updateState,
    }),
    new GoogleDriveCatalogTimeline(files, uploads),
    payloads,
    stars,
    (token) => createStarTransferSession(token, payloads, null, session).catalogPort,
    async (interactive) => {
      await session.run(() => auth.getToken(interactive));
    },
  );
  return {
    kind: 'sync-turn',
    getState,
    confirmAccountScope: (scope) => session.run(() => payloads.captureScopes(scope)),
    restorePreviousVersion: (targets, interactive) =>
      restoreDrivePreviousVersion({ auth, session, identity, uploads }, targets, interactive),
    upload: (...args) =>
      session.run(async () => {
        if (
          args[4] === undefined ||
          FOLDER_PLATFORMS[args[4]].accountIsolationStorageKey !== null
        ) {
          await identity.capture(
            args[7],
            args[4] === undefined || FOLDER_PLATFORMS[args[4]].syncsConversationExtras
              ? args[8]
              : null,
          );
        }
        return folders.upload(...args);
      }),
    download: (...args) =>
      session.run(async () => {
        if (
          args[1] === undefined ||
          FOLDER_PLATFORMS[args[1]].accountIsolationStorageKey !== null
        ) {
          await identity.capture(
            args[2],
            args[1] === undefined || FOLDER_PLATFORMS[args[1]].syncsConversationExtras
              ? args[3]
              : null,
          );
        }
        return folders.download(...args);
      }),
    uploadPromptsOnly: (...args) =>
      session.run(async () => {
        await payloads.captureScopes(args[1]);
        return shared.uploadPromptsOnly(...args);
      }),
    downloadPromptsOnly: (...args) =>
      session.run(async () => {
        await payloads.captureScopes(args[0]);
        return shared.downloadPromptsOnly(...args);
      }),
    uploadHighlightsOnly: (...args) =>
      session.run(async () => {
        await payloads.captureScopes(args[1]);
        return shared.uploadHighlightsOnly(...args);
      }),
    downloadHighlightsOnly: (...args) =>
      session.run(async () => {
        await payloads.captureScopes(args[0]);
        return shared.downloadHighlightsOnly(...args);
      }),
    uploadCatalogData: (...args) => session.run(() => catalog.uploadCatalogData(...args)),
    downloadCatalogTimeline: (...args) =>
      session.run(() => catalog.downloadCatalogTimeline(...args)),
    downloadCatalogStars: (...args) => session.run(() => catalog.downloadCatalogStars(...args)),
  };
}
