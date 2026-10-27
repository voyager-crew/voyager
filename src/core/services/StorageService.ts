/**
 * Centralized storage service
 * Typed wrapper over chrome.storage
 * Implements Repository pattern with type safety
 */
import { ErrorCode, StorageError } from '../errors/AppError';
import type { Result, StorageKey } from '../types/common';
import {
  hasValidExtensionContext,
  isExtensionContextInvalidatedError,
} from '../utils/extensionContext';
import { logger } from './LoggerService';

export interface IStorageService {
  get<T>(key: StorageKey): Promise<Result<T>>;
  set<T>(key: StorageKey, value: T): Promise<Result<void>>;
  remove(key: StorageKey): Promise<Result<void>>;
  clear(): Promise<Result<void>>;
}

/**
 * Base Chrome Storage implementation (DRY: shared logic)
 */
abstract class BaseChromeStorageService implements IStorageService {
  protected abstract readonly storageArea: chrome.storage.StorageArea;
  protected abstract readonly loggerName: string;

  protected get logger(): ReturnType<typeof logger.createChild> {
    // Lazy getter to avoid abstract property access in constructor
    return logger.createChild(this.loggerName);
  }

  private isContextInvalidated(error: unknown): boolean {
    return isExtensionContextInvalidatedError(error) || !hasValidExtensionContext();
  }

  async get<T>(key: StorageKey): Promise<Result<T>> {
    try {
      this.logger.debug(`Reading key: ${key}`);

      const result = await new Promise<Record<string, T>>((resolve, reject) => {
        this.storageArea.get([key], (items) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(items as Record<string, T>);
        });
      });

      const value = result[key];

      if (value === undefined) {
        this.logger.debug(`Key not found: ${key}`);
        return {
          success: false,
          error: new StorageError(ErrorCode.STORAGE_READ_FAILED, `Key not found: ${key}`, { key }),
        };
      }

      this.logger.debug(`Successfully read key: ${key}`);
      return { success: true, data: value };
    } catch (error) {
      if (this.isContextInvalidated(error)) {
        this.logger.debug(`Extension context invalidated while reading key: ${key}`);
        return {
          success: false,
          error: new StorageError(
            ErrorCode.STORAGE_READ_FAILED,
            `Extension context invalidated while reading key: ${key}`,
            { key },
            error instanceof Error ? error : undefined,
          ),
        };
      }
      this.logger.error(`Failed to read key: ${key}`, { error });
      return {
        success: false,
        error: new StorageError(
          ErrorCode.STORAGE_READ_FAILED,
          `Failed to read key: ${key}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  async set<T>(key: StorageKey, value: T): Promise<Result<void>> {
    try {
      this.logger.debug(`Writing key: ${key}`);

      await new Promise<void>((resolve, reject) => {
        this.storageArea.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      this.logger.debug(`Successfully wrote key: ${key}`);
      return { success: true, data: undefined };
    } catch (error) {
      if (this.isContextInvalidated(error)) {
        this.logger.debug(`Extension context invalidated while writing key: ${key}`);
        return {
          success: false,
          error: new StorageError(
            ErrorCode.STORAGE_WRITE_FAILED,
            `Extension context invalidated while writing key: ${key}`,
            { key, value },
            error instanceof Error ? error : undefined,
          ),
        };
      }
      this.logger.error(`Failed to write key: ${key}`, { error });
      return {
        success: false,
        error: new StorageError(
          ErrorCode.STORAGE_WRITE_FAILED,
          `Failed to write key: ${key}`,
          { key, value },
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  async remove(key: StorageKey): Promise<Result<void>> {
    try {
      this.logger.debug(`Removing key: ${key}`);

      await new Promise<void>((resolve, reject) => {
        this.storageArea.remove(key, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      this.logger.debug(`Successfully removed key: ${key}`);
      return { success: true, data: undefined };
    } catch (error) {
      if (this.isContextInvalidated(error)) {
        this.logger.debug(`Extension context invalidated while removing key: ${key}`);
        return {
          success: false,
          error: new StorageError(
            ErrorCode.STORAGE_WRITE_FAILED,
            `Extension context invalidated while removing key: ${key}`,
            { key },
            error instanceof Error ? error : undefined,
          ),
        };
      }
      this.logger.error(`Failed to remove key: ${key}`, { error });
      return {
        success: false,
        error: new StorageError(
          ErrorCode.STORAGE_WRITE_FAILED,
          `Failed to remove key: ${key}`,
          { key },
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }

  async clear(): Promise<Result<void>> {
    try {
      this.logger.debug('Clearing all storage');

      await new Promise<void>((resolve, reject) => {
        this.storageArea.clear(() => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      this.logger.debug('Successfully cleared storage');
      return { success: true, data: undefined };
    } catch (error) {
      if (this.isContextInvalidated(error)) {
        this.logger.debug('Extension context invalidated while clearing storage');
        return {
          success: false,
          error: new StorageError(
            ErrorCode.STORAGE_WRITE_FAILED,
            'Extension context invalidated while clearing storage',
            {},
            error instanceof Error ? error : undefined,
          ),
        };
      }
      this.logger.error('Failed to clear storage', { error });
      return {
        success: false,
        error: new StorageError(
          ErrorCode.STORAGE_WRITE_FAILED,
          'Failed to clear storage',
          {},
          error instanceof Error ? error : undefined,
        ),
      };
    }
  }
}

/**
 * Chrome Storage Sync implementation (100KB quota, cross-device sync)
 * Use for small settings and preferences
 */
export class ChromeStorageService extends BaseChromeStorageService {
  protected readonly storageArea = chrome.storage.sync;
  protected readonly loggerName = 'ChromeStorage';
}

/**
 * Chrome Storage Local implementation (5-10MB quota, local only)
 * Use for large data like prompts
 */
export class ChromeLocalStorageService extends BaseChromeStorageService {
  protected readonly storageArea = chrome.storage.local;
  protected readonly loggerName = 'ChromeLocalStorage';
}

/**
 * Storage type selection
 */
export type StorageType = 'sync' | 'local';

/**
 * Storage factory - picks the chrome.storage area for the requested type
 */
export class StorageFactory {
  /**
   * Create a storage service instance
   * @param type - 'sync' for chrome.storage.sync (100KB, cross-device), 'local' for chrome.storage.local (5-10MB, local only)
   */
  static create(type: StorageType = 'sync'): IStorageService {
    return type === 'local' ? new ChromeLocalStorageService() : new ChromeStorageService();
  }
}

// Export singleton instances
export const storageService = StorageFactory.create('sync'); // For folders (small data, cross-device sync)
export const promptStorageService = StorageFactory.create('local'); // For prompts (large data, local only)
