/**
 * StorageService unit tests
 * Demonstrates testing best practices for the refactored code
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '../../types/common';
import { ChromeStorageService } from '../StorageService';

describe('ChromeStorageService', () => {
  let service: ChromeStorageService;
  let originalRuntimeId: string | undefined;

  const setRuntimeId = (id: string | undefined): void => {
    Object.defineProperty(chrome.runtime, 'id', {
      value: id,
      configurable: true,
    });
  };

  beforeEach(() => {
    service = new ChromeStorageService();
    originalRuntimeId = chrome.runtime.id;
    vi.clearAllMocks();
  });

  afterEach(() => {
    setRuntimeId(originalRuntimeId);
  });

  it('returns context-invalidated error details when runtime context is gone', async () => {
    const getSpy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });

    const result = await service.get(StorageKeys.PROMPT_ITEMS);

    expect(getSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Extension context invalidated');
    }
  });

  it('treats generic storage failures as context-invalidated when runtime id is missing', async () => {
    setRuntimeId(undefined);
    const getSpy = vi.spyOn(chrome.storage.sync, 'get').mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'get')");
    });

    const result = await service.get(StorageKeys.PROMPT_ITEMS);

    expect(getSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Extension context invalidated');
    }
  });
});
