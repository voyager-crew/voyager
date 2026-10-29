import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDriveTestClient } from './fixtures/driveTestClient';
import { createFakeICloudUploadTransport } from './fixtures/fakeICloudUploadTransport';

const downloadSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const downloadSafariGoogleDriveText = vi.hoisted(() => vi.fn());
const ensureSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const findSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const requestSafariGoogleDriveSession = vi.hoisted(() => vi.fn());
const signOutSafariGoogleDrive = vi.hoisted(() => vi.fn());
const sendNativeMessage = vi.hoisted(() => vi.fn());
const uploadSafariGoogleDriveText = vi.hoisted(() => vi.fn());
const createSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const listSafariGoogleDriveHistory = vi.hoisted(() => vi.fn());
const trashSafariGoogleDriveFile = vi.hoisted(() => vi.fn());
const checkSafariICloudAccount = vi.hoisted(() => vi.fn());
const getSafariICloudRetryDelay = vi.hoisted(() => vi.fn((): number | null => null));
const isSafariICloudConflictError = vi.hoisted(() => vi.fn(() => false));
const readSafariICloudFile = vi.hoisted(() => vi.fn());
const safariRuntime = vi.hoisted(() => ({ buildTarget: 'safari', userAgentMatches: false }));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => safariRuntime.buildTarget,
  isBrave: () => false,
  isSafari: () => safariRuntime.userAgentMatches,
}));

vi.mock('@/core/utils/safariGoogleDrive', async (original) => ({
  ...(await original<typeof import('@/core/utils/safariGoogleDrive')>()),
  downloadSafariGoogleDriveFile,
  downloadSafariGoogleDriveText,
  ensureSafariGoogleDriveFile,
  findSafariGoogleDriveFile,
  requestSafariGoogleDriveSession,
  signOutSafariGoogleDrive,
  uploadSafariGoogleDriveText,
  createSafariGoogleDriveFile,
  listSafariGoogleDriveHistory,
  trashSafariGoogleDriveFile,
}));

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendNativeMessage } },
}));

vi.mock('@/core/utils/safariICloudSync', async (original) => ({
  ...(await original<typeof import('@/core/utils/safariICloudSync')>()),
  checkSafariICloudAccount,
  getSafariICloudRetryDelay,
  isSafariICloudConflictError,
  readSafariICloudFile,
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

const cloudFiles = new Map<string, unknown>();

beforeEach(() => {
  cloudFiles.clear();
  const cloudUploads = createFakeICloudUploadTransport({
    readText: (name) => (cloudFiles.has(name) ? JSON.stringify(cloudFiles.get(name)) : null),
    writeText: (name, text) => {
      cloudFiles.set(name, JSON.parse(text));
    },
  });
  sendNativeMessage.mockReset().mockImplementation(async (_app, message) => {
    const cloudResponse = await cloudUploads(message);
    return (
      cloudResponse ?? {
        success: true,
        data: {
          saved: true,
          id: 'native-file-id',
          md5Checksum: 'native-upload',
          modifiedTime: '2026-10-29T00:00:00Z',
        },
      }
    );
  });
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

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(true);
    expect(ensureSafariGoogleDriveFile).toHaveBeenCalledWith('gemini-voyager-prompts.json', null);
    expect(sendNativeMessage).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
      action: 'googleDriveUploadFile',
      fileID: 'native-file-id',
      json: expect.any(String),
    });
    const nativeUpload = sendNativeMessage.mock.calls.find(
      ([, message]) => message.action === 'googleDriveUploadFile',
    )?.[1];
    if (typeof nativeUpload?.json !== 'string') throw new Error('No native Drive media write');
    expect(JSON.parse(nativeUpload.json)).toMatchObject({
      items: [{ id: '1', text: 'Hi', tags: [], createdAt: 1 }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops retrying and drops authentication when the native session is revoked', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    requestSafariGoogleDriveSession.mockResolvedValue({
      signedIn: true,
      requiresAppLaunch: false,
    });
    ensureSafariGoogleDriveFile.mockResolvedValue('native-file-id');
    sendNativeMessage.mockResolvedValue({
      success: false,
      code: 'drive_auth_required',
      error: 'Google Drive access must be authorized again. Open Voyager to reconnect.',
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(false);
    expect(sendNativeMessage).not.toHaveBeenCalledWith(
      'com.yourCompany.Gemini-Voyager',
      expect.objectContaining({ action: 'googleDriveUploadFile' }),
    );
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
    const transport = sendNativeMessage.getMockImplementation();
    if (!transport) throw new Error('No native transport');
    let limited = true;
    sendNativeMessage.mockImplementation(async (app, message) => {
      if (message.action === 'googleDriveUploadFile' && limited) {
        limited = false;
        return {
          success: false,
          code: 'drive_rate_limited',
          retryAfterMs: 2500,
          error: 'Google Drive is rate limiting requests.',
        };
      }
      return transport(app, message);
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    let settled = false;
    const upload = service
      .uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }])
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(limited).toBe(false);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(upload).resolves.toBe(true);
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

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(true);
    expect(checkSafariICloudAccount).toHaveBeenCalled();
    expect(cloudFiles.get('gemini-voyager-prompts.json')).toMatchObject({
      format: 'gemini-voyager.prompts.v1',
      items: [{ id: '1', text: 'Hi', tags: [], createdAt: 1 }],
    });
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ gvSyncProvider: 'icloud' }),
    );
  });

  it('reports the merge-first recovery when bounded iCloud replans keep conflicting', async () => {
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    checkSafariICloudAccount.mockResolvedValue(undefined);
    const transport = sendNativeMessage.getMockImplementation();
    if (!transport) throw new Error('No native transport');
    sendNativeMessage.mockImplementation(async (app, message) =>
      message.action === 'iCloudWriteUpload'
        ? {
            success: false,
            code: 'icloud_conflict',
            error: 'prompts changed on another device. Download and merge before uploading again.',
          }
        : transport(app, message),
    );
    isSafariICloudConflictError.mockReturnValue(true);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    await expect(
      service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]),
    ).resolves.toBe(false);
    expect(cloudFiles.size).toBe(0);
    await expect(service.getState()).resolves.toMatchObject({
      error: expect.stringContaining('Download and merge'),
    });
  });

  it('honors the native iCloud retry delay before trying the upload again', async () => {
    vi.useFakeTimers();
    (globalThis as { chrome: typeof chrome }).chrome = createChromeMock();
    checkSafariICloudAccount.mockResolvedValue(undefined);
    const transport = sendNativeMessage.getMockImplementation();
    if (!transport) throw new Error('No native transport');
    let limited = true;
    sendNativeMessage.mockImplementation(async (app, message) => {
      if (message.action === 'iCloudWriteUpload' && limited) {
        limited = false;
        return { success: false, code: 'icloud_temporary_failure', error: 'Try again' };
      }
      return transport(app, message);
    });
    getSafariICloudRetryDelay.mockReturnValue(2_500);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    await service.setProvider('icloud');

    const upload = service.uploadPromptsOnly([{ id: '1', text: 'Hi', tags: [], createdAt: 1 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(limited).toBe(false);
    expect(cloudFiles.size).toBe(0);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(cloudFiles.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);

    await expect(upload).resolves.toBe(true);
    expect(cloudFiles.get('gemini-voyager-prompts.json')).toMatchObject({
      items: [{ id: '1', text: 'Hi', tags: [], createdAt: 1 }],
    });
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
