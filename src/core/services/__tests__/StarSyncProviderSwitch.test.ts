import { afterEach, expect, it, vi } from 'vitest';

import { createStarStore } from '@/features/savedLibrary/starStore';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { createDriveTestClient } from './fixtures/driveTestClient';
import { createFakeICloudUploadTransport } from './fixtures/fakeICloudUploadTransport';

const native = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  native.mockReset();
});

it('an upload started during a provider switch writes nothing to the new provider', async () => {
  vi.stubEnv('VOYAGER_BUILD_TARGET', 'safari');
  let clearStarted!: () => void;
  const clearing = new Promise<void>((resolve) => {
    clearStarted = resolve;
  });
  let releaseClear!: () => void;
  const heldClear = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  const tokenRequests: string[] = [];

  const values: Record<string, unknown> = {};
  const area = {
    get: vi.fn(async () => structuredClone(values)),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
    remove: vi.fn(async () => {
      clearStarted();
      await heldClear;
    }),
  };
  vi.stubGlobal('chrome', { storage: { local: area } });
  const remote = new Map<string, unknown>();
  const writes: string[] = [];
  const cloudUploads = createFakeICloudUploadTransport({
    readText: (name) => (remote.has(name) ? JSON.stringify(remote.get(name)) : null),
    writeText: (name, text) => {
      writes.push(name);
      remote.set(name, JSON.parse(text));
    },
  });
  native.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
    const cloudResponse = await cloudUploads(message);
    if (cloudResponse) return cloudResponse;
    if (message.action === 'googleDriveGetSession') {
      tokenRequests.push(String(message.action));
      return { success: true, data: { signedIn: true } };
    }
    const fileName = String(message.fileName);
    if (message.action === 'iCloudReadFile') {
      return {
        success: true,
        data: { found: remote.has(fileName), json: JSON.stringify(remote.get(fileName)) },
      };
    }
    throw new Error(`Unexpected action ${message.action}`);
  });

  const service = createDriveTestClient(new GoogleDriveSyncService());
  await service.getState();
  const store = createStarStore(area);
  await store.add({
    conversationId: 'gemini:conv:abc',
    conversationUrl: 'https://gemini.google.com/app/abc',
    turnId: 's-one',
    content: 'preview',
    text: 'Private full prompt',
    starredAt: 50,
  });
  const change = service.setProvider('icloud');
  await clearing;
  const transfer = service.upload(
    { folders: [], folderContents: {} },
    [],
    { messages: {} },
    true,
    'gemini',
    null,
    null,
    null,
    null,
    null,
    null,
    store,
  );
  releaseClear();
  await change;

  expect(await transfer).toBe(false);
  expect(tokenRequests).toEqual([]);
  expect(writes).toEqual([]);
  expect(remote.size).toBe(0);
  expect(await service.getState()).toMatchObject({
    provider: 'icloud',
    error: null,
  });
  expect((await store.getAll()).messages['gemini:conv:abc'][0].text).toBe('Private full prompt');
});
