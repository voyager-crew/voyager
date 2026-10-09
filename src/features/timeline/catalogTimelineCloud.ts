/**
 * The page and popup side of catalog timeline sync: each catalog site's outlines and stars. The
 * background reads, merges and uploads the local data; a pull returns the cloud copies, which the
 * caller merges in: outlines through the background's single outline writer, which orders them
 * with every page edit, and stars through the background star store.
 */
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';

import {
  CATALOG_TIMELINE_PULL_MESSAGE,
  CATALOG_TIMELINE_PUSH_MESSAGE,
  type CatalogTimelineBuckets,
} from './catalogHierarchySync';
import { restoreCatalogTimelineBuckets } from './catalogOutlineMessages';

type SendMessage = (message: { type: string; payload?: unknown }) => Promise<unknown>;

type CatalogTimelineResponse =
  | {
      ok?: boolean;
      error?: string;
      buckets?: CatalogTimelineBuckets;
      stars?: Record<string, unknown>;
    }
  | null
  | undefined;

/** A pull's cloud copies: outline buckets by storage key, star files by site. */
export interface PulledCatalogTimeline {
  outlines: CatalogTimelineBuckets;
  stars: Record<string, unknown>;
}

function assertOk(response: CatalogTimelineResponse): void {
  // No response at all means nothing handled the message; there is nothing to report.
  if (response && response.ok === false) {
    throw new Error(response.error || 'Timeline outline sync failed');
  }
}

function records<T>(value: Record<string, T> | undefined): Record<string, T> {
  return value && typeof value === 'object' ? value : {};
}

/**
 * Uploads the local catalog outlines and syncs the catalog star files this sender may sync;
 * throws when either failed. `stars: false` skips the stars a Gemini sync has just synced.
 */
export async function pushCatalogTimeline(
  send: SendMessage,
  { interactive = true, stars = true }: { interactive?: boolean; stars?: boolean } = {},
): Promise<void> {
  assertOk(
    (await send({
      type: CATALOG_TIMELINE_PUSH_MESSAGE,
      payload: { interactive, stars },
    })) as CatalogTimelineResponse,
  );
}

/** The cloud catalog outlines and stars this sender may restore, or null when there are none. */
export async function pullCatalogTimeline(
  send: SendMessage,
  interactive = true,
): Promise<PulledCatalogTimeline | null> {
  const response = (await send({
    type: CATALOG_TIMELINE_PULL_MESSAGE,
    payload: { interactive },
  })) as CatalogTimelineResponse;
  assertOk(response);
  const outlines = records(response?.buckets);
  const stars = records(response?.stars);
  return Object.keys(outlines).length > 0 || Object.keys(stars).length > 0
    ? { outlines, stars }
    : null;
}

/**
 * Merges pulled outlines and stars into local storage; true when anything was restored. Always a
 * merge, even for an overwrite restore: they span sites and accounts this restore did not choose.
 */
export async function restorePulledCatalogTimeline(
  send: SendMessage,
  pulled: PulledCatalogTimeline,
): Promise<boolean> {
  const { restored, failed } = await restoreCatalogTimelineBuckets(send, pulled.outlines);
  let merged = false;
  for (const payload of Object.values(pulled.stars)) {
    // A catalog star file has no account scope; its stars carry their own account annotation.
    const { status } = await StarredMessagesService.mergeSync({ v2: payload }, null);
    if (status === 'merged') merged = true;
  }
  if (failed > 0) throw new Error('Could not restore timeline outlines');
  return restored > 0 || merged;
}
