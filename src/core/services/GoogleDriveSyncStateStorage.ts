/** Persistence for the existing sync state keys, shared by all transfer kinds. */
import type { SyncState, SyncMode } from '@/core/types/sync';
import {
  FOLDER_PLATFORMS,
  FOLDER_PLATFORM_IDS,
  type SyncTimeField,
} from '@/features/folder/platforms';

import { isSafariRuntime } from './GoogleDriveAuth';

/** Every platform's transfer times with their persisted keys, in registry order. */
const SYNC_TIME_STORAGE = FOLDER_PLATFORM_IDS.flatMap((platform) => {
  const definition = FOLDER_PLATFORMS[platform];
  return [
    { field: definition.lastSyncTimeField, storageKey: definition.lastSyncTimeStorageKey },
    { field: definition.lastUploadTimeField, storageKey: definition.lastUploadTimeStorageKey },
  ] satisfies { field: SyncTimeField; storageKey: string }[];
});

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function loadPersistedSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get([
    'gvSyncMode',
    'gvSyncProvider',
    ...SYNC_TIME_STORAGE.map(({ storageKey }) => storageKey),
    'gvSyncError',
  ]);
  const times = Object.fromEntries(
    SYNC_TIME_STORAGE.map(({ field, storageKey }) => [field, getNumberValue(result[storageKey])]),
  ) as Record<SyncTimeField, number | null>;
  const state: SyncState = {
    provider: result.gvSyncProvider === 'icloud' && isSafariRuntime() ? 'icloud' : 'googleDrive',
    mode: (result.gvSyncMode as SyncMode) || 'disabled',
    ...times,
    error: getStringValue(result.gvSyncError),
    isSyncing: false,
    isAuthenticated: false,
  };
  return state;
}

export async function savePersistedSyncState(state: SyncState): Promise<void> {
  await chrome.storage.local.set({
    gvSyncMode: state.mode,
    gvSyncProvider: state.provider,
    ...Object.fromEntries(
      SYNC_TIME_STORAGE.map(({ field, storageKey }) => [storageKey, state[field]]),
    ),
    gvSyncError: state.error,
  });
}
