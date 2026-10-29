import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { AUTHORITY_FENCE_KEY } from '@/features/folder/owner/authorityFence';
import { LegacyFolderFence } from '@/features/folder/owner/legacyFolderFence';

import { DataBackupService } from '../DataBackupService';

const boundary = vi.hoisted(() => ({ stored: {} as Record<string, unknown> }));
vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [key, boundary.stored[key]]),
          ),
        ),
        remove: vi.fn(async (key: string) => {
          delete boundary.stored[key];
        }),
      },
    },
    runtime: {
      sendMessage: vi.fn(async ({ key, value }: { key: string; value: string }) => {
        boundary.stored[key] = value;
        return { status: 'saved' };
      }),
    },
  },
}));

const fences: LegacyFolderFence[] = [];
const services: DataBackupService<unknown>[] = [];
const deferred = <T>() => Promise.withResolvers<T>();
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function safari() {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Version/18.0 Safari/605.1.15');
  vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
}
beforeEach(() => {
  boundary.stored = {};
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys) =>
    Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((key) => [key, boundary.stored[key as string]]),
    ),
  );
});
afterEach(() => {
  for (const service of services.splice(0)) service.destroy();
  for (const fence of fences.splice(0)) fence.destroy();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe.each([
  { site: 'gemini', key: StorageKeys.FOLDER_DATA, namespace: 'gemini-folders' },
  { site: 'aistudio', key: StorageKeys.FOLDER_DATA_AISTUDIO, namespace: 'aistudio-folders' },
  { site: 'chatgpt', key: StorageKeys.FOLDER_DATA_CHATGPT, namespace: 'chatgpt-folders' },
])('$site backup write authorization', ({ site, key, namespace }) => {
  const primary = `gvBackup_${namespace}_primary`;
  const emergency = `gvBackup_${namespace}_emergency`;
  const metadata = `gvBackup_${namespace}_metadata`;
  function service() {
    const fence = new LegacyFolderFence(key, () => {}, false);
    fences.push(fence);
    const backup = new DataBackupService<unknown>(
      namespace,
      () => true,
      () => fence.canWrite,
      (write) => fence.write(write),
    );
    services.push(backup);
    return backup;
  }
  const owner = () => ({ [AUTHORITY_FENCE_KEY]: { build: 'newer', sites: { [site]: 'owner' } } });

  it('a delayed earlier authorization cannot replace the newest emergency backup', async () => {
    const backup = service();
    const authorization = deferred<Record<string, unknown>>();
    vi.mocked(browser.storage.local.get).mockImplementationOnce(() => authorization.promise);
    const earlier = backup.createEmergencyBackup({ folders: ['Earlier'] });
    expect(await backup.createEmergencyBackup({ folders: ['Newest'] })).toBe(true);
    authorization.resolve({});
    expect(await earlier).toBe(false);
    expect(JSON.parse(localStorage.getItem(emergency)!).data).toEqual({ folders: ['Newest'] });
    expect(await backup.recoverFromBackupForKey('gvFolderData')).toEqual({ folders: ['Newest'] });
  });

  it('delayed primary metadata cannot replace a newer primary snapshot', async () => {
    const backup = service();
    const authorization = deferred<Record<string, unknown>>();
    const get = vi.mocked(browser.storage.local.get).getMockImplementation()!;
    let reads = 0;
    vi.mocked(browser.storage.local.get).mockImplementation((keys) => {
      if (keys === AUTHORITY_FENCE_KEY && ++reads === 2) return authorization.promise;
      return get(keys);
    });
    const earlier = backup.createPrimaryBackup({ folders: ['Earlier'] });
    await settle();
    expect(await backup.createPrimaryBackup({ folders: ['Newest', 'Also newest'] })).toBe(true);
    authorization.resolve({});
    await earlier;
    expect(await backup.recoverFromBackupForKey('gvFolderData')).toEqual({
      folders: ['Newest', 'Also newest'],
    });
    expect(JSON.parse(localStorage.getItem(metadata)!).primary.itemCount).toBe(2);
  });

  it('a newly published owner blocks the durable copy after the local backup settles', async () => {
    safari();
    const backup = service();
    const authorization = deferred<Record<string, unknown>>();
    const get = vi.mocked(browser.storage.local.get).getMockImplementation()!;
    let reads = 0;
    vi.mocked(browser.storage.local.get).mockImplementation((keys) => {
      if (keys === AUTHORITY_FENCE_KEY && ++reads === 2) return authorization.promise;
      return get(keys);
    });
    boundary.stored[emergency] = 'previous durable copy';
    const saving = backup.createEmergencyBackup({ folders: ['Local before owner'] });
    await settle();
    authorization.resolve(owner());
    expect(await saving).toBe(true);
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    expect(boundary.stored[emergency]).toBe('previous durable copy');
  });

  it('a newly published owner preserves metadata after the primary slot was written', async () => {
    const backup = service();
    const previous = JSON.stringify({ primary: { timestamp: 'older', itemCount: 1 } });
    localStorage.setItem(metadata, previous);
    const set = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((slot, value) => {
      set(slot, value);
      if (slot === primary) Object.assign(boundary.stored, owner());
    });
    expect(await backup.createPrimaryBackup({ folders: ['Written before owner'] })).toBe(true);
    expect(localStorage.getItem(metadata)).toBe(previous);
    expect(JSON.parse(localStorage.getItem(primary)!).data).toEqual({
      folders: ['Written before owner'],
    });
  });

  it('a newly published owner blocks hydration mirrors after the durable read settles', async () => {
    safari();
    const backup = service();
    const durableRead = deferred<Record<string, unknown>>();
    const get = vi.mocked(browser.storage.local.get).getMockImplementation()!;
    vi.mocked(browser.storage.local.get).mockImplementation((keys) =>
      Array.isArray(keys) ? durableRead.promise : get(keys),
    );
    const hydrating = backup.ensureHydrated();
    await settle();
    Object.assign(boundary.stored, owner());
    durableRead.resolve({ [primary]: 'older durable copy' });
    await hydrating;
    expect(localStorage.getItem(primary)).toBeNull();
  });

  it('a newly published owner blocks durable removal after a page slot was cleared', async () => {
    const backup = service();
    localStorage.setItem(primary, 'previous page copy');
    boundary.stored[primary] = 'previous durable copy';
    const authorization = deferred<Record<string, unknown>>();
    const get = vi.mocked(browser.storage.local.get).getMockImplementation()!;
    let reads = 0;
    vi.mocked(browser.storage.local.get).mockImplementation((keys) => {
      if (keys === AUTHORITY_FENCE_KEY && ++reads === 5) return authorization.promise;
      return get(keys);
    });
    backup.clearAllBackups();
    await settle();
    authorization.resolve(owner());
    await settle();
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(boundary.stored[primary]).toBe('previous durable copy');
  });
});
