/**
 * The page and popup side of catalog outline sync. The background reads, merges and uploads the
 * local buckets; a pull returns the cloud buckets, which the caller merges in through
 * `restoreCatalogTimelineBuckets` so its own page's outline queue orders the writes.
 */
import {
  CATALOG_TIMELINE_PULL_MESSAGE,
  CATALOG_TIMELINE_PUSH_MESSAGE,
  type CatalogTimelineBuckets,
} from './catalogHierarchySync';
import { restoreCatalogTimelineBuckets } from './restoreHierarchyBucket';

type SendMessage = (message: { type: string; payload?: unknown }) => Promise<unknown>;

type CatalogTimelineResponse =
  | { ok?: boolean; error?: string; buckets?: CatalogTimelineBuckets }
  | null
  | undefined;

function assertOk(response: CatalogTimelineResponse): void {
  // No response at all means nothing handled the message; there is nothing to report.
  if (response && response.ok === false) {
    throw new Error(response.error || 'Timeline outline sync failed');
  }
}

/** Uploads the local catalog outlines this sender may sync; throws when the upload failed. */
export async function pushCatalogTimeline(send: SendMessage, interactive = true): Promise<void> {
  assertOk(
    (await send({
      type: CATALOG_TIMELINE_PUSH_MESSAGE,
      payload: { interactive },
    })) as CatalogTimelineResponse,
  );
}

/** The cloud catalog outlines this sender may restore, or null when there are none. */
export async function pullCatalogTimeline(
  send: SendMessage,
  interactive = true,
): Promise<CatalogTimelineBuckets | null> {
  const response = (await send({
    type: CATALOG_TIMELINE_PULL_MESSAGE,
    payload: { interactive },
  })) as CatalogTimelineResponse;
  assertOk(response);
  const buckets = response?.buckets;
  return buckets && typeof buckets === 'object' && Object.keys(buckets).length > 0 ? buckets : null;
}

/**
 * Merges pulled outlines into local storage; true when any bucket was restored. Always a merge,
 * even for an overwrite restore: the buckets span sites and accounts this restore did not choose.
 */
export async function restorePulledCatalogTimeline(
  buckets: CatalogTimelineBuckets,
): Promise<boolean> {
  const { restored, failed } = await restoreCatalogTimelineBuckets(buckets);
  if (failed > 0) throw new Error('Could not restore timeline outlines');
  return restored > 0;
}
