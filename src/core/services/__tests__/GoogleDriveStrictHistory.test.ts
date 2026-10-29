import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { GoogleDriveBackupFolder } from '../GoogleDriveBackupFolder';
import { GoogleDriveFiles } from '../GoogleDriveFiles';
import { GoogleDriveUploadFiles } from '../GoogleDriveUploadFiles';
import { FakeSyncDrive } from './fixtures/fakeSyncDrive';
import { strictExtraHistoryFixtures } from './fixtures/strictHistoryExtras';
import { HISTORY_TEST_TIME, strictSharedHistoryFixtures } from './fixtures/strictHistoryPayloads';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const fixtures = [...strictSharedHistoryFixtures, ...strictExtraHistoryFixtures];

function device(source: string) {
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const files = new GoogleDriveFiles(new GoogleDriveBackupFolder([source]), {
    getProvider: () => 'googleDrive',
    onAuthLost: () => {},
  });
  return { drive, uploads: () => new GoogleDriveUploadFiles(files) };
}

function history(drive: FakeSyncDrive, source: string, id: string, text: string, order: number) {
  drive.files.set(id, text);
  drive.metadata.set(id, {
    id,
    name: id,
    parents: ['sync-test-folder'],
    createdTime: new Date(Date.parse(HISTORY_TEST_TIME) - 60_000 + order * 1000).toISOString(),
    appProperties: { voyagerHistorySource: source },
  });
}

function exactMedia(value: unknown): string {
  return `\uFEFF\n${JSON.stringify(value, null, 2)}\n`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(HISTORY_TEST_TIME));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('complete Drive history retention and restoration', () => {
  it.each(fixtures)(
    '$label: two corrupt newer histories cannot evict a valid older copy',
    async ({ source, valid, corrupt }) => {
      const d = device(source);
      const current = exactMedia(valid('current'));
      const older = exactMedia(valid('valid-older'));
      const corruptOne = exactMedia(corrupt('newer-one'));
      const corruptTwo = exactMedia(corrupt('newer-two'));
      d.drive.put(source, valid('current'));
      d.drive.files.set(source, current);
      history(d.drive, source, 'valid-older', older, 0);
      history(d.drive, source, 'corrupt-newer-one', corruptOne, 1);
      history(d.drive, source, 'corrupt-newer-two', corruptTwo, 2);

      await d.uploads().write('token', source, valid('replacement'));

      expect(d.drive.payload(source)).toEqual(valid('replacement'));
      expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toEqual(
        expect.arrayContaining([older, current, corruptOne, corruptTwo]),
      );
      expect(d.drive.trashed).toEqual(new Set());
    },
  );

  it.each(fixtures)(
    '$label: restore skips corrupt newer histories and restores exact valid bytes',
    async ({ source, valid, corrupt }) => {
      const d = device(source);
      const older = exactMedia(valid('valid-older'));
      const newestValid = exactMedia(valid('valid-newest'));
      const current = exactMedia(valid('current'));
      d.drive.put(source, valid('current'));
      d.drive.files.set(source, current);
      history(d.drive, source, 'valid-older', older, 0);
      history(d.drive, source, 'valid-newest', newestValid, 1);
      history(d.drive, source, 'corrupt-newer-one', exactMedia(corrupt('newer-one')), 2);
      history(d.drive, source, 'corrupt-newer-two', exactMedia(corrupt('newer-two')), 3);

      await expect(d.uploads().restoreHistory('token', [source])).resolves.toEqual([
        { name: source, status: 'restored', historyId: 'valid-newest' },
      ]);

      expect(d.drive.files.get(source)).toBe(newestValid);
      expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toEqual(
        expect.arrayContaining([older, newestValid, current]),
      );
      expect(d.drive.trashed).toEqual(new Set());
    },
  );

  it.each(fixtures)(
    '$label: complete exports count toward the three-copy limit and remain restorable',
    async ({ source, valid }) => {
      const d = device(source);
      const current = exactMedia(valid('current'));
      d.drive.put(source, valid('current'));
      d.drive.files.set(source, current);
      for (const [index, id] of ['oldest', 'middle', 'newest'].entries()) {
        history(d.drive, source, id, exactMedia(valid(id)), index);
      }

      await d.uploads().write('token', source, valid('replacement'));

      expect(d.drive.trashed).toEqual(new Set(['oldest']));
      expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toEqual(
        expect.arrayContaining([exactMedia(valid('middle')), exactMedia(valid('newest')), current]),
      );
      await expect(d.uploads().restoreHistory('token', [source])).resolves.toMatchObject([
        { name: source, status: 'restored' },
      ]);
      expect(d.drive.files.get(source)).toBe(current);
      expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toContain(
        JSON.stringify(valid('replacement')),
      );
    },
  );

  it.each(['upload', 'restore'])(
    'literal numeric overflow history cannot replace a recoverable copy during %s',
    async (operation) => {
      const source = 'gemini-voyager-settings.json';
      const d = device(source);
      const payload = (fontSize: number) => ({
        format: 'gemini-voyager.settings.v1',
        exportedAt: HISTORY_TEST_TIME,
        version: '2.2.1',
        data: { [StorageKeys.CHAT_FONT_SIZE]: fontSize },
      });
      const older = exactMedia(payload(90));
      const current = exactMedia(payload(100));
      // JSON.stringify(Infinity) would erase the bug before the real media reader sees it.
      const overflow = `{"format":"gemini-voyager.settings.v1","exportedAt":"${HISTORY_TEST_TIME}","version":"2.2.1","data":{"${StorageKeys.CHAT_FONT_SIZE}":1e999}}`;
      d.drive.put(source, payload(100));
      d.drive.files.set(source, current);
      history(d.drive, source, 'valid-older', older, 0);
      history(d.drive, source, 'overflow-newer-one', overflow, 1);
      history(d.drive, source, 'overflow-newer-two', overflow, 2);

      if (operation === 'upload') {
        await d.uploads().write('token', source, payload(110));
        expect(d.drive.payload(source)).toEqual(payload(110));
      } else {
        await expect(d.uploads().restoreHistory('token', [source])).resolves.toEqual([
          { name: source, status: 'restored', historyId: 'valid-older' },
        ]);
        expect(d.drive.files.get(source)).toBe(older);
      }

      expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toEqual(
        expect.arrayContaining([older, current, overflow]),
      );
      expect(d.drive.trashed).toEqual(new Set());
    },
  );
});
