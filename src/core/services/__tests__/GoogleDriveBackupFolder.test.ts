import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';

const RECOVERY_FILE_NAMES = [
  'gemini-voyager-folders.json',
  'gemini-voyager-aistudio-folders.json',
  'gemini-voyager-prompts.json',
  'gemini-voyager-settings.json',
  'gemini-voyager-plugins.json',
  'gemini-voyager-starred.json',
] as const;

type MockedChrome = typeof chrome;

function createChromeMock(): MockedChrome {
  const localStorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const syncStorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  };

  const runtime = {
    lastError: null as chrome.runtime.LastError | null,
    id: 'test-extension-id',
    getManifest: vi.fn(() => ({
      oauth2: {
        client_id: 'test-client-id',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    })),
  };

  const identity = {
    getAuthToken: vi.fn(),
    removeCachedAuthToken: vi.fn((_details: { token: string }, callback?: () => void) => {
      callback?.();
    }),
    launchWebAuthFlow: vi.fn(),
    getRedirectURL: vi.fn(() => 'https://test-extension.chromiumapp.org/'),
  };

  return {
    storage: {
      local: localStorageArea,
      sync: syncStorageArea,
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime,
    identity,
  } as unknown as MockedChrome;
}

async function loadServiceClass() {
  vi.resetModules();
  const mod = await import('../GoogleDriveSyncService');
  return mod.GoogleDriveSyncService;
}

function responseJson(data: unknown, status: number = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}

describe('GoogleDriveBackupFolder migration', () => {
  const fetchMock = vi.fn();

  function authenticate(chromeMock: MockedChrome): void {
    (chromeMock.identity.getAuthToken as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_details: { interactive?: boolean }, callback: (token?: string) => void) => {
        callback('folder-token');
      },
    );
  }

  function driveQuery(url: URL): string {
    return url.searchParams.get('q') ?? '';
  }

  function isFolderMarkerSearch(url: URL): boolean {
    return driveQuery(url).includes("appProperties has { key='voyagerDataFolder'");
  }

  function isFolderNameSearch(url: URL): boolean {
    const query = driveQuery(url);
    return query.includes("name='Voyager Data'") && query.includes("name='Gemini Voyager Data'");
  }

  function isRecoveryFileSearch(url: URL): boolean {
    const query = driveQuery(url);
    return query.includes("name='gemini-voyager-folders.json'") && !query.includes('mimeType=');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renames and marks the moved legacy folder without changing its parent or ID', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && isFolderMarkerSearch(url)) {
        return responseJson({ files: [] });
      }
      if (url.pathname === '/drive/v3/files' && isFolderNameSearch(url)) {
        expect(driveQuery(url)).not.toContain('in parents');
        return responseJson({
          files: [
            {
              id: 'legacy-folder',
              name: 'Gemini Voyager Data',
              mimeType: 'application/vnd.google-apps.folder',
              parents: ['nested-parent'],
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files' && isRecoveryFileSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'folders-file',
              name: 'gemini-voyager-folders.json',
              parents: ['legacy-folder'],
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files/legacy-folder' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          name: 'Voyager Data',
          appProperties: { voyagerDataFolder: '1' },
        });
        return responseJson({
          id: 'legacy-folder',
          name: 'Voyager Data',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['nested-parent'],
          appProperties: { voyagerDataFolder: '1' },
        });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(folder.resolve('token', true)).resolves.toBe('legacy-folder');
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          new URL(String(input)).pathname === '/drive/v3/files' && init?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('does not create a missing folder during read-only resolution', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && !init?.method) {
        return responseJson({ files: [] });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });
    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(folder.resolve('token', false)).resolves.toBeNull();
    expect(folder.id).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('creates one marked Voyager Data folder for concurrent first uploads', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({
          name: 'Voyager Data',
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { voyagerDataFolder: '1' },
        });
        return responseJson({ id: 'created-folder' });
      }
      if (url.pathname === '/drive/v3/files') return responseJson({ files: [] });
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(
      Promise.all([folder.resolve('token', true), folder.resolve('token', true)]),
    ).resolves.toEqual(['created-folder', 'created-folder']);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('keeps a user-renamed and moved folder when its private marker is present', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && isFolderMarkerSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'custom-folder',
              name: 'My Personal Voyager Backup',
              mimeType: 'application/vnd.google-apps.folder',
              parents: ['deeply-nested-parent'],
              appProperties: { voyagerDataFolder: '1' },
            },
          ],
        });
      }
      if (
        url.pathname === '/drive/v3/files' &&
        driveQuery(url).startsWith("name='gemini-voyager-prompts.json' and trashed=false")
      ) {
        expect(driveQuery(url)).toContain("'custom-folder' in parents");
        return responseJson({ files: [{ id: 'prompts-file' }] });
      }
      if (url.pathname === '/drive/v3/files') return responseJson({ files: [] });
      if (url.pathname === '/drive/v3/files/custom-folder' && !init?.method) {
        return responseJson({
          id: 'custom-folder',
          name: 'My Personal Voyager Backup',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['deeply-nested-parent'],
          appProperties: { voyagerDataFolder: '1' },
        });
      }
      if (url.pathname === '/drive/v3/files/prompts-file') {
        return responseJson({ parents: ['custom-folder'], trashed: false });
      }
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        throw new Error('A marked custom folder must not be renamed or recreated');
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(folder.resolve('token', true)).resolves.toBe('custom-folder');
    const files = new GoogleDriveFiles(folder, {
      getProvider: () => 'googleDrive',
      onAuthLost: vi.fn(),
    });
    await expect(files.ensure('token', 'gemini-voyager-prompts.json')).resolves.toBe(
      'prompts-file',
    );
  });

  it('recovers a pre-upgrade custom rename from its existing sync-file parents', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && isRecoveryFileSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'folders-file',
              name: 'gemini-voyager-folders.json',
              parents: ['custom-folder'],
            },
            {
              id: 'settings-file',
              name: 'gemini-voyager-settings.json',
              parents: ['custom-folder'],
            },
            {
              id: 'prompts-file',
              name: 'gemini-voyager-prompts.json',
              parents: ['custom-folder'],
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files') return responseJson({ files: [] });
      if (url.pathname === '/drive/v3/files/custom-folder' && !init?.method) {
        return responseJson({
          id: 'custom-folder',
          name: 'Already Renamed By User',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['nested-parent'],
        });
      }
      if (url.pathname === '/drive/v3/files/custom-folder' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          appProperties: { voyagerDataFolder: '1' },
        });
        return responseJson({
          id: 'custom-folder',
          name: 'Already Renamed By User',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['nested-parent'],
          appProperties: { voyagerDataFolder: '1' },
        });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(folder.resolve('token', true)).resolves.toBe('custom-folder');
  });

  it('does not rename a legacy data folder into an ambiguous canonical-name conflict', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && isFolderMarkerSearch(url)) {
        return responseJson({ files: [] });
      }
      if (url.pathname === '/drive/v3/files' && isFolderNameSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'canonical-empty',
              name: 'Voyager Data',
              mimeType: 'application/vnd.google-apps.folder',
            },
            {
              id: 'legacy-with-data',
              name: 'Gemini Voyager Data',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files' && isRecoveryFileSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'folders-file',
              name: 'gemini-voyager-folders.json',
              parents: ['legacy-with-data'],
            },
            {
              id: 'settings-file',
              name: 'gemini-voyager-settings.json',
              parents: ['legacy-with-data'],
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files/legacy-with-data' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({
          appProperties: { voyagerDataFolder: '1' },
        });
        return responseJson({
          id: 'legacy-with-data',
          name: 'Gemini Voyager Data',
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { voyagerDataFolder: '1' },
        });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(folder.resolve('token', true)).resolves.toBe('legacy-with-data');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('keeps syncing with the stable legacy ID when metadata migration is temporarily denied', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && isFolderMarkerSearch(url)) {
        return responseJson({ files: [] });
      }
      if (url.pathname === '/drive/v3/files' && isFolderNameSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'legacy-folder',
              name: 'Gemini Voyager Data',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files' && isRecoveryFileSearch(url)) {
        return responseJson({ files: [] });
      }
      if (url.pathname === '/drive/v3/files/legacy-folder' && init?.method === 'PATCH') {
        return responseJson({ error: 'forbidden' }, 403);
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const folder = new GoogleDriveBackupFolder(RECOVERY_FILE_NAMES);

    await expect(folder.resolve('token', true)).resolves.toBe('legacy-folder');
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('migrates the legacy folder during a download without creating a new folder', async () => {
    const chromeMock = createChromeMock();
    (globalThis as { chrome: MockedChrome }).chrome = chromeMock;
    authenticate(chromeMock);

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/drive/v3/files' && isFolderMarkerSearch(url)) {
        return responseJson({ files: [] });
      }
      if (url.pathname === '/drive/v3/files' && isFolderNameSearch(url)) {
        return responseJson({
          files: [
            {
              id: 'legacy-folder',
              name: 'Gemini Voyager Data',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        });
      }
      if (url.pathname === '/drive/v3/files' && isRecoveryFileSearch(url)) {
        return responseJson({ files: [] });
      }
      if (url.pathname === '/drive/v3/files/legacy-folder' && init?.method === 'PATCH') {
        return responseJson({
          id: 'legacy-folder',
          name: 'Voyager Data',
          mimeType: 'application/vnd.google-apps.folder',
          appProperties: { voyagerDataFolder: '1' },
        });
      }
      if (
        url.pathname === '/drive/v3/files' &&
        driveQuery(url).startsWith("name='gemini-voyager-prompts.json' and trashed=false")
      ) {
        expect(driveQuery(url)).toContain("'legacy-folder' in parents");
        return responseJson({ files: [{ id: 'prompts-file' }] });
      }
      if (
        url.pathname === '/drive/v3/files/prompts-file' &&
        url.searchParams.get('alt') === 'media'
      ) {
        return responseJson({
          format: 'gemini-voyager.prompts.v1',
          exportedAt: '2026-07-19T00:00:00.000Z',
          version: '1.0.0',
          items: [],
        });
      }
      throw new Error(`Unexpected Drive request: ${url.toString()}`);
    });

    const GoogleDriveSyncService = await loadServiceClass();
    const service = new GoogleDriveSyncService();
    await service.getState();

    await expect(service.runExclusive((port) => port.downloadPromptsOnly())).resolves.toMatchObject(
      {
        kind: 'found',
        value: { items: [] },
      },
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          new URL(String(input)).pathname === '/drive/v3/files/legacy-folder' &&
          init?.method === 'PATCH',
      ),
    ).toBe(true);
  });
});
