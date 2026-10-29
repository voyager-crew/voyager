import { StorageKeys } from '@/core/types/common';
import { HIGHLIGHT_INDEX_KEY_PREFIX, HIGHLIGHT_PLATFORMS } from '@/core/types/highlight';
import { hashValue } from '@/core/utils/canonicalHash';
import { normalizeTimelineHierarchyData } from '@/features/timeline/hierarchyTypes';

import { folderSnapshotProjections } from './cloudSyncFolderProjection';
import type { SnapshotValueHash, StorageWriteKey } from './cloudSyncSnapshotTypes';
import { parseIndex } from './highlightAnnotationData';

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
  const folderProjections = await folderSnapshotProjections(target, content);
  if (folderProjections.length) return { ...target, hash, projections: folderProjections };
  if (target.area === 'local' && target.key.startsWith(HIGHLIGHT_INDEX_KEY_PREFIX)) {
    const index = parseIndex(content, target.key.slice(HIGHLIGHT_INDEX_KEY_PREFIX.length), 0);
    return {
      ...target,
      hash,
      projections: await Promise.all(
        HIGHLIGHT_PLATFORMS.map(async (platform) => ({
          projection: `highlight-clear:${platform}`,
          hash: await hashValue(index.clearMarkers?.[platform]),
        })),
      ),
    };
  }
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
