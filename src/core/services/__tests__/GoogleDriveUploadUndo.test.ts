import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudUploadReceipt } from '@/core/types/syncUploadReceipt';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';
import { GoogleDriveUploadFiles } from '../GoogleDriveUploadFiles';
import { FakeSyncDrive } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));
const source = 'gemini-voyager-prompts.json';
const payload = (text: string) => ({
  format: 'gemini-voyager.prompts.v1',
  items: [{ id: text, text, tags: [], createdAt: 1 }],
});
function fixture() {
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([source]), {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  return { drive, files, upload: () => new GoogleDriveUploadFiles(files) };
}
afterEach(() => vi.unstubAllGlobals());

describe('upload Undo receipts', () => {
  it('keeps a later device version instead of restoring the newest history', async () => {
    const d = fixture();
    d.drive.put(source, payload('original'));
    await d.upload().write('token', source, payload('A'));
    const written = await d.files.metadata('token', source);
    const receipt: CloudUploadReceipt = {
      complete: true,
      files: [
        {
          name: source,
          fileId: source,
          md5Checksum: written!.md5Checksum,
          replaced: { kind: 'history', historyId: d.drive.histories(source)[0].id },
        },
      ],
    };
    await d.upload().write('token', source, payload('B'));
    expect(await d.upload().restoreHistory('token', [source], receipt)).toEqual([
      { name: source, status: 'kept' },
    ]);
    expect(d.drive.payload(source)).toEqual(payload('B'));
  });

  it('restores the receipted copy even when a newer failed upload archive exists', async () => {
    const d = fixture();
    d.drive.put(source, payload('original'));
    await d.upload().write('token', source, payload('A'));
    const written = await d.files.metadata('token', source);
    const historyId = d.drive.histories(source)[0].id;
    const receipt: CloudUploadReceipt = {
      complete: true,
      files: [
        {
          name: source,
          fileId: source,
          md5Checksum: written!.md5Checksum,
          replaced: { kind: 'history', historyId },
        },
      ],
    };
    await d.files.createHistory(
      'token',
      'newer-failed-archive',
      source,
      JSON.stringify(payload('unrelated')),
    );
    expect(await d.upload().restoreHistory('token', [source], receipt)).toEqual([
      { name: source, status: 'restored', historyId },
    ]);
    expect(d.drive.payload(source)).toEqual(payload('original'));
  });

  it('trashes the first-created cloud file while retaining its bytes and local data', async () => {
    const d = fixture();
    await d.upload().write('token', source, payload('first'));
    const written = await d.files.metadata('token', source);
    const receipt: CloudUploadReceipt = {
      complete: true,
      files: [
        {
          name: source,
          fileId: source,
          md5Checksum: written!.md5Checksum,
          replaced: { kind: 'created' },
        },
      ],
    };
    expect(await d.upload().restoreHistory('token', [source], receipt)).toEqual([
      { name: source, status: 'removed' },
    ]);
    expect(d.drive.trashed.has(source)).toBe(true);
    expect(d.drive.payload(source)).toEqual(payload('first'));
  });
});
