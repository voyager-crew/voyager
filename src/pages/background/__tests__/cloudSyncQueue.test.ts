import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSyncDrive } from '@/core/services/__tests__/fixtures/fakeSyncDrive';
import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

const build = vi.hoisted((): { target: 'chrome' | 'safari' } => ({ target: 'chrome' }));
const native = vi.hoisted(() => vi.fn());
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => build.target,
  isSafari: () => build.target === 'safari',
  isBrave: () => false,
}));
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));

const extensionId = 'runtime-sync-queue';
const PROMPTS = 'gemini-voyager-prompts.json';
const AI_FOLDERS = 'gemini-voyager-aistudio-folders.json';
const PLUGINS = 'gemini-voyager-plugins.json';
const prompt = (id: string): PromptItem => ({ id, text: `${id} text`, tags: [], createdAt: 1 });
const folderData = { folders: [], folderContents: {} };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Two runtime messages share the real background handler, service, owners and Drive transport. */
async function device() {
  const values: Record<string, unknown> = {
    gvSyncMode: 'disabled',
    [StorageKeys.FOLDER_DATA]: folderData,
    [FOLDER_PLATFORMS.aistudio.folderStorageKey]: folderData,
    [StorageKeys.PROMPT_ITEMS]: [prompt('local')],
    [StorageKeys.PLUGINS_STATE]: { plugin: { enabled: true, installedAt: 1 } },
    [StorageKeys.FORK_NODES]: { nodes: {}, groups: {} },
    [StorageKeys.TIMELINE_HIERARCHY]: { conversations: {} },
    [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: false,
  };
  const localWrites: Record<string, unknown>[] = [];
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
      localWrites.push(structuredClone(items));
      Object.assign(values, structuredClone(items));
    },
    remove: async (keys: string | string[]) => {
      for (const key of [keys].flat()) delete values[key];
    },
  };
  const identity = vi.fn((_options: unknown, callback: (token: string) => void) =>
    callback('account-token'),
  );
  vi.stubGlobal('chrome', {
    runtime: {
      id: extensionId,
      lastError: null,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    },
    identity: { getAuthToken: identity },
    storage: {
      local: area,
      sync: {
        get: async () => ({ [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false }),
        set: async () => {},
      },
    },
  });
  const drive = new FakeSyncDrive();
  drive.put(PROMPTS, {
    format: 'gemini-voyager.prompts.v1',
    exportedAt: '2026-10-29T00:00:00.000Z',
    items: [prompt('cloud')],
  });
  drive.put(AI_FOLDERS, {
    format: 'gemini-voyager.folders.v1',
    exportedAt: '2026-10-29T00:00:00.000Z',
    data: folderData,
  });
  const fetch = vi.fn(drive.fetch);
  vi.stubGlobal('fetch', fetch);
  let nativeAuthLost = false;
  native.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
    const name = String(message.fileName ?? message.fileID);
    switch (message.action) {
      case 'googleDriveGetSession':
        return { success: true, data: { signedIn: true } };
      case 'googleDriveFindFile':
        return { success: true, data: { fileID: drive.files.has(name) ? name : null } };
      case 'googleDriveEnsureFile':
        if (!drive.files.has(name)) drive.files.set(name, '');
        return { success: true, data: { fileID: name } };
      case 'googleDriveCreateFile': {
        const response = await drive.createFile(
          {
            name,
            mimeType: 'application/json',
            parents: ['sync-test-folder'],
            appProperties: message.appProperties as Record<string, string>,
          },
          typeof message.json === 'string' ? message.json : undefined,
        );
        if (!response.ok) return { success: false, error: 'Google Drive write failed' };
        const metadata = (await response.json()) as {
          id: string;
          name: string;
          createdTime: string;
        };
        return {
          success: true,
          data: { fileID: metadata.id, name: metadata.name, createdTime: metadata.createdTime },
        };
      }
      case 'googleDriveListHistory':
        return {
          success: true,
          data: {
            files: drive.histories(String(message.sourceFileName)).map((file) => ({
              fileID: file.id,
              name: file.name,
              createdTime: file.createdTime,
            })),
          },
        };
      case 'googleDriveTrashFile':
        drive.trashed.add(name);
        return { success: true, data: { trashed: true } };
      case 'googleDriveDownloadFile':
        await drive.beforeRead?.(name);
        if (nativeAuthLost)
          return { success: false, code: 'drive_auth_required', error: 'Reconnect' };
        return {
          success: true,
          data: { found: drive.files.has(name), json: drive.files.get(name) },
        };
      case 'googleDriveGetFileMetadata': {
        const response = await drive.fetch(
          `https://www.googleapis.com/drive/v3/files/${name}?fields=id,md5Checksum,modifiedTime,trashed`,
        );
        return {
          success: true,
          data:
            response.status === 404
              ? { found: false }
              : { found: true, ...(await response.json()) },
        };
      }
      case 'googleDriveUploadFile':
        drive.files.set(name, String(message.json));
        return {
          success: true,
          data: {
            saved: true,
            ...(await (
              await drive.fetch(
                `https://www.googleapis.com/drive/v3/files/${name}?fields=id,md5Checksum,modifiedTime`,
              )
            ).json()),
          },
        };
      default:
        throw new Error(`Unexpected native action ${String(message.action)}`);
    }
  });
  vi.resetModules();
  const { createCloudSyncMessageHandler } = await import('../cloudSyncMessages');
  const { createForkMessagesOwner } = await import('../forkMessages');
  const { createStarStore } = await import('@/features/savedLibrary/starStore');
  const { googleDriveSyncService: service } =
    await import('@/core/services/GoogleDriveSyncService');
  const stars = createStarStore(area);
  const forks = createForkMessagesOwner(area);
  const handler = createCloudSyncMessageHandler({
    getAllStarredMessages: stars.getAll,
    getAllForkNodes: forks.getAllForkNodes,
    starStore: stars,
  });
  await service.getState();
  const sender: chrome.runtime.MessageSender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/src/pages/popup/index.html`,
  };
  return {
    service,
    drive,
    values,
    identity,
    localWrites,
    loseNativeAuth: (lost: boolean) => {
      nativeAuthLost = lost;
    },
    driveCalls: () =>
      fetch.mock.calls.filter(([input]) => new URL(String(input)).hostname === 'www.googleapis.com')
        .length,
    request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
      const result = handler(
        { type, payload: { interactive: false, platform: 'aistudio', ...payload } },
        sender,
      );
      if (!result) throw new Error('Unexpected non-sync message');
      return result;
    },
  };
}

beforeEach(() => {
  build.target = 'chrome';
  native.mockReset();
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runtime cloud sync queue', () => {
  it('a full upload queued behind a prompt merge reads and uploads the merged library', async () => {
    const d = await device();
    const started = deferred();
    const release = deferred();
    d.drive.beforeRead = async (name) => {
      if (name === PROMPTS) {
        started.resolve();
        await release.promise;
      }
    };
    const merge = d.request('gv.sync.pushPromptsMerge');
    await started.promise;
    const upload = d.request('gv.sync.upload');
    // Give an unqueued second message a complete virtual turn while the first read is held.
    await vi.advanceTimersByTimeAsync(0);
    release.resolve();
    await expect(Promise.all([merge, upload])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    const expected = [prompt('cloud'), prompt('local')];
    expect(d.drive.payload(PROMPTS)).toMatchObject({ items: expect.arrayContaining(expected) });
    expect(d.drive.payload<{ items: PromptItem[] }>(PROMPTS).items).toHaveLength(2);
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(expect.arrayContaining(expected));
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toHaveLength(2);
  });

  it('sign-out rejects an old queued runtime upload before token, Drive or storage work, and clears cancellation errors', async () => {
    const d = await device();
    const started = deferred();
    const release = deferred();
    d.drive.beforeRead = async (name) => {
      if (name === PROMPTS) {
        started.resolve();
        await release.promise;
      }
    };
    const reading = d.request('gv.sync.pullPromptsMerge');
    await started.promise;
    const queued = d.request('gv.sync.upload');
    const outcomes = Promise.allSettled([reading, queued]);
    await d.service.signOut();
    const afterSignOut = structuredClone(d.values);
    const calls = d.driveCalls();
    const writes = d.localWrites.length;
    const cloud = new Map(d.drive.files);
    release.resolve();
    await expect(outcomes).resolves.toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ]);
    expect(d.identity).toHaveBeenCalledTimes(1);
    expect(d.driveCalls()).toBe(calls);
    expect(d.localWrites).toHaveLength(writes);
    expect(d.values).toEqual(afterSignOut);
    expect(d.drive.files).toEqual(cloud);
    await expect(d.service.getState()).resolves.toMatchObject({ error: null, isSyncing: false });
    d.drive.beforeRead = undefined;
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({ ok: true });
    expect(d.identity).toHaveBeenCalledTimes(2);
    expect(d.drive.payload(PROMPTS)).toMatchObject({ items: [prompt('local')] });
  });

  it('native auth loss rejects old queued work without another session request, while a new request can sync', async () => {
    build.target = 'safari';
    const d = await device();
    const started = deferred();
    const release = deferred();
    d.drive.beforeRead = async (name) => {
      if (name === PROMPTS) {
        started.resolve();
        await release.promise;
      }
    };
    d.loseNativeAuth(true);
    const reading = d.request('gv.sync.pullPromptsMerge');
    await started.promise;
    const queued = d.request('gv.sync.upload');
    const outcomes = Promise.allSettled([reading, queued]);
    const nativeCalls = native.mock.calls.length;
    const local = structuredClone(d.values);
    const cloud = new Map(d.drive.files);
    release.resolve();
    await expect(outcomes).resolves.toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ]);
    expect(native).toHaveBeenCalledTimes(nativeCalls);
    expect(d.values).toEqual(local);
    expect(d.drive.files).toEqual(cloud);
    await expect(d.service.getState()).resolves.toMatchObject({
      error: 'Reconnect',
      isAuthenticated: false,
      isSyncing: false,
    });
    d.drive.beforeRead = undefined;
    d.loseNativeAuth(false);
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(PROMPTS)).toMatchObject({ items: [prompt('local')] });
  });

  it('a handler preflight read error stays in that request and does not leave a persistent sync error', async () => {
    const d = await device();
    const cloud = new Map(d.drive.files);
    d.values[StorageKeys.PROMPT_ITEMS] = 'unreadable';
    const local = structuredClone(d.values);
    await expect(d.request('gv.sync.upload')).resolves.toEqual({
      ok: false,
      error: 'local_read_failed',
    });
    await expect(d.service.getState()).resolves.toMatchObject({ error: null, isSyncing: false });
    expect(d.identity).not.toHaveBeenCalled();
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    d.values[StorageKeys.PROMPT_ITEMS] = [prompt('local')];
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(PROMPTS)).toMatchObject({ items: [prompt('local')] });
  });

  it('an actual transfer error retains the existing sync error path', async () => {
    const d = await device();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (
        url.pathname === '/drive/v3/files' &&
        !query.startsWith('(') &&
        query.includes(`name='${PLUGINS}'`)
      )
        return Response.json({}, { status: 503 });
      return d.drive.fetch(input, init);
    });
    await expect(d.request('gv.sync.upload')).resolves.toMatchObject({ ok: false });
    await expect(d.service.getState()).resolves.toMatchObject({
      error: 'Failed to search files: 503',
      isSyncing: false,
    });
  });
});
