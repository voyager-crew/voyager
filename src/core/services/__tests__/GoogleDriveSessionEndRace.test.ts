import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GoogleDriveAuth } from '../GoogleDriveAuth';
import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import type { GoogleDriveSyncTransfer } from '../GoogleDriveSyncTransfer';

const native = vi.hoisted(() => vi.fn());
vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: native } } }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const prompt = (id: string) => ({ id, text: id, tags: [], createdAt: 1 });
const PROMPTS = 'gemini-voyager-prompts.json';

beforeEach(() => {
  vi.stubEnv('VOYAGER_BUILD_TARGET', 'safari');
  native.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(['provider switch', 'sign-out'] as const)(
  'an auth-lost read during %s cleanup cannot revive a session for queued writes',
  async (action) => {
    const values: Record<string, unknown> = { businessData: ['unchanged'] };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: async () => structuredClone(values),
          set: async (items: Record<string, unknown>) => {
            Object.assign(values, structuredClone(items));
          },
          remove: async () => {},
        },
      },
    });
    const drive = new Map<string, unknown>([[PROMPTS, { items: [prompt('cloud')] }]]);
    const cloud = new Map<string, unknown>();
    const reading = deferred();
    const releaseRead = deferred();
    const clearing = deferred();
    const releaseClear = deferred();
    const captured = deferred();
    const tokenRequests: string[] = [];
    const contentWrites: string[] = [];
    native.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
      switch (message.action) {
        case 'googleDriveGetSession':
          tokenRequests.push('googleDrive');
          return { success: true, data: { signedIn: true } };
        case 'iCloudAccountStatus':
          tokenRequests.push('icloud');
          return { success: true, data: { available: true } };
        case 'googleDriveSignOut':
          return { success: true, data: { signedOut: true } };
        case 'googleDriveFindFile':
          return { success: true, data: { fileID: message.fileName } };
        case 'googleDriveEnsureFile':
          return { success: true, data: { fileID: message.fileName } };
        case 'googleDriveDownloadFile':
          reading.resolve();
          await releaseRead.promise;
          return {
            success: false,
            code: 'drive_auth_required',
            error: 'Old native credentials revoked',
          };
        case 'googleDriveUploadFile':
          drive.set(String(message.fileID), JSON.parse(String(message.json)));
          contentWrites.push('googleDrive');
          return { success: true, data: { saved: true } };
        case 'iCloudWriteFile':
          cloud.set(String(message.fileName), JSON.parse(String(message.json)));
          contentWrites.push('icloud');
          return { success: true, data: { saved: true } };
        default:
          throw new Error(`Unexpected native action: ${message.action}`);
      }
    });
    vi.spyOn(GoogleDriveAuth.prototype, 'clear').mockImplementation(async () => {
      clearing.resolve();
      await releaseClear.promise;
    });
    const service = new GoogleDriveSyncService();
    await service.getState();
    const active = service
      .runExclusive((port) => port.downloadPromptsOnly(null, false))
      .then(
        () => undefined,
        () => undefined,
      );
    await reading.promise;
    const configuration =
      action === 'provider switch' ? service.setProvider('icloud') : service.signOut();
    await clearing.promise;
    let queued!: Promise<{ ok: boolean }>;
    service.onStateChange(() => {
      service.onStateChange(() => {});
      queued = service
        .runExclusive(async (port: GoogleDriveSyncTransfer) => {
          await chrome.storage.local.set({ businessData: ['stale request ran'] });
          return port.uploadPromptsOnly([prompt('stale')], null, false);
        })
        .then(
          (ok) => ({ ok }),
          () => ({ ok: false }),
        );
      captured.resolve();
      releaseClear.resolve();
    });
    releaseRead.resolve();
    await captured.promise;
    await configuration;
    await active;
    const result = await queued;

    expect(result).toEqual({ ok: false });
    expect(tokenRequests).toEqual(['googleDrive']);
    expect(contentWrites).toEqual([]);
    expect(values.businessData).toEqual(['unchanged']);
    expect(drive.get(PROMPTS)).toEqual({ items: [prompt('cloud')] });
    expect(cloud.size).toBe(0);

    await expect(
      service.runExclusive((port) => port.uploadPromptsOnly([prompt('fresh')], null, false)),
    ).resolves.toBe(true);
    expect((action === 'provider switch' ? cloud : drive).get(PROMPTS)).toMatchObject({
      items: [prompt('fresh')],
    });
  },
);

it('an auth-lost read cannot write its old error back after a provider switch clears it', async () => {
  const values: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async () => structuredClone(values),
        set: async (items: Record<string, unknown>) => {
          Object.assign(values, structuredClone(items));
        },
        remove: async () => {},
      },
    },
  });
  const reading = deferred();
  const releaseRead = deferred();
  const configuring = deferred();
  native.mockImplementation(async (_app: string, message: Record<string, unknown>) => {
    switch (message.action) {
      case 'googleDriveGetSession':
        return { success: true, data: { signedIn: true } };
      case 'googleDriveFindFile':
        return { success: true, data: { fileID: PROMPTS } };
      case 'googleDriveDownloadFile':
        reading.resolve();
        await releaseRead.promise;
        return {
          success: false,
          code: 'drive_auth_required',
          error: 'Old native credentials revoked',
        };
      default:
        throw new Error(`Unexpected native action: ${message.action}`);
    }
  });
  const service = new GoogleDriveSyncService();
  await service.getState();
  await expect(service.authenticate(false)).resolves.toBe(true);
  const active = service
    .runExclusive((port) => port.downloadPromptsOnly(null, false))
    .then(
      () => undefined,
      () => undefined,
    );
  await reading.promise;
  let switched!: Promise<void>;
  service.onStateChange((state) => {
    if (state.isAuthenticated) return;
    service.onStateChange(() => {});
    switched = service.setProvider('icloud');
    configuring.resolve();
  });
  releaseRead.resolve();
  await configuring.promise;
  await switched;
  await active;

  await expect(service.getState()).resolves.toMatchObject({
    provider: 'icloud',
    isAuthenticated: false,
    isSyncing: false,
    error: null,
  });
});
