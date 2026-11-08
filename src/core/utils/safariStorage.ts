import browser from 'webextension-polyfill';

/**
 * Safari-specific storage adapter
 * Uses browser.storage.local for reliable persistence on Safari
 *
 * Why Safari needs this:
 * - Safari's localStorage has 7-day deletion policy
 * - Random data loss on iOS 13+
 * - Private mode quota exceeded errors
 *
 * Solution:
 * - Use browser.storage.local (persistent; quota depends on Safari version and permissions)
 * - Writes fall back to localStorage if the storage API fails; reads reject instead
 */
import { logger } from '@/core/services/LoggerService';

/** Optional authorization immediately around a physical storage call. */
export type PhysicalStorageWriter = <T>(operation: () => T | Promise<T>) => Promise<T>;

async function attemptWrite(
  operation: () => void | Promise<void>,
  write?: PhysicalStorageWriter,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const attempt = async () => {
    try {
      await operation();
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error } as const;
    }
  };
  // Catch boundary failures inside the callback: authorization refusals must never fall back.
  return write ? write(attempt) : attempt();
}

interface SafariStorageAdapter {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Safari storage adapter using browser.storage.local
 * Provides async methods that replace localStorage for Safari
 */
export class SafariStorage implements SafariStorageAdapter {
  /**
   * Get item from browser.storage.local
   */
  async getItem(key: string): Promise<unknown> {
    try {
      const result = await browser.storage.local.get(key);
      return result[key] ?? null;
    } catch (error) {
      console.error('[SafariStorage] Failed to get item:', key, error);
      // No page fallback: a stale or empty page copy would read as the stored value
      // or as an absent key, and callers decide what to write from that.
      throw error;
    }
  }

  /**
   * Set item to browser.storage.local
   */
  async setItem(key: string, value: unknown, write?: PhysicalStorageWriter): Promise<void> {
    const result = await attemptWrite(() => browser.storage.local.set({ [key]: value }), write);
    if (result.ok) return;
    console.error('[SafariStorage] Failed to set item:', key, result.error);
    const fallback = await attemptWrite(() => {
      const fallbackValue = typeof value === 'string' ? value : JSON.stringify(value);
      if (fallbackValue === undefined) throw result.error;
      localStorage.setItem(key, fallbackValue);
    }, write);
    if (!fallback.ok) {
      console.error('[SafariStorage] Fallback to localStorage also failed:', fallback.error);
      throw result.error;
    }
  }

  /** Remove an item, retaining the existing page fallback for ordinary storage failures. */
  async removeItem(key: string, write?: PhysicalStorageWriter): Promise<void> {
    const result = await attemptWrite(() => browser.storage.local.remove(key), write);
    if (result.ok) return;
    console.error('[SafariStorage] Failed to remove item:', key, result.error);
    await attemptWrite(() => localStorage.removeItem(key), write);
  }

  /**
   * Migrate data from localStorage to browser.storage.local
   * Should be called once during initialization
   */
  async migrateFromLocalStorage(key: string, write?: PhysicalStorageWriter): Promise<boolean> {
    let writeRefused = false;
    const authorize: PhysicalStorageWriter | undefined =
      write &&
      (async (operation) => {
        try {
          return await write(operation);
        } catch (error) {
          writeRefused = true;
          throw error;
        }
      });
    try {
      // Check if already migrated
      const migrationKey = `${key}_migrated`;
      const alreadyMigrated = await this.getItem(migrationKey);
      if (alreadyMigrated === 'true') {
        return true;
      }

      // Extension storage is authoritative: data already there needs nothing from the page,
      // whose storage may be unreadable. The flag only saves this check next time.
      const browserData = await browser.storage.local.get(key);
      if (browserData[key]) {
        try {
          await this.setItem(migrationKey, 'true', authorize);
        } catch (error) {
          if (writeRefused) throw error;
        }
        return true;
      }

      // Check if there's data in localStorage
      const localData = localStorage.getItem(key);
      if (!localData) {
        // No data to migrate, mark as migrated
        await this.setItem(migrationKey, 'true', authorize);
        return true;
      }

      // Migrate data. No page fallback: a copy that only reaches localStorage is no migration.
      const migrated = await attemptWrite(
        () => browser.storage.local.set({ [key]: localData }),
        authorize,
      );
      if (!migrated.ok) throw migrated.error;
      await this.setItem(migrationKey, 'true', authorize);

      logger.info('[SafariStorage] Migrated a key from localStorage to browser.storage.local', {
        key,
      });
      return true;
    } catch (error) {
      if (writeRefused) throw error;
      console.error('[SafariStorage] Migration failed:', error);
      return false;
    }
  }
}

/**
 * Singleton instance
 */
export const safariStorage = new SafariStorage();
