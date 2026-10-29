import {
  PANEL_PAGE_PATH,
  PANEL_TOKEN_QUERY_PARAM,
  type PanelContext,
  type PanelSession,
  type PanelToken,
  isPanelRecord,
  isPanelToken,
  panelHostOrigin,
  parsePanelContext,
  parsePanelSession,
} from '@/features/panel/protocol';

// Like the bridge's session keys, these are not sync/local personalization settings.
export const PANEL_STATE_SESSION_KEY = 'gvPanelState';

export interface PanelTokenRecord {
  token: PanelToken;
  tabId: number;
  context: PanelContext;
  issuedAt: number;
  hostDocumentId: string | null;
}
export interface PanelFrameRecord extends PanelSession {
  tabId: number;
  frameId: number;
  documentId: string | null;
  hostDocumentId: string | null;
}
export interface PanelState {
  tokens: PanelTokenRecord[];
  frames: PanelFrameRecord[];
}

export function isPanelTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Existing handoff code documents Firefox >=115 and Safari >=16.4 session support.
 * Fail closed on older runtimes: an in-memory fallback would forget consumed tokens on restart.
 */
export function panelSessionArea(): chrome.storage.StorageArea | null {
  return chrome.storage.session ?? null;
}

function parseToken(value: unknown): PanelTokenRecord | null {
  if (!isPanelRecord(value) || !isPanelToken(value.token) || !isPanelTabId(value.tabId))
    return null;
  if (
    typeof value.issuedAt !== 'number' ||
    !Number.isSafeInteger(value.issuedAt) ||
    value.issuedAt < 0
  )
    return null;
  if (!isOptionalDocumentId(value.hostDocumentId)) return null;
  const context = parsePanelContext(value.context);
  return context
    ? {
        token: value.token,
        tabId: value.tabId,
        context,
        issuedAt: value.issuedAt,
        hostDocumentId: value.hostDocumentId ?? null,
      }
    : null;
}

function parseFrame(value: unknown): PanelFrameRecord | null {
  if (
    !isPanelRecord(value) ||
    !isPanelTabId(value.tabId) ||
    !isPanelTabId(value.frameId) ||
    value.frameId === 0
  )
    return null;
  if (value.documentId !== null && (typeof value.documentId !== 'string' || !value.documentId))
    return null;
  if (!isOptionalDocumentId(value.hostDocumentId)) return null;
  const session = parsePanelSession(value);
  return session
    ? {
        ...session,
        tabId: value.tabId,
        frameId: value.frameId,
        documentId: value.documentId,
        hostDocumentId: value.hostDocumentId ?? null,
      }
    : null;
}

// Sessions issued before document binding keep the origin/registration fallback.
function isOptionalDocumentId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === 'string' && value.length > 0);
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  return Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        const parsed = parse(item);
        return parsed ? [parsed] : [];
      })
    : [];
}

export async function readPanelState(area: chrome.storage.StorageArea): Promise<PanelState> {
  const stored: unknown = await area.get(PANEL_STATE_SESSION_KEY);
  const value = isPanelRecord(stored) ? stored[PANEL_STATE_SESSION_KEY] : null;
  return isPanelRecord(value)
    ? { tokens: parseList(value.tokens, parseToken), frames: parseList(value.frames, parseFrame) }
    : { tokens: [], frames: [] };
}

export function isPanelPageUrl(value: unknown, token?: PanelToken): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const expected = new URL(chrome.runtime.getURL(PANEL_PAGE_PATH));
    return (
      url.protocol === expected.protocol &&
      url.host === expected.host &&
      url.pathname === expected.pathname &&
      !url.username &&
      !url.password &&
      (token === undefined || url.searchParams.get(PANEL_TOKEN_QUERY_PARAM) === token)
    );
  } catch {
    return false;
  }
}

/** The sender fields a frame match reads; any `chrome.runtime.MessageSender` is one. */
export type PanelSender = Pick<
  chrome.runtime.MessageSender,
  'id' | 'frameId' | 'url' | 'documentId'
> & {
  tab?: { id?: number; url?: string };
};

export function matchesPanelFrame(sender: PanelSender, frame: PanelFrameRecord): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab?.id === frame.tabId &&
    sender.frameId === frame.frameId &&
    isPanelPageUrl(sender.url) &&
    (frame.documentId === null || sender.documentId === frame.documentId) &&
    (!sender.tab.url || panelHostOrigin(sender.tab.url) === frame.hostOrigin)
  );
}

/** Re-check a persisted frame against the live tab, including browsers omitting sender.tab.url. */
export async function panelTabHasOrigin(tabId: number, origin: string): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (panelHostOrigin(tab.url) !== origin) return false;
    const url = new URL(origin);
    return await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] });
  } catch {
    return false;
  }
}

/** Async because the registration lives in storage.session, including after worker restart.
 * This does not change any existing sync handler's sender policy; Part 2 opts those in.
 */
export async function isRegisteredPanelFrame(
  sender: chrome.runtime.MessageSender,
): Promise<boolean> {
  const area = panelSessionArea();
  if (!area) return false;
  try {
    const frame = (await readPanelState(area)).frames.find((frame) =>
      matchesPanelFrame(sender, frame),
    );
    return !!frame && (await panelTabHasOrigin(frame.tabId, frame.hostOrigin));
  } catch {
    return false;
  }
}
