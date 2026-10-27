// Where the user dragged the persistent export toolbar, one spot per site,
// kept in local storage under `StorageKeys.PERSISTENT_EXPORT_TOOLBAR_POSITION`:
// `{ [siteId]: { right, top } }`, px from the viewport's right edge and top.
// Local, not sync: a spot belongs to this device's screen. A site without an
// entry uses the default top-right dock.
import { StorageKeys } from '@/core/types/common';

import type { ToolbarSpot } from './toolbarAvoidance';

type SpotsBySite = Record<string, ToolbarSpot>;

const KEY = StorageKeys.PERSISTENT_EXPORT_TOOLBAR_POSITION;

function isToolbarSpot(value: unknown): value is ToolbarSpot {
  if (typeof value !== 'object' || value === null) return false;
  const { right, top } = value as Record<string, unknown>;
  return (
    typeof right === 'number' &&
    Number.isFinite(right) &&
    typeof top === 'number' &&
    Number.isFinite(top)
  );
}

function readSpots(): Promise<SpotsBySite> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([KEY], (items) => {
        const stored = items?.[KEY];
        const valid = typeof stored === 'object' && stored !== null && !Array.isArray(stored);
        resolve(valid ? (stored as SpotsBySite) : {});
      });
    } catch {
      resolve({});
    }
  });
}

/** The spot saved for `siteId`; null when there is none or it cannot be read. */
export async function readToolbarSpot(siteId: string): Promise<ToolbarSpot | null> {
  const spot = (await readSpots())[siteId];
  return isToolbarSpot(spot) ? { right: spot.right, top: spot.top } : null;
}

// Each write reads what the previous one stored: two quick drops (away, then
// back onto the dock) otherwise raced, and the older spot could land last.
let writes: Promise<void> = Promise.resolve();

/** Saves `siteId`'s spot, or forgets it for null; other sites' spots are kept. Never rejects. */
export function writeToolbarSpot(siteId: string, spot: ToolbarSpot | null): Promise<void> {
  writes = writes.then(async () => {
    try {
      const spots = { ...(await readSpots()) };
      if (spot) spots[siteId] = { right: Math.round(spot.right), top: Math.round(spot.top) };
      else if (siteId in spots) delete spots[siteId];
      else return;
      await chrome.storage.local.set({ [KEY]: spots });
    } catch {
      // The toolbar keeps its spot for this page; it just will not be restored.
    }
  });
  return writes;
}
