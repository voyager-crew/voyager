import { describe, expect, it, vi } from 'vitest';

import {
  filterBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from '@/core/services/SettingsBackupService';
import { StorageKeys } from '@/core/types/common';

import { migrateGeminiQuoteReplyDefault } from '../quoteReplyDefaultMigration';

function storageArea(initial: Record<string, unknown> = {}) {
  const state = { ...initial };
  return {
    state,
    get: vi.fn(async (key: string) => (Object.hasOwn(state, key) ? { [key]: state[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(state, items);
    }),
  };
}

function device(
  initialSync: Record<string, unknown> = { [StorageKeys.QUOTE_REPLY_ENABLED]: true },
  initialLocal: Record<string, unknown> = {},
) {
  return { sync: storageArea(initialSync), local: storageArea(initialLocal) };
}

describe('Gemini quote reply one-time device migration', () => {
  it('turns off a saved legacy default and records completion without changing other data', async () => {
    const storage = device(
      { [StorageKeys.QUOTE_REPLY_ENABLED]: true, [StorageKeys.FORMULA_COPY_ENABLED]: true },
      { [StorageKeys.PLUGINS_STATE]: { 'voyager.chatgpt-quote-reply': { enabled: true } } },
    );

    await migrateGeminiQuoteReplyDefault(storage);

    expect(storage.sync.state).toEqual({
      [StorageKeys.QUOTE_REPLY_ENABLED]: false,
      [StorageKeys.FORMULA_COPY_ENABLED]: true,
    });
    expect(storage.local.state).toEqual({
      [StorageKeys.PLUGINS_STATE]: { 'voyager.chatgpt-quote-reply': { enabled: true } },
      [StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]: true,
    });
  });

  it('preserves a re-enabled preference across a new background module instance', async () => {
    const storage = device(undefined, { [StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]: true });
    vi.resetModules();
    const restarted = await import('../quoteReplyDefaultMigration');

    await restarted.migrateGeminiQuoteReplyDefault(storage);
    await restarted.migrateGeminiQuoteReplyDefault(storage);

    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(true);
    expect(storage.sync.set).not.toHaveBeenCalled();
    expect(storage.local.set).not.toHaveBeenCalled();
  });

  it('leaves an unset preference missing and preserves the first subsequent opt-in', async () => {
    const storage = device({});

    await migrateGeminiQuoteReplyDefault(storage);

    expect(storage.sync.state).toEqual({});
    expect(storage.sync.set).not.toHaveBeenCalled();
    expect(storage.local.state[StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]).toBe(true);
    await storage.sync.set({ [StorageKeys.QUOTE_REPLY_ENABLED]: true });
    await migrateGeminiQuoteReplyDefault(storage);
    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(true);
  });

  it('does not mark completion when closing fails, and retries on the next startup', async () => {
    const storage = device();
    storage.sync.set.mockRejectedValueOnce(new Error('sync write failed'));

    await migrateGeminiQuoteReplyDefault(storage);

    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(true);
    expect(storage.local.state).toEqual({});
    expect(storage.local.set).not.toHaveBeenCalled();
    await migrateGeminiQuoteReplyDefault(storage);
    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(false);
    expect(storage.local.state[StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]).toBe(true);
  });

  it('keeps an unsuccessful marker write retryable after closing succeeds', async () => {
    const storage = device();
    storage.local.set.mockRejectedValueOnce(new Error('local write failed'));

    await migrateGeminiQuoteReplyDefault(storage);

    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(false);
    expect(storage.local.state).toEqual({});
    await migrateGeminiQuoteReplyDefault(storage);
    expect(storage.local.state[StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]).toBe(true);
    await storage.sync.set({ [StorageKeys.QUOTE_REPLY_ENABLED]: true });
    await migrateGeminiQuoteReplyDefault(storage);
    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(true);
  });

  it.each(['sync', 'local'] as const)(
    'leaves data intact after a %s read failure',
    async (area) => {
      const storage = device();
      storage[area].get.mockRejectedValueOnce(new Error('read failed'));

      await migrateGeminiQuoteReplyDefault(storage);

      expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(true);
      expect(storage.local.state).toEqual({});
      expect(storage.sync.set).not.toHaveBeenCalled();
      expect(storage.local.set).not.toHaveBeenCalled();
    },
  );

  it('never leaves a completion marker while the closing write is still pending', async () => {
    const storage = device();
    let finishWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    storage.sync.set.mockImplementationOnce(async (items) => {
      await pendingWrite;
      Object.assign(storage.sync.state, items);
    });

    const migration = migrateGeminiQuoteReplyDefault(storage);
    try {
      await vi.waitFor(() => expect(storage.sync.set).toHaveBeenCalledOnce());
      expect(storage.local.state).toEqual({});
      expect(storage.local.set).not.toHaveBeenCalled();
    } finally {
      finishWrite();
      await migration;
    }
    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(false);
    expect(storage.local.state[StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]).toBe(true);
  });

  it('allows an old backup to restore true after migration without exporting the device marker', async () => {
    const storage = device();
    await migrateGeminiQuoteReplyDefault(storage);
    // Drive and manual restore share this allowlist and restore path.
    const oldBackup = {
      [StorageKeys.QUOTE_REPLY_ENABLED]: true,
      [StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]: true,
    };
    expect(filterBackupableSyncSettings(oldBackup)).toEqual({
      [StorageKeys.QUOTE_REPLY_ENABLED]: true,
    });
    await restoreBackupableSyncSettings(oldBackup, {
      get: chrome.storage.sync.get,
      set: storage.sync.set,
    });
    await migrateGeminiQuoteReplyDefault(storage);

    expect(storage.sync.state[StorageKeys.QUOTE_REPLY_ENABLED]).toBe(true);
    expect(storage.local.state[StorageKeys.QUOTE_REPLY_DEFAULT_OFF_MIGRATED]).toBe(true);
  });
});
