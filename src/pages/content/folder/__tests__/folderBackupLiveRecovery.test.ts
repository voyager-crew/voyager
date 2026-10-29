import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { hashCloudSyncContent } from '@/core/services/cloudSyncSnapshotHash';
import type { CloudSyncUndoneRecord } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import { budgetCopyBridge } from '@/features/storage/__tests__/budgetCopyBridge';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { FolderRepository } from '../FolderRepository';
import { AISTUDIO_FOLDER_CONFIG } from '../platformFolderConfig';
import { AIStudioFolderStorageAdapter } from '../storage/AIStudioFolderStorageAdapter';
import type { FolderData } from '../types';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: (keys: string | string[]) => chrome.storage.local.get(keys),
        set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
        remove: (keys: string | string[]) => chrome.storage.local.remove(keys),
      },
      onChanged: {
        addListener: (listener: Parameters<typeof chrome.storage.onChanged.addListener>[0]) =>
          chrome.storage.onChanged.addListener(listener),
        removeListener: (listener: Parameters<typeof chrome.storage.onChanged.removeListener>[0]) =>
          chrome.storage.onChanged.removeListener(listener),
      },
    },
    runtime: { sendMessage: vi.fn() },
  },
}));
vi.mock('@/core/utils/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/utils/browser')>()),
  isSafari: () => false,
}));

const KEY = StorageKeys.FOLDER_DATA_AISTUDIO;
const MARKERS = StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT;
const PRIMARY = 'gvBackup_aistudio-folders_primary';
const EMERGENCY = 'gvBackup_aistudio-folders_emergency';
let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let repository: FolderRepository | undefined;
let reloads: Promise<void>[];

function data(name: string): FolderData {
  return {
    folders: [{ id: 'a', name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
    folderContents: { a: [] },
  };
}

function serialized(value: FolderData, age = 0): string {
  return JSON.stringify({
    data: value,
    metadata: { timestamp: new Date(Date.now() - age).toISOString() },
  });
}

function createRepository(): FolderRepository {
  const created = new FolderRepository(AISTUDIO_FOLDER_CONFIG, new AIStudioFolderStorageAdapter(), {
    onChange: vi.fn(),
    onRecovery: vi.fn(),
    onExternalChange: () => reloads.push(created.loadData()),
    onAccountReleased: vi.fn(),
    isEnabled: () => true,
  });
  repository = created;
  return created;
}

async function finishReloads(): Promise<void> {
  while (reloads.length) await Promise.all(reloads.splice(0));
}

beforeEach(() => {
  originalStorage = chrome.storage;
  memory = createMemoryStorage();
  reloads = [];
  chrome.storage = memory.api;
  localStorage.clear();
  for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
    vi.spyOn(localStorage, method).mockImplementation(() => {
      throw new DOMException('Page storage is unavailable', 'SecurityError');
    });
  }
  vi.spyOn(accountIsolationService, 'isIsolationEnabled').mockResolvedValue(false);
  vi.mocked(browser.runtime.sendMessage).mockImplementation(
    budgetCopyBridge((items) => chrome.storage.local.set(items)),
  );
});

afterEach(async () => {
  await repository?.destroy();
  repository = undefined;
  chrome.storage = originalStorage;
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe('folder recovery with backups changed by another context', () => {
  it('keeps page backup cleanup inside its recovery ownership while authorization waits', async () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const)
      vi.mocked(localStorage[method]).mockRestore();
    const applied = data('Undone download');
    const primary = serialized(applied);
    localStorage.setItem(PRIMARY, primary);
    memory.values.local.set(MARKERS, {
      kind: 'undone',
      markers: [
        {
          area: 'local',
          key: KEY,
          replacedHash: await hashCloudSyncContent(applied),
          projections: [],
        },
      ],
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    let checkingCopy = false;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(
      async (keys: string | string[] | object | null = null) => {
        const result = await get<Record<string, unknown>>(keys);
        if (Array.isArray(keys) && keys.includes(PRIMARY) && keys.length === 3) checkingCopy = true;
        if (checkingCopy && keys === AUTHORITY_FENCE_KEY) {
          entered.resolve();
          await release.promise;
        }
        return result;
      },
    );

    const loading = createRepository().init();
    await entered.promise;
    repository!.suspend();
    release.resolve();
    await loading;

    expect(localStorage.getItem(PRIMARY)).toBe(primary);
    expect(memory.values.local.has(KEY)).toBe(false);
    expect(repository!.canEdit).toBe(false);
  });

  it('yields to read backoff when backups keep changing, then recovers a verified copy', async () => {
    vi.useFakeTimers();
    const backup = data('Continuously refreshed primary');
    memory.values.local.set(PRIMARY, serialized(backup, 1000));
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    let changingReads = 0;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(
      async (keys: string | string[] | object | null = null) => {
        if (Array.isArray(keys) && keys.includes(PRIMARY) && changingReads < 20) {
          changingReads += 1;
          memory.external('local', PRIMARY, serialized(backup, 1000 - changingReads));
        }
        return get<Record<string, unknown>>(keys);
      },
    );

    await createRepository().init();

    expect(repository!.canEdit).toBe(false);
    expect(memory.values.local.has(KEY)).toBe(false);
    expect(JSON.parse(String(memory.values.local.get(PRIMARY))).data).toEqual(backup);
    changingReads = 20;
    await vi.advanceTimersByTimeAsync(1000);
    await finishReloads();
    await repository!.session!.backup.finishPendingWrites();
    expect(repository!.canEdit).toBe(true);
    expect(memory.values.local.get(KEY)).toEqual(backup);
    expect(repository!.data).toEqual(backup);
  });

  it.each(['suspend', 'destroy', 'canonical recovery'] as const)(
    'stops reading recovery copies after %s during a live backup read',
    async (stop) => {
      vi.useFakeTimers();
      const backup = data('Old backup');
      const canonical = data('New canonical');
      memory.values.local.set(PRIMARY, serialized(backup));
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      let stopped = false;
      let postStopReads = 0;
      vi.spyOn(chrome.storage.local, 'get').mockImplementation(
        async (keys: string | string[] | object | null = null) => {
          const result = await get<Record<string, unknown>>(keys);
          if (Array.isArray(keys) && keys.includes(PRIMARY)) {
            if (stopped) postStopReads += 1;
            // The live recovery read contains the three data slots, excluding hydration metadata.
            if (keys.length === 3 && !stopped) {
              entered.resolve();
              await release.promise;
            }
          }
          return result;
        },
      );

      const loading = createRepository().init();
      await entered.promise;
      if (stop === 'canonical recovery') memory.external('local', KEY, canonical);
      else if (stop === 'destroy') await repository!.destroy();
      else repository!.suspend();
      stopped = true;
      release.resolve();
      await loading;

      expect(postStopReads).toBe(0);
      expect(memory.values.local.get(KEY)).toEqual(
        stop === 'canonical recovery' ? canonical : undefined,
      );
      if (stop === 'canonical recovery') {
        await vi.advanceTimersByTimeAsync(1000);
        await finishReloads();
        expect(repository!.data).toEqual(canonical);
        expect(repository!.canEdit).toBe(true);
      } else expect(repository!.canEdit).toBe(false);
    },
  );

  it.each([
    { window: 'primary', markerRead: 1 },
    { window: 'emergency fallback', markerRead: 3 },
  ])(
    'recovers the live primary when it changes during the $window marker check',
    async ({ markerRead }) => {
      const applied = data('Undone A');
      const emergency = data('Emergency C');
      const newer = data('Newer B');
      const marker: CloudSyncUndoneRecord = {
        kind: 'undone',
        markers: [
          {
            area: 'local',
            key: KEY,
            replacedHash: await hashCloudSyncContent(undefined),
            appliedHash: await hashCloudSyncContent(applied),
            projections: [],
          },
        ],
      };
      memory.values.local.set(MARKERS, marker);
      memory.values.local.set(PRIMARY, serialized(applied));
      memory.values.local.set(EMERGENCY, serialized(emergency, 1000));
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      let hydrated = false;
      let markerReads = 0;
      vi.spyOn(chrome.storage.local, 'get').mockImplementation(
        async (keys: string | string[] | object | null = null) => {
          const result = await get<Record<string, unknown>>(keys);
          if (Array.isArray(keys) && keys.includes(PRIMARY)) hydrated = true;
          if (hydrated && keys === MARKERS && ++markerReads === markerRead) {
            entered.resolve();
            await release.promise;
          }
          return result;
        },
      );

      const loading = createRepository().init();
      await entered.promise;
      const primary = serialized(newer);
      memory.external('local', PRIMARY, primary);
      release.resolve();
      await loading;
      await repository!.session!.backup.finishPendingWrites();

      expect(repository!.data).toEqual(newer);
      expect(memory.values.local.get(KEY)).toEqual(newer);
      expect(JSON.parse(String(memory.values.local.get(PRIMARY))).data).toEqual(newer);
    },
  );

  it('leaves canonical storage untouched when live backup reads fail after a marker check', async () => {
    const applied = data('Undone A');
    const marker: CloudSyncUndoneRecord = {
      kind: 'undone',
      markers: [
        {
          area: 'local',
          key: KEY,
          replacedHash: await hashCloudSyncContent(applied),
          projections: [],
        },
      ],
    };
    memory.values.local.set(MARKERS, marker);
    const primary = serialized(applied);
    memory.values.local.set(PRIMARY, primary);
    memory.values.local.set(EMERGENCY, serialized(data('Emergency C'), 1000));
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    let hydrated = false;
    let unreadable = false;
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(
      async (keys: string | string[] | object | null = null) => {
        if (Array.isArray(keys) && keys.includes(PRIMARY)) {
          if (unreadable) throw new Error('Backup storage could not be read');
          hydrated = true;
        }
        if (hydrated && keys === MARKERS) unreadable = true;
        return get<Record<string, unknown>>(keys);
      },
    );

    await createRepository().init();

    expect(repository!.canEdit).toBe(false);
    expect(memory.values.local.has(KEY)).toBe(false);
    expect(memory.values.local.get(PRIMARY)).toBe(primary);
  });

  it('ends reconciliation after recovery without reloading its own write over a newer primary', async () => {
    const recovered = data('Selected recovery A');
    const newer = data('Newer B');
    memory.values.local.set(KEY, data('Before corruption'));
    await createRepository().init();
    await repository!.session!.backup.finishPendingWrites();
    memory.values.local.set(PRIMARY, serialized(recovered));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
      if (KEY in items) {
        entered.resolve();
        await release.promise;
      }
      await set(items);
    });

    memory.external('local', KEY, { corrupted: true });
    await entered.promise;
    const primary = serialized(newer);
    memory.external('local', PRIMARY, primary);
    release.resolve();
    await finishReloads();
    await repository!.session!.backup.finishPendingWrites();

    expect(repository!.data).toEqual(recovered);
    expect(memory.values.local.get(KEY)).toEqual(recovered);
    expect(memory.values.local.get(PRIMARY)).toBe(primary);
  });
});
