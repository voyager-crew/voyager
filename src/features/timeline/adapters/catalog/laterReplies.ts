import { turnSummary } from './turnHash';
import type { MountedTurn } from './turnMerge';

const pageOrder = (a: Node, b: Node): number =>
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

/**
 * The rendered user turns, in page order, with each reply that follows
 * another reply with no user turn between them. A ChatGPT scheduled task
 * keeps one prompt and appends a reply per run, so those runs get a marker
 * each; the first reply after a prompt is reached through the prompt's
 * marker, and a conversation with one reply per prompt adds none.
 */
export function mountedTurnsWithLaterReplies(
  container: ParentNode,
  turnSelector: string,
  replySelector: string,
  rendered: (element: Element) => boolean,
): MountedTurn[] {
  const users = new Set(
    Array.from(container.querySelectorAll<HTMLElement>(turnSelector)).filter(rendered),
  );
  const replies = Array.from(container.querySelectorAll<HTMLElement>(replySelector)).filter(
    (element) => !users.has(element) && rendered(element),
  );
  const result: MountedTurn[] = [];
  let lastReply: HTMLElement | null = null;
  let replied = false;
  for (const element of [...users, ...replies].sort(pageOrder)) {
    if (users.has(element)) {
      result.push({ element, summary: turnSummary(element) });
      replied = false;
      continue;
    }
    // A reply nested in the one before it is part of that reply.
    if (lastReply?.contains(element)) continue;
    if (replied) result.push({ element, summary: turnSummary(element), reply: true });
    replied = true;
    lastReply = element;
  }
  return result;
}
