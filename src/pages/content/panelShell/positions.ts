/**
 * Where the user left the panel, per site, in `gvPanelPositions`
 * (chrome.storage.local: device-local, never backed up or synced).
 *
 * Format: `{ [site]: { x, y } }`, the panel's top-left corner in CSS pixels,
 * keyed by the site adapter id (`gemini`, `claude`, …) or, on a custom
 * website, its host. A missing entry means centered.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

export interface PanelPoint {
  readonly x: number;
  readonly y: number;
}

type PanelPositions = Record<string, PanelPoint>;

function isPoint(value: unknown): value is PanelPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

/** Keeps the valid entries of a stored value from any version; anything else reads as empty. */
export function parsePanelPositions(value: unknown): PanelPositions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const positions: PanelPositions = {};
  for (const [site, point] of Object.entries(value)) {
    if (isPoint(point)) positions[site] = { x: point.x, y: point.y };
  }
  return positions;
}

async function readAll(): Promise<PanelPositions> {
  const stored = await chrome.storage.local.get(StorageKeys.PANEL_POSITIONS);
  return parsePanelPositions(stored?.[StorageKeys.PANEL_POSITIONS]);
}

function warnUnlessInvalidated(error: unknown): void {
  if (!isExtensionContextInvalidatedError(error)) {
    logger.warn('Panel position storage failed', { error });
  }
}

export async function readPanelPosition(site: string): Promise<PanelPoint | null> {
  try {
    return (await readAll())[site] ?? null;
  } catch (error) {
    warnUnlessInvalidated(error);
    return null;
  }
}

/** Saves `point` for `site`, or forgets it (centered) with null; other sites are kept. */
export async function writePanelPosition(site: string, point: PanelPoint | null): Promise<void> {
  try {
    const positions = await readAll();
    if (point) positions[site] = { x: Math.round(point.x), y: Math.round(point.y) };
    else if (site in positions) delete positions[site];
    else return;
    await chrome.storage.local.set({ [StorageKeys.PANEL_POSITIONS]: positions });
  } catch (error) {
    warnUnlessInvalidated(error);
  }
}
