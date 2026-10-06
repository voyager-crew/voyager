/**
 * The runtime message that has the background, the single writer of catalog outlines, save a page
 * edit or merge in cloud buckets. Pages still read outlines from storage themselves and refresh on
 * its change events. A worker restart drops a queued write: a missed edit, never a wrong one.
 */
import { catalogHierarchySiteOf } from './catalogHierarchySync';
import { type OutlineEdit, parseOutlineEdit } from './outlineEdits';

export const CATALOG_OUTLINE_WRITE_MESSAGE = 'gv.timeline.catalogOutline.write';

export type CatalogOutlineWriteRequest =
  | { kind: 'edit'; key: string; conversationId: string; edit: OutlineEdit }
  /** Cloud buckets by catalog storage key. */
  | { kind: 'restore'; buckets: Record<string, unknown> };

export type CatalogOutlineWriteResponse =
  | { ok: true; restored?: number; failed?: number }
  | { ok: false; error: string };

const MAX_CONVERSATION_ID_LENGTH = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A request whose keys are catalog bucket keys and whose edit belongs to that key's site. */
export function parseCatalogOutlineWriteRequest(
  payload: unknown,
): CatalogOutlineWriteRequest | null {
  if (!isRecord(payload)) return null;
  if (payload.kind === 'restore') {
    const { buckets } = payload;
    if (!isRecord(buckets)) return null;
    if (!Object.keys(buckets).every((key) => catalogHierarchySiteOf(key))) return null;
    return { kind: 'restore', buckets };
  }
  if (payload.kind !== 'edit') return null;
  const { key, conversationId } = payload;
  const site = typeof key === 'string' ? catalogHierarchySiteOf(key) : null;
  if (!site || typeof key !== 'string') return null;
  if (
    typeof conversationId !== 'string' ||
    conversationId.length > MAX_CONVERSATION_ID_LENGTH ||
    !conversationId.startsWith(`${site}:conv:`)
  ) {
    return null;
  }
  const edit = parseOutlineEdit(payload.edit);
  return edit ? { kind: 'edit', key, conversationId, edit } : null;
}

/** Asks the background to save one page edit; true once it is in storage. */
export function requestCatalogOutlineEdit(request: {
  key: string;
  conversationId: string;
  edit: OutlineEdit;
}): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: CATALOG_OUTLINE_WRITE_MESSAGE, payload: { kind: 'edit', ...request } },
        (response?: CatalogOutlineWriteResponse) => {
          resolve(!chrome.runtime.lastError && response?.ok === true);
        },
      );
    } catch {
      // An invalidated extension context saves nothing.
      resolve(false);
    }
  });
}

type SendMessage = (message: { type: string; payload?: unknown }) => Promise<unknown>;

/**
 * Has the background merge every catalog bucket of a pulled cloud copy into local storage; keys of
 * any other kind are ignored. A refused or unanswered request counts every bucket as failed.
 */
export async function restoreCatalogTimelineBuckets(
  send: SendMessage,
  buckets: unknown,
): Promise<{ restored: number; failed: number }> {
  if (!isRecord(buckets)) return { restored: 0, failed: 0 };
  const catalog = Object.fromEntries(
    Object.entries(buckets).filter(([key]) => catalogHierarchySiteOf(key)),
  );
  const count = Object.keys(catalog).length;
  if (count === 0) return { restored: 0, failed: 0 };
  const response = (await send({
    type: CATALOG_OUTLINE_WRITE_MESSAGE,
    payload: { kind: 'restore', buckets: catalog },
  })) as CatalogOutlineWriteResponse | null | undefined;
  if (!response?.ok) return { restored: 0, failed: count };
  return { restored: response.restored ?? 0, failed: response.failed ?? 0 };
}
