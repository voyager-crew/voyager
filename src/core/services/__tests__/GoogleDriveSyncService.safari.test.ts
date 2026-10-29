import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDriveTestClient } from './fixtures/driveTestClient';

const downloadSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const downloadSafariGoogleDriveText = vi.hoisted(() => vi.fn());
const ensureSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const findSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const getSafariGoogleDriveRetryDelay = vi.hoisted(() => vi.fn((): number | null => null));
const isSafariGoogleDriveAuthError = vi.hoisted(() => vi.fn(() => false));
const requestSafariGoogleDriveSession = vi.hoisted(() => vi.fn());
const signOutSafariGoogleDrive = vi.hoisted(() => vi.fn());
const uploadSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const uploadSafariGoogleDriveText = vi.hoisted(() => vi.fn());
const createSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const listSafariGoogleDriveHistory = vi.hoisted(() => vi.fn());
const trashSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const checkSafariICloudAccount = vi.hoisted(() => vi.fn());
const getSafariICloudRetryDelay = vi.hoisted(() => vi.fn((): number | null => null));
const isSafariICloudConflictError = vi.hoisted(() => vi.fn(() => false));
const readSafariICloudFile = vi.hoisted(() => vi.fn());
const writeSafariICloudFile = vi.hoisted(() => vi.fn());
const safariRuntime = vi.hoisted(() => ({ buildTarget: 'safari', userAgentMatches: false }));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => safariRuntime.buildTarget,
  isBrave: () => false,
  isSafari: () => safariRuntime.userAgentMatches,
}));

vi.mock('@/core/utils/safariGoogleDrive', () => ({
  downloadSafariGoogleDriveFile,
  downloadSafariGoogleDriveText,
  ensureSafariGoogleDriveFile,
  findSafariGoogleDriveFile,
  getSafariGoogleDriveRetryDelay,
  isSafariGoogleDriveAuthError,
  requestSafariGoogleDriveSession,
  signOutSafariGoogleDrive,
  uploadSafariGoogleDriveFile,
  uploadSafariGoogleDriveText,
  createSafariGoogleDriveFile,
  listSafariGoogleDriveHistory,
  trashSafariGoogleDriveFile,
}));

vi.mock('@/core/utils/safariICloudSync', () => ({
  checkSafariICloudAccount,
  getSafariICloudRetryDelay,
  isSafariICloudConflictError,
  readSafariICloudFile,
  writeSafariICloudFile,
}));

function createChromeMock(stored: Record<string, unknown> = {}) {
  return {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue(stored),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as typeof chrome;
}

async function loadServiceClass() {
  vi.resetModules();
  const module = await import('../GoogleDriveSyncService');
  return module.GoogleDriveSyncService;
}

beforeEach(() => {
  findSafariGoogleDriveFile.mockResolvedValue(null);
  downloadSafariGoogleDriveText.mockResolvedValue(null);
  listSafariGoogleDriveHistory.mockResolvedValue([]);
  uploadSafariGoogleDriveText.mockResolvedValue(undefined);
  trashSafariGoogleDriveFile.mockResolvedValue(undefined);
  createSafariGoogleDriveFile.mockResolvedValue('history-file-id');
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  getSafariICloudRetryDelay.mockReturnValue(null);
  isSafariICloudConflictError.mockReturnValue(false);
  getSafariGoogleDriveRetryDelay.mockReturnValue(null);
  isSafariGoogleDriveAuthError.mockReturnValue(false);
  safariRuntime.buildTarget = 'safari';
  safariRuntime.userAgentMatches = false;
});

describe('GoogleDriveSyncService Safari authentication', () => {
  it('uses a native session without exposing or persisting a token', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: typeof chrome }).chrome = chromeMock;
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.authenticate(true)).resolves.toBe(true);
    expect(requestSafariGoogleDriveSession).toHaveBeenCalledWith(true);
    expect(chromeMock.storage.local.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ gvAccessToken: expect.anything() }),
    );
  });

  it('reports an unavailable non-interactive native session without an error', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: false,
      requiresAppLaunch: false,
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.authenticate(false)).resolves.toBe(false);
    await expect(service.getState()).resolves.toMatchObject({ error: null });
  });

  it('asks Safari users to open Voyager when the native extension cannot launch the app', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: false,
      requiresAppLaunch: true,
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.authenticate(true)).resolves.toBe(false);
    await expect(service.getState()).resolves.toMatchObject({
      error: 'Open Voyager to connect Google Drive, then try again.',
    });
  });

  it('clears the native Keychain session on sign out', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.authenticate(true);
    await service.signOut();

    expect(signOutSafariGoogleDrive).toHaveBeenCalledOnce();
    await expect(service.getState()).resolves.toMatchObject({ isAuthenticated: false });
  });

  it('keeps Safari Drive file transport in the native process', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });
    ensureSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    uploadSafariGoogleDriveFile.mockResolvedValue(undefined);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(true);
    expect(ensureSafariGoogleDriveFile).toHaveBeenCalledWith('gemini-voyager-prompts.json', null);
    expect(uploadSafariGoogleDriveFile).toHaveBeenCalledWith(
      'native-file-id',
      expect.objectContaining({ format: 'gemini-voyager.prompts.v1' }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops retrying and drops authentication when the native session is revoked', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });
    ensureSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    uploadSafariGoogleDriveFile.mockRejectedValue(
      new Error('Google Drive access must be authorized again. Open Voyager to reconnect.'),
    );
    isSafariGoogleDriveAuthError.mockReturnValue(true);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(false);
    expect(uploadSafariGoogleDriveFile).toHaveBeenCalledOnce();
    await expect(service.getState()).resolves.toMatchObject({
      isAuthenticated: false,
      error: expect.stringContaining('authorized again'),
    });
  });

  it('honors the native Drive rate-limit delay before retrying the upload', async () => {
    vi.useFakeTimers();
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });
    ensureSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    uploadSafariGoogleDriveFile
      .mockRejectedValueOnce(new Error('Google Drive is rate limiting requests.'))
      .mockResolvedValue(undefined);
    getSafariGoogleDriveRetryDelay.mockReturnValue(2_500);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    const upload = service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(uploadSafariGoogleDriveFile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(uploadSafariGoogleDriveFile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(upload).resolves.toBe(true);
    expect(uploadSafariGoogleDriveFile).toHaveBeenCalledTimes(2);
  });

  it('downloads Safari Drive data through the native process', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });
    findSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    downloadSafariGoogleDriveFile.mockResolvedValue({
      format: 'gemini-voyager.prompts.v1',
      exportedAt: '2026-07-17T00:00:00.000Z',
      version: '1.0.0',
      items: [{ id: '1', text: 'Hi', tags: [], createdAt: 1 }],
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.downloadPromptsOnly()).resolves.toMatchObject({
      kind: 'found',
      value: {
        format: 'gemini-voyager.prompts.v1',
        items: [{ id: '1', text: 'Hi', tags: [], createdAt: 1 }],
      },
    });
    expect(findSafariGoogleDriveFile).toHaveBeenCalledWith('gemini-voyager-prompts.json');
    expect(downloadSafariGoogleDriveFile).toHaveBeenCalledWith('native-file-id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unreadable native Drive file as failed rather than an absent prompts file', async () => {
    vi.useFakeTimers();
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({ signedIn: true, requiresAppLaunch: false });
    findSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    const error = new Error('Safari Google Drive download failed');
    downloadSafariGoogleDriveFile.mockRejectedValue(error);
    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());

    const pending = service.downloadPromptsOnly();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ kind: 'failed', error });
    await expect(service.getState()).resolves.toMatchObject({ error: error.message });
  });

  it('reports a native file in an unrelated format as unrecognized instead of empty prompts', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({ signedIn: true, requiresAppLaunch: false });
    findSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    downloadSafariGoogleDriveFile.mockResolvedValue({ format: 'unrelated', items: [] });
    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());

    await expect(service.downloadPromptsOnly()).resolves.toEqual({ kind: 'unrecognized' });
    await expect(service.getState()).resolves.toMatchObject({ error: 'Download failed' });
  });
});

describe('GoogleDriveSyncService Safari iCloud provider', () => {
  it('restores iCloud from the Safari build target when the background UA is reduced', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock({
      gvSyncProvider: 'icloud',
    });
    checkSafariICloudAccount.mockResolvedValue(undefined);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());

    await expect(service.getState()).resolves.toMatchObject({ provider: 'icloud' });
  });

  it('uses CloudKit as the file transport after switching providers', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: typeof chrome }).chrome = chromeMock;
    checkSafariICloudAccount.mockResolvedValue(undefined);
    writeSafariICloudFile.mockResolvedValue(undefined);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(true);
    expect(checkSafariICloudAccount).toHaveBeenCalled();
    expect(writeSafariICloudFile).toHaveBeenCalledWith(
      'gemini-voyager-prompts.json',
      expect.objectContaining({ format: 'gemini-voyager.prompts.v1' }),
    );
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ gvSyncProvider: 'icloud' }),
    );
  });

  it('does not retry an iCloud conflict and reports the merge-first recovery', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    checkSafariICloudAccount.mockResolvedValue(undefined);
    writeSafariICloudFile.mockRejectedValue(
      new Error('prompts changed on another device. Download and merge before uploading again.'),
    );
    isSafariICloudConflictError.mockReturnValue(true);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(false);
    expect(writeSafariICloudFile).toHaveBeenCalledOnce();
    await expect(service.getState()).resolves.toMatchObject({
      error: expect.stringContaining('Download and merge'),
    });
  });

  it('honors the native iCloud retry delay before trying the upload again', async () => {
    vi.useFakeTimers();
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    checkSafariICloudAccount.mockResolvedValue(undefined);
    writeSafariICloudFile
      .mockRejectedValueOnce(new Error('Try again'))
      .mockResolvedValue(undefined);
    getSafariICloudRetryDelay.mockReturnValue(2_500);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    const upload = service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(writeSafariICloudFile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(writeSafariICloudFile).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(upload).resolves.toBe(true);
    expect(writeSafariICloudFile).toHaveBeenCalledTimes(2);
  });

  it('reports missing CloudKit files without a read failure', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    checkSafariICloudAccount.mockResolvedValue(undefined);
    readSafariICloudFile.mockResolvedValue(null);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    await expect(service.downloadPromptsOnly()).resolves.toEqual({ kind: 'missing' });
    await expect(service.getState()).resolves.toMatchObject({ error: null });
    expect(readSafariICloudFile).toHaveBeenCalledWith('gemini-voyager-prompts.json');
  });
});
