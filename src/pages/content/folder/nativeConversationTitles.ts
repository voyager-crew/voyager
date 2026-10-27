import { getBundledGeminiSelectorView, type GeminiSelectorView } from '@/core/gemini/selectors';
import { geminiSidebarSelector } from '@/core/gemini/sidebar/queries';
import { geminiTitleSelectors } from '@/core/gemini/sidebar/titleProof';

import {
  extractConversationIdFromHref,
  normalizeConversationId,
} from './folderConversationIdentity';
import { folderDebug as debugLog, folderDebugWarn as debugWarn } from './folderManagerDebug';
import { GEM_CONFIG } from './gemConfig';

export interface NativeConversationInfo {
  id: string;
  title: string;
  url: string;
}

export function extractNativeDragTitle(element: HTMLElement, conversationId?: string): string {
  const title =
    extractNativeConversationTitle(element) ||
    (conversationId ? syncConversationTitleFromNative(conversationId) : null);

  return title || 'Untitled';
}

/** Persistent callers default to packaged evidence; passive collectors pass their operation view. */
export function extractNativeConversationTitle(
  conversationEl: HTMLElement,
  view: GeminiSelectorView = getBundledGeminiSelectorView(),
): string | null {
  const scope =
    (conversationEl.closest(geminiSidebarSelector('sidebar.row', view)) as HTMLElement) ||
    conversationEl;
  // 1) Known title selectors
  const titleEl = scope.querySelector(geminiSidebarSelector('sidebar.title', view));
  let title = titleEl?.textContent?.trim() || null;
  if (title && !isGemLabel(title)) {
    debugLog('extractTitle(selectors):', title);
    return title;
  }

  // 2) Link attributes
  const candidate = scope.querySelector(geminiSidebarSelector('sidebar.conversationLinks', view));
  const link = candidate instanceof HTMLAnchorElement ? candidate : null;
  const aria = link?.getAttribute('aria-label')?.trim();
  if (aria && !isGemLabel(aria)) {
    debugLog('extractTitle(link aria-label):', aria);
    return aria;
  }
  const linkTitle = link?.getAttribute('title')?.trim();
  if (linkTitle && !isGemLabel(linkTitle)) {
    debugLog('extractTitle(link title attr):', linkTitle);
    return linkTitle;
  }

  // 3) Parse visible text from link (ignore icons and gem labels)
  const fromLinkText = extractTitleFromLinkText(link || undefined);
  if (fromLinkText) {
    debugLog('extractTitle(link text):', fromLinkText);
    return fromLinkText;
  }

  // 4) Fallbacks on common labels
  title = extractFallbackTitle(scope, view);
  if (title && !isGemLabel(title)) {
    debugLog('extractTitle(fallback):', title);
    return title;
  }

  debugLog('extractTitle: null');
  return null;
}

/**
 * Build a conversationId → native title lookup table with ONE sidebar scan.
 *
 * Mirrors the per-row matching semantics of `syncConversationTitleFromNative`
 * (`jslog.includes(id)` and `link.href.includes(id)`): every `c_<hex>` id a
 * row's jslog mentions and the id extracted from the row's link href are all
 * registered, in both prefixed (`c_<hex>`) and bare (`<hex>`) forms, so
 * callers can look up either id shape. First title-bearing row wins — same
 * as the old first-match-in-DOM-order behavior.
 */
export function buildNativeConversationTitleMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const conversations = document.querySelectorAll(
      geminiSidebarSelector('sidebar.row', getBundledGeminiSelectorView()),
    );
    for (const convEl of Array.from(conversations)) {
      const element = convEl as HTMLElement;
      const title = extractNativeConversationTitle(element);
      if (!title) continue;

      const register = (rawId: string | null | undefined): void => {
        const hex = normalizeConversationId(rawId);
        if (!hex) return;
        if (!map.has(hex)) map.set(hex, title);
        const prefixed = `c_${hex}`;
        if (!map.has(prefixed)) map.set(prefixed, title);
      };

      const jslog = element.getAttribute('jslog');
      if (jslog) {
        for (const match of jslog.matchAll(/c_([a-f0-9]{8,})/gi)) {
          register(match[1]);
        }
      }

      const link = element.querySelector(
        geminiSidebarSelector('sidebar.conversationLinks', getBundledGeminiSelectorView()),
      ) as HTMLAnchorElement | null;
      if (link) {
        register(extractConversationIdFromHref(link.href));
      }
    }
  } catch (e) {
    debugLog('Error building native title map:', e);
  }
  return map;
}

export function lookupNativeConversationTitle(
  map: Map<string, string> | null,
  conversationId: string,
): string | null {
  if (!map) return null;

  const direct = map.get(conversationId);
  if (direct) return direct;

  const normalized = normalizeConversationId(conversationId);
  if (normalized) {
    const byHex = map.get(normalized);
    if (byHex) return byHex;
  }
  return null;
}

export function syncConversationTitleFromNative(conversationId: string): string | null {
  try {
    // Try to find the conversation in the native sidebar by its ID
    const conversations = document.querySelectorAll(
      geminiSidebarSelector('sidebar.row', getBundledGeminiSelectorView()),
    );
    for (const convEl of Array.from(conversations)) {
      // Check if this conversation matches the ID
      const jslog = convEl.getAttribute('jslog');
      if (jslog && jslog.includes(conversationId)) {
        // Found the matching conversation, extract its current title
        const currentTitle = extractNativeConversationTitle(convEl as HTMLElement);
        if (currentTitle) {
          debugLog('Synced title from native:', currentTitle);
          return currentTitle;
        }
      }

      // Also check by href
      const link = convEl.querySelector(
        geminiSidebarSelector('sidebar.conversationLinks', getBundledGeminiSelectorView()),
      ) as HTMLAnchorElement | null;
      if (link && link.href.includes(conversationId)) {
        const currentTitle = extractNativeConversationTitle(convEl as HTMLElement);
        if (currentTitle) {
          debugLog('Synced title from native (by href):', currentTitle);
          return currentTitle;
        }
      }
    }
  } catch (e) {
    debugLog('Error syncing title from native:', e);
  }
  return null;
}

export function extractFallbackTitle(
  conversationEl: HTMLElement,
  view: GeminiSelectorView = getBundledGeminiSelectorView(),
): string | null {
  try {
    const scope =
      (conversationEl.closest(geminiSidebarSelector('sidebar.row', view)) as HTMLElement) ||
      conversationEl;
    // Prefer explicit attributes if present
    const aria = scope.getAttribute('aria-label');
    if (aria && aria.trim()) {
      debugLog('fallbackTitle(aria-label):', aria.trim());
      return aria.trim();
    }
    const titleAttr = scope.getAttribute('title');
    if (titleAttr && titleAttr.trim()) {
      debugLog('fallbackTitle(title attr):', titleAttr.trim());
      return titleAttr.trim();
    }
    // Try a common inner label
    const label = scope.querySelector(geminiSidebarSelector('sidebar.titleFallback', view));
    const labelText = label?.textContent?.trim();
    if (labelText && !isGemLabel(labelText)) {
      debugLog('fallbackTitle(label-ish):', labelText);
      return labelText;
    }
    const onlineTitle = [
      'sidebar.row',
      'sidebar.title',
      'sidebar.titleFallback',
      'sidebar.conversationLinks',
    ] as const;
    // Generic row text must not conceal failed online title reads from the operation fallback.
    if (onlineTitle.some((key) => view.remoteKeys.has(key))) return null;
    // Fall back to trimmed text content (first line, clipped)
    const raw = scope.textContent?.trim() || '';
    if (raw) {
      const firstLine =
        raw
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)[0] || raw;
      const clipped = firstLine.slice(0, 80);
      debugLog('fallbackTitle(textContent):', clipped);
      return clipped;
    }
  } catch (e) {
    debugWarn('extractFallbackTitle error:', e);
  }
  return null;
}

function isGemLabel(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const simple = t.toLowerCase();
  // Generic labels we want to ignore
  if (simple === 'gem' || simple === 'gems') return true;
  // Known Gem names (English)
  for (const g of GEM_CONFIG) {
    if (simple === g.name.toLowerCase()) return true;
  }
  return false;
}

function extractTitleFromLinkText(link?: HTMLAnchorElement | null): string | null {
  if (!link) return null;
  // Get visible textual lines from the link
  const text = (link.innerText || '').trim();
  if (!text) return null;
  const parts = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !isGemLabel(s))
    .filter((s) => s.length >= 2);
  debugLog('extractTitleFromLinkText parts:', parts);
  if (parts.length === 0) return null;
  // Heuristic: pick the longest part
  const best = parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0]);
  return best || null;
}

// Placeholder strings Gemini shows before the chat is auto-titled.
// Must cover every locale Gemini supports — the DOM text is localized
// even though the brand name "Gemini" is not.
const DISALLOWED_PAGE_TITLES = new Set([
  '',
  'Gemini',
  'Google Gemini',
  'New chat', // en
  '新对话', // zh-CN
  '新對話', // zh-TW
  '新しいチャット', // ja
  '새 채팅', // ko
  'Nuevo chat', // es
  'Nouveau chat', // fr
  'Novo chat', // pt
  'Новый чат', // ru
  'محادثة جديدة', // ar
]);

/**
 * Extract conversation info from the current page URL and top-bar title.
 * Used exclusively for the top-right conversation header menu (not sidebar).
 *
 * Returns null ONLY when the URL does not contain a valid conversation ID,
 * in which case injection is skipped entirely.
 * Title always has a fallback — never returns null for title.
 */
export function extractConversationInfoFromPage(): NativeConversationInfo | null {
  // --- Robust URL parsing ---
  let path: string;
  try {
    path = window.location.pathname;
  } catch {
    debugWarn('extractConversationInfoFromPage: failed to read location.pathname');
    return null;
  }

  // Support multi-user prefix /u/<n>/, /app/<hexId>, and /gem/<gemId>/<hexId>
  const hexMatch = path.match(/\/(?:app|gem\/[^/?#]+)\/([a-f0-9]{8,})/i);
  if (!hexMatch?.[1]) {
    debugLog('extractConversationInfoFromPage: no valid conversation ID in URL');
    return null;
  }
  const id = hexMatch[1];
  const url = window.location.href;

  // Gemini generates titles asynchronously; the DOM element may not be ready yet.
  // Fallback order: top-bar selectors, document.title, then a default string.
  const title = readTopBarTitle() || readDocumentTitle() || 'Untitled';

  debugLog('extractConversationInfoFromPage:', { id, title, url });
  return { id, title, url };
}

function readTopBarTitle(): string | null {
  for (const sel of geminiTitleSelectors('sidebar.pageTitle')) {
    try {
      const text = document.querySelector(sel)?.textContent?.trim();
      if (text && !DISALLOWED_PAGE_TITLES.has(text)) return text;
    } catch {
      // Continue to next selector
    }
  }
  return null;
}

// Gemini sets document.title in the "Title - Gemini" format.
function readDocumentTitle(): string | null {
  try {
    const docTitle = document.title?.trim();
    if (!docTitle) return null;
    const cleaned = docTitle.replace(/\s*[-–—]\s*Gemini\s*$/i, '').trim();
    return cleaned && !DISALLOWED_PAGE_TITLES.has(cleaned) ? cleaned : null;
  } catch {
    return null;
  }
}
