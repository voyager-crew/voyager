import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  exportedAt: '2026-10-29T01:30:00.000Z',
  items: [{ id: text, text, tags: [], createdAt: 1 }],
});

function fixture() {
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([source]), {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  return { drive, upload: () => new GoogleDriveUploadFiles(files) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T01:30:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Drive upload commit safety', () => {
  it('restoring a revisited version can still be reversed to the immediately replaced content', async () => {
    const d = fixture();
    d.drive.put(source, payload('A'));
    for (const text of ['B', 'C', 'A']) await d.upload().write('token', source, payload(text));
    await d.upload().restoreHistory('token', [source]);
    expect(d.drive.payload(source)).toEqual(payload('C'));
    await d.upload().restoreHistory('token', [source]);
    expect(d.drive.payload(source)).toEqual(payload('A'));
  });

  it('failed replacements retain every prior version and do not archive the same current body repeatedly', async () => {
    const d = fixture();
    d.drive.put(source, payload('original'));
    for (const text of ['one', 'two', 'current'])
      await d.upload().write('token', source, payload(text));
    const prior = d.drive.histories(source).map(({ id }) => id);
    d.drive.failWrites.add(source);
    for (let attempt = 0; attempt < 3; attempt++) {
      const writing = expect(d.upload().write('token', source, payload('next'))).rejects.toThrow();
      await vi.runAllTimersAsync();
      await writing;
    }
    expect(d.drive.payload(source)).toEqual(payload('current'));
    expect(prior.every((id) => !d.drive.trashed.has(id))).toBe(true);
    expect(
      d.drive
        .histories(source, true)
        .filter(({ id }) => d.drive.files.get(id) === JSON.stringify(payload('current'))),
    ).toHaveLength(1);

    d.drive.failWrites.delete(source);
    await expect(d.upload().restoreHistory('token', [source])).resolves.toMatchObject([
      { name: source, status: 'restored' },
    ]);
    expect(d.drive.payload(source)).toEqual(payload('two'));
  });

  it('a failed first upload leaves read-only and later targets missing', async () => {
    const d = fixture();
    const upload = d.upload();
    const readOnly = 'gemini-voyager-highlights.json';
    const later = 'gemini-voyager-plugins.json';
    upload.register(source, readOnly, later);
    d.drive.failWrites.add(source);
    const writing = expect(upload.write('token', source, payload('next'))).rejects.toThrow();
    await vi.runAllTimersAsync();
    await writing;
    expect(d.drive.files.has(readOnly)).toBe(false);
    expect(d.drive.files.has(later)).toBe(false);
  });

  it('a rejected account persistence gate creates and moves no Drive file', async () => {
    const d = fixture();
    const upload = d.upload();
    upload.register(source);
    upload.setBeforeFirstWrite(async () => {
      throw new Error('account changed');
    });
    const before = new Map(d.drive.files);
    await expect(upload.write('token', source, payload('next'))).rejects.toThrow('account changed');
    expect(d.drive.files).toEqual(before);
  });
});
