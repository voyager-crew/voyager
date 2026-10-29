import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCloudRestore } from '@/core/services/CloudSyncApplyService';
import {
  readCloudSyncSnapshot,
  undoCloudSyncSnapshot,
} from '@/core/services/CloudSyncSnapshotService';
import { parseCloudSyncSnapshotSlot } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';
import type { PromptItem } from '@/features/backup/types/backup';

import {
  createRuntimePromptLibraryClient,
  handlePromptLibraryApplyMessage,
} from '../promptLibraryMessages';
import { PROMPT_LIBRARY_KEY, createPromptLibraryOwner } from '../promptLibraryOwner';

const slot = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const prompt = (id: string, text: string): PromptItem => ({ id, text, tags: [], createdAt: 1 });
const previous = [prompt('local', 'Original prompt')];
const downloaded = [prompt('downloaded', 'Downloaded prompt')];

function setup() {
  const values: Record<string, unknown> = { [PROMPT_LIBRARY_KEY]: structuredClone(previous) };
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(async () => structuredClone(values));
  const save = async (items: Record<string, unknown>) => {
    Object.assign(values, structuredClone(items));
  };
  const set = vi.spyOn(chrome.storage.local, 'set').mockImplementation(save);
  vi.spyOn(chrome.storage.local, 'remove').mockImplementation(async (keys) => {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key];
  });
  const owner = createPromptLibraryOwner({
    area: {
      get: (key) => chrome.storage.local.get<Record<string, unknown>>(key),
      set: (items) => chrome.storage.local.set(items),
    },
  });
  vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(async (request) =>
    handlePromptLibraryApplyMessage(structuredClone(request), owner),
  );
  const client = createRuntimePromptLibraryClient();
  const restore = (items: PromptItem[] = downloaded) =>
    applyCloudRestore({
      mode: 'overwrite',
      highlightsRestored: false,
      storageUpdate: {},
      snapshot: { source: 'popup-restore', platform: 'gemini', accountScope: null },
      owners: [
        {
          parts: ['prompts'],
          keys: [{ area: 'local', key: PROMPT_LIBRARY_KEY }],
          run: async (snapshotId) => {
            await client.apply({ kind: 'restore', mode: 'overwrite', items, snapshotId });
            return true;
          },
        },
      ],
    });
  return { values, set, save, restore };
}

afterEach(() => vi.restoreAllMocks());

describe('prompt download write receipts', () => {
  it('keeps the original prompts when saving the receipt exceeds quota', async () => {
    const { values, set, save, restore } = setup();
    set.mockImplementation(async (items: Record<string, unknown>) => {
      const candidate = parseCloudSyncSnapshotSlot(items[slot]);
      if (candidate?.kind === 'snapshot' && candidate.appliedHashes.length)
        throw new Error('receipt quota exceeded');
      await save(items);
    });

    await expect(restore([])).rejects.toMatchObject({ restored: [], failed: ['prompts'] });
    expect(values[PROMPT_LIBRARY_KEY]).toEqual(previous);
    expect(await undoCloudSyncSnapshot()).toEqual({ status: 'absent' });
    expect(values[PROMPT_LIBRARY_KEY]).toEqual(previous);
  });

  it('persists the exact payload before replacing prompts even if a later tab edits before reply', async () => {
    const { values, set, save, restore } = setup();
    const later = [prompt('later', 'Newer edit')];
    let receiptBeforeWrite: unknown;
    set.mockImplementation(async (items) => {
      if (PROMPT_LIBRARY_KEY in items) receiptBeforeWrite = structuredClone(values[slot]);
      await save(items);
      if (PROMPT_LIBRARY_KEY in items) values[PROMPT_LIBRARY_KEY] = later;
    });

    await expect(restore()).resolves.toMatchObject({ restored: ['prompts'] });
    const receipt = {
      area: 'local',
      key: PROMPT_LIBRARY_KEY,
      kind: 'prompts',
      hash: await hashValue(downloaded),
    };
    expect(receiptBeforeWrite).toMatchObject({ kind: 'snapshot', appliedHashes: [receipt] });
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([receipt]);
    expect(values[PROMPT_LIBRARY_KEY]).toEqual(later);
    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({
      status: 'restored',
      restoredKeys: 0,
      kept: [{ kind: 'prompts', reason: 'changed-since-download' }],
    });
    expect(values[PROMPT_LIBRARY_KEY]).toEqual(later);
  });

  it('retains original prompts after canonical failure for undo when current content matches the receipt', async () => {
    const { values, set, save, restore } = setup();
    set.mockImplementation(async (items) => {
      if (PROMPT_LIBRARY_KEY in items) throw new Error('canonical quota exceeded');
      await save(items);
    });

    await expect(restore()).rejects.toMatchObject({ restored: [], failed: ['prompts'] });
    expect(values[PROMPT_LIBRARY_KEY]).toEqual(previous);
    expect((await readCloudSyncSnapshot())?.entries).toEqual([
      { area: 'local', key: PROMPT_LIBRARY_KEY, existed: true, value: previous },
    ]);
    expect((await readCloudSyncSnapshot())?.appliedHashes).toEqual([
      expect.objectContaining({ key: PROMPT_LIBRARY_KEY, hash: await hashValue(downloaded) }),
    ]);

    // The prepared receipt remains usable if the failed write committed despite its error reply.
    values[PROMPT_LIBRARY_KEY] = structuredClone(downloaded);
    set.mockImplementation(save);
    await expect(undoCloudSyncSnapshot()).resolves.toMatchObject({
      status: 'restored',
      restoredKeys: 1,
    });
    expect(values[PROMPT_LIBRARY_KEY]).toEqual(previous);
  });
});
