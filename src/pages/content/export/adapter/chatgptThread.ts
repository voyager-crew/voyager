import { textWithLatexSource } from '@/core/utils/userLatexSource';
import type {
  ContentExtractor,
  ExtractedContent,
} from '@/features/export/services/DOMContentExtractor';

import { mergeExtractedContent } from './chatgptShared';

/**
 * ChatGPT's thread DOM as measured live (October 2026).
 *
 * - The conversation is a virtual list of `[data-turn-key]` items. Each item is
 *   one exchange: a user prompt (`[data-user-message-bubble]`) and/or an
 *   assistant reply (`[data-chatgpt-selection-message-id]`, at most one per
 *   item and never on the user side). Whole items mount and unmount as the
 *   thread scrolls; only a handful are in the DOM at a time.
 * - The items sit in a box sized to the whole loaded list (the item's ancestor
 *   directly under `[data-chatgpt-conversation-selection-target]`): its top is
 *   the first item's top, its bottom the last item's bottom.
 * - An item's key is its prompt's message id; the prompt and reply blocks list
 *   their message ids in `data-chatgpt-search-message-ids`. Regenerating a
 *   reply keeps the key and changes the reply's id.
 * - Older history is paginated: while more exists, a `[role="status"]` spinner
 *   sits above the first item and the next page loads when it scrolls in.
 * - Conversations opened earlier in the tab stay in the DOM under a
 *   `display: none` ancestor, each with its own `main`.
 */
export const TURN_ITEM_SELECTOR = '[data-turn-key]';
const TURN_KEY_ATTRIBUTE = 'data-turn-key';
export const USER_BUBBLE_SELECTOR = '[data-user-message-bubble]';
/** The block that holds a prompt's bubble, its uploads and its action row. */
const USER_UNIT_SELECTOR = '[data-chatgpt-search-unit-key]';
export const ASSISTANT_REPLY_SELECTOR = '[data-chatgpt-selection-message-id]';
const REPLY_ID_ATTRIBUTE = 'data-chatgpt-selection-message-id';
const MESSAGE_IDS_ATTRIBUTE = 'data-chatgpt-search-message-ids';
/** The attributes {@link readTurnKey} and {@link readTurnFingerprint} read. */
export const TURN_VERSION_ATTRIBUTES: readonly string[] = [
  TURN_KEY_ATTRIBUTE,
  MESSAGE_IDS_ATTRIBUTE,
  REPLY_ID_ATTRIBUTE,
];
const HISTORY_PENDING_SELECTOR = '[role="status"]';
/** The list's own wrapper: the history spinner and the items, nothing of the page around them. */
const THREAD_LIST_SELECTOR = '[data-chatgpt-conversation-selection-target]';
const ROOT_CANDIDATES = ['main', '[role="main"]'];

// Unverified on the live DOM: no generated image, upload or streaming reply was
// on screen when the selectors above were measured. These are the earlier
// DOM's selectors, kept so those cases still export if ChatGPT kept them.
const IMAGEGEN_SELECTOR = '[class*="group/imagegen-image"]';
const STOP_GENERATING_SELECTOR = [
  '[data-testid="stop-button"]',
  'button[aria-label*="stop generating" i]',
  'button[aria-label*="停止生成"]',
].join(',');
const STREAMING_SELECTOR = [
  '[data-message-streaming="true"]',
  '[data-is-streaming="true"]',
  '.result-streaming',
].join(',');
const RENDERED_CONTENT_SELECTOR =
  'img, svg, canvas, pre, table, [data-math-source], [role="math"], .katex';

export type ChatGptMessageRole = 'user' | 'assistant';

/** One message of an item, extracted while the item was mounted. */
export interface ChatGptThreadMessage {
  /** `<turn key>:u` or `<turn key>:a`. */
  readonly id: string;
  readonly turnKey: string;
  readonly role: ChatGptMessageRole;
  readonly content: ExtractedContent;
  /** The element that carried the message when it was extracted; may since be unmounted. */
  readonly host: HTMLElement;
  /** The item's {@link readTurnFingerprint} when it was read. */
  readonly fingerprint: string;
  /** Raw prompt bubble hash, captured while mounted and shared with its reply. */
  readonly starHash?: string;
}

export function userMessageId(turnKey: string): string {
  return `${turnKey}:u`;
}

export function assistantMessageId(turnKey: string): string {
  return `${turnKey}:a`;
}

/**
 * Whether the element is laid out: connected and under no `display: none`
 * ancestor. ChatGPT hides cached pages that way.
 */
export function isRendered(element: Element): boolean {
  if (!element.isConnected) return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false;
    if (getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

/** The conversation's `main`, skipping cached pages ChatGPT keeps hidden. */
export function resolveVisibleConversationRoot(doc: Document = document): HTMLElement {
  for (const selector of ROOT_CANDIDATES) {
    for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
      if (isRendered(element)) return element;
    }
  }
  return doc.body;
}

export function readTurnKey(item: Element): string {
  return item.getAttribute(TURN_KEY_ATTRIBUTE)?.trim() ?? '';
}

/** Mounted items in DOM (= conversation) order, one per key. */
export function mountedTurnItems(root: ParentNode): HTMLElement[] {
  const seen = new Set<string>();
  const items: HTMLElement[] = [];
  for (const item of root.querySelectorAll<HTMLElement>(TURN_ITEM_SELECTOR)) {
    const key = readTurnKey(item);
    if (!key || seen.has(key)) continue;
    if (item.parentElement?.closest(TURN_ITEM_SELECTOR)) continue;
    if (!isRendered(item)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

export function findMountedTurnItem(root: ParentNode, turnKey: string): HTMLElement | null {
  return mountedTurnItems(root).find((item) => readTurnKey(item) === turnKey) ?? null;
}

/**
 * The box sized to the whole loaded list, or null when the item is not in one.
 * The item is mounted at its place in it, so the box shows where unmounted
 * items lie.
 */
export function findThreadExtent(item: Element): HTMLElement | null {
  const list = item.parentElement?.closest(THREAD_LIST_SELECTOR);
  if (!list) return null;
  let node: Element | null = item.parentElement;
  while (node && node.parentElement !== list) node = node.parentElement;
  return node instanceof HTMLElement ? node : null;
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Which version of an item is mounted: the message ids of its prompt and
 * reply, so a regenerated reply or another branch under the same key reads
 * differently. Falls back to a hash of the text for an item without ids.
 */
export function readTurnFingerprint(item: Element): string {
  const ids = new Set<string>();
  for (const unit of item.querySelectorAll(`[${MESSAGE_IDS_ATTRIBUTE}]`)) {
    for (const id of unit.getAttribute(MESSAGE_IDS_ATTRIBUTE)?.split(/\s+/) ?? []) {
      if (id) ids.add(id);
    }
  }
  for (const reply of item.querySelectorAll(ASSISTANT_REPLY_SELECTOR)) {
    const id = reply.getAttribute(REPLY_ID_ATTRIBUTE)?.trim();
    if (id) ids.add(id);
  }
  if (ids.size > 0) return `ids:${Array.from(ids).sort().join(' ')}`;
  return `text:${hashText(textWithLatexSource(item).trim())}`;
}

/** Whether a rendered ChatGPT thread (the current DOM) is present. */
export function hasRenderedThread(doc: Document = document): boolean {
  return mountedTurnItems(doc).length > 0;
}

/**
 * ChatGPT shows a "Loading older messages" spinner above the first item while
 * older history remains to be loaded (measured live: a `[role="status"]` in the
 * list wrapper, before the items). Statuses elsewhere in `main`, such as
 * sr-only live regions or one inside a streaming item, do not count.
 */
export function hasPendingHistory(root: ParentNode, firstItem: Element | null): boolean {
  const scope = firstItem?.closest(THREAD_LIST_SELECTOR) ?? root;
  for (const status of scope.querySelectorAll(HISTORY_PENDING_SELECTOR)) {
    if (status.closest(TURN_ITEM_SELECTOR)) continue;
    if (!isRendered(status)) continue;
    if (
      !firstItem ||
      status.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      return true;
    }
  }
  return false;
}

export function isChatGptThreadGenerating(root: ParentNode = document): boolean {
  return root.querySelector(`${STOP_GENERATING_SELECTOR},${STREAMING_SELECTOR}`) !== null;
}

export function findUserBubble(item: Element): HTMLElement | null {
  return item.querySelector<HTMLElement>(USER_BUBBLE_SELECTOR);
}

export function findAssistantReply(item: Element): HTMLElement | null {
  return item.querySelector<HTMLElement>(ASSISTANT_REPLY_SELECTOR);
}

/** Where a prompt's selection checkbox goes: its whole block, not just the bubble. */
export function userSelectionHost(item: Element, bubble: HTMLElement): HTMLElement {
  const unit = bubble.closest<HTMLElement>(USER_UNIT_SELECTOR);
  return unit && item.contains(unit) ? unit : bubble;
}

export function hasRenderedContent(element: Element): boolean {
  return (
    (element.textContent?.trim().length ?? 0) > 0 ||
    element.querySelector(RENDERED_CONTENT_SELECTOR) !== null
  );
}

/**
 * Whether the thread is changing under the crawl: the item carries a streaming
 * marker, or the composer shows a stop button (a reply started mid-crawl).
 */
export function isItemGenerating(root: ParentNode, item: Element): boolean {
  if (item.matches(STREAMING_SELECTOR) || item.querySelector(STREAMING_SELECTOR)) return true;
  return isChatGptThreadGenerating(root);
}

function topLevelOnly(elements: Element[]): Element[] {
  return elements.filter(
    (element) => !elements.some((other) => other !== element && other.contains(element)),
  );
}

/**
 * Extract a prompt. The text comes from the bubble; uploads that ChatGPT may
 * render beside it inside the prompt's block are copied in as well (that
 * placement is unverified live), never its action buttons.
 */
export function extractUserMessage(
  item: Element,
  bubble: HTMLElement,
  extractor: ContentExtractor,
): ExtractedContent {
  const unit = userSelectionHost(item, bubble);
  const extras =
    unit === bubble
      ? []
      : topLevelOnly(
          Array.from(unit.querySelectorAll('img, [role="group"][aria-label]')).filter(
            (element) => !bubble.contains(element) && !element.closest('button'),
          ),
        );
  if (extras.length === 0) return extractor.extractUserContent(bubble);

  const detached = document.createElement('div');
  extras.forEach((element) => detached.appendChild(element.cloneNode(true)));
  detached.appendChild(bubble.cloneNode(true));
  return extractor.extractUserContent(detached);
}

/**
 * Extract a reply. Generated-image cards rendered beside the reply inside the
 * item are appended as cloned images only, so their Edit/Share controls never
 * leak into the export (the earlier DOM did this; unverified on the current one).
 */
export function extractAssistantMessage(
  item: Element,
  reply: HTMLElement,
  extractor: ContentExtractor,
): ExtractedContent {
  const content = extractor.extractAssistantContent(reply);
  const siblingImages = Array.from(
    item.querySelectorAll<HTMLImageElement>(`${IMAGEGEN_SELECTOR} img`),
  ).filter((image) => !reply.contains(image) && usableImageSource(image));
  if (siblingImages.length === 0) return content;

  const imageRoot = document.createElement('div');
  siblingImages.forEach((image) => imageRoot.appendChild(image.cloneNode(true)));
  return mergeExtractedContent(content, extractor.extractAssistantContent(imageRoot));
}

function usableImageSource(image: HTMLImageElement): boolean {
  const src = (image.getAttribute('src') || image.src || '').trim();
  return src.length > 0 && src !== 'about:blank';
}

export function isEmptyContent(content: ExtractedContent): boolean {
  return !content.text && !content.html && content.attachments.length === 0;
}
