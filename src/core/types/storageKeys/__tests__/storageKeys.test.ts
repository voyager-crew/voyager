import { describe, expect, expectTypeOf, it } from 'vitest';

import { type StorageKey, StorageKeys } from '@/core/types/common';

import { APP_STORAGE_KEYS } from '../appKeys';
import { APPEARANCE_STORAGE_KEYS } from '../appearanceKeys';
import { COMPOSER_STORAGE_KEYS } from '../composerKeys';
import { CONVERSATION_STORAGE_KEYS } from '../conversationKeys';
import { FOLDER_STORAGE_KEYS } from '../folderKeys';
import { PLUGIN_STORAGE_KEYS } from '../pluginKeys';
import storageKeysBeforeSplit from './storageKeysBeforeSplit.json';

const GROUPS = [
  FOLDER_STORAGE_KEYS,
  CONVERSATION_STORAGE_KEYS,
  APPEARANCE_STORAGE_KEYS,
  COMPOSER_STORAGE_KEYS,
  APP_STORAGE_KEYS,
  PLUGIN_STORAGE_KEYS,
];

describe('StorageKeys', () => {
  it('keeps every group key after the merge, so no spread overwrote another', () => {
    const groupKeyCount = GROUPS.reduce((count, group) => count + Object.keys(group).length, 0);

    expect(Object.keys(StorageKeys)).toHaveLength(193);
    expect(groupKeyCount).toBe(Object.keys(StorageKeys).length);
  });

  it('gives every key its own persisted value', () => {
    const values = Object.values(StorageKeys);

    expect(new Set(values).size).toBe(values.length);
  });

  it('persists every key under the same string as before the domain split', () => {
    // The fixture was generated once from the single-object common.ts; a moved key whose
    // value changed would silently orphan the data users already stored under it.
    expect({ ...StorageKeys }).toEqual(storageKeysBeforeSplit);
  });

  it('types StorageKey as a union of literals rather than string', () => {
    expectTypeOf<StorageKey>().not.toEqualTypeOf<string>();
    expectTypeOf<string>().not.toExtend<StorageKey>();
    expectTypeOf<'gvFolderData'>().toExtend<StorageKey>();
  });
});
