import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';

const native = vi.hoisted(() => ({ safari: false, send: vi.fn() }));
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => (native.safari ? 'safari' : 'chrome'),
  isSafari: () => native.safari,
  isBrave: () => false,
}));
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendNativeMessage: native.send } },
}));

const metadata = { id: 'file', md5Checksum: 'abc', modifiedTime: '2026-10-29T00:00:00Z' };
const files = () =>
  new GoogleDriveFiles(new GoogleDriveBackupFolder([]), {
    getProvider: () => 'googleDrive',
    onAuthLost: vi.fn(),
  });
beforeEach(() => {
  native.safari = false;
  native.send.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('requests only Drive metadata fields and treats missing or trashed files as absent', async () => {
  const urls: URL[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(new URL(url));
    return Response.json(metadata);
  });
  expect(await files().metadata('token', 'file')).toEqual(metadata);
  expect(urls).toHaveLength(1);
  expect(urls[0].searchParams.has('alt')).toBe(false);
  expect(urls[0].searchParams.get('fields')?.split(',')).toEqual(
    expect.arrayContaining(['md5Checksum', 'modifiedTime']),
  );
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
  expect(await files().metadata('token', 'file')).toBeNull();
  vi.stubGlobal('fetch', async () => Response.json({ ...metadata, trashed: true }));
  expect(await files().metadata('token', 'file')).toBeNull();
});

it('reads Safari metadata through the native operation without exposing an OAuth token', async () => {
  native.safari = true;
  native.send.mockResolvedValue({ success: true, data: { ...metadata, found: true } });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await files().metadata('native-token', 'file')).toEqual(metadata);
  expect(native.send).toHaveBeenCalledWith('com.yourCompany.Gemini-Voyager', {
    action: 'googleDriveGetFileMetadata',
    fileID: 'file',
  });
  expect(fetch).not.toHaveBeenCalled();
  native.send.mockResolvedValue({ success: true, data: { found: false } });
  expect(await files().metadata('native-token', 'missing')).toBeNull();
});

it('takes Safari upload metadata from the same native write response', async () => {
  native.safari = true;
  native.send.mockResolvedValue({ success: true, data: { ...metadata, saved: true } });
  const value = { format: 'test', items: [] };
  expect(await files().upload('native-token', 'file', value)).toEqual(metadata);
  expect(native.send).toHaveBeenCalledExactlyOnceWith('com.yourCompany.Gemini-Voyager', {
    action: 'googleDriveUploadFile',
    fileID: 'file',
    json: JSON.stringify(value),
  });
});

it('does not retry a successful media write whose metadata receipt is malformed', async () => {
  const fetch = vi.fn(async () => Response.json({ id: 'file' }));
  vi.stubGlobal('fetch', fetch);
  await expect(files().upload('token', 'file', { items: [] })).rejects.toThrow(
    'invalid_drive_metadata',
  );
  expect(fetch).toHaveBeenCalledOnce();
});
