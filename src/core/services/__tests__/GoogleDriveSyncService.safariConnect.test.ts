import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { recordGoogleDriveConnectStart } from '../googleDriveConnectIntent';

const requestSafariGoogleDriveSession = vi.hoisted(() => vi.fn());
const signOutSafariGoogleDrive = vi.hoisted(() => vi.fn());

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'safari',
  isBrave: () => false,
  isSafari: () => true,
}));

vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: vi.fn() } } }));

vi.mock('@/core/utils/safariGoogleDrive', async (original) => ({
  ...(await original<typeof import('@/core/utils/safariGoogleDrive')>()),
  requestSafariGoogleDriveSession,
  signOutSafariGoogleDrive,
}));

const CLICKED_AT = 1_761_700_000_000;
let storage: MemoryStorage;

async function startService(stored: Record<string, unknown>) {
  for (const [key, value] of Object.entries(stored)) storage.values.local.set(key, value);
  vi.resetModules();
  const { GoogleDriveSyncService } = await import('../GoogleDriveSyncService');
  const service = new GoogleDriveSyncService();
  await service.getState();
  // Loading asks the native side too; tests count only the reads that follow.
  requestSafariGoogleDriveSession.mockClear();
  return service;
}

function nativeSession(signedIn: boolean, signedInAt: number | null) {
  requestSafariGoogleDriveSession.mockResolvedValue({
    signedIn,
    requiresAppLaunch: false,
    signedInAt,
  });
}

/** A native reply the test releases once the interleaving it needs is in place. */
function heldNativeSession(signedIn: boolean, signedInAt: number | null) {
  const held = Promise.withResolvers<void>();
  requestSafariGoogleDriveSession.mockImplementationOnce(async () => {
    await held.promise;
    return { signedIn, requiresAppLaunch: false, signedInAt };
  });
  return held;
}

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', { storage: storage.api });
  signOutSafariGoogleDrive.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Safari Drive connection made in the Voyager app', () => {
  it('shows Drive as connected after the app signs in, even while sync is disabled', async () => {
    const service = await startService({ gvSyncMode: 'disabled' });
    nativeSession(true, CLICKED_AT - 60_000);

    await service.refreshNativeAuthorization();

    // No connect was started from the popup, so the chosen mode stays.
    await expect(service.getState()).resolves.toMatchObject({
      isAuthenticated: true,
      mode: 'disabled',
      error: null,
    });
  });

  it('turns a disabled sync on in manual mode once the connect it started succeeds', async () => {
    const service = await startService({ gvSyncMode: 'disabled' });
    await recordGoogleDriveConnectStart(CLICKED_AT);
    nativeSession(true, CLICKED_AT + 45_000);

    await service.refreshNativeAuthorization();

    await expect(service.getState()).resolves.toMatchObject({
      isAuthenticated: true,
      mode: 'manual',
    });
    expect(storage.values.local.get('gvSyncMode')).toBe('manual');
    expect(storage.values.local.has(StorageKeys.GOOGLE_DRIVE_CONNECT_PENDING)).toBe(false);
  });

  it('keeps sync disabled when the sign-in was cancelled and an older session remains', async () => {
    vi.useFakeTimers({ now: CLICKED_AT + 30_000, toFake: ['Date'] });
    const service = await startService({ gvSyncMode: 'disabled' });
    await recordGoogleDriveConnectStart(CLICKED_AT);
    nativeSession(true, CLICKED_AT - 86_400_000);

    await service.refreshNativeAuthorization();

    await expect(service.getState()).resolves.toMatchObject({
      isAuthenticated: true,
      mode: 'disabled',
    });

    // The person tries again and finishes this time.
    nativeSession(true, CLICKED_AT + 90_000);
    await service.refreshNativeAuthorization();
    await expect(service.getState()).resolves.toMatchObject({ mode: 'manual' });
  });

  it('leaves the card as it was when the native side cannot answer', async () => {
    requestSafariGoogleDriveSession.mockRejectedValue(new Error('Native messaging unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = await startService({ gvSyncMode: 'manual' });

    await service.refreshNativeAuthorization();

    await expect(service.getState()).resolves.toMatchObject({
      isAuthenticated: false,
      mode: 'manual',
      error: null,
    });
  });
});

describe('Safari Drive answers that arrive after the session changed', () => {
  it('keeps Drive signed out when a reply asked for before sign-out lands after it', async () => {
    const service = await startService({ gvSyncMode: 'manual' });
    const held = heldNativeSession(true, CLICKED_AT);
    const staleRefresh = service.refreshNativeAuthorization();
    await vi.waitFor(() => expect(requestSafariGoogleDriveSession).toHaveBeenCalledTimes(1));

    await service.signOut();
    // The popup asks again after signing out; that read must not wait on the old one.
    nativeSession(false, null);
    const freshRefresh = service.refreshNativeAuthorization();
    held.resolve();
    await Promise.all([staleRefresh, freshRefresh]);

    expect(requestSafariGoogleDriveSession).toHaveBeenCalledTimes(2);
    await expect(service.getState()).resolves.toMatchObject({ isAuthenticated: false });
  });

  it('keeps Drive signed out when a refresh is asked for while sign-out is running', async () => {
    const service = await startService({ gvSyncMode: 'manual' });
    const nativeSignOut = Promise.withResolvers<void>();
    signOutSafariGoogleDrive.mockReturnValueOnce(nativeSignOut.promise);
    const signingOut = service.signOut();
    await vi.waitFor(() => expect(signOutSafariGoogleDrive).toHaveBeenCalled());

    // The native side still has the session until its sign-out finishes.
    const held = heldNativeSession(true, CLICKED_AT);
    const refresh = service.refreshNativeAuthorization();
    nativeSignOut.resolve();
    await signingOut;
    held.resolve();
    await refresh;

    await expect(service.getState()).resolves.toMatchObject({ isAuthenticated: false });
  });

  it('leaves iCloud sync disabled when the provider changes while a connect settles', async () => {
    const service = await startService({ gvSyncMode: 'disabled' });
    await recordGoogleDriveConnectStart(CLICKED_AT);
    nativeSession(true, CLICKED_AT + 45_000);
    // Hold the read of the pending connect, so the provider changes while it settles.
    const reached = Promise.withResolvers<void>();
    const pendingRead = Promise.withResolvers<void>();
    const memory = storage.api;
    vi.stubGlobal('chrome', {
      storage: {
        ...memory,
        local: {
          ...memory.local,
          get: async (keys: string) => {
            if (keys === StorageKeys.GOOGLE_DRIVE_CONNECT_PENDING) {
              reached.resolve();
              await pendingRead.promise;
            }
            return memory.local.get(keys);
          },
        },
      },
    });
    const refresh = service.refreshNativeAuthorization();
    await reached.promise;

    await service.setProvider('icloud');
    pendingRead.resolve();
    await refresh;

    await expect(service.getState()).resolves.toMatchObject({
      provider: 'icloud',
      mode: 'disabled',
    });
    expect(storage.values.local.get('gvSyncMode')).toBe('disabled');
  });
});
