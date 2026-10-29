import type { SyncState } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import type { GoogleDriveAuth } from './GoogleDriveAuth';
import { GoogleDriveBookkeepingTurn } from './GoogleDriveBookkeepingTurn';
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
  const identity = new GoogleDriveIdentity();
  const bookkeeping = new GoogleDriveBookkeepingTurn(
    {
      find: (token, name) => session.run(() => options.files.find(token, name)),
      metadata: (token, id) => session.run(() => options.files.metadata(token, id)),
    },
    identity,
    session.provider,
    () => session.run(() => auth.getToken(false)),
  );
  const files: DriveFilesPort = {
    metadata: (token, id) => session.run(() => options.files.metadata(token, id)),
    find: (token, name) =>
      session.run(async () => {
        const id = await options.files.find(token, name);
        if (id) bookkeeping.names.set(id, name);
        return id;
      }),
    ensure: (token, name, known) =>
      session.run(async () => {
        const id = await options.files.ensure(token, name, known);
        bookkeeping.names.set(id, name);
        return id;
      }),
    upload: (token, id, data) =>
      session.run(async () => {
        const metadata = await options.files.upload(token, id, data);
        const name = bookkeeping.names.get(id);
        if (name)
          bookkeeping.writes.set(name, { id, content: data, ...(metadata ? { metadata } : {}) });
        return metadata;
      }),
    download: <T>(token: string, id: string) =>
      session.run(async () => {
        const metadata = await bookkeeping.beforeRead(token, id);
        const result = await options.files.download<T>(token, id);
        if (result !== null && metadata) bookkeeping.readsById.set(id, metadata);
        return result;
      }),
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
  const payloads = new GoogleDriveSyncPayloads(files, uploads, identity, (metadata, target) => {
    bookkeeping.legacyTargets.set(metadata.id, target);
    bookkeeping.readsById.set(metadata.id, metadata);
  });
  const stars = new StarDriveSyncCoordinator();
  const shared = new GoogleDriveSharedTransfers(auth, payloads, session, updateState, saveState);
  const timeline = new GoogleDriveCatalogTimeline(files, uploads);
  const folders = new GoogleDriveFolderTransfers(
    auth,
    payloads,
    stars,
    session,
    updateState,
    saveState,
    timeline,
  );
  const catalog = new GoogleDriveCatalogTransfers(
    createCatalogTransferRunner({
      getSession: () => session,
      getToken: (interactive, persist) => session.run(() => auth.getToken(interactive, persist)),
      updateState,
    }),
    timeline,
    payloads,
    stars,
    (token) => createStarTransferSession(token, payloads, null, session).catalogPort,
    async (interactive) => {
      await session.run(() => auth.getToken(interactive));
    },
  );
  return {
    kind: 'sync-turn',
    beginDownloadBookkeeping: () => {
      session.assertActive();
      bookkeeping.beginDownload();
    },
    getFileStatus: (requests) => session.run(() => bookkeeping.status(requests)),
    getDownloadBookkeeping: () => session.run(() => bookkeeping.reads()),
    commitBookkeeping: (localRequests) => session.run(() => bookkeeping.commit(localRequests)),
    commitAppliedBookkeeping: (files) => session.run(() => bookkeeping.applied(files)),
    getState,
    confirmAccountScope: (scope) =>
      session.run(async () => {
        await payloads.captureScopes(scope);
        return scope ? identity.get(scope).emailKey : null;
      }),
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
    downloadHighlightsResult: (...args) =>
      session.run(async () => {
        await payloads.captureScopes(args[0]);
        return shared.downloadHighlightsResult(...args);
      }),
    uploadCatalogData: (...args) => session.run(() => catalog.uploadCatalogData(...args)),
    downloadCatalogTimeline: (...args) =>
      session.run(() => catalog.downloadCatalogTimeline(...args)),
    downloadCatalogStars: (...args) => session.run(() => catalog.downloadCatalogStars(...args)),
    downloadCatalogDataResult: (...args) =>
      session.run(() => catalog.downloadCatalogDataResult(...args)),
  };
}
