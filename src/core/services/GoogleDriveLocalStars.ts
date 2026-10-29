import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { normalizeStarredMessages } from '@/features/savedLibrary/starData';
import { mergeStarState, normalizeStarTombstones } from '@/features/savedLibrary/starSyncData';
import { filterStarStateByScope } from '@/features/savedLibrary/starSyncPayload';

/** Discovery/status must not trigger the star owner's lazy migration writes. */
export async function readLocalSyncStars(
  scope: SyncAccountScope | null = null,
  captured?: Record<string, unknown>,
) {
  const values =
    captured ??
    (await chrome.storage.local.get<Record<string, unknown>>([
      StorageKeys.SAVED_LIBRARY_STARS,
      StorageKeys.TIMELINE_STARRED_MESSAGES,
      StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES,
    ]));
  return filterStarStateByScope(
    mergeStarState(
      [
        normalizeStarredMessages(values[StorageKeys.SAVED_LIBRARY_STARS]),
        normalizeStarredMessages(values[StorageKeys.TIMELINE_STARRED_MESSAGES]),
      ],
      normalizeStarTombstones(values[StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES]),
      Date.now(),
    ),
    scope,
  );
}
