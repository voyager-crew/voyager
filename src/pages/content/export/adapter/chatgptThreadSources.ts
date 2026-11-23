import { logger } from '@/core/services/LoggerService';
import {
  DEFAULT_EXPORT_THREAD_ORDER,
  type ExportCrawlSection,
  type ExportThreadSource,
} from '@/features/plugins/sites/sections/exportCrawlData';
import type { SiteAdapter } from '@/features/plugins/types';

import { isAbortError } from '../exportCancellation';
import {
  type ChatGptCrawlBehavior,
  type ChatGptCrawlOptions,
  type ChatGptCrawlTiming,
  crawlChatGptThread,
} from './chatgptCrawl';
import { apiTurnMessages, chatGptHistory } from './chatgptHistoryApi';
import { assertActive } from './chatgptShared';
import {
  type ChatGptThreadMessage,
  findAssistantReply,
  findUserBubble,
  isChatGptThreadGenerating,
  mountedTurnItems,
  readTurnFingerprint,
  readTurnKey,
  resolveVisibleConversationRoot,
} from './chatgptThread';

/**
 * Where an export reads the whole ChatGPT conversation from, in the order the
 * site data names (`exportThread`): the page walk (`crawl`), or ChatGPT's
 * conversation endpoint (`api`). A ChatGPT redesign that breaks the walk then
 * costs the export its rich formatting (endpoint replies are plain Markdown),
 * not the export itself.
 */

export interface ChatGptThreadReadOptions extends ChatGptCrawlOptions {
  readonly order?: readonly ExportThreadSource[];
}

/**
 * Failures that say something about the conversation, not about how it was
 * read: another source would read the same unfinished or departed thread.
 */
const FINAL_FAILURES = [
  'chatgpt_export_response_still_generating',
  'chatgpt_export_conversation_changed',
];

function canTryNextSource(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !FINAL_FAILURES.some((code) => message.includes(code));
}

/** The crawl options the site data sets; fields it leaves out keep the crawl's defaults. */
export function chatGptCrawlSettings(site: SiteAdapter): {
  readonly order: readonly ExportThreadSource[];
  readonly timing: Partial<ChatGptCrawlTiming>;
  readonly behavior: Partial<ChatGptCrawlBehavior>;
} {
  const crawl: ExportCrawlSection | undefined = site.exportCrawl;
  const timing: { -readonly [key in keyof ChatGptCrawlTiming]?: number } = {};
  const behavior: { -readonly [key in keyof ChatGptCrawlBehavior]?: ChatGptCrawlBehavior[key] } =
    {};
  if (crawl) {
    for (const key of [
      'pollMs',
      'settleMs',
      'mountTimeoutMs',
      'historyIdleMs',
      'historyStallMs',
    ] as const) {
      const value = crawl[key];
      if (value !== undefined) timing[key] = value;
    }
    if (crawl.extent) behavior.extent = crawl.extent;
    if (crawl.upwardScroll) behavior.upwardScroll = crawl.upwardScroll;
    if (crawl.direction) behavior.direction = crawl.direction;
  }
  return { order: site.exportThread?.order ?? DEFAULT_EXPORT_THREAD_ORDER, timing, behavior };
}

/**
 * Read the conversation's saved branch from the endpoint, checked against the
 * page: every message turn on screen must be in it, in the version shown.
 * A mounted turn takes the fingerprint the page gives it, so the export's
 * version watch compares the page with itself.
 */
async function readFromEndpoint(options: ChatGptCrawlOptions): Promise<ChatGptThreadMessage[]> {
  assertActive(options);
  const root = resolveVisibleConversationRoot(document);
  if (isChatGptThreadGenerating(root)) throw new Error('chatgpt_export_response_still_generating');
  const turns = await (options.history ?? chatGptHistory).currentBranch(
    options.expectedUrl ?? location.href,
    options.signal,
  );
  assertActive(options);
  const messages = apiTurnMessages(turns);
  const shown = new Map<string, string>();
  for (const item of mountedTurnItems(root)) {
    const key = readTurnKey(item);
    const fingerprint = readTurnFingerprint(item);
    const read = messages.find((message) => message.turnKey === key);
    if (!read) {
      if (findUserBubble(item) || findAssistantReply(item)) {
        throw new Error('chatgpt_export_history_mismatch');
      }
      continue;
    }
    // Ids on the page that differ name another branch; a page without ids cannot tell.
    if (fingerprint.startsWith('ids:') && fingerprint !== read.fingerprint) {
      throw new Error('chatgpt_export_history_mismatch');
    }
    shown.set(key, fingerprint);
  }
  options.onProgress?.(turns.length);
  return messages.map((message) => {
    const fingerprint = shown.get(message.turnKey);
    return fingerprint ? { ...message, fingerprint } : message;
  });
}

/**
 * Read the whole thread from each source in `order` until one succeeds. When
 * every source fails, the first failure is the one reported.
 */
export async function readChatGptThread(
  options: ChatGptThreadReadOptions,
): Promise<ChatGptThreadMessage[]> {
  const order = options.order?.length ? options.order : DEFAULT_EXPORT_THREAD_ORDER;
  let failure: { readonly error: unknown } | null = null;
  for (const [index, source] of order.entries()) {
    try {
      return source === 'crawl'
        ? await crawlChatGptThread(options)
        : await readFromEndpoint(options);
    } catch (error) {
      if (!canTryNextSource(error)) throw error;
      // The caller reports the first failure; log the ones it will not see.
      if (failure || index < order.length - 1) {
        // The code goes in the text: consoles fold a data object to `Object`.
        logger.warn(`ChatGPT export could not read the conversation (${source}): ${String(error)}`);
      }
      failure ??= { error };
    }
  }
  throw failure ? failure.error : new Error('chatgpt_export_thread_incomplete');
}
