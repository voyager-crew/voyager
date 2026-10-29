/**
 * Folder Storage Adapter
 *
 * Enterprise-grade storage abstraction using Strategy Pattern
 * Provides unified interface for different storage backends
 *
 * Design Patterns:
 * - Strategy Pattern: Different storage implementations (localStorage vs browser.storage)
 * - Factory Pattern: Automatic strategy selection based on browser
 * - Adapter Pattern: Converts different storage APIs to unified interface
 *
 * Benefits:
 * - Single Responsibility: Each adapter handles one storage type
 * - Open/Closed: Easy to add new storage backends without modifying existing code
 * - Dependency Inversion: FolderManager depends on interface, not implementation
 * - Testability: Easy to mock storage in unit tests
 */
import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { isSafari } from '@/core/utils/browser';
import { safariStorage } from '@/core/utils/safariStorage';
import { LegacyFolderWriteRefusedError } from '@/features/folder/owner/legacyFolderFence';

import type { FolderData } from '../types';
import { createFolderWriter, type FolderWriter } from './folderWriter';

/** Persist exact intended canonical items before any folder or derived-copy write. */
export type FolderWriteReceipt = (items: Record<string, unknown>) => Promise<void>;

/**
 * Parses a JSON string bucket. Unparseable text is returned as found, so the
 * caller's validation treats it as corrupt data (backup recovery), not as absent.
 */
function parseStoredFolderData(stored: string): FolderData {
  try {
    return JSON.parse(stored) as FolderData;
  } catch {
    return stored as unknown as FolderData;
  }
}

/** A removed canonical bucket must not be recreated from its undone page mirror. */
async function discardUndonePageCopy(
  key: string,
  stored: string,
  write: FolderWriter,
): Promise<boolean> {
  if (!(await isUndoneCloudSyncValue({ area: 'local', key, value: stored }))) return false;
  await write(key, () => {
    // Hashing crossed an async boundary: a different page copy still belongs to its writer.
    if (localStorage.getItem(key) === stored) localStorage.removeItem(key);
  });
  return true;
}

/**
 * Unified storage interface for folder data
 * All implementations must provide async methods
 */
export interface IFolderStorageAdapter {
  /** Repository-owned authorization at each physical write. */
  setWriteGate?(writer: FolderWriter): void;
  /**
   * Initialize the storage adapter
   * Used for adapter-specific setup like data migration
   * @param key Storage key
   */
  init(key: string): Promise<void>;

  /**
   * Load folder data from storage, as stored: callers validate it.
   * @returns the stored value, or null only when nothing is stored
   * @throws when storage cannot be read. A failed read is not an absent bucket:
   *   treating it as one lets recovery or the next save overwrite real data.
   */
  loadData(key: string): Promise<FolderData | null>;

  /**
   * Save folder data to storage
   * @param key Storage key
   * @param data Folder data to save
   * @param companions Other keys to write in the same storage call. Only adapters
   *   that write them atomically may be handed companions (see AIStudioFolderStorageAdapter).
   * @returns `false` (or a rejection) if the write failed; any other resolution
   *   means it succeeded, so an adapter may return the storage call's own promise.
   */
  saveData(
    key: string,
    data: FolderData,
    companions?: Record<string, unknown>,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean | void>;

  /**
   * Remove folder data from storage
   * @param key Storage key
   */
  removeData(key: string): Promise<void>;

  /**
   * Get storage backend name for debugging
   */
  getBackendName(): string;
}

/**
 * LocalStorage implementation for Chrome/Firefox/Edge
 * Synchronous localStorage API wrapped in async interface for consistency
 */
export class LocalStorageFolderAdapter implements IFolderStorageAdapter {
  private write = createFolderWriter();

  setWriteGate(writer: FolderWriter): void {
    this.write = writer;
  }

  /**
   * Initialize and migrate existing data to chrome.storage.local
   * This enables popup/sync to access folder data
   */
  async init(key: string): Promise<void> {
    try {
      // Check if we need to migrate localStorage data to chrome.storage.local
      const localData = localStorage.getItem(key);
      if (localData) {
        const result = await chrome.storage.local.get(key);
        if (!result[key]) {
          if (await discardUndonePageCopy(key, localData, this.write)) return;
          // Migrate localStorage data to chrome.storage.local
          const data = JSON.parse(localData) as FolderData;
          await this.write(key, () => chrome.storage.local.set({ [key]: data }));
          console.log('[LocalStorageFolderAdapter] Migrated folder data to chrome.storage.local');
        }
      }
    } catch (error) {
      if (error instanceof LegacyFolderWriteRefusedError) throw error;
      console.warn('[LocalStorageFolderAdapter] Migration check failed:', error);
    }
  }

  async loadData(key: string): Promise<FolderData | null> {
    // First check chrome.storage.local (for synced data from popup/download)
    const chromeResult = await chrome.storage.local.get(key);
    if (chromeResult[key]) {
      console.log('[LocalStorageFolderAdapter] Loaded data from chrome.storage.local');
      // Also sync to localStorage for consistency. A full localStorage must not fail the read.
      try {
        await this.write(key, () => localStorage.setItem(key, JSON.stringify(chromeResult[key])));
      } catch (error) {
        if (error instanceof LegacyFolderWriteRefusedError) throw error;
        console.warn('[LocalStorageFolderAdapter] Failed to mirror to localStorage:', error);
      }
      return chromeResult[key] as FolderData;
    }

    // Fallback to localStorage
    const stored = localStorage.getItem(key);
    if (!stored) {
      return null;
    }
    if (await discardUndonePageCopy(key, stored, this.write)) return null;
    return parseStoredFolderData(stored);
  }

  async saveData(
    key: string,
    data: FolderData,
    _companions?: Record<string, unknown>,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean> {
    const items = { [key]: data };
    // A receipt failure must leave even the recoverable page mirror untouched and skip retry.
    if (beforeWrite) await beforeWrite(items);
    try {
      const dataString = JSON.stringify(data);
      await this.write(key, () => localStorage.setItem(key, dataString));

      // Verify the save was successful
      const verification = localStorage.getItem(key);
      if (verification !== dataString) {
        throw new Error('Save verification failed - data mismatch');
      }

      // Also write chrome.storage.local for popup/sync access. Loads read it first,
      // so a save it missed would be rolled back on the next load: report it failed.
      await this.write(key, () => chrome.storage.local.set(items));

      return true;
    } catch (error) {
      if (error instanceof LegacyFolderWriteRefusedError) throw error;
      console.error('[LocalStorageFolderAdapter] Failed to save data:', error);
      return false;
    }
  }

  async removeData(key: string): Promise<void> {
    try {
      await this.write(key, () => localStorage.removeItem(key));
    } catch (error) {
      if (error instanceof LegacyFolderWriteRefusedError) throw error;
      console.error('[LocalStorageFolderAdapter] Failed to remove data:', error);
    }
  }

  getBackendName(): string {
    return 'localStorage';
  }
}

/**
 * BrowserStorage implementation for Safari
 * Uses browser.storage.local for reliable persistence
 *
 * Why Safari needs this:
 * - Safari's localStorage has 7-day deletion policy
 * - Random data loss on iOS 13+
 * - Private mode quota exceeded errors
 * - browser.storage.local is more reliable (persistent; quota depends on Safari and permissions)
 */
export class SafariFolderAdapter implements IFolderStorageAdapter {
  private write = createFolderWriter();

  setWriteGate(writer: FolderWriter): void {
    this.write = writer;
  }

  /** Keys whose localStorage migration completed in this context. */
  private readonly migrated = new Set<string>();

  /**
   * Initialize Safari adapter with data migration
   * Migrates data from localStorage to browser.storage.local (one-time)
   */
  async init(key: string): Promise<void> {
    await this.migrateFromLocalStorage(key);
  }

  async loadData(key: string): Promise<FolderData | null> {
    // Before migration completes, the only copy may still be in localStorage: an empty
    // browser.storage answer would read as absent. Reject so the read is retried instead.
    if (!this.migrated.has(key) && !(await this.migrateFromLocalStorage(key))) {
      throw new Error('Folder data migration from localStorage did not complete');
    }
    const stored = await safariStorage.getItem(key);
    if (!stored) {
      return null;
    }
    // Older Safari builds stored JSON strings; cloud sync writes the same
    // structured object shape used by the other browsers.
    return typeof stored === 'string' ? parseStoredFolderData(stored) : (stored as FolderData);
  }

  async saveData(
    key: string,
    data: FolderData,
    _companions?: Record<string, unknown>,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<boolean> {
    // Keep receipt errors outside the save/fallback result: they admit no physical write or retry.
    if (beforeWrite) await beforeWrite({ [key]: data });
    try {
      await safariStorage.setItem(key, data, (operation) => this.write(key, operation));

      // Verify the save was successful for robustness
      const verification = await safariStorage.getItem(key);
      const verifiedData =
        typeof verification === 'string' ? (JSON.parse(verification) as FolderData) : verification;
      if (JSON.stringify(verifiedData) !== JSON.stringify(data)) {
        throw new Error('Save verification failed - data mismatch');
      }

      return true;
    } catch (error) {
      if (error instanceof LegacyFolderWriteRefusedError) throw error;
      console.error('[SafariFolderAdapter] Failed to save data:', error);
      return false;
    }
  }

  async removeData(key: string): Promise<void> {
    try {
      await safariStorage.removeItem(key, (operation) => this.write(key, operation));
    } catch (error) {
      if (error instanceof LegacyFolderWriteRefusedError) throw error;
      console.error('[SafariFolderAdapter] Failed to remove data:', error);
    }
  }

  getBackendName(): string {
    return 'browser.storage.local (Safari)';
  }

  /**
   * Migrate data from localStorage to browser.storage.local
   * Should be called once during initialization
   */
  async migrateFromLocalStorage(key: string): Promise<boolean> {
    try {
      // Check at the owning adapter before Safari's generic migration can copy a legacy mirror.
      // Existing canonical data stays authoritative even when page storage is unreadable.
      if (!(await safariStorage.getItem(key))) {
        const pageCopy = localStorage.getItem(key);
        if (pageCopy && (await discardUndonePageCopy(key, pageCopy, this.write))) return true;
      }
      const migrated = await safariStorage.migrateFromLocalStorage(key, (operation) =>
        this.write(key, operation),
      );
      if (migrated) this.migrated.add(key);
      return migrated;
    } catch (error) {
      if (error instanceof LegacyFolderWriteRefusedError) throw error;
      console.error('[SafariFolderAdapter] Migration failed:', error);
      return false;
    }
  }
}

/**
 * Factory function to create appropriate storage adapter
 * Automatically selects based on browser detection
 *
 * Strategy Selection:
 * - Safari → SafariFolderAdapter (browser.storage.local)
 * - Others → LocalStorageFolderAdapter (localStorage)
 *
 * @returns Storage adapter instance
 */
export function createFolderStorageAdapter(): IFolderStorageAdapter {
  if (isSafari()) {
    console.log('[FolderStorage] Using SafariFolderAdapter (browser.storage.local)');
    return new SafariFolderAdapter();
  }

  console.log('[FolderStorage] Using LocalStorageFolderAdapter (localStorage)');
  return new LocalStorageFolderAdapter();
}
