import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const source = 'gemini-voyager-prompts.json';
const now = '2026-10-29T12:00:00.000Z';
const prompt = (id: string) => ({ id, text: `${id} text`, tags: [], createdAt: 1 });
const payload = (id: string) => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt: now,
  version: '2.2.1',
  items: [prompt(id)],
});

async function device() {
  const local = createSyncStorage({
    gvSyncMode: 'disabled',
    gvAccessToken: 'history-recovery-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.PROMPT_ITEMS]: [prompt('local')],
  });
  vi.stubGlobal('chrome', {
    runtime: { lastError: null },
    storage: { local: local.area, sync: createSyncStorage().area },
  });
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const service = new GoogleDriveSyncService();
  await service.getState();
  return {
    drive,
    local,
    upload: (id: string) =>
      service.runExclusive((turn) => turn.uploadPromptsOnly([prompt(id)], null, false)),
    restore: () =>
      service.runExclusive((turn) =>
        turn.restorePreviousVersion([{ name: source, accountScope: null }], false),
      ),
  };
}

function history(drive: FakeSyncDrive, id: string, text: string, order: number): string {
  drive.files.set(id, text);
  drive.metadata.set(id, {
    id,
    name: id,
    parents: ['sync-test-folder'],
    createdTime: new Date(Date.parse(now) - 60_000 + order * 1000).toISOString(),
    appProperties: { voyagerHistorySource: source },
  });
  return id;
}

function seedValidHistory(drive: FakeSyncDrive): void {
  for (const [index, id] of ['oldest', 'middle', 'newest'].entries()) {
    history(drive, id, JSON.stringify(payload(id)), index);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('history recovery through the sync service', () => {
  it('two failed archives followed by success keep the last three complete backups', async () => {
    const d = await device();
    d.drive.put(source, payload('current'));
    seedValidHistory(d.drive);
    const previous = d.drive.files.get(source);
    const localPrompts = structuredClone(d.local.values[StorageKeys.PROMPT_ITEMS]);
    d.drive.beforeWrite = async (id) => {
      if (id !== source) d.drive.failWrites.add(id);
    };

    for (const attempt of ['failed-one', 'failed-two']) {
      const uploading = d.upload(attempt);
      await vi.runAllTimersAsync();
      await expect(uploading).resolves.toBe(false);
      expect(d.drive.files.get(source)).toBe(previous);
    }
    d.drive.beforeWrite = undefined;
    d.drive.failWrites.clear();
    await expect(d.upload('replacement')).resolves.toBe(true);

    const active = d.drive.histories(source);
    expect(active).toHaveLength(3);
    expect(active.map(({ id }) => d.drive.files.get(id))).toEqual(
      expect.arrayContaining([
        JSON.stringify(payload('middle')),
        JSON.stringify(payload('newest')),
        JSON.stringify(payload('current')),
      ]),
    );
    expect(d.drive.histories(source, true)).toHaveLength(4);
    expect(d.drive.trashed).toEqual(new Set(['oldest']));
    expect(d.drive.payload(source)).toMatchObject({ items: [prompt('replacement')] });
    expect(d.local.values[StorageKeys.PROMPT_ITEMS]).toEqual(localPrompts);
  });

  it('old empty and corrupt archive records cannot evict a complete backup', async () => {
    const d = await device();
    d.drive.put(source, payload('current'));
    seedValidHistory(d.drive);
    history(d.drive, 'legacy-stub', '', 3);
    history(d.drive, 'legacy-corrupt', '{broken json', 4);

    await expect(d.upload('replacement')).resolves.toBe(true);

    expect(d.drive.trashed).toEqual(new Set(['oldest']));
    expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toEqual(
      expect.arrayContaining([
        JSON.stringify(payload('middle')),
        JSON.stringify(payload('newest')),
        JSON.stringify(payload('current')),
        '',
        '{broken json',
      ]),
    );
  });

  it('keeps unrecognized current bytes without counting them against recoverable backups', async () => {
    const d = await device();
    const unknownCurrent = '  { future-or-malformed format }\n';
    d.drive.files.set(source, unknownCurrent);
    seedValidHistory(d.drive);

    await expect(d.upload('replacement')).resolves.toBe(true);

    expect(d.drive.trashed).toEqual(new Set());
    expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toContain(
      unknownCurrent,
    );
    for (const id of ['oldest', 'middle', 'newest']) {
      expect(d.drive.histories(source).some((entry) => entry.id === id)).toBe(true);
    }
    // The upload stamps the running extension's version.
    expect(d.drive.payload(source)).toEqual({
      ...payload('replacement'),
      version: EXTENSION_VERSION,
    });
  });

  it('restores the newest complete valid history behind corrupt and empty newer records', async () => {
    const d = await device();
    d.drive.put(source, payload('current'));
    history(d.drive, 'valid-older', JSON.stringify(payload('previous')), 0);
    history(d.drive, 'empty-newer', '', 1);
    history(d.drive, 'corrupt-newest', '{broken json', 2);
    const local = structuredClone(d.local.values);

    await expect(d.restore()).resolves.toEqual([
      { name: source, status: 'restored', historyId: 'valid-older' },
    ]);

    expect(d.drive.payload(source)).toEqual(payload('previous'));
    expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toContain(
      JSON.stringify(payload('current')),
    );
    expect(d.drive.files.get('empty-newer')).toBe('');
    expect(d.drive.files.get('corrupt-newest')).toBe('{broken json');
    expect(d.drive.trashed).toEqual(new Set());
    expect(d.local.values).toEqual(local);
  });

  it.each(['upload', 'restore'] as const)(
    'an older history read failure aborts %s before any media or local data is changed',
    async (operation) => {
      const d = await device();
      d.drive.put(source, payload('current'));
      seedValidHistory(d.drive);
      d.drive.failReads.add('oldest');
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.local.values);

      const result = operation === 'upload' ? d.upload('replacement') : d.restore();
      await vi.runAllTimersAsync();
      if (operation === 'upload') await expect(result).resolves.toBe(false);
      else await expect(result).resolves.toEqual([{ name: source, status: 'read_failed' }]);

      expect(d.drive.files).toEqual(cloud);
      expect(d.drive.writes).toEqual([]);
      expect(d.drive.trashed).toEqual(new Set());
      expect(d.local.values).toEqual(local);
    },
  );
});
