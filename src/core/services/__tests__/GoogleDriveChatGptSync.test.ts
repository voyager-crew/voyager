import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type { SyncAccountScope } from '@/core/types/sync';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { createStarStore } from '@/features/savedLibrary/starStore';

import { createDriveTestClient } from './fixtures/driveTestClient';

const EXPORTED_AT = '2026-10-03T12:00:00.000Z';
const NOW = Date.parse(EXPORTED_AT);
const CHATGPT_FILE = 'gemini-voyager-chatgpt-folders.json';
const accountScope: SyncAccountScope = {
  accountKey: 'email:example@example.com',
  accountId: 2,
  routeUserId: '2',
};
const folders: FolderData = {
  folders: [
    {
      id: 'folder-1',
      name: 'Research',
      parentId: null,
      isExpanded: true,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  folderContents: {
    'folder-1': [
      {
        conversationId: 'chatgpt:conv:12345678-1234-1234-1234-123456789abc',
        title: 'Conversation',
        url: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
        addedAt: 3,
      },
    ],
  },
};
const prompts = [{ id: 'prompt-1', text: 'Shared prompt', tags: [], createdAt: 4 }];
const settings = { gvTheme: 'dark' };
const plugins = { 'voyager.example': { enabled: true, installedAt: 5 } };
const starred = { messages: {} };
const forks = { nodes: {}, groups: {} };
const hierarchy = { conversations: {} };

function exportBytes(format: string, data: unknown): string {
  return JSON.stringify({ format, exportedAt: EXPORTED_AT, version: EXTENSION_VERSION, data });
}

function createBoundaries(
  initialStorage: Record<string, unknown> = {},
  initialSyncStorage: Record<string, unknown> = {},
) {
  const storage = { ...initialStorage };
  const syncStorage = { ...initialSyncStorage };
  const localReadKeys: string[] = [];
  const syncReadKeys: string[] = [];
  const mediaByName = new Map<string, string>();
  const uploadedNames: string[] = [];
  const downloadedNames: string[] = [];
  const searchedNames: string[] = [];
  const folder = {
    id: 'backup-folder',
    name: 'Voyager Data',
    mimeType: 'application/vnd.google-apps.folder',
    appProperties: { voyagerDataFolder: '1' },
  };

  function storageArea(values: Record<string, unknown>, readKeys: string[]) {
    return {
      get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
        const requested =
          typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : Object.keys(keys ?? values);
        readKeys.push(...requested);
        const defaults =
          keys !== null && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
        return {
          ...defaults,
          ...Object.fromEntries(
            requested.filter((key) => key in values).map((key) => [key, values[key]]),
          ),
        };
      }),
      set: vi.fn(async (updates: Record<string, unknown>) => {
        Object.assign(values, updates);
      }),
    };
  }

  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      lastError: null,
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    },
    identity: {
      getAuthToken: vi.fn((_details: unknown, callback: (token: string) => void) =>
        callback('test-oauth-token'),
      ),
    },
    storage: {
      local: storageArea(storage, localReadKeys),
      sync: storageArea(syncStorage, syncReadKeys),
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
        const metadata = JSON.parse(String(init.body)) as { name: string };
        return Response.json({ id: metadata.name });
      }
      if (url.pathname === '/drive/v3/files') {
        if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
          return Response.json({ files: [folder] });
        }
        if (query.startsWith('(')) return Response.json({ files: [] });
        const name = /name='([^']+)'/.exec(query)?.[1];
        if (!name) throw new Error(`Unexpected Drive query: ${query}`);
        searchedNames.push(name);
        return Response.json({ files: mediaByName.has(name) ? [{ id: name, name }] : [] });
      }
      if (url.pathname === '/drive/v3/files/backup-folder') return Response.json(folder);
      const name = url.pathname.split('/').at(-1)!;
      if (url.pathname.startsWith('/upload/drive/v3/files/')) {
        uploadedNames.push(name);
        mediaByName.set(name, String(init?.body));
        return Response.json({ id: name });
      }
      if (url.pathname.startsWith('/drive/v3/files/')) {
        if (url.searchParams.get('alt') === 'media') {
          downloadedNames.push(name);
          return new Response(mediaByName.get(name), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return Response.json({ parents: [folder.id], trashed: false });
      }
      throw new Error(`Unexpected Drive request: ${url}`);
    }),
  );
  return {
    storage,
    mediaByName,
    uploadedNames,
    downloadedNames,
    searchedNames,
    localReadKeys,
    syncReadKeys,
  };
}

async function createService() {
  vi.resetModules();
  const { GoogleDriveSyncService } = await import('../GoogleDriveSyncService');
  const service = createDriveTestClient(new GoogleDriveSyncService());
  await service.getState();
  return service;
}

describe('ChatGPT Drive folder isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts ChatGPT timestamps at null when existing platforms already synced', async () => {
    createBoundaries({
      gvLastSyncTime: 11,
      gvLastUploadTime: 12,
      gvLastSyncTimeAIStudio: 21,
      gvLastUploadTimeAIStudio: 22,
    });
    const service = await createService();
    await expect(service.getState()).resolves.toMatchObject({
      lastSyncTimeChatGPT: null,
      lastUploadTimeChatGPT: null,
      lastSyncTime: 11,
      lastUploadTime: 12,
      lastSyncTimeAIStudio: 21,
      lastUploadTimeAIStudio: 22,
    });
  });

  it('syncs authoritative ChatGPT storage through the background even with legacy account isolation and corrupt prompts', async () => {
    const popupData: FolderData = { folders: [], folderContents: {} };
    const boundaries = createBoundaries(
      {
        [StorageKeys.FOLDER_DATA_CHATGPT]: JSON.stringify(folders),
        [StorageKeys.FOLDER_DATA]: popupData,
        [StorageKeys.FOLDER_DATA_AISTUDIO]: popupData,
        [StorageKeys.PROMPT_ITEMS]: 'corrupt prompt data',
      },
      { [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: true },
    );
    vi.resetModules();
    const { createCloudSyncMessageHandler } = await import('@/pages/background/cloudSyncMessages');
    const { googleDriveSyncService } = await import('../GoogleDriveSyncService');
    await googleDriveSyncService.getState();
    const handler = createCloudSyncMessageHandler({
      getAllStarredMessages: async () => starred,
      getAllForkNodes: async () => forks,
    });
    const message = {
      type: 'gv.sync.upload',
      payload: {
        platform: 'chatgpt',
        accountScope,
        includeHighlights: true,
        data: { folders: { data: popupData }, prompts: { items: prompts } },
      },
    };
    const sender = {
      id: chrome.runtime.id,
      tab: { url: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc' },
    } as chrome.runtime.MessageSender;
    await expect(
      handler(message, {
        ...sender,
        tab: { url: 'https://gemini.google.com/app/chat-1' },
      } as chrome.runtime.MessageSender),
    ).resolves.toEqual({ ok: false, error: 'untrusted_sender' });
    expect(boundaries.uploadedNames).toEqual([]);
    await expect(handler(message, sender)).resolves.toMatchObject({ ok: true });
    const expectedFolderPayload = {
      format: 'gemini-voyager.folders.v1',
      exportedAt: EXPORTED_AT,
      version: EXTENSION_VERSION,
      data: folders,
      platform: 'chatgpt',
    };
    expect(Object.fromEntries(boundaries.mediaByName)).toEqual({
      [CHATGPT_FILE]: JSON.stringify(expectedFolderPayload),
    });
    await expect(handler({ ...message, type: 'gv.sync.download' }, sender)).resolves.toMatchObject({
      ok: true,
      data: {
        folders: expectedFolderPayload,
        prompts: null,
        settings: null,
        plugins: null,
      },
    });
    expect(boundaries.uploadedNames).toEqual([CHATGPT_FILE]);
    expect(boundaries.downloadedNames).toEqual([CHATGPT_FILE]);
    expect(boundaries.localReadKeys).toContain(StorageKeys.FOLDER_DATA_CHATGPT);
    expect(boundaries.localReadKeys).not.toContain(StorageKeys.FOLDER_DATA);
    expect(boundaries.localReadKeys).not.toContain(StorageKeys.FOLDER_DATA_AISTUDIO);
    expect(boundaries.localReadKeys).not.toContain(StorageKeys.PROMPT_ITEMS);
    expect(boundaries.syncReadKeys).not.toContain(StorageKeys.FOLDER_DATA_CHATGPT);
  });

  it('round-trips only unscoped ChatGPT folders and preserves other platforms and shared files', async () => {
    const boundaries = createBoundaries({
      gvLastSyncTime: 11,
      gvLastUploadTime: 12,
      gvLastSyncTimeAIStudio: 21,
      gvLastUploadTimeAIStudio: 22,
      gvLastSyncTimeChatGPT: 31,
      gvLastUploadTimeChatGPT: 32,
    });
    const sharedFiles = {
      'gemini-voyager-folders.json': 'gemini untouched bytes',
      'gemini-voyager-aistudio-folders.json': 'aistudio untouched bytes',
      'gemini-voyager-prompts.json': 'shared prompts untouched bytes',
      'gemini-voyager-settings.json': 'shared settings untouched bytes',
      'gemini-voyager-plugins.json': 'shared plugins untouched bytes',
    };
    Object.entries(sharedFiles).forEach(([name, bytes]) => boundaries.mediaByName.set(name, bytes));
    const service = await createService();
    await expect(service.getState()).resolves.toMatchObject({
      lastSyncTimeChatGPT: 31,
      lastUploadTimeChatGPT: 32,
    });

    await expect(
      service.upload(
        folders,
        prompts,
        starred,
        true,
        'chatgpt',
        forks,
        hierarchy,
        accountScope,
        accountScope,
        settings,
        plugins,
      ),
    ).resolves.toBe(true);
    expect(boundaries.storage).toMatchObject({
      gvLastSyncTimeChatGPT: 31,
      gvLastUploadTimeChatGPT: NOW,
    });
    vi.setSystemTime(NOW + 1_000);
    await expect(service.download(true, 'chatgpt', accountScope, accountScope)).resolves.toEqual({
      folders: {
        format: 'gemini-voyager.folders.v1',
        exportedAt: EXPORTED_AT,
        version: EXTENSION_VERSION,
        data: folders,
        platform: 'chatgpt',
      },
      prompts: null,
      settings: null,
      plugins: null,
      starred: null,
      forks: null,
      timelineHierarchy: null,
    });

    expect(boundaries.uploadedNames).toEqual([CHATGPT_FILE]);
    expect(boundaries.downloadedNames).toEqual([CHATGPT_FILE]);
    expect(new Set(boundaries.searchedNames)).toEqual(new Set([CHATGPT_FILE]));
    expect(Object.fromEntries(boundaries.mediaByName)).toEqual({
      ...sharedFiles,
      [CHATGPT_FILE]: JSON.stringify({
        format: 'gemini-voyager.folders.v1',
        exportedAt: EXPORTED_AT,
        version: EXTENSION_VERSION,
        data: folders,
        platform: 'chatgpt',
      }),
    });
    expect(boundaries.storage).toMatchObject({
      gvLastSyncTime: 11,
      gvLastUploadTime: 12,
      gvLastSyncTimeAIStudio: 21,
      gvLastUploadTimeAIStudio: 22,
      gvLastSyncTimeChatGPT: NOW + 1_000,
      gvLastUploadTimeChatGPT: NOW,
    });
    const restartedService = await createService();
    await expect(restartedService.getState()).resolves.toMatchObject({
      lastSyncTimeChatGPT: NOW + 1_000,
      lastUploadTimeChatGPT: NOW,
    });
  });

  it.each(['gemini', 'aistudio'] as const)(
    'keeps %s upload filenames, exact JSON bytes and independent timestamps unchanged',
    async (platform) => {
      const boundaries = createBoundaries({
        gvLastSyncTime: 11,
        gvLastUploadTime: 12,
        gvLastSyncTimeAIStudio: 21,
        gvLastUploadTimeAIStudio: 22,
        gvLastSyncTimeChatGPT: 31,
        gvLastUploadTimeChatGPT: 32,
      });
      const service = await createService();
      await expect(
        service.upload(
          folders,
          prompts,
          starred,
          true,
          platform,
          forks,
          hierarchy,
          null,
          null,
          settings,
          plugins,
          ...(platform === 'gemini' ? ([createStarStore(chrome.storage.local)] as const) : []),
        ),
      ).resolves.toBe(true);

      const expectedBytes: Record<string, string> = {
        [platform === 'gemini'
          ? 'gemini-voyager-folders.json'
          : 'gemini-voyager-aistudio-folders.json']: exportBytes(
          'gemini-voyager.folders.v1',
          folders,
        ),
        'gemini-voyager-prompts.json': JSON.stringify({
          format: 'gemini-voyager.prompts.v1',
          exportedAt: EXPORTED_AT,
          version: EXTENSION_VERSION,
          items: prompts,
        }),
        'gemini-voyager-settings.json': exportBytes('gemini-voyager.settings.v1', settings),
        'gemini-voyager-plugins.json': exportBytes('gemini-voyager.plugins.v1', plugins),
        ...(platform === 'gemini'
          ? {
              'gemini-voyager-stars.json': JSON.stringify({
                format: 'gemini-voyager.stars.v2',
                exportedAt: EXPORTED_AT,
                version: EXTENSION_VERSION,
                items: [],
                tombstones: [],
              }),
              'gemini-voyager-starred.json': exportBytes('gemini-voyager.starred.v1', starred),
              'gemini-voyager-forks.json': exportBytes('gemini-voyager.forks.v1', forks),
              'gemini-voyager-timeline-hierarchy.json': exportBytes(
                'gemini-voyager.timeline-hierarchy.v1',
                hierarchy,
              ),
            }
          : {}),
      };
      expect(Object.fromEntries(boundaries.mediaByName)).toEqual(expectedBytes);
      expect(boundaries.uploadedNames).toHaveLength(Object.keys(expectedBytes).length);
      expect(new Set(boundaries.uploadedNames)).toEqual(new Set(Object.keys(expectedBytes)));
      expect(boundaries.storage).toMatchObject({
        gvLastSyncTime: 11,
        gvLastUploadTime: platform === 'gemini' ? NOW : 12,
        gvLastSyncTimeAIStudio: 21,
        gvLastUploadTimeAIStudio: platform === 'aistudio' ? NOW : 22,
        gvLastSyncTimeChatGPT: 31,
        gvLastUploadTimeChatGPT: 32,
      });
    },
  );
});
