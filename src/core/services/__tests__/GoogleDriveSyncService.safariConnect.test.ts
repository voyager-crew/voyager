import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { recordGoogleDriveConnectStart } from '../googleDriveConnectIntent';

const requestSafariGoogleDriveSession = vi.hoisted(() => vi.fn());

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'safari',
  isBrave: () => false,
  isSafari: () => true,
}));

vi.mock('webextension-polyfill', () => ({ default: { runtime: { sendNativeMessage: vi.fn() } } }));

vi.mock('@/core/utils/safariGoogleDrive', async (original) => ({
  ...(await original<typeof import('@/core/utils/safariGoogleDrive')>()),
  requestSafariGoogleDriveSession,
}));

const CLICKED_AT = 1_761_700_000_000;
let storage: MemoryStorage;

async function startService(stored: Record<string, unknown>) {
  for (const [key, value] of Object.entries(stored)) storage.values.local.set(key, value);
  vi.resetModules();
  const { GoogleDriveSyncService } = await import('../GoogleDriveSyncService');
  const service = new GoogleDriveSyncService();
  await service.getState();
  return service;
}

function nativeSession(signedIn: boolean, signedInAt: number | null) {
  requestSafariGoogleDriveSession.mockResolvedValue({
    signedIn,
    requiresAppLaunch: false,
    signedInAt,
  });
}

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', { storage: storage.api });
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
