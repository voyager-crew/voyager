import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  HIGHLIGHT_BUCKET_KEY_PREFIX,
  HIGHLIGHT_DEVICE_ID_KEY,
  HIGHLIGHT_EXPORT_FORMAT,
  HIGHLIGHT_INDEX_KEY_PREFIX,
  type HighlightCreateInput,
  type HighlightExportPayloadV1,
  type HighlightRecordV1,
} from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import { FakeSyncDrive } from './fixtures/fakeSyncDrive';

const extensionId = 'highlight-upload-preparation';
const foldersFile = 'gemini-voyager-folders.json';
const accountScope: SyncAccountScope = {
  accountKey: 'email:highlight-person',
  accountId: 1,
  routeUserId: '1',
};
const scope = { ...accountScope, platform: 'gemini' as const };
const highlightsFile = `gemini-voyager-highlights.acct-${hashString(scope.accountKey)}.json`;

function input(text: string): HighlightCreateInput {
  return {
    conversationId: 'gemini:conv:one',
    conversationUrl: 'https://gemini.google.com/u/1/app/one',
    turnId: `turn-${text}`,
    role: 'assistant',
    anchor: {
      quote: { exact: text, prefix: '', suffix: '' },
      position: { start: 0, end: text.length },
      sourceTextHash: `source-${text}`,
    },
  };
}

function highlightStorage(values: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(
    Object.fromEntries(
      Object.entries(values).filter(
        ([key]) =>
          key.startsWith(HIGHLIGHT_INDEX_KEY_PREFIX) ||
          key.startsWith(HIGHLIGHT_BUCKET_KEY_PREFIX) ||
          key === HIGHLIGHT_DEVICE_ID_KEY,
      ),
    ),
  );
}

async function device() {
  const values: Record<string, unknown> = {
    gvSyncMode: 'disabled',
    gvAccessToken: 'authorized-highlight-test-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.FOLDER_DATA]: { folders: [], folderContents: {} },
    [StorageKeys.PROMPT_ITEMS]: [],
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    [StorageKeys.PLUGINS_STATE]: {},
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: true,
  };
  const area = {
    get: async (keys: unknown) => {
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
          names.filter((key) => key in values).map((key) => [key, values[key]]),
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
    permissions: { contains: async () => false },
    tabs: { query: async () => [] },
  });
  const drive = new FakeSyncDrive();
  drive.put(foldersFile, {
    format: 'gemini-voyager.folders.v1',
    data: { folders: [], folderContents: {} },
  });
  vi.stubGlobal('fetch', drive.fetch);
  vi.resetModules();
  const { highlightAnnotationService: annotations } = await import('../HighlightAnnotationService');
  const { createCloudSyncMessageHandler } = await import('@/pages/background/cloudSyncMessages');
  const { createForkMessagesOwner } = await import('@/pages/background/forkMessages');
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
  return {
    values,
    annotations,
    drive,
    upload: () =>
      handle(
        {
          type: 'gv.sync.upload',
          payload: {
            platform: 'gemini',
            interactive: false,
            includeHighlights: true,
            highlightAccountScope: accountScope,
          },
        },
        sender,
      ),
    cloud: (items: HighlightRecordV1[], clearMarker?: HighlightExportPayloadV1['clearMarker']) =>
      drive.put(highlightsFile, {
        format: HIGHLIGHT_EXPORT_FORMAT,
        exportedAt: new Date().toISOString(),
        version: '2.2.1',
        accountScope: { platform: 'gemini', accountHash: hashString(scope.accountKey) },
        items,
        ...(clearMarker ? { clearMarker } : {}),
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('highlight planning inside a Gemini upload', () => {
  it('keeps local highlight buckets and clear markers intact when the main upload fails', async () => {
    const d = await device();
    await d.annotations.add(scope, input('local quote'));
    d.cloud([], {
      clearedAt: Date.now() + 1_000,
      revision: { counter: 100, deviceId: 'remote-device' },
      generation: { counter: 1, id: 'remote-clear' },
    });
    const before = highlightStorage(d.values);
    const failedContentWrites: string[] = [];
    d.drive.beforeWrite = async (name) => {
      if (name === foldersFile) {
        failedContentWrites.push(name);
        throw new TypeError('Main upload unavailable');
      }
    };

    const pending = d.upload();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ ok: false });
    expect(failedContentWrites).toContain(foldersFile);
    expect(highlightStorage(d.values)).toEqual(before);
    expect((await d.annotations.getAll(scope)).map((record) => record.anchor.quote.exact)).toEqual([
      'local quote',
    ]);
    expect(d.drive.payload<HighlightExportPayloadV1>(highlightsFile).items).toEqual([]);
  });

  it('uploads a highlight added during the main upload together with local and cloud records', async () => {
    const d = await device();
    const { record: local } = await d.annotations.add(scope, input('before-main'));
    const cloud: HighlightRecordV1 = {
      ...local,
      id: 'cloud-highlight',
      turnId: 'cloud-turn',
      anchor: input('cloud quote').anchor,
    };
    d.cloud([cloud]);
    let addedDuringMain: HighlightRecordV1 | undefined;
    d.drive.beforeWrite = async (name) => {
      if (name === foldersFile)
        addedDuringMain = (await d.annotations.add(scope, input('during-main'))).record;
    };

    await expect(d.upload()).resolves.toMatchObject({ ok: true, highlights: { synced: true } });

    expect(addedDuringMain).toBeDefined();
    const uploaded = d.drive.payload<HighlightExportPayloadV1>(highlightsFile);
    expect(uploaded.items.map((record) => record.anchor.quote.exact).sort()).toEqual([
      'before-main',
      'cloud quote',
      'during-main',
    ]);
    expect(
      (await d.annotations.getAll(scope)).map((record) => record.anchor.quote.exact).sort(),
    ).toEqual(['before-main', 'cloud quote', 'during-main']);
    expect(uploaded.items).toContainEqual(addedDuringMain);
  });

  it('applies a cloud clear marker only after the main upload succeeds', async () => {
    const d = await device();
    await d.annotations.add(scope, input('before-clear'));
    const marker = {
      clearedAt: Date.now() + 1_000,
      revision: { counter: 100, deviceId: 'remote-device' },
      generation: { counter: 1, id: 'remote-clear' },
    };
    d.cloud([], marker);
    const recordsSeenByMain: string[][] = [];
    d.drive.beforeWrite = async (name) => {
      if (name === foldersFile) {
        recordsSeenByMain.push(
          (await d.annotations.getAll(scope)).map((record) => record.anchor.quote.exact),
        );
      }
    };

    await expect(d.upload()).resolves.toMatchObject({ ok: true });

    expect(recordsSeenByMain).toEqual([['before-clear']]);
    expect(d.drive.payload<HighlightExportPayloadV1>(highlightsFile)).toMatchObject({
      items: [],
      clearMarker: marker,
    });
    expect((await d.annotations.getAccountSnapshot(scope)).clearMarker).toEqual(marker);
    expect(await d.annotations.getAll(scope)).toEqual([]);
  });
});
