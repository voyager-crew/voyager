import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { GoogleDriveSyncService } from '../GoogleDriveSyncService';
import { FakeSyncDrive, createSyncStorage } from './fixtures/fakeSyncDrive';

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isSafari: () => false,
  isBrave: () => false,
}));

const PROMPTS = 'gemini-voyager-prompts.json';
const prompt = (id: string) => ({ id, text: `${id} text`, tags: [], createdAt: 1 });
const payload = (id: string) => ({
  format: 'gemini-voyager.prompts.v1',
  exportedAt: '2026-10-29T00:00:00.000Z',
  version: '2.2.1',
  items: [prompt(id)],
});

async function device() {
  const local = createSyncStorage({
    gvSyncMode: 'disabled',
    gvAccessToken: 'raw-history-test-token',
    gvTokenExpiry: Date.now() + 3_600_000,
    [StorageKeys.PROMPT_ITEMS]: [prompt('new')],
  });
  vi.stubGlobal('chrome', {
    runtime: { lastError: null },
    storage: { local: local.area, sync: createSyncStorage().area },
  });
  const drive = new FakeSyncDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const service = new GoogleDriveSyncService();
  await service.getState();
  return { drive, local, service };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('raw Drive history media', () => {
  it('keeps a UTF-8 BOM in the backup and restored current file', async () => {
    const d = await device();
    const previous = `\uFEFF${JSON.stringify(payload('previous'), null, 2)}`;
    d.drive.files.set(PROMPTS, previous);

    await expect(
      d.service.runExclusive((turn) => turn.uploadPromptsOnly([prompt('new')], null, false)),
    ).resolves.toBe(true);
    const uploaded = d.drive.files.get(PROMPTS);
    const histories = d.drive.histories(PROMPTS);
    expect(histories).toHaveLength(1);
    expect(d.drive.files.get(histories[0].id)).toBe(previous);
    expect(d.drive.payload(PROMPTS)).toMatchObject({ items: [prompt('new')] });

    await expect(
      d.service.runExclusive((turn) =>
        turn.restorePreviousVersion([{ name: PROMPTS, accountScope: null }], false),
      ),
    ).resolves.toMatchObject([{ name: PROMPTS, status: 'restored' }]);
    expect(d.drive.files.get(PROMPTS)).toBe(previous);
    expect(
      d.drive.histories(PROMPTS).some((entry) => d.drive.files.get(entry.id) === uploaded),
    ).toBe(true);
  });

  it('aborts before creating history or overwriting a current file with invalid UTF-8 media', async () => {
    const d = await device();
    d.drive.files.set(PROMPTS, 'raw-current-byte-ff');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (
        url.pathname === `/drive/v3/files/${PROMPTS}` &&
        url.searchParams.get('alt') === 'media'
      ) {
        return new Response(new Uint8Array([255]));
      }
      return d.drive.fetch(input, init);
    });
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.local.values);

    const upload = d.service.runExclusive((turn) =>
      turn.uploadPromptsOnly([prompt('new')], null, false),
    );
    await vi.runAllTimersAsync();
    await expect(upload).resolves.toBe(false);
    expect(d.drive.files).toEqual(cloud);
    expect(d.drive.histories(PROMPTS, true)).toEqual([]);
    expect(d.local.values).toEqual(local);
  });
});
