import { chatGptTurnHash } from '@/features/savedLibrary/exportStars';

import { type ChatGptHistoryReader, apiTurnMessages, chatGptHistory } from './chatgptHistoryApi';
import { type ScrollView, createScrollView, findScrollContainer } from './chatgptScrollView';
import { assertActive, wait } from './chatgptShared';
import {
  type ChatGptThreadMessage,
  assistantMessageId,
  extractAssistantMessage,
  extractUserMessage,
  findAssistantReply,
  findMountedTurnItem,
  findThreadExtent,
  findUserBubble,
  hasPendingHistory,
  hasRenderedContent,
  isChatGptThreadGenerating,
  isEmptyContent,
  isItemGenerating,
  mountedTurnItems,
  readTurnFingerprint,
  readTurnKey,
  resolveVisibleConversationRoot,
  userMessageId,
  userSelectionHost,
} from './chatgptThread';
import type { ChatGptReadOptions } from './type';

/**
 * Walk ChatGPT's virtualized thread from its first turn to its last and
 * extract every item while it is mounted.
 *
 * Completeness rests on these checks, and any failure throws rather than
 * returning a shorter list:
 * - settled: a window is read only once its items cover the part of the list
 *   inside the viewport and hold still, so a window left mounted from an
 *   earlier scroll position is never taken for the current one;
 * - start: older history is loaded until ChatGPT's history spinner is gone,
 *   and the first mounted item starts where the list box starts. When the
 *   spinner stays and nothing loads (ChatGPT loads older pages only on a
 *   trusted wheel or touch), the crawl starts at the first loaded item and the
 *   turns before it come from ChatGPT's conversation endpoint, read along
 *   that item's own branch;
 * - no gaps: every scroll keeps the last recorded item mounted, so each new
 *   window continues the previous one. A window without it is retried with a
 *   shorter step, then fails;
 * - one branch: an item seen again must carry the message ids it was read
 *   with, so a regenerated reply or a branch switch fails the crawl;
 * - end: the last mounted item ends where the list box ends.
 */

export interface ChatGptCrawlTiming {
  /** Interval between DOM reads. */
  readonly pollMs: number;
  /** A window counts as mounted once it covers the viewport and holds this long. */
  readonly settleMs: number;
  /** Longest wait for a window to settle or an item's content to appear. */
  readonly mountTimeoutMs: number;
  /** The top of the thread must hold this long, spinner gone, to count as fully loaded. */
  readonly historyIdleMs: number;
  /** Longest wait for a pending history page to make progress. */
  readonly historyStallMs: number;
  readonly maxSteps: number;
}

export const DEFAULT_CHATGPT_CRAWL_TIMING: ChatGptCrawlTiming = {
  pollMs: 50,
  settleMs: 150,
  mountTimeoutMs: 2500,
  historyIdleMs: 1000,
  historyStallMs: 10000,
  maxSteps: 5000,
};

export interface ChatGptCrawlOptions extends ChatGptReadOptions {
  readonly timing?: Partial<ChatGptCrawlTiming>;
  /** Called with the number of turns read so far, after each one. */
  readonly onProgress?: (turns: number) => void;
  /** Reads the turns ChatGPT will not load; the page's shared reader by default. */
  readonly history?: ChatGptHistoryReader;
}

/** A tall last item is crossed in steps of this share of the viewport. */
const TALL_ITEM_STEP = 0.9;
const MAX_GAP_RETRIES = 6;
/** An item edge this close to the list box's edge touches it. */
const EDGE_TOLERANCE_PX = 2;
/**
 * Largest gap between mounted items, or between them and the visible part of
 * the list, in a window that covers the viewport (items sit 12px apart live).
 */
const COVER_SLACK_PX = 32;

interface CrawlContext {
  readonly root: HTMLElement;
  readonly view: ScrollView;
  readonly options: ChatGptCrawlOptions;
  readonly timing: ChatGptCrawlTiming;
  /**
   * The first loaded item's key when older history would not load. ChatGPT
   * keeps blank room for the unloaded turns above it (measured live: ~950px
   * inside the list box), so the list starts at that item, not at the box.
   */
  loadedFrom: string | null;
}

interface Span {
  readonly top: number;
  readonly bottom: number;
}

interface MountedWindow {
  readonly items: HTMLElement[];
  readonly spans: Span[];
  /** The box sized to the whole loaded list, when ChatGPT renders one. */
  readonly extent: Span | null;
}

function spanOf(view: ScrollView, element: Element): Span {
  const top = view.offsetOf(element);
  return { top, bottom: top + element.getBoundingClientRect().height };
}

function readWindow(context: CrawlContext): MountedWindow {
  const items = mountedTurnItems(context.root);
  const box = items[0] ? findThreadExtent(items[0]) : null;
  return {
    items,
    spans: items.map((item) => spanOf(context.view, item)),
    extent: box ? spanOf(context.view, box) : null,
  };
}

/**
 * Whether the mounted items cover the part of the list inside the viewport,
 * as a virtual list does once it has rendered for the current position.
 */
function coversViewport(
  view: ScrollView,
  mounted: MountedWindow,
  loadedFrom: string | null,
): boolean {
  const { spans, extent } = mounted;
  const first = spans[0];
  const last = spans.at(-1);
  if (!first || !last) return false;
  const viewTop = view.offset();
  const viewBottom = viewTop + view.viewportHeight();
  if (!extent) return spans.some((span) => span.bottom > viewTop && span.top < viewBottom);
  const startIndex = loadedFrom
    ? mounted.items.findIndex((item) => readTurnKey(item) === loadedFrom)
    : -1;
  const top = Math.max(viewTop, extent.top, startIndex >= 0 ? spans[startIndex]!.top : -Infinity);
  const bottom = Math.min(viewBottom, extent.bottom);
  if (bottom <= top) return false;
  if (first.top > top + COVER_SLACK_PX || last.bottom < bottom - COVER_SLACK_PX) return false;
  return spans.every(
    (span, index) => index === 0 || span.top - spans[index - 1]!.bottom <= COVER_SLACK_PX,
  );
}

/** The first mounted item is the conversation's first. */
function atThreadStart(context: CrawlContext, mounted: MountedWindow): boolean {
  const first = mounted.items[0];
  if (!first || hasPendingHistory(context.root, first)) return false;
  return mounted.extent
    ? Math.abs(mounted.spans[0]!.top - mounted.extent.top) <= EDGE_TOLERANCE_PX
    : context.view.offset() <= 1;
}

/** The first mounted item is the first one loaded, older history left unloaded above it. */
function atLoadedStart(context: CrawlContext, mounted: MountedWindow): boolean {
  const first = mounted.items[0];
  return !!first && readTurnKey(first) === context.loadedFrom;
}

/** The last mounted item is the conversation's last. */
function atThreadEnd(context: CrawlContext, mounted: MountedWindow): boolean {
  const last = mounted.spans.at(-1);
  if (!last) return false;
  return mounted.extent
    ? Math.abs(last.bottom - mounted.extent.bottom) <= EDGE_TOLERANCE_PX
    : context.view.offset() >= context.view.range() - 1;
}

/**
 * Wait until the mounted window covers the viewport and stops changing.
 * Throws when it does not within the mount timeout.
 */
async function settleWindow(context: CrawlContext): Promise<MountedWindow> {
  const { view, timing, options } = context;
  const startedAt = Date.now();
  let signature = '';
  let stableSince = startedAt;
  while (Date.now() - startedAt < timing.mountTimeoutMs) {
    await wait(timing.pollMs, options.signal);
    assertActive(options);
    const mounted = readWindow(context);
    const next = [
      mounted.items.map(readTurnKey).join(','),
      Math.round(view.range()),
      Math.round(view.offset()),
    ].join('|');
    if (next !== signature || !coversViewport(view, mounted, context.loadedFrom)) {
      signature = next;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= timing.settleMs) {
      return mounted;
    }
  }
  throw new Error('chatgpt_export_thread_unsettled');
}

/**
 * Scroll to the top until ChatGPT has no older page left to load. Returns
 * false when its history spinner stays but no page arrives: older turns exist
 * that the page will not load for a script.
 */
async function loadFullHistory(context: CrawlContext): Promise<boolean> {
  const { root, view, timing, options } = context;
  let signature = '';
  let changedAt = Date.now();
  for (;;) {
    assertActive(options);
    view.scrollTo(0);
    await wait(timing.pollMs, options.signal);
    const first = mountedTurnItems(root)[0] ?? null;
    const next = `${first ? readTurnKey(first) : ''}|${Math.round(view.range())}`;
    if (next !== signature) {
      signature = next;
      changedAt = Date.now();
      continue;
    }
    const pending = hasPendingHistory(root, first);
    const idleFor = Date.now() - changedAt;
    if (!pending && first && view.offset() <= 1 && idleFor >= timing.historyIdleMs) return true;
    if (idleFor >= timing.historyStallMs) {
      if (pending && first) return false;
      throw new Error('chatgpt_export_history_unavailable');
    }
  }
}

interface CapturedItem {
  readonly messages: ChatGptThreadMessage[];
  readonly fingerprint: string;
}

/** Extract one item's messages, waiting briefly for content that is still mounting. */
async function captureItem(context: CrawlContext, key: string): Promise<CapturedItem> {
  const { root, timing, options } = context;
  const deadline = Date.now() + timing.mountTimeoutMs;
  for (;;) {
    assertActive(options);
    const item = findMountedTurnItem(root, key);
    if (!item) throw new Error(`chatgpt_export_message_unavailable:${key}`);
    if (isItemGenerating(root, item)) throw new Error('chatgpt_export_response_still_generating');

    const bubble = findUserBubble(item);
    const reply = findAssistantReply(item);
    const ready =
      (bubble !== null || reply !== null) &&
      (!bubble || hasRenderedContent(bubble)) &&
      (!reply || hasRenderedContent(reply));
    if (ready || Date.now() >= deadline) {
      const fingerprint = readTurnFingerprint(item);
      if (!bubble && !reply) {
        // Not a message item. One that shows content has a shape this export
        // does not know, so dropping it would lose part of the conversation.
        if (hasRenderedContent(item)) throw new Error(`chatgpt_export_message_unavailable:${key}`);
        return { messages: [], fingerprint };
      }
      // A bubble or reply still empty after the wait is blank in ChatGPT too.
      const messages: ChatGptThreadMessage[] = [];
      const starHash = bubble ? chatGptTurnHash(bubble) : undefined;
      if (bubble && hasRenderedContent(bubble)) {
        const content = extractUserMessage(item, bubble, options.extractor);
        if (!isEmptyContent(content)) {
          messages.push({
            id: userMessageId(key),
            turnKey: key,
            role: 'user',
            content,
            host: userSelectionHost(item, bubble),
            fingerprint,
            starHash,
          });
        }
      }
      if (reply && hasRenderedContent(reply)) {
        const content = extractAssistantMessage(item, reply, options.extractor);
        if (!isEmptyContent(content)) {
          messages.push({
            id: assistantMessageId(key),
            turnKey: key,
            role: 'assistant',
            content,
            host: reply,
            fingerprint,
            starHash,
          });
        }
      }
      return { messages, fingerprint };
    }
    await wait(timing.pollMs, options.signal);
  }
}

async function walkThread(context: CrawlContext): Promise<ChatGptThreadMessage[]> {
  const { root, view, timing, options } = context;
  const fingerprints = new Map<string, string>();
  const order: string[] = [];
  const messages: ChatGptThreadMessage[] = [];
  let anchoredOffset = 0;
  let gapRetries = 0;

  view.scrollTo(0);
  for (let step = 0; ; step++) {
    if (step > timing.maxSteps) throw new Error('chatgpt_export_thread_incomplete');
    const mounted = await settleWindow(context);
    const keys = mounted.items.map(readTurnKey);
    mounted.items.forEach((item, index) => {
      const recorded = fingerprints.get(keys[index]!);
      if (recorded !== undefined && readTurnFingerprint(item) !== recorded) {
        throw new Error('chatgpt_export_thread_changed');
      }
    });

    let start = 0;
    const tail = order.at(-1);
    if (tail === undefined) {
      const started = context.loadedFrom
        ? atLoadedStart(context, mounted)
        : atThreadStart(context, mounted);
      if (!started) throw new Error('chatgpt_export_thread_incomplete');
    } else {
      const tailIndex = keys.indexOf(tail);
      if (tailIndex < 0) {
        // The scroll skipped past every recorded item, so an unseen one may
        // lie in between. Retry from halfway back to where the tail was mounted.
        if (++gapRetries > MAX_GAP_RETRIES) throw new Error('chatgpt_export_thread_gap');
        view.scrollTo(anchoredOffset + (view.offset() - anchoredOffset) / 2);
        continue;
      }
      if (keys.slice(0, tailIndex).some((key) => !fingerprints.has(key))) {
        throw new Error('chatgpt_export_thread_order');
      }
      start = tailIndex + 1;
    }
    gapRetries = 0;

    for (const key of keys.slice(start)) {
      if (fingerprints.has(key)) throw new Error('chatgpt_export_thread_order');
      const captured = await captureItem(context, key);
      messages.push(...captured.messages);
      fingerprints.set(key, captured.fingerprint);
      order.push(key);
      options.onProgress?.(order.length);
    }

    const after = readWindow(context);
    const lastItem = after.items.at(-1);
    if (lastItem && readTurnKey(lastItem) === order.at(-1) && atThreadEnd(context, after)) {
      return messages;
    }

    const current = view.offset();
    anchoredOffset = current;
    const tailItem = findMountedTurnItem(root, order[order.length - 1]!);
    const tailTop = tailItem ? view.offsetOf(tailItem) : current;
    view.scrollTo(
      tailTop > current + 1 ? tailTop : current + view.viewportHeight() * TALL_ITEM_STEP,
    );
    if (view.offset() <= current) throw new Error('chatgpt_export_thread_incomplete');
  }
}

/**
 * Put the turns ChatGPT would not load in front of the crawled ones. They are
 * the ancestors of the first loaded turn's prompt, so the branch on screen
 * decides them, not the branch the server last saved.
 */
async function prependUnloadedHistory(
  context: CrawlContext,
  crawled: ChatGptThreadMessage[],
): Promise<ChatGptThreadMessage[]> {
  const { options, loadedFrom } = context;
  if (!loadedFrom) return crawled;
  const older = await (options.history ?? chatGptHistory).turnsBefore(
    options.expectedUrl ?? location.href,
    loadedFrom,
    options.signal,
  );
  assertActive(options);
  const messages = [...apiTurnMessages(older), ...crawled];
  options.onProgress?.(new Set(messages.map((message) => message.turnKey)).size);
  return messages;
}

interface ScrollRestore {
  restore(): Promise<void>;
}

/**
 * Remember the reader's place: the first visible item and how far it sits
 * below the viewport top, plus the distance from the end of the thread, which
 * history loaded above does not change.
 */
function captureReaderPosition(context: CrawlContext): ScrollRestore {
  const { root, view } = context;
  const distanceFromEnd = view.range() - view.offset();
  const viewTop = view.offset();
  const anchor = mountedTurnItems(root).find(
    (item) => view.offsetOf(item) + item.getBoundingClientRect().height > viewTop,
  );
  const anchorKey = anchor ? readTurnKey(anchor) : null;
  const anchorDelta = anchor ? view.offsetOf(anchor) - viewTop : 0;
  return {
    async restore() {
      view.scrollTo(view.range() - distanceFromEnd);
      if (!anchorKey) return;
      await new Promise((resolve) => window.setTimeout(resolve, context.timing.pollMs));
      const item = findMountedTurnItem(root, anchorKey);
      if (item) view.scrollTo(view.offsetOf(item) - anchorDelta);
    },
  };
}

/**
 * Crawl the visible ChatGPT thread. Returns its messages in conversation order,
 * or throws when it cannot prove the list complete. The reader's scroll
 * position is restored either way.
 */
export async function crawlChatGptThread(
  options: ChatGptCrawlOptions,
): Promise<ChatGptThreadMessage[]> {
  assertActive(options);
  const timing = { ...DEFAULT_CHATGPT_CRAWL_TIMING, ...options.timing };
  const root = resolveVisibleConversationRoot(document);
  const first = mountedTurnItems(root)[0];
  if (!first) throw new Error('chatgpt_export_no_turns');
  if (isChatGptThreadGenerating(root)) throw new Error('chatgpt_export_response_still_generating');

  const context: CrawlContext = {
    root,
    view: createScrollView(findScrollContainer(first)),
    options,
    timing,
    loadedFrom: null,
  };
  const position = captureReaderPosition(context);
  let messages: ChatGptThreadMessage[];
  try {
    if (!(await loadFullHistory(context))) {
      const firstLoaded = mountedTurnItems(root)[0];
      if (!firstLoaded) throw new Error('chatgpt_export_history_unavailable');
      context.loadedFrom = readTurnKey(firstLoaded);
    }
    messages = await walkThread(context);
    if (context.loadedFrom) messages = await prependUnloadedHistory(context, messages);
  } finally {
    await position.restore();
  }
  // Restoring the position cannot be cancelled; a cancel or route change that
  // arrived meanwhile still wins over the result.
  assertActive(options);
  return messages;
}
