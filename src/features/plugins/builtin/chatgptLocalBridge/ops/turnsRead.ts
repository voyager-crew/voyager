/**
 * `turns.read` (spec §3.4, passive): one finished reply as Markdown, through
 * the export's own extractor and ChatGPT dialect. No clipboard hook, no
 * backend JSON. The localized role heading ("ChatGPT 说：") is left out by
 * structure; a heading text line is dropped only as a fallback.
 *
 * With `latest` it reads the conversation's last turn, once that turn's reply
 * is the message ChatGPT says the conversation ends on (`current_node`, from
 * the page's own request; `PageData.currentNode`). That turn must show a
 * finished reply: one still being written is `unverified`, never an earlier
 * reply in its place.
 *
 * `files` lists the sandbox files the turn links (`sandboxFiles.ts`), from
 * ChatGPT's own conversation answer; a turn that answer did not include (one
 * the page has not fetched since it was written) lists none.
 */
import type { FileCandidate, TurnsReadParams, TurnsReadResult } from '@/features/bridge/protocol';
import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';
import { resolveChatgptReplyContent } from '@/features/plugins/builtin/chatgptReplyContent';
import { hasReplyActions } from '@/features/plugins/builtin/chatgptResponseNotification/page';
import type { SiteAdapter } from '@/features/plugins/types';
import { extractAssistantMessage } from '@/pages/content/export/adapter/chatgptThread';
import { buildChatGptAdapter } from '@/pages/content/export/adapter/platform/chatgpt';

import { GRANT_MARGIN_MS, type OpContext } from '../opContext';
import type { PageData } from '../pageData/store';
import { requirePageObserver } from './pageObserver';
import {
  conversationItems,
  findReply,
  findReplyByKey,
  hasStopControl,
  hasThinkingSignal,
  isCompleteTurnState,
  readTurnKey,
  replyIdOf,
  settledConversationId,
  sha256Hex,
  siteOf,
  turnStateOf,
} from './pageReaders';
import { interruptionNotice } from './replyEvidence';
import { sandboxCandidates, turnMessages } from './sandboxFiles';

// Fallback only: the heading's text in the UI languages measured or shipped by ChatGPT.
const HEADING_LINE = /^(?:#{1,6}\s*)?(?:ChatGPT said:|ChatGPT 说：|ChatGPT 說：)\s*\n+/;

const LATEST_TIMEOUT_MS = 20_000;

interface FoundReply {
  readonly item: HTMLElement;
  readonly reply: HTMLElement;
  readonly turnKey: string;
}

/** The read fails once the tab shows another conversation than the one asked for. */
function requireConversation(ctx: OpContext, conversationId: string): void {
  const actual = settledConversationId();
  if (actual === conversationId) return;
  ctx.fail('unverified', 'The tab left the conversation while it was read.', {
    reason: 'route-changed',
    expected: conversationId,
    actual,
  });
}

/** The last mounted turn, once its reply is the message the conversation ends on. */
async function currentLastItem(
  ctx: OpContext,
  conversationId: string,
  pageData: PageData,
): Promise<HTMLElement | null> {
  // Three polls without a change once passed for the end of the thread; a slow history
  // answer showed an older reply that long.
  const found = await ctx.waitFor(
    () => {
      // A passive op has no route guard, and an in-app navigation keeps the document:
      // without this the thread settles on the other conversation's turns.
      requireConversation(ctx, conversationId);
      const currentNode = pageData.currentNode(conversationId);
      const last = conversationItems().at(-1);
      const reply = last ? findReply(last) : null;
      return currentNode && reply && replyIdOf(reply) === currentNode ? last : null;
    },
    {
      timeoutMs: Math.max(
        0,
        Math.min(LATEST_TIMEOUT_MS, ctx.grant.deadline - GRANT_MARGIN_MS - ctx.now()),
      ),
    },
  );
  return found ?? null;
}

/**
 * The conversation's last turn and its reply, proven finished: the reply has
 * rendered with its action row, the turn state (when the turn has one) reads
 * complete, and nothing is still thinking or streaming.
 */
async function findLatestReply(
  ctx: OpContext,
  conversationId: string,
  adapter: SiteAdapter | null,
  pageData: PageData,
): Promise<FoundReply> {
  await requirePageObserver(ctx, pageData);
  const current = await currentLastItem(ctx, conversationId, pageData);
  const item = current ?? conversationItems().at(-1);
  if (!item) ctx.fail('selector-missing', 'The conversation shows no turns.');
  const reply = findReply(item);
  refuseInterrupted(ctx, item);
  const state = turnStateOf(item);
  const unfinished =
    !reply ||
    (state !== null && !isCompleteTurnState(state)) ||
    hasStopControl(adapter) ||
    hasThinkingSignal(item) ||
    !hasReplyActions(reply);
  if (unfinished) {
    ctx.fail('unverified', 'The last reply is still being written.', {
      reason: 'still-generating',
      turnState: state,
      hasReply: reply !== null,
    });
  }
  if (!current) {
    ctx.fail('unverified', 'The conversation could not be confirmed as loaded to its end.', {
      reason: 'history-unconfirmed',
      knownEnd: pageData.currentNode(conversationId) !== null,
    });
  }
  return { item, reply, turnKey: replyIdOf(reply) ?? readTurnKey(item) };
}

/** A reply ChatGPT shows as cut short by a lost connection is not a reply to save. */
function refuseInterrupted(ctx: OpContext, item: HTMLElement): void {
  const notice = interruptionNotice(item);
  if (notice) {
    ctx.fail('unverified', 'ChatGPT lost the connection before the reply was complete.', {
      reason: 'connection-interrupted',
      notice,
    });
  }
}

async function findKeyedReply(
  ctx: OpContext,
  key: string,
  adapter: SiteAdapter | null,
): Promise<FoundReply> {
  const found = findReplyByKey(key);
  if (!found) ctx.fail('selector-missing', 'The reply is not on the page.');
  refuseInterrupted(ctx, found.item);
  const state = turnStateOf(found.item);
  if ((state !== null && !isCompleteTurnState(state)) || hasStopControl(adapter)) {
    ctx.fail('unverified', 'The reply is still being written.', { reason: 'still-generating' });
  }
  return { ...found, turnKey: key };
}

/** The sandbox files the turn links, as ChatGPT's last conversation answer lists it. */
function turnFiles(pageData: PageData, conversationId: string, anchor: string): FileCandidate[] {
  const messages = pageData.messages(conversationId);
  const turn = messages ? turnMessages(messages, anchor) : null;
  return turn ? sandboxCandidates(turn) : [];
}

export async function runTurnsRead(
  ctx: OpContext,
  params: TurnsReadParams,
  adapter: SiteAdapter | null,
  pageData: PageData,
): Promise<TurnsReadResult> {
  if (settledConversationId() !== params.conversationId) {
    ctx.fail('unverified', 'The tab shows another conversation.', {
      expected: params.conversationId,
      actual: settledConversationId(),
    });
  }
  const found =
    'latest' in params
      ? await findLatestReply(ctx, params.conversationId, adapter, pageData)
      : await findKeyedReply(ctx, params.assistantTurnKey, adapter);
  requireConversation(ctx, params.conversationId);

  const extractor = createContentExtractor(buildChatGptAdapter(siteOf(adapter)));
  const content = extractAssistantMessage(
    found.item,
    resolveChatgptReplyContent(found.reply),
    extractor,
  );
  const markdown = content.text.trim().replace(HEADING_LINE, '').trim();
  const messageId = replyIdOf(found.reply);
  return {
    markdown,
    turnKey: found.turnKey,
    ...(messageId ? { messageId } : {}),
    textSha256: await sha256Hex(markdown),
    files: turnFiles(pageData, params.conversationId, messageId ?? found.turnKey),
  };
}
