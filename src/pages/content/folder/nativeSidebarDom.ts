import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import {
  geminiSidebarSelector,
  hasOnlineSidebarRoot,
  packagedGeminiSidebarRoot,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';

import {
  extractConversationIdFromHref,
  normalizeConversationId,
} from './folderConversationIdentity';
import { folderDebug as debugLog, folderDebugWarn as debugWarn } from './folderManagerDebug';
import {
  extractConversationId,
  extractConversationIdFromElement,
  buildConversationUrlFromId,
  extractNativeConversationId,
  extractNativeConversationUrl,
} from './nativeConversationIds';
import {
  type NativeConversationInfo,
  extractFallbackTitle,
  extractNativeConversationTitle,
} from './nativeConversationTitles';
import {
  isPackagedNativeConversationRow,
  packagedConversationRoot,
  packagedConversationRows,
  readCompleteNativeConversationRows,
  readSidebarConversationRows,
  sidebarConversationRoot,
} from './sidebarConversationQueries';

/** Current native sidebar state, read again after asynchronous collection waits. */
export interface NativeSidebarReadContext {
  sidebar: HTMLElement | null;
  accountIsolationEnabled: boolean;
  isDestroyed: boolean;
}

// The lr26 sidebar fills conversation rows lazily (see #725).
const AI_ORG_COLLECT_TIMEOUT_MS = 3000;
const AI_ORG_COLLECT_POLL_MS = 150;

export function getNativeConversationElements(sidebar: HTMLElement | null): HTMLElement[] {
  return readCompleteNativeConversationRows(
    (view) => sidebarConversationRoot(sidebar, view),
    () => packagedConversationRoot(sidebar),
  );
}

/**
 * Find native conversation element by conversation ID
 */
export function findNativeConversationElement(
  sidebar: HTMLElement | null,
  conversationId: string,
): HTMLElement | null {
  const targetId = normalizeConversationId(conversationId);
  if (!targetId) return null;

  // Try multiple strategies to find the conversation
  const allConversations = packagedConversationRows(sidebar);

  for (const conv of allConversations) {
    const id = extractConversationIdFromElement(conv) || extractConversationId(conv as HTMLElement);
    if (normalizeConversationId(id) === targetId) {
      return conv as HTMLElement;
    }
  }

  return null;
}

// Map a ⋮ trigger button to its conversation list item. Handles the current
// UI (trigger nested inside `[data-test-id="conversation"]`) and the older
// sibling layout (`.conversation-actions-container` next to the item).
export function findConversationElementForTrigger(trigger: HTMLElement): HTMLElement | null {
  const direct = trigger.closest('[data-test-id="conversation"]') as HTMLElement | null;
  if (direct) return direct;

  const actionsContainer = trigger.closest('.conversation-actions-container');
  if (actionsContainer) {
    let sibling = actionsContainer.previousElementSibling;
    while (sibling) {
      if (sibling.getAttribute('data-test-id') === 'conversation') {
        return sibling as HTMLElement;
      }
      sibling = sibling.previousElementSibling;
    }
  }

  const historyItem = trigger.closest('[data-test-id^="history-item"]') as HTMLElement | null;
  if (historyItem) return historyItem;

  return null;
}

/** Id, URL and title of one native row, for its ⋮ menu; null without an id. */
export function readNativeConversationInfo(
  conversationEl: HTMLElement,
  accountIsolationEnabled: boolean,
): NativeConversationInfo | null {
  const id = extractNativeConversationId(conversationEl);
  if (!id) return null;

  const url =
    extractNativeConversationUrl(conversationEl, accountIsolationEnabled) ||
    buildConversationUrlFromId(id, accountIsolationEnabled);
  const title =
    extractNativeConversationTitle(conversationEl, getBundledGeminiSelectorView()) ||
    extractFallbackTitle(conversationEl, getBundledGeminiSelectorView()) ||
    'Untitled';
  return { id, title, url };
}

export function findNativeConversationLinkById(conversationId: string): HTMLAnchorElement | null {
  const normalizedId = normalizeConversationId(conversationId);
  if (!normalizedId) return null;

  const byJslog = document.querySelector(
    `[data-test-id="conversation"][jslog*="c_${normalizedId}"] a[href]`,
  ) as HTMLAnchorElement | null;
  if (byJslog && extractConversationIdFromHref(byJslog.href) === normalizedId) {
    return byJslog;
  }

  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      geminiSidebarSelector('sidebar.links', getBundledGeminiSelectorView()),
    ),
  );

  for (const link of links) {
    if (extractConversationIdFromHref(link.href) === normalizedId) {
      return link;
    }
  }

  return null;
}

export function triggerNativeConversationClick(target: HTMLElement): void {
  const options = { bubbles: true, cancelable: true };
  target.dispatchEvent(new MouseEvent('pointerdown', options));
  target.dispatchEvent(new MouseEvent('mousedown', options));
  target.dispatchEvent(new MouseEvent('mouseup', options));
  target.dispatchEvent(new MouseEvent('click', options));
}

/**
 * Check if conversation still exists in DOM
 * Returns true if conversation found, false if definitely deleted
 * In case of errors, conservatively returns true to avoid false deletions
 */
export function isConversationInDOM(
  sidebar: HTMLElement | null,
  conversationId: string,
  ignoreHiddenRows = false,
): boolean {
  // An online mount point cannot turn a still-present native row into deletion evidence.
  if (hasOnlineSidebarRoot()) sidebar = packagedGeminiSidebarRoot();
  if (!sidebar) {
    debugWarn('Sidebar container not available for DOM check');
    return true; // Conservative: assume conversation exists if we can't check
  }

  try {
    const matchingRows = new Set<HTMLElement>();
    sidebar
      .querySelectorAll<HTMLElement>(`[data-test-id="conversation"][jslog*="c_${conversationId}"]`)
      .forEach((row) => matchingRows.add(row));
    sidebar
      .querySelectorAll<HTMLAnchorElement>(
        `[data-test-id="conversation"] a[href*="${conversationId}"]`,
      )
      .forEach((link) => {
        const row = link.closest('[data-test-id="conversation"]');
        if (row instanceof HTMLElement) matchingRows.add(row);
      });

    const existingRow = Array.from(matchingRows).find(
      (row) => !ignoreHiddenRows || isRenderedNativeConversationRow(row),
    );
    if (existingRow) {
      debugLog(`Found conversation ${conversationId} in DOM`);
      return true;
    }

    if (matchingRows.size > 0) {
      debugLog(`Ignored hidden stale native row for conversation ${conversationId}`);
    }

    // Not found in DOM
    debugLog(`Conversation ${conversationId} not found in DOM`);
    return false;
  } catch (error) {
    debugWarn(`DOM check failed for ${conversationId}:`, error);
    // Conservative approach: if we can't check, assume it still exists
    // This prevents accidental deletion during DOM reconstruction
    return true;
  }
}

function isRenderedNativeConversationRow(row: HTMLElement): boolean {
  // A collapsed/temporarily hidden sidebar is not evidence that Gemini
  // removed the conversation. Only the row's own state can identify a
  // stale virtualized template; ancestor visibility belongs to sidebar UI
  // lifecycle and must be treated conservatively.
  if (row.hidden || row.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(row);
  return !(
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    style.contentVisibility === 'hidden'
  );
}

/**
 * A conversation row is "populated" once Gemini fills in its link. The lr26
 * sidebar virtualizes rows: `[data-test-id="conversation"]` elements exist as
 * empty stubs (no link, no title) while collapsed or mid-render, and only gain
 * an `<a href>` once actually rendered. We use the link as the populated signal.
 */
function isPopulatedConversationEl(el: HTMLElement, view: GeminiSelectorView): boolean {
  const link = el.querySelector(geminiSidebarSelector('sidebar.conversationLinks', view));
  return (
    link instanceof HTMLAnchorElement &&
    link.matches(geminiSidebarSelector('sidebar.conversationLinks', getBundledGeminiSelectorView()))
  );
}

/** Synchronous extraction over the currently-populated sidebar rows. */
function collectPopulatedConversations(
  sidebar: HTMLElement | null,
  accountIsolationEnabled: boolean,
  view: GeminiSelectorView,
): Array<{ id: string; title: string; url: string }> {
  const results: Array<{ id: string; title: string; url: string }> = [];
  const seen = new Set<string>();
  const conversationEls = readSidebarConversationRows(sidebarConversationRoot(sidebar, view), view);
  const packaged = getBundledGeminiSelectorView();
  const trustedRows = new Set(packagedConversationRows(sidebar));
  const listed = new Set(conversationEls);
  // A partial online list would hand AI organization a short list of the user's chats.
  if (view.remoteKeys.size > 0 && [...trustedRows].some((row) => !listed.has(row))) return [];
  const onlineTitle = [
    'sidebar.row',
    'sidebar.title',
    'sidebar.titleFallback',
    'sidebar.conversationLinks',
  ] as const;

  for (const element of conversationEls) {
    // AI organization can later import these records: online matches cannot establish identity.
    if (!trustedRows.has(element) || !isPackagedNativeConversationRow(element)) continue;
    if (!isPopulatedConversationEl(element, view)) continue; // skip virtualized stub
    const id = extractNativeConversationId(element);
    const url = extractNativeConversationUrl(element, accountIsolationEnabled);
    if (!id || !url) continue;
    if (seen.has(id)) continue; // collapsed rail can emit duplicate rows
    const title = extractNativeConversationTitle(element, view);
    if (onlineTitle.some((key) => view.remoteKeys.has(key))) {
      // A failed label or an unrelated label cannot become an imported title or "Untitled".
      if (!title || title !== extractNativeConversationTitle(element, packaged)) return [];
    }
    seen.add(id);
    results.push({ id, title: title || 'Untitled', url });
  }

  return results;
}

/**
 * Poll until at least one sidebar conversation row is populated, or timeout.
 * Returns true if a populated row was found.
 */
async function waitForPopulatedSidebarConversations(
  getContext: () => NativeSidebarReadContext,
): Promise<boolean> {
  const hasPopulated = () => {
    const { sidebar, accountIsolationEnabled } = getContext();
    return resolveGeminiSidebarOperation(
      (view) =>
        view.remoteKeys.size === 0
          ? // Packaged rows count once they have a link; collection parses IDs after the wait.
            packagedConversationRows(sidebar).some((row) => isPopulatedConversationEl(row, view))
          : collectPopulatedConversations(sidebar, accountIsolationEnabled, view).length > 0,
      Boolean,
    ).value;
  };

  if (hasPopulated()) return true;

  const deadline = Date.now() + AI_ORG_COLLECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, AI_ORG_COLLECT_POLL_MS));
    if (getContext().isDestroyed) return false;
    if (hasPopulated()) return true;
  }
  return false;
}

/**
 * Collect all conversation titles and URLs from the native sidebar DOM.
 * Waits for the virtualized rows to populate before reading them — otherwise
 * the list comes back empty and the AI-organize prompt has nothing to work
 * with (see #725).
 */
export async function collectAllSidebarConversations(
  getContext: () => NativeSidebarReadContext,
): Promise<Array<{ id: string; title: string; url: string }>> {
  await waitForPopulatedSidebarConversations(getContext);
  const { sidebar, accountIsolationEnabled } = getContext();
  return resolveGeminiSidebarOperation(
    (view) => collectPopulatedConversations(sidebar, accountIsolationEnabled, view),
    (rows) => rows.length > 0,
  ).value;
}
