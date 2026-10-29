import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { applyPopupCloudDownload, type CloudDownloadData } from '../CloudSyncDownloadService';

const FOLDERS = {
  folders: [
    {
      id: 'local',
      name: 'Keep local',
      isExpanded: false,
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: {},
};
const CLOUD_FOLDERS = {
  folders: [
    {
      id: 'cloud',
      name: 'From Drive',
      isExpanded: false,
      parentId: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: {},
};

function setup() {
  const values: Record<string, unknown> = {
    [StorageKeys.FOLDER_DATA]: structuredClone(FOLDERS),
    [StorageKeys.PROMPT_ITEMS]: [
      { id: 'local-prompt', text: 'Keep prompt', tags: [], createdAt: 1 },
    ],
    [StorageKeys.PLUGINS_STATE]: { 'custom.example': { enabled: true } },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
  };
  vi.mocked(chrome.storage.local.get).mockImplementation(async (keys) => {
    const requested =
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(values);
    return structuredClone(
      Object.fromEntries(requested.flatMap((key) => (key in values ? [[key, values[key]]] : []))),
    );
  });
  vi.mocked(chrome.storage.local.set).mockImplementation(async (items) => {
    Object.assign(values, structuredClone(items));
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({}));
  const send = vi.fn(async () => undefined);
  return {
    values,
    send,
    apply: (data: CloudDownloadData, mode: 'overwrite' | 'merge' = 'overwrite') =>
      applyPopupCloudDownload({
        context: {
          payload: { platform: 'gemini', accountScope: null },
          timelineHierarchyStorageKey: StorageKeys.TIMELINE_HIERARCHY,
        },
        local: {
          folders: FOLDERS,
          timelineHierarchy: { conversations: {} },
          folderStorageKey: StorageKeys.FOLDER_DATA,
          accountChanged: false,
        },
        data,
        mode,
        highlightsRestored: false,
        catalog: { status: 'pulled', value: null },
        send,
      }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('download status at the real popup apply seam', () => {
  it('reports unrecognized null payloads separately from missing kinds and leaves their local data intact', async () => {
    const h = setup();
    const before = structuredClone(h.values);
    const result = await h.apply({
      folders: null,
      prompts: null,
      settings: null,
      plugins: null,
      timelineHierarchy: null,
      kindStatus: {
        folders: 'unrecognized',
        prompts: 'unrecognized',
        timelineHierarchy: 'unrecognized',
        settings: 'missing',
        plugins: 'missing',
      },
    });

    expect(result.restored).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'folders', reason: 'unrecognized' },
        { kind: 'prompts', reason: 'unrecognized' },
        { kind: 'timelineHierarchy', reason: 'unrecognized' },
        { kind: 'settings', reason: 'missing' },
      ]),
    );
    expect(h.values).toEqual(before);
  });

  it('aborts every apply when any read failed, even if an earlier kind was valid', async () => {
    const h = setup();
    const before = structuredClone(h.values);
    await expect(
      h.apply({
        folders: { format: 'gemini-voyager.folders.v1', data: CLOUD_FOLDERS },
        kindStatus: { folders: 'found', prompts: 'failed' },
      }),
    ).rejects.toThrow('cloud_read_failed');
    expect(h.values).toEqual(before);
  });

  it('applies the selected site without running shared owners during a merge', async () => {
    const h = setup();
    const before = structuredClone(h.values);
    await h.apply(
      {
        folders: { format: 'gemini-voyager.folders.v1', data: CLOUD_FOLDERS },
        prompts: { format: 'gemini-voyager.prompts.v1', items: [] },
        plugins: { format: 'gemini-voyager.plugins.v1', data: {} },
        selection: {
          site: true,
          shared: false,
          timelineHierarchy: false,
          conversationExtras: false,
        },
      },
      'merge',
    );

    expect(h.values[StorageKeys.FOLDER_DATA]).toMatchObject({
      folders: expect.arrayContaining([
        expect.objectContaining({ id: 'local' }),
        expect.objectContaining({ id: 'cloud' }),
      ]),
    });
    for (const key of [
      StorageKeys.PROMPT_ITEMS,
      StorageKeys.PLUGINS_STATE,
      StorageKeys.TIMELINE_HIERARCHY,
    ])
      expect(h.values[key]).toEqual(before[key]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each(['merge', 'overwrite'] as const)(
    'does not write excluded site or shared rows in %s mode',
    async (mode) => {
      const h = setup();
      const before = structuredClone(h.values);
      await h.apply(
        {
          folders: { format: 'gemini-voyager.folders.v1', data: CLOUD_FOLDERS },
          selection: { site: false, shared: false },
        },
        mode,
      );
      expect(h.values).toEqual(before);
    },
  );
});
