import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncPlatform } from '@/core/types/sync';

import { createDriveTestClient } from './fixtures/driveTestClient';

function installChrome(): void {
  const area = () => ({
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  vi.stubGlobal('chrome', {
    storage: {
      local: area(),
      sync: area(),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { lastError: null, id: 'test-extension-id', getManifest: vi.fn(() => ({})) },
  });
}

async function createService() {
  vi.resetModules();
  const { GoogleDriveSyncService } = await import('../GoogleDriveSyncService');
  const service = createDriveTestClient(new GoogleDriveSyncService());
  await service.getState();
  const { GoogleDriveAuth } = await import('../GoogleDriveAuth');
  const { GoogleDriveFiles } = await import('../GoogleDriveFiles');
  vi.spyOn(GoogleDriveAuth.prototype, 'getToken').mockResolvedValue('token');
  return { service, files: GoogleDriveFiles.prototype };
}

const EMPTY_FOLDERS = { folders: [], folderContents: {} };

describe('GoogleDriveSyncService folder platform files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChrome();
  });

  it.each([
    ['gemini', 'gemini-voyager-folders.json', 'lastUploadTime'],
    ['aistudio', 'gemini-voyager-aistudio-folders.json', 'lastUploadTimeAIStudio'],
  ] as const)(
    'uploads %s folders to its own Drive file and timestamp',
    async (platform: SyncPlatform, fileName, timeField) => {
      const { service, files } = await createService();
      vi.spyOn(files, 'find').mockResolvedValue(null);
      vi.spyOn(files, 'ensure').mockImplementation(async (_token, name) => name);
      vi.spyOn(files, 'upload').mockResolvedValue(undefined);

      await expect(service.upload(EMPTY_FOLDERS, [], null, true, platform)).resolves.toBe(true);

      expect(files.upload).toHaveBeenCalledExactlyOnceWith(
        'token',
        fileName,
        expect.objectContaining({
          format: 'gemini-voyager.folders.v1',
          data: EMPTY_FOLDERS,
        }),
      );
      const state = await service.getState();
      expect(state[timeField]).toEqual(expect.any(Number));
      const otherFields = ['lastUploadTime', 'lastUploadTimeAIStudio'].filter(
        (field) => field !== timeField,
      ) as Array<'lastUploadTime' | 'lastUploadTimeAIStudio'>;
      for (const field of otherFields) expect(state[field]).toBeNull();
      expect(state.lastSyncTime).toBeNull();
      expect(state.lastSyncTimeAIStudio).toBeNull();
    },
  );

  it.each([
    ['gemini', 'gemini-voyager-folders.json', 'lastSyncTime', 'lastSyncTimeAIStudio'],
    ['aistudio', 'gemini-voyager-aistudio-folders.json', 'lastSyncTimeAIStudio', 'lastSyncTime'],
  ] as const)(
    'downloads %s folders from its own Drive file and timestamp',
    async (platform: SyncPlatform, fileName, timeField, otherTimeField) => {
      const { service, files } = await createService();
      vi.spyOn(files, 'prepareDownload').mockResolvedValue(undefined);
      vi.spyOn(files, 'find').mockImplementation(async (_token, name) =>
        name === fileName ? 'folders-file' : null,
      );
      const payload = { format: 'gemini-voyager.folders.v1', data: EMPTY_FOLDERS };
      vi.spyOn(files, 'download').mockResolvedValue(payload);

      const result = await service.download(true, platform);

      expect(result?.folders).toEqual(payload);
      const requestedFolderFiles = vi
        .mocked(files.find)
        .mock.calls.map(([, name]) => name)
        .filter((name) => name.includes('folders'));
      expect(requestedFolderFiles).toEqual([fileName]);
      const state = await service.getState();
      expect(state[timeField]).toEqual(expect.any(Number));
      expect(state[otherTimeField]).toBeNull();
    },
  );
});
