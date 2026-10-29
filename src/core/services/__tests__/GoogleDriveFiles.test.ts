import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function files(onAuthLost = vi.fn()) {
  return new GoogleDriveFiles(new GoogleDriveBackupFolder(['gemini-voyager-prompts.json']), {
    getProvider: () => 'googleDrive',
    onAuthLost,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GoogleDriveFiles', () => {
  it('keeps different account filenames in separate caches and rediscovers them after reset', async () => {
    const first = 'gemini-voyager-prompts.acct-first.json';
    const second = 'gemini-voyager-prompts.acct-second.json';
    const ids = new Map([
      [first, 'first-id'],
      [second, 'second-id'],
    ]);
    const searched: string[] = [];
    const folder = {
      id: 'folder',
      name: 'Voyager Data',
      appProperties: { voyagerDataFolder: '1' },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === '/drive/v3/files') {
          const query = url.searchParams.get('q') ?? '';
          if (query.includes('mimeType=')) return response({ files: [folder] });
          if (query.startsWith('(')) return response({ files: [] });
          const name = /name='([^']+)'/.exec(query)![1];
          searched.push(name);
          return response({ files: [{ id: ids.get(name) }] });
        }
        if (url.pathname.endsWith('/folder')) return response(folder);
        return response({ parents: ['folder'], trashed: false });
      }),
    );
    const store = files();
    await expect(store.ensure('token', first)).resolves.toBe('first-id');
    await expect(store.ensure('token', second)).resolves.toBe('second-id');
    ids.set(first, 'replacement-id');
    await expect(store.ensure('token', first)).resolves.toBe('first-id');
    expect(searched).toEqual([first, second]);

    store.reset();
    await expect(store.ensure('token', first)).resolves.toBe('replacement-id');
    expect(searched).toEqual([first, second, first]);
  });

  it('retries web authorization failures three times with the existing backoff and exact media body', async () => {
    const attempts: number[] = [];
    const fetch = vi.fn(async () => {
      attempts.push(Date.now());
      return response({}, 401);
    });
    vi.stubGlobal('fetch', fetch);
    const authLost = vi.fn();
    const failure = expect(
      files(authLost).upload('token', 'file-id', {
        format: 'legacy',
        items: [{ pinnedAt: null }],
      }),
    ).rejects.toThrow('Upload failed: 401');
    await vi.advanceTimersByTimeAsync(999);
    expect(attempts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 1000]);
    await vi.advanceTimersByTimeAsync(2000);
    await failure;
    expect(attempts).toEqual([0, 1000, 3000]);
    expect(authLost).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/upload/drive/v3/files/file-id?uploadType=media&fields=id,md5Checksum,modifiedTime',
      {
        method: 'PATCH',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: '{"format":"legacy","items":[{"pinnedAt":null}]}',
      },
    );
  });

  it('returns null for a missing media file without retrying it', async () => {
    const fetch = vi.fn().mockResolvedValue(response({}, 404));
    vi.stubGlobal('fetch', fetch);
    await expect(files().download('token', 'missing')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
