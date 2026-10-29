import { vi } from 'vitest';

import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import type {
  ForkNodesDataSync,
  PromptItem,
  SyncAccountScope,
  SyncPlatform,
  SyncProvider,
  TimelineHierarchyDataSync,
} from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';
import type { PluginStateMap } from '@/features/plugins/storage/pluginState';

const build = vi.hoisted((): { target: 'chrome' | 'safari' } => ({ target: 'chrome' }));
const native = vi.hoisted(() => vi.fn());
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => build.target,
  isSafari: () => build.target === 'safari',
  isBrave: () => false,
}));
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));

export type GuardKind = 'folders' | 'prompts' | 'timelineHierarchy' | 'forks' | 'plugins';
export const guardKinds: GuardKind[] = [
  'folders',
  'prompts',
  'timelineHierarchy',
  'forks',
  'plugins',
];
export const GUARD_TIME = '2026-10-29T12:00:00.000Z';
export const guardFiles = {
  folders: 'gemini-voyager-folders.json',
  prompts: 'gemini-voyager-prompts.json',
  timelineHierarchy: 'gemini-voyager-timeline-hierarchy.json',
  forks: 'gemini-voyager-forks.json',
  plugins: 'gemini-voyager-plugins.json',
};
const storageKeys = {
  folders: StorageKeys.FOLDER_DATA,
  prompts: StorageKeys.PROMPT_ITEMS,
  timelineHierarchy: StorageKeys.TIMELINE_HIERARCHY,
  forks: StorageKeys.FORK_NODES,
  plugins: StorageKeys.PLUGINS_STATE,
};
const formats = {
  folders: 'gemini-voyager.folders.v1',
  prompts: 'gemini-voyager.prompts.v1',
  timelineHierarchy: 'gemini-voyager.timeline-hierarchy.v1',
  forks: 'gemini-voyager.forks.v1',
  plugins: 'gemini-voyager.plugins.v1',
};

export const guardPrompt = (id: string): PromptItem => ({
  id,
  text: `${id} text`,
  tags: [],
  createdAt: 1,
});

export function guardFolders(count: number): FolderData {
  return {
    folders: Array.from({ length: count }, (_, index) => ({
      id: `folder-${index}`,
      name: `Folder ${index}`,
      parentId: null,
      isExpanded: true,
      createdAt: 1,
      updatedAt: 1,
    })),
    folderContents: {},
  };
}

export function guardHierarchy(count: number): TimelineHierarchyDataSync {
  return count
    ? {
        conversations: {
          conversation: {
            conversationUrl: 'https://gemini.google.com/app/conversation',
            levels: Object.fromEntries(
              Array.from({ length: count }, (_, index) => [
                `turn-${index}`,
                ((index % 3) + 1) as 1 | 2 | 3,
              ]),
            ),
            collapsed: [],
            updatedAt: 1,
          },
        },
      }
    : { conversations: {} };
}

export function guardForks(count: number): ForkNodesDataSync {
  return {
    nodes: count
      ? {
          conversation: Array.from({ length: count }, (_, index) => ({
            conversationId: 'conversation',
            conversationUrl: 'https://gemini.google.com/app/conversation',
            turnId: `turn-${index}`,
            forkGroupId: 'shared-group',
            forkIndex: index,
            createdAt: 1,
          })),
        }
      : {},
    groups: count ? { 'shared-group': ['conversation:turn-0'] } : {},
  };
}

export function guardPlugins(count: number): PluginStateMap {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `plugin-${index}`,
      { enabled: index % 2 === 0, installedAt: 1 },
    ]),
  );
}

export function guardData(kind: GuardKind, count: number): unknown {
  switch (kind) {
    case 'folders':
      return guardFolders(count);
    case 'prompts':
      return Array.from({ length: count }, (_, index) => guardPrompt(`prompt-${index}`));
    case 'timelineHierarchy':
      return guardHierarchy(count);
    case 'forks':
      return guardForks(count);
    case 'plugins':
      return guardPlugins(count);
  }
}

export function guardEnvelope(kind: GuardKind, data: unknown) {
  return {
    format: formats[kind],
    exportedAt: GUARD_TIME,
    version: '2.2.1',
    ...(kind === 'prompts' ? { items: data } : { data }),
  };
}

export function scopedGuardFile(name: string, scope: SyncAccountScope): string {
  return name.replace(/\.json$/, `.acct-${hashString(scope.accountKey)}.json`);
}

/** Only storage/HTTP/native boundaries are fake; handlers, owners, payload readers and queue are real. */
export async function createGuardDevice(
  options: {
    provider?: SyncProvider;
    platform?: SyncPlatform;
    scope?: SyncAccountScope;
    isolation?: boolean;
  } = {},
) {
  const provider = options.provider ?? 'googleDrive';
  const platform = options.platform ?? 'gemini';
  const scope = options.scope;
  build.target = provider === 'icloud' ? 'safari' : 'chrome';
  native.mockReset();
  const values: Record<string, unknown> = {
    gvSyncMode: 'disabled',
    gvSyncProvider: provider,
    gvAccessToken: 'cached-guard-test-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.PROMPT_ITEMS]: [],
    [StorageKeys.PLUGINS_STATE]: {},
    [StorageKeys.FORK_NODES]: guardForks(0),
    [StorageKeys.TIMELINE_HIERARCHY]: guardHierarchy(0),
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false,
    ...Object.fromEntries(
      FOLDER_PLATFORM_IDS.map((id) => [FOLDER_PLATFORMS[id].folderStorageKey, guardFolders(0)]),
    ),
  };
  if (scope)
    values[`${FOLDER_PLATFORMS[platform].folderStorageKey}:acct:${hashString(scope.accountKey)}`] =
      guardFolders(0);
  const area = {
    get: async (keys: unknown): Promise<Record<string, unknown>> => {
      const names =
        typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys ?? values);
      const defaults =
        typeof keys === 'object' && keys !== null && !Array.isArray(keys) ? keys : {};
      return structuredClone({
        ...defaults,
        ...Object.fromEntries(
          names
            .filter((key): key is string => typeof key === 'string' && key in values)
            .map((key) => [key, values[key]]),
        ),
      });
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key];
    },
  };
  const extensionId = 'upload-guard-test';
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      sendMessage: async () => {},
    },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) =>
        callback('fresh-guard-token'),
    },
    storage: {
      local: area,
      sync: {
        get: async () => ({
          [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: options.isolation ?? Boolean(scope),
        }),
        set: async () => {},
      },
    },
    tabs: { query: async () => [], sendMessage: async () => {} },
  });
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  native.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
    const name = String(message.fileName ?? '');
    switch (message.action) {
      case 'iCloudAccountStatus':
        return { success: true, data: { available: true } };
      case 'iCloudReadFile':
        await drive.beforeRead?.(name);
        if (drive.failReads.has(name)) return { success: false, error: 'iCloud download failed' };
        return {
          success: true,
          data: { found: drive.files.has(name), json: drive.files.get(name) },
        };
      case 'iCloudWriteFile':
        await drive.beforeWrite?.(name, String(message.json));
        drive.files.set(name, String(message.json));
        drive.writes.push(name);
        return { success: true, data: { saved: true } };
      default:
        throw new Error(`Unexpected guard native action ${String(message.action)}`);
    }
  });
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('../../cloudSyncMessages');
  const { createForkMessagesOwner } = await import('../../forkMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const { googleDriveSyncService: service } =
    await import('@/core/services/GoogleDriveSyncService');
  const starStore = createStarStore(area);
  const forks = createForkMessagesOwner(area);
  const handle = createCloudSyncMessageHandler({
    getAllStarredMessages: starStore.getAll,
    getAllForkNodes: forks.getAllForkNodes,
    starStore,
  });
  await service.getState();
  const sender: chrome.runtime.MessageSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/src/pages/popup/index.html`,
  };
  return {
    drive,
    values,
    service,
    starStore,
    setLocal(kind: GuardKind, count: number) {
      values[
        kind === 'folders'
          ? scope
            ? `${FOLDER_PLATFORMS[platform].folderStorageKey}:acct:${hashString(scope.accountKey)}`
            : FOLDER_PLATFORMS[platform].folderStorageKey
          : storageKeys[kind]
      ] = guardData(kind, count);
    },
    putCloud(kind: GuardKind, count: number) {
      const name =
        kind === 'folders' ? FOLDER_PLATFORMS[platform].driveFoldersFileName : guardFiles[kind];
      drive.put(name, {
        ...guardEnvelope(kind, guardData(kind, count)),
        ...(kind === 'folders' && FOLDER_PLATFORMS[platform].folderExport
          ? { platform: FOLDER_PLATFORMS[platform].folderExport?.platform }
          : {}),
      });
    },
    request(type = 'gv.sync.upload', payload: Record<string, unknown> = {}): Promise<unknown> {
      const result = handle(
        {
          type,
          payload: {
            platform,
            interactive: false,
            ...(scope ? { accountScope: scope } : {}),
            ...payload,
          },
        },
        sender,
      );
      if (!result) throw new Error('Expected a sync request');
      return result;
    },
  };
}
