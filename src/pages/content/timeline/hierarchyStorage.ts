import {
  buildScopedStorageKey,
  extractRouteUserIdFromUrl,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import {
  type TimelineHierarchyData,
  normalizeTimelineHierarchyData,
} from '@/features/timeline/hierarchyTypes';

export function getTimelineHierarchyStorageKey(accountKey?: string | null): string {
  return accountKey
    ? buildScopedStorageKey(StorageKeys.TIMELINE_HIERARCHY, accountKey)
    : StorageKeys.TIMELINE_HIERARCHY;
}

export function getTimelineHierarchyStorageKeysToRead(accountKey?: string | null): string[] {
  const primaryKey = getTimelineHierarchyStorageKey(accountKey);
  return primaryKey === StorageKeys.TIMELINE_HIERARCHY
    ? [primaryKey]
    : [primaryKey, StorageKeys.TIMELINE_HIERARCHY];
}

export function filterTimelineHierarchyByRouteScope(
  data: TimelineHierarchyData,
  routeUserId: string | null | undefined,
): TimelineHierarchyData {
  if (!routeUserId) return data;

  const conversations = Object.fromEntries(
    Object.entries(data.conversations).filter(([, conversation]) => {
      const conversationRouteUserId = extractRouteUserIdFromUrl(conversation.conversationUrl);
      return conversationRouteUserId === null || conversationRouteUserId === routeUserId;
    }),
  );

  return { conversations };
}

export function resolveTimelineHierarchyDataForStorageScope(
  values: Record<string, unknown>,
  accountKey?: string | null,
  routeUserId?: string | null,
): TimelineHierarchyData {
  const primaryKey = getTimelineHierarchyStorageKey(accountKey);
  const primaryValue = values[primaryKey];

  if (
    primaryKey === StorageKeys.TIMELINE_HIERARCHY ||
    Object.prototype.hasOwnProperty.call(values, primaryKey)
  ) {
    return normalizeTimelineHierarchyData(primaryValue);
  }

  const legacyData = normalizeTimelineHierarchyData(values[StorageKeys.TIMELINE_HIERARCHY]);
  return filterTimelineHierarchyByRouteScope(legacyData, routeUserId);
}
