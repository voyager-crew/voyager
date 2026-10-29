import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { createStarStore } from '@/features/savedLibrary/starStore';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';
import {
  corruptLegacyStarredPayload,
  strictLegacyStarredPayload,
} from './fixtures/strictHistoryExtras';
import { HISTORY_TEST_TIME } from './fixtures/strictHistoryPayloads';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const source = 'gemini-voyager-starred.json';

async function device() {
  const local = createSyncStorage({
    gvSyncMode: 'disabled',
    gvAccessToken: 'starred-history-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.SAVED_LIBRARY_STARS]: strictLegacyStarredPayload('local').data,
  });
  vi.stubGlobal('chrome', {
    runtime: { lastError: null },
    storage: { local: local.area, sync: createSyncStorage().area },
  });
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const service = new GoogleDriveSyncService();
  await service.getState();
  return { drive, local, service, store: createStarStore(local.area) };
}

function history(drive: FakeSyncDrive, id: string, payload: unknown, order: number) {
  const text = `\uFEFF\n${JSON.stringify(payload, null, 2)}\n`;
  drive.files.set(id, text);
  drive.metadata.set(id, {
    id,
    name: id,
    parents: ['sync-test-folder'],
    createdTime: new Date(Date.parse(HISTORY_TEST_TIME) - 60_000 + order * 1000).toISOString(),
    appProperties: { voyagerHistorySource: source },
  });
  return text;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(HISTORY_TEST_TIME));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('legacy starred history through the sync service', () => {
  it('upload cannot trash the only older valid starred backup behind two corrupt message buckets', async () => {
    const d = await device();
    const current = strictLegacyStarredPayload('current');
    d.drive.put(source, current);
    const currentText = d.drive.files.get(source);
    const olderText = history(d.drive, 'valid-older', strictLegacyStarredPayload('previous'), 0);
    history(d.drive, 'corrupt-newer-one', corruptLegacyStarredPayload('newer-one'), 1);
    history(d.drive, 'corrupt-newer-two', corruptLegacyStarredPayload('newer-two'), 2);

    await expect(
      d.service.runExclusive((turn) =>
        turn.upload(
          { folders: [], folderContents: {} },
          [],
          null,
          false,
          'gemini',
          null,
          null,
          null,
          null,
          null,
          null,
          d.store,
        ),
      ),
    ).resolves.toEqual({ kind: 'uploaded' });

    expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toEqual(
      expect.arrayContaining([olderText, currentText]),
    );
    expect(d.drive.trashed).toEqual(new Set());
    expect(d.drive.payload(source)).toMatchObject({
      data: {
        messages: {
          conversation: expect.arrayContaining([
            expect.objectContaining({ turnId: 'turn-local' }),
            expect.objectContaining({ turnId: 'turn-current' }),
          ]),
        },
      },
    });
    expect(await d.store.getForConversation('conversation')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turnId: 'turn-local' }),
        expect.objectContaining({ turnId: 'turn-current' }),
      ]),
    );
  });

  it('restore bypasses corrupt v1 message buckets without replacing local stars', async () => {
    const d = await device();
    d.drive.put(source, strictLegacyStarredPayload('current'));
    const current = d.drive.files.get(source);
    history(d.drive, 'valid-oldest', strictLegacyStarredPayload('oldest'), 0);
    const previous = history(d.drive, 'valid-newest', strictLegacyStarredPayload('previous'), 1);
    history(d.drive, 'corrupt-newer-one', corruptLegacyStarredPayload('newer-one'), 2);
    history(d.drive, 'corrupt-newer-two', corruptLegacyStarredPayload('newer-two'), 3);
    const localBefore = structuredClone(d.local.values);

    await expect(
      d.service.runExclusive((turn) =>
        turn.restorePreviousVersion([{ name: source, accountScope: null }], false),
      ),
    ).resolves.toEqual([{ name: source, status: 'restored', historyId: 'valid-newest' }]);

    expect(d.drive.files.get(source)).toBe(previous);
    expect(d.drive.histories(source).map(({ id }) => d.drive.files.get(id))).toContain(current);
    expect(d.drive.trashed).toEqual(new Set());
    expect(d.local.values).toEqual(localBefore);
  });
});
