import { vi } from 'vitest';

import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import { StorageKeys } from '@/core/types/common';

export const SYNC_TEST_EXTENSION = 'scope-status-extension';
export const SYNC_TEST_FOLDER_FILE = 'gemini-voyager-folders.json';
export const SYNC_TEST_PROMPTS_FILE = 'gemini-voyager-prompts.json';
export const SYNC_TEST_CATALOG_FILE = 'gemini-voyager-timeline-hierarchy.site-chatgpt.json';
export const SYNC_TEST_CATALOG_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}chatgpt`;
export const syncTestPrompt = (id: string) => ({
  id,
  text: `${id} prompt`,
  tags: [],
  createdAt: 1,
});
export const syncTestFolders = (name: string) => ({
  folders: [{ id: 'folder', name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
  folderContents: { folder: [] },
});
export const syncTestEnvelope = (format: string, data: unknown) => ({
  format,
  version: '2.2.1',
  exportedAt: '2026-10-29T00:00:00.000Z',
  data,
});

/** Real background, owners, operation queue and Drive transport; only browser/HTTP are fake. */
export async function createScopeSyncDevice() {
  const values: Record<string, unknown> = {
    gvAccessToken: 'fake-authorized-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    gvSyncMode: 'disabled',
    [StorageKeys.FOLDER_DATA]: syncTestFolders('Local'),
    [StorageKeys.PROMPT_ITEMS]: [syncTestPrompt('local')],
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    [StorageKeys.PLUGINS_STATE]: { 'test.plugin': { enabled: true, installedAt: 1 } },
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false,
  };
  const syncValues: Record<string, unknown> = {
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
    [StorageKeys.CHAT_WIDTH]: 82,
  };
  let failedLocalKey: string | undefined;
  const makeArea = (data: Record<string, unknown>) => ({
    get: async (keys: unknown) => {
      const names =
        typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? data);
      if (data === values && failedLocalKey && (keys === null || names.includes(failedLocalKey)))
        throw new Error('local_read_failed');
      const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
      return structuredClone({
        ...defaults,
        ...Object.fromEntries(
          names
            .filter((key) => typeof key === 'string' && Object.hasOwn(data, key))
            .map((key) => [key, data[key]]),
        ),
      });
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete data[key];
    },
  });
  const local = makeArea(values);
  vi.stubGlobal('chrome', {
    runtime: {
      id: SYNC_TEST_EXTENSION,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${SYNC_TEST_EXTENSION}/${path}`,
    },
    identity: {
      getAuthToken: (_options: unknown, callback: (token: string) => void) =>
        callback('fake-token'),
    },
    storage: { local, sync: makeArea(syncValues) },
  });
  const drive = new FakeSyncDrive();
  const requests: URL[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new URL(String(input)));
    return drive.fetch(input, init);
  });
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('../cloudSyncMessages');
  const { createForkMessagesOwner } = await import('../forkMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const stars = createStarStore(local);
  const forks = createForkMessagesOwner(local);
  const handler = createCloudSyncMessageHandler({
    getAllStarredMessages: stars.getAll,
    getAllForkNodes: forks.getAllForkNodes,
    starStore: stars,
  });
  const popup: chrome.runtime.MessageSender = {
    id: SYNC_TEST_EXTENSION,
    url: `chrome-extension://${SYNC_TEST_EXTENSION}/src/pages/popup/index.html`,
  };
  return {
    values,
    syncValues,
    drive,
    requests,
    stars,
    failLocal: (key: string) => {
      failedLocalKey = key;
    },
    request: (type: string, payload: Record<string, unknown> = {}, sender = popup) =>
      handler({ type, payload: { platform: 'gemini', interactive: false, ...payload } }, sender),
    catalog() {
      values[SYNC_TEST_CATALOG_KEY] = {
        conversations: {
          local: {
            conversationUrl: 'https://chatgpt.com/c/local',
            levels: { turn: 2 },
            collapsed: [],
            updatedAt: 1,
          },
        },
      };
      drive.put(SYNC_TEST_CATALOG_FILE, {
        ...syncTestEnvelope('gemini-voyager.catalog-timeline-hierarchy.v1', {}),
        site: 'chatgpt',
      });
    },
  };
}
