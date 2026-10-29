import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import { StorageKeys } from '@/core/types/common';

const extensionId = 'normalization-test-extension';
const foldersFile = 'gemini-voyager-folders.json';
const promptsFile = 'gemini-voyager-prompts.json';
const hierarchyFile = 'gemini-voyager-timeline-hierarchy.json';
const pluginsFile = 'gemini-voyager-plugins.json';
const forksFile = 'gemini-voyager-forks.json';
const prompt = { id: 'local', text: 'Local', tags: [], createdAt: 1 };
const folderData = { folders: [], folderContents: {} };
const hierarchy = {
  conversations: {
    saved: {
      conversationUrl: 'https://gemini.google.com/app/saved',
      levels: { turn: 2 },
      collapsed: [],
      updatedAt: 1,
    },
  },
};
const fork = {
  conversationId: 'saved',
  conversationUrl: 'https://gemini.google.com/app/saved',
  turnId: 'turn',
  forkGroupId: 'group',
  forkIndex: 0,
  createdAt: 1,
};

/** Exercise the background upload, replacing only browser storage and Drive HTTP. */
async function device(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    gvSyncMode: 'disabled',
    gvAccessToken: 'test-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.FOLDER_DATA]: folderData,
    [StorageKeys.PROMPT_ITEMS]: [prompt],
    [StorageKeys.TIMELINE_HIERARCHY]: hierarchy,
    [StorageKeys.PLUGINS_STATE]: { plugin: { enabled: true, installedAt: 1 } },
    [StorageKeys.FORK_NODES]: { nodes: { saved: [fork] }, groups: { group: ['saved:turn'] } },
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false,
    ...structuredClone(overrides),
  };
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
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    },
    storage: {
      local: area,
      sync: {
        get: async () => ({ [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false }),
        set: async () => {},
      },
    },
  });
  const drive = new FakeSyncDrive();
  for (const name of [foldersFile, promptsFile, hierarchyFile, pluginsFile, forksFile]) {
    drive.put(name, { retained: 'cloud content' });
  }
  vi.stubGlobal('fetch', drive.fetch);
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('../cloudSyncMessages');
  const { createForkMessagesOwner } = await import('../forkMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const stars = createStarStore(area);
  const forks = createForkMessagesOwner(area);
  const handle = createCloudSyncMessageHandler({
    getAllStarredMessages: stars.getAll,
    getAllForkNodes: forks.getAllForkNodes,
    starStore: stars,
  });
  const sender: chrome.runtime.MessageSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/src/pages/popup/index.html`,
  };
  const upload = () =>
    handle({ type: 'gv.sync.upload', payload: { platform: 'gemini', interactive: false } }, sender);
  return { drive, values, upload };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizable local data through the background upload', () => {
  it('uploads repaired entries and retains good content from every local kind', async () => {
    const d = await device({
      [StorageKeys.PROMPT_ITEMS]: [
        { ...prompt, text: ' Local ', tags: ['Review', 1, 'Review'], createdAt: 'old' },
        null,
      ],
      [StorageKeys.TIMELINE_HIERARCHY]: {
        conversations: {
          saved: { ...hierarchy.conversations.saved, collapsed: [''], updatedAt: -1 },
          broken: 'unreadable',
        },
      },
      [StorageKeys.PLUGINS_STATE]: {
        plugin: { enabled: true, installedAt: 'old', settings: { good: true, dropped: [] } },
        broken: { enabled: 'not a switch' },
      },
      [StorageKeys.FORK_NODES]: {
        nodes: { saved: [fork, { turnId: 'broken' }] },
        groups: { group: ['saved:turn'] },
      },
    });
    await expect(d.upload()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(promptsFile)).toMatchObject({
      items: [{ ...prompt, tags: ['review', '1'], createdAt: 0 }],
    });
    expect(d.drive.payload(hierarchyFile)).toMatchObject({
      data: {
        conversations: {
          saved: { ...hierarchy.conversations.saved, updatedAt: 0 },
        },
      },
    });
    expect(d.drive.payload(pluginsFile)).toMatchObject({
      data: {
        plugin: {
          enabled: true,
          installedAt: 0,
          settings: { good: true },
        },
      },
    });
    expect(d.drive.payload(forksFile)).toMatchObject({
      data: { nodes: { saved: [fork] }, groups: { group: ['saved:turn'] } },
    });
  });

  it.each([
    ['prompts', StorageKeys.PROMPT_ITEMS, {}],
    ['prompts becoming empty', StorageKeys.PROMPT_ITEMS, [{ text: '' }]],
    ['hierarchy', StorageKeys.TIMELINE_HIERARCHY, { conversations: [] }],
    [
      'hierarchy becoming empty',
      StorageKeys.TIMELINE_HIERARCHY,
      { conversations: { unreadable: null } },
    ],
    ['plugins', StorageKeys.PLUGINS_STATE, []],
    ['plugins becoming empty', StorageKeys.PLUGINS_STATE, { broken: { enabled: 'bad' } }],
    ['forks', StorageKeys.FORK_NODES, { nodes: [], groups: {} }],
    ['forks becoming empty', StorageKeys.FORK_NODES, { nodes: { bad: [{}] }, groups: {} }],
  ])(
    'does not replace any Drive content after an unreadable %s local read',
    async (_kind, key, raw) => {
      const d = await device({ [String(key)]: raw });
      const cloud = new Map(d.drive.files);
      const outcome = await Promise.resolve(d.upload()).catch(() => ({ ok: false }));
      expect(outcome).toMatchObject({ ok: false });
      expect(d.drive.files).toEqual(cloud);
    },
  );
});
