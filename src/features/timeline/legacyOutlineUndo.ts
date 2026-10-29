import { isUndoneCloudSyncValue } from '@/core/services/CloudSyncUndoMarkers';
import { logger } from '@/core/services/LoggerService';

import type { TimelineHierarchyConversationData } from './hierarchyTypes';
import { safeLocalStorageGet } from './timelineLocalStorage';

/** Keep original legacy sources, but retire mirrors whose applied projection was undone. */
export async function guardLegacyTimelineOutline(options: {
  storageKeys: readonly string[];
  conversationId: string;
  legacy: TimelineHierarchyConversationData | null;
  levelsKey: string | null;
  collapsedKey: string | null;
  current(): boolean;
}): Promise<TimelineHierarchyConversationData | null> {
  const { legacy } = options;
  if (!legacy) return null;
  const copies = [options.levelsKey, options.collapsedKey].flatMap((key) =>
    key ? [{ key, raw: safeLocalStorageGet(key) }] : [],
  );
  const undone = await Promise.all(
    options.storageKeys.map((key) =>
      isUndoneCloudSyncValue({
        area: 'local',
        key,
        value: { levels: legacy.levels, collapsed: legacy.collapsed },
        projection: `timeline:${options.conversationId}`,
      }),
    ),
  );
  if (!options.current()) return null;
  // A different legacy edit made while marker storage waited remains its owner's data.
  if (copies.some(({ key, raw }) => safeLocalStorageGet(key) !== raw)) return null;
  if (!undone.some(Boolean)) return legacy;
  for (const { key, raw } of copies) {
    if (raw === null || safeLocalStorageGet(key) !== raw) continue;
    try {
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn('Could not remove an undone timeline mirror', { key, error: String(error) });
    }
  }
  return null;
}
