import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HighlightExportPayload, SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import { createDriveTestClient } from './fixtures/driveTestClient';
import {
  createChromeMock,
  loadServiceClass,
  createHighlightPayload,
  responseJson,
  type MockedChrome,
} from './fixtures/googleDriveServiceFixture';

describe('GoogleDriveSyncService prompts-only sync', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploadPromptsOnly returns false (does not throw) when not authenticated non-interactively', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    (chromeMock.identity.getAuthToken as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) =>
        callback(undefined),
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());

    await expect(service.uploadPromptsOnly([], null, false)).resolves.toBe(false);
    // Never reached the Drive API — no file writes attempted.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('downloadPromptsOnly reports a failed read when not authenticated non-interactively', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    (chromeMock.identity.getAuthToken as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) =>
        callback(undefined),
    );

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());

    await expect(service.downloadPromptsOnly(null, false)).resolves.toMatchObject({
      kind: 'failed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GoogleDriveSyncService highlights-only sync', () => {
  const fetchMock = vi.fn();
  const accountScope: SyncAccountScope = {
    accountKey: 'email:account@example.com',
    accountId: 2,
    routeUserId: '2',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function authenticate(chromeMock: MockedChrome): void {
    (chromeMock.identity.getAuthToken as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) => {
        callback('highlight-token');
      },
    );
  }

  it('round-trips the exact payload through an account-scoped independent file', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    authenticate(chromeMock);

    const exact = `${'0123456789'.repeat(1_000)}-exact-tail`;
    const payload = createHighlightPayload(accountScope, exact);
    let uploadedPayload: unknown = null;
    const searchedFileNames: string[] = [];

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === 'https://www.googleapis.com' && url.pathname === '/drive/v3/files') {
        const query = url.searchParams.get('q') ?? '';
        if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
          return responseJson({
            files: [
              {
                id: 'backup-folder',
                name: 'Voyager Data',
                mimeType: 'application/vnd.google-apps.folder',
                appProperties: { voyagerDataFolder: '1' },
              },
            ],
          });
        }
        if (query.includes("name='gemini-voyager-folders.json'")) {
          return responseJson({ files: [] });
        }
        const name = /name='([^']+)'/.exec(query)?.[1];
        if (name) searchedFileNames.push(name);
        return responseJson({ files: [{ id: 'highlight-file' }] });
      }
      if (url.pathname === '/drive/v3/files/highlight-file') {
        if (url.searchParams.get('alt') === 'media') return responseJson(uploadedPayload);
        return responseJson({ parents: ['backup-folder'], trashed: false });
      }
      if (url.pathname === '/drive/v3/files/backup-folder') {
        return responseJson({
          id: 'backup-folder',
          name: 'Voyager Data',
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { voyagerDataFolder: '1' },
        });
      }
      if (url.pathname === '/upload/drive/v3/files/highlight-file') {
        expect(init?.method).toBe('PATCH');
        uploadedPayload = JSON.parse(String(init?.body));
        return responseJson({ id: 'highlight-file' });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.uploadHighlightsOnly(payload, accountScope, true)).resolves.toBe(true);
    await expect(service.downloadHighlightsOnly(accountScope, true)).resolves.toEqual(payload);

    const scopedFileName = `gemini-voyager-highlights.acct-${hashString(accountScope.accountKey)}.json`;
    expect(searchedFileNames).toEqual([scopedFileName, scopedFileName]);
    expect(searchedFileNames).not.toContain('gemini-voyager-highlights.json');
    expect(uploadedPayload).toEqual(payload);
    expect((uploadedPayload as HighlightExportPayload).items[0].anchor.quote.exact).toBe(exact);
  });

  it('does not fall back to an unscoped legacy file when the scoped file is absent', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    authenticate(chromeMock);

    const searchedFileNames: string[] = [];
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      const name = /name='([^']+)'/.exec(query)?.[1];
      if (name?.startsWith('gemini-voyager-highlights.')) searchedFileNames.push(name);
      return responseJson({ files: [] });
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.downloadHighlightsOnly(accountScope, true)).resolves.toBeNull();
    expect(searchedFileNames).toEqual([
      `gemini-voyager-highlights.acct-${hashString(accountScope.accountKey)}.json`,
    ]);
  });

  it('rejects a payload from another account before authenticating or writing', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    const payload = createHighlightPayload(accountScope);
    payload.accountScope.accountHash = 'wrong-account-hash';

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.uploadHighlightsOnly(payload, accountScope, true)).resolves.toBe(false);
    expect(chromeMock.identity.getAuthToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.getState()).resolves.toMatchObject({
      isSyncing: false,
      error: 'Highlight sync payload does not match the requested account scope',
    });
  });

  it('rejects an invalid remote payload and exposes a failure state', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    authenticate(chromeMock);

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files') {
        return responseJson({ files: [{ id: 'highlight-file' }] });
      }
      if (
        url.pathname === '/drive/v3/files/highlight-file' &&
        url.searchParams.get('alt') === 'media'
      ) {
        return responseJson({ format: 'gemini-voyager.annotations.v0', items: [] });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.downloadHighlightsOnly(accountScope, true)).resolves.toBeNull();
    await expect(service.getState()).resolves.toMatchObject({
      isSyncing: false,
      error: 'Invalid highlight sync payload',
    });
  });

  it('records Drive API failures in sync state', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    authenticate(chromeMock);
    const payload = createHighlightPayload(accountScope);

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('q') ?? '';
      if (query.includes("mimeType='application/vnd.google-apps.folder'")) {
        return responseJson({
          files: [
            {
              id: 'backup-folder',
              name: 'Voyager Data',
              mimeType: 'application/vnd.google-apps.folder',
              appProperties: { voyagerDataFolder: '1' },
            },
          ],
        });
      }
      return responseJson({ error: 'unavailable' }, 503);
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.uploadHighlightsOnly(payload, accountScope, true)).resolves.toBe(false);
    await expect(service.getState()).resolves.toMatchObject({
      isSyncing: false,
      error: 'Failed to search files: 503',
    });
  });

  it('returns null/false without Drive requests when non-interactive auth is unavailable', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    (chromeMock.identity.getAuthToken as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) =>
        callback(undefined),
    );
    const payload = createHighlightPayload(accountScope);

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();

    await expect(service.uploadHighlightsOnly(payload, accountScope, false)).resolves.toBe(false);
    await expect(service.downloadHighlightsOnly(accountScope, false)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GoogleDriveSyncService plugin-state file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads plugin state as an independent global Drive file', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    const { GoogleDriveAuth } = await import('../GoogleDriveAuth');
    const { GoogleDriveFiles } = await import('../GoogleDriveFiles');
    vi.spyOn(GoogleDriveAuth.prototype, 'getToken').mockResolvedValue('token');
    vi.spyOn(GoogleDriveFiles.prototype, 'find').mockResolvedValue(null);
    vi.spyOn(GoogleDriveFiles.prototype, 'ensure').mockImplementation(async (_token, name) => name);
    const uploadSpy = vi.spyOn(GoogleDriveFiles.prototype, 'upload').mockResolvedValue(undefined);

    const ok = await service.upload(
      { folders: [], folderContents: {} },
      [],
      null,
      true,
      'gemini',
      null,
      null,
      null,
      null,
      null,
      {
        'voyager.example': {
          enabled: true,
          installedAt: 123,
          settings: { width: 80 },
        },
      },
    );

    expect(ok).toBe(true);
    expect(uploadSpy).toHaveBeenCalledWith(
      'token',
      'gemini-voyager-plugins.json',
      expect.objectContaining({
        format: 'gemini-voyager.plugins.v1',
        data: {
          'voyager.example': {
            enabled: true,
            installedAt: 123,
            settings: { width: 80 },
          },
        },
      }),
    );
  });

  it('downloads the independent plugin-state file with the aggregate result', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;

    const GoogleDriveSyncService = await loadServiceClass();
    const service = createDriveTestClient(new GoogleDriveSyncService());
    await service.getState();
    const pluginPayload = {
      format: 'gemini-voyager.plugins.v1' as const,
      exportedAt: '2026-07-16T00:00:00.000Z',
      version: '1.5.6',
      data: {
        'voyager.example': { enabled: false, installedAt: 456 },
      },
    };
    const { GoogleDriveAuth } = await import('../GoogleDriveAuth');
    const { GoogleDriveFiles } = await import('../GoogleDriveFiles');
    vi.spyOn(GoogleDriveAuth.prototype, 'getToken').mockResolvedValue('token');
    vi.spyOn(GoogleDriveFiles.prototype, 'prepareDownload').mockResolvedValue(undefined);
    vi.spyOn(GoogleDriveFiles.prototype, 'find').mockImplementation(async (_token, name) =>
      name === 'gemini-voyager-plugins.json' ? 'plugins-file' : null,
    );
    vi.spyOn(GoogleDriveFiles.prototype, 'download').mockImplementation(async (_token, id) =>
      id === 'plugins-file' ? pluginPayload : null,
    );

    const result = await service.download(true, 'gemini');

    expect(result?.plugins).toEqual(pluginPayload);
  });
});
