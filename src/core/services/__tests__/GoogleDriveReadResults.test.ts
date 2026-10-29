import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncProvider } from '@/core/types/sync';
import { readDriveValue } from '@/core/utils/driveReadResult';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';

const runtime = vi.hoisted(() => ({ safari: false, sendNativeMessage: vi.fn() }));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => (runtime.safari ? 'safari' : 'chrome'),
  isSafari: () => runtime.safari,
  isBrave: () => false,
}));

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendNativeMessage: runtime.sendNativeMessage } },
}));

function files(provider: SyncProvider = 'googleDrive') {
  return new GoogleDriveFiles(new GoogleDriveBackupFolder(['gemini-voyager-prompts.json']), {
    getProvider: () => provider,
    onAuthLost: vi.fn(),
  });
}

const read = (store: GoogleDriveFiles, id: string) =>
  readDriveValue(() => store.download<unknown>('token', id));

beforeEach(() => {
  runtime.safari = false;
  runtime.sendNativeMessage.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Drive media read results', () => {
  it.each([
    { body: '', kind: 'missing' },
    { body: '{', kind: 'unrecognized' },
    { body: 'null', kind: 'unrecognized' },
    { body: ' ', kind: 'unrecognized' },
  ])('reports $kind for media body "$body" without retrying it', async ({ body, kind }) => {
    const fetch = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetch);

    await expect(read(files(), 'prompts')).resolves.toEqual({ kind });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a found file and distinguishes a missing media file', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"items":[{"id":"saved"}]}'))
        .mockResolvedValueOnce(new Response('', { status: 404 })),
    );

    const store = files();
    await expect(read(store, 'present')).resolves.toEqual({
      kind: 'found',
      value: { items: [{ id: 'saved' }] },
    });
    await expect(read(store, 'absent')).resolves.toEqual({ kind: 'missing' });
  });

  it('reports a failed server read instead of absent data after retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    const pending = read(files(), 'prompts');

    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({
      kind: 'failed',
      error: expect.objectContaining({ message: 'Download failed: 503' }),
    });
  });
});

describe('Drive discovery read failures', () => {
  it.each([{}, { files: null }, { files: [{}] }, { files: [{ id: 12 }] }])(
    'refuses malformed search data instead of reporting no backup: %j',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(payload))),
      );

      await expect(files().find('token', 'prompts.json')).rejects.toThrow('Failed to search files');
    },
  );

  it('refuses invalid search JSON but accepts a successful empty search', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{'))
        .mockResolvedValueOnce(new Response('{"files":[]}')),
    );
    const store = files();

    await expect(store.find('token', 'prompts.json')).rejects.toThrow('Failed to search files');
    await expect(store.find('token', 'prompts.json')).resolves.toBeNull();
  });
});

describe.each(['googleDrive', 'icloud'] satisfies SyncProvider[])(
  '%s native media read results',
  (provider) => {
    beforeEach(() => {
      runtime.safari = true;
    });

    it.each([
      { found: false, json: undefined, kind: 'missing' },
      { found: true, json: '', kind: 'missing' },
      { found: true, json: '{', kind: 'unrecognized' },
      { found: true, json: 'null', kind: 'unrecognized' },
    ])('reports $kind for native found=$found/json="$json"', async ({ found, json, kind }) => {
      runtime.sendNativeMessage.mockResolvedValue({ success: true, data: { found, json } });

      await expect(read(files(provider), 'prompts')).resolves.toEqual({ kind });
      expect(runtime.sendNativeMessage).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns the downloaded payload and sends the provider native action', async () => {
      runtime.sendNativeMessage.mockResolvedValue({
        success: true,
        data: { found: true, json: '{"items":[{"id":"native"}]}' },
      });

      await expect(read(files(provider), 'prompts')).resolves.toEqual({
        kind: 'found',
        value: { items: [{ id: 'native' }] },
      });
      expect(runtime.sendNativeMessage).toHaveBeenCalledWith(
        'com.yourCompany.Gemini-Voyager',
        provider === 'googleDrive'
          ? { action: 'googleDriveDownloadFile', fileID: 'prompts' }
          : { action: 'iCloudReadFile', fileName: 'prompts' },
      );
    });

    it('reports a native read failure instead of a missing file', async () => {
      runtime.sendNativeMessage.mockResolvedValue({ success: false, error: 'Network unavailable' });
      const pending = read(files(provider), 'prompts');

      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({
        kind: 'failed',
        error: expect.objectContaining({ message: 'Network unavailable' }),
      });
    });

    it('refuses a malformed native download response instead of reporting a missing file', async () => {
      runtime.sendNativeMessage.mockResolvedValue({ success: true, data: {} });
      const pending = read(files(provider), 'prompts');

      await vi.runAllTimersAsync();

      await expect(pending).resolves.toMatchObject({ kind: 'failed' });
    });
  },
);
