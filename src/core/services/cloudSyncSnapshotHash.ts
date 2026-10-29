import { StorageKeys } from '@/core/types/common';
import { hashValue } from '@/core/utils/canonicalHash';
import { normalizeTimelineHierarchyData } from '@/features/timeline/hierarchyTypes';

import type { SnapshotValueHash, StorageWriteKey } from './cloudSyncSnapshotTypes';

/** Folder mirrors may serialize the same content that extension storage keeps as an object. */
export function cloudSyncContent(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? parsed : value;
  } catch {
    return value;
  }
}

export function hashCloudSyncContent(value: unknown): Promise<string> {
  return hashValue(cloudSyncContent(value));
}

/** Hash-only projections protect legacy per-conversation hierarchy mirrors as well. */
export async function hashSnapshotValue(
  target: StorageWriteKey,
  value: unknown,
): Promise<SnapshotValueHash> {
  const content = cloudSyncContent(value);
  const hash = await hashValue(content);
  if (
    target.area !== 'local' ||
    !(
      target.key === StorageKeys.TIMELINE_HIERARCHY ||
      target.key.startsWith(`${StorageKeys.TIMELINE_HIERARCHY}:acct:`)
    )
  )
    return { ...target, hash };
  const hierarchy = normalizeTimelineHierarchyData(content);
  const projections = await Promise.all(
    Object.entries(hierarchy.conversations).map(async ([id, entry]) => ({
      projection: `timeline:${id}`,
      hash: await hashValue({ levels: entry.levels, collapsed: entry.collapsed }),
    })),
  );
  return { ...target, hash, projections };
}
