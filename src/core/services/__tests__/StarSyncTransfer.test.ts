import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { createStarStore } from '@/features/savedLibrary/starStore';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';
import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { createDriveTestClient } from './fixtures/driveTestClient';

const native = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));
const scope: SyncAccountScope = { accountKey: 'person', accountId: 2, routeUserId: '2' };
const item: StarredMessage = {
  conversationId: 'gemini:conv:abc',
  conversationUrl: 'https://gemini.google.com/u/2/app/abc',
  turnId: 's-one',
  content: 'preview',
  text: 'Full\nprompt',
  starredAt: 50,
};
const name = (base: string) => `${base}.acct-${hashString(scope.accountKey)}.json`;

function fixture() {
  const values: Record<string, unknown> = { gvSyncProvider: 'icloud' };
  const area = {
    get: vi.fn(async () => structuredClone(values)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
    remove: vi.fn(async () => {}),
  };
  vi.stubGlobal('chrome', { storage: { local: area } });
  const remote = new Map<string, unknown>();
  const writes: string[] = [];
  native.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
    if (message.action === 'iCloudAccountStatus')
      return { success: true, data: { available: true } };
    if (message.action === 'iCloudReadFile') {
      const fileName = String(message.fileName);
      return {
        success: true,
        data: { found: remote.has(fileName), json: JSON.stringify(remote.get(fileName)) },
      };
    }
    if (message.action === 'iCloudWriteFile') {
      writes.push(String(message.fileName));
      remote.set(String(message.fileName), JSON.parse(String(message.json)));
      return { success: true, data: { saved: true } };
    }
    throw new Error(`Unexpected native request: ${message.action}`);
  });
  const service = createDriveTestClient(new GoogleDriveSyncService());
  const store = createStarStore(area);
  const upload = () =>
    service.upload(
      { folders: [], folderContents: {} },
      [],
      starMarker,
      true,
      'gemini',
      null,
      null,
      scope,
      null,
      null,
      null,
      store,
    );
  return { area, values, remote, writes, service, store, upload };
}
const starMarker = { messages: {} };
beforeEach(() => {
  vi.stubEnv('VOYAGER_BUILD_TARGET', 'safari');
  native.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('a tombstone-only iCloud transfer writes v2 and the empty legacy projection', async () => {
  const f = fixture();
  await f.service.getState();
  await f.store.add(item);
  await f.store.remove(item.conversationId, item.turnId);
  expect(await f.upload()).toBe(true);
  expect(f.remote.get(name('gemini-voyager-stars'))).toMatchObject({
    items: [],
    tombstones: [expect.objectContaining({ turnId: item.turnId })],
  });
  expect(f.remote.get(name('gemini-voyager-starred'))).toMatchObject({ data: { messages: {} } });
  expect(f.writes).toEqual([
    name('gemini-voyager-folders'),
    name('gemini-voyager-stars'),
    name('gemini-voyager-starred'),
  ]);
});

it('a scoped iCloud push seeds from the legacy shared v1 file but never shared v2', async () => {
  const f = fixture();
  await f.service.getState();
  const { text: _text, ...old } = item;
  f.remote.set('gemini-voyager-starred.json', {
    format: 'gemini-voyager.starred.v1',
    data: { messages: { [item.conversationId]: [old] } },
  });
  f.remote.set(
    'gemini-voyager-stars.json',
    buildStarsV2({ data: { messages: {} }, tombstones: [] }, null, 'test'),
  );
  expect(await f.upload()).toBe(true);
  expect((await f.store.getAll()).messages[item.conversationId]).toEqual([old]);
  const readNames = native.mock.calls
    .filter(([, message]) => message.action === 'iCloudReadFile')
    .map(([, message]) => message.fileName);
  expect(readNames).toContain('gemini-voyager-starred.json');
  expect(readNames).not.toContain('gemini-voyager-stars.json');
});

it('a successful null cloud read is a failure rather than an empty backup', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.getState();
  f.remote.set(name('gemini-voyager-stars'), null);
  const pending = f.upload();
  await vi.runAllTimersAsync();
  expect(await pending).toBe(false);
  expect(f.writes).toEqual([]);
  expect(f.remote.get(name('gemini-voyager-stars'))).toBeNull();
  expect(f.values[StorageKeys.SAVED_LIBRARY_STARS]).toBeUndefined();
});

it('a provider switch while reading never retargets the captured star transfer', async () => {
  const f = fixture();
  await f.service.getState();
  const implementation = native.getMockImplementation()!;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  native.mockImplementation(async (app, message) => {
    if (message.action === 'iCloudReadFile' && message.fileName === name('gemini-voyager-stars')) {
      started();
      await held;
    }
    return implementation(app, message);
  });
  const pending = f.upload();
  await reading;
  await f.service.setProvider('googleDrive');
  release();
  expect(await pending).toBe(false);
  expect(f.writes).toEqual([]);
  expect(await f.service.getState()).toMatchObject({
    provider: 'googleDrive',
    error: null,
  });
});

it('revoked native credentials expose reconnect instead of leaving the session authenticated', async () => {
  const f = fixture();
  await f.service.getState();
  await f.service.setProvider('googleDrive');
  native.mockImplementation(async (_app, message) => {
    if (message.action === 'googleDriveGetSession')
      return { success: true, data: { signedIn: true } };
    if (message.action === 'googleDriveFindFile')
      return { success: true, data: { fileID: 'found' } };
    if (message.action === 'googleDriveDownloadFile')
      return { success: false, code: 'drive_auth_required', error: 'Reconnect' };
    throw new Error(`Unexpected ${message.action}`);
  });
  expect(await f.service.authenticate()).toBe(true);
  expect(await f.service.download(true, 'gemini', scope)).toBeNull();
  expect(await f.service.getState()).toMatchObject({ isAuthenticated: false, error: 'Reconnect' });
});

it('an account scope changed during authentication cannot retarget the uploaded files', async () => {
  const f = fixture();
  await f.service.getState();
  const implementation = native.getMockImplementation()!;
  let started!: () => void;
  const authenticating = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  native.mockImplementation(async (app, message) => {
    if (message.action === 'iCloudAccountStatus') {
      started();
      await held;
    }
    return implementation(app, message);
  });
  const requestScope = { ...scope };
  const pending = f.service.upload(
    { folders: [], folderContents: {} },
    [],
    starMarker,
    true,
    'gemini',
    null,
    null,
    requestScope,
    null,
    null,
    null,
    f.store,
  );
  await authenticating;
  requestScope.accountKey = 'other';
  requestScope.routeUserId = '9';
  release();
  expect(await pending).toBe(true);
  expect(f.writes).toEqual([
    name('gemini-voyager-folders'),
    name('gemini-voyager-stars'),
    name('gemini-voyager-starred'),
  ]);
});

it('an obsolete auth failure cannot invalidate a newly connected provider', async () => {
  const f = fixture();
  await f.service.getState();
  await f.service.setProvider('googleDrive');
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  native.mockImplementation(async (_app, message) => {
    if (message.action === 'googleDriveGetSession')
      return { success: true, data: { signedIn: true } };
    if (message.action === 'googleDriveFindFile')
      return { success: true, data: { fileID: 'found' } };
    if (message.action === 'iCloudAccountStatus')
      return { success: true, data: { available: true } };
    if (message.action === 'googleDriveDownloadFile') {
      started();
      await held;
      return { success: false, code: 'drive_auth_required', error: 'Old session revoked' };
    }
    throw new Error(`Unexpected ${message.action}`);
  });
  const pending = f.service.download(true, 'gemini', scope);
  await reading;
  await f.service.setProvider('icloud');
  expect(await f.service.authenticate()).toBe(true);
  release();
  expect(await pending).toBeNull();
  expect(await f.service.getState()).toMatchObject({ provider: 'icloud', isAuthenticated: true });
});

it('a successful Drive null response is refused while a missing file stays absent', async () => {
  vi.stubEnv('VOYAGER_BUILD_TARGET', 'chrome');
  vi.useFakeTimers();
  const fetch = vi.fn(async () => Response.json(null));
  vi.stubGlobal('fetch', fetch);
  const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([]), {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  const rejected = expect(files.download('token', 'stars-file')).rejects.toThrow(
    'invalid null data',
  );
  await vi.runAllTimersAsync();
  await rejected;
  fetch.mockResolvedValue(new Response(null, { status: 404 }));
  expect(await files.download('token', 'missing')).toBeNull();
});
