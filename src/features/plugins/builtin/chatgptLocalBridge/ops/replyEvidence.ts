import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
/**
 * A reply that will not finish, and what the page shows around it.
 *
 * ChatGPT can lose a long turn's stream: the turn then shows "Connection
 * interrupted. Waiting for the complete answer" (zh-CN 「连接已中断，正在等待完整答复」)
 * and, by field reports from 2026-10, never delivers after it. Its
 * DOM has not been measured yet, so the notice is found by those words outside
 * the prompt and the reply's own text, and every stall or timeout carries the
 * page's state around the reply, for the next time it happens live.
 */
import type { SiteAdapter } from '@/features/plugins/types';

import { touchesRepairedChatgptReplyContent } from '../../chatgptReplyContent';
import {
  USER_UNIT_SELECTOR,
  hasStopControl,
  replyTextOf,
  thinkingSignalsOf,
  turnStateOf,
} from './pageReaders';

const INTERRUPTED_COPY = chatgptPageData.interruptedCopy.map((source) => new RegExp(source, 'i'));
/** Quick test of the whole turn before looking for the notice element. */
const INTERRUPTED_ANYWHERE = new RegExp(chatgptPageData.interruptedAnywhere, 'i');
const NOTICE_MAX_CHARS = 200;
const REPLY_BODY_SELECTOR = chatgptPageData.assistantMarkdown;
const NOTICE_SELECTOR = chatgptPageData.replyNotice;
const TEXT_MAX_CHARS = 300;
const LIST_MAX = 8;

const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

const OWN_TEXT_SELECTOR = `${USER_UNIT_SELECTOR}, ${REPLY_BODY_SELECTOR}`;

/** A short element that opens with the copy and holds none of the prompt's or the reply's text. */
function isNotice(element: Element): boolean {
  if (element.closest(OWN_TEXT_SELECTOR) || element.querySelector(OWN_TEXT_SELECTOR)) return false;
  if (touchesRepairedChatgptReplyContent(element)) return false;
  const text = flat(element.textContent);
  return (
    text.length > 0 &&
    text.length <= NOTICE_MAX_CHARS &&
    INTERRUPTED_COPY.some((pattern) => pattern.test(text))
  );
}

/** The innermost match: a wrapper around the notice also holds its retry button's text. */
function innermost(elements: Element[]): Element | undefined {
  return elements.find(
    (element) => !elements.some((other) => other !== element && element.contains(other)),
  );
}

/** The interruption notice in the reply's turn, or in a page alert outside the thread. */
export function interruptionNotice(item: HTMLElement): string | null {
  const inTurn = INTERRUPTED_ANYWHERE.test(item.textContent ?? '')
    ? innermost(Array.from(item.querySelectorAll('*')).filter(isNotice))
    : undefined;
  const found =
    inTurn ??
    innermost(
      Array.from(document.querySelectorAll(NOTICE_SELECTOR)).filter(
        (element) => !element.closest(chatgptPageData.turnItem) && isNotice(element),
      ),
    );
  return found ? flat(found.textContent) : null;
}

/** What a stalled or timed-out wait saw around the reply, so a new failure state can be named later. */
export function replyEvidence(
  item: HTMLElement | null,
  reply: HTMLElement | null,
  adapter: SiteAdapter | null,
): Record<string, unknown> {
  if (!item) return { stop: hasStopControl(adapter) };
  const turnNotices = Array.from(item.querySelectorAll(NOTICE_SELECTOR))
    .map((element) => flat(element.textContent).slice(0, TEXT_MAX_CHARS))
    .filter(Boolean)
    .slice(0, LIST_MAX);
  const afterReply = reply
    ? Array.from(item.querySelectorAll(chatgptPageData.replyActions))
        .filter(
          (button) =>
            !reply.contains(button) &&
            !!(reply.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
        )
        .map((button) => flat(button.getAttribute('aria-label') ?? button.textContent) || '(icon)')
        .slice(0, LIST_MAX)
    : [];
  const notice = interruptionNotice(item);
  return {
    turnState: turnStateOf(item),
    stop: hasStopControl(adapter),
    thinking: thinkingSignalsOf(item),
    turnNotices,
    buttonsAfterReply: afterReply,
    replyTail: reply ? replyTextOf(reply).slice(-TEXT_MAX_CHARS) : null,
    ...(notice ? { interrupted: notice } : {}),
  };
}
