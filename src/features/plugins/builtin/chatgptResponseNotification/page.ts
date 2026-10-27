import { getSiteSelectorView } from '@/core/selectors';
import { nativeSiteComposerRoot } from '@/core/services/composer/siteInputReads';
import { readChatGptConversationPath } from '@/features/folder/sites/chatgptIdentity';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import type { SiteAdapter } from '@/features/plugins/types';

import {
  BUNDLED_NOTIFICATION_SELECTORS,
  type ChatgptNotificationSelectors,
  hasNotificationSelectorFixes,
  notificationSelectorsOf,
} from '../chatgptNotificationSelectors';

/**
 * Read-only views of the ChatGPT page that the completion run inspects, as
 * measured live (October 2026, zh-CN UI, tab hidden throughout):
 * - The sent prompt's bubble (`userTurn`) renders at once; in a hidden tab its
 *   reply (`assistantTurn`, same `[data-turn-key]` item) appears only at the
 *   end, with the copy/read-aloud/regenerate row after it, in the frame the
 *   stop control goes away. A prompt the user just sent that is still waiting
 *   for its reply is the language-neutral generation signal.
 * - Opening a conversation can render a prompt before its reply too, which is
 *   why that signal needs a send from this page.
 * - No element carries a `data-testid`. In the composer (`composerRoot`) the
 *   stop control takes the voice button's slot: `button[type="button"]` with an
 *   inline svg and a localized label ("停止"). The other composer buttons draw
 *   sprite icons (`<use href>`); send (`sendButton`) is `type="submit"`.
 * - Earlier conversations of the tab stay in the DOM under a `display: none`
 *   ancestor, a stale composer and stop control included, so every reader
 *   skips unrendered nodes.
 *
 * The selectors come from the site adapter (`catalog/sites/chatgpt/site.json`).
 * Kept here, because the adapter names none of them: the turn item, the reply
 * id attribute and the stop control's labels.
 */

// The `[data-turn-key]` item that holds one prompt and its reply; the adapter
// only lists it as a key attribute (`turnKeyAttributes`), not as a container.
const TURN_SELECTOR = chatgptPageData.turnItem;
// The adapter's `assistantTurn` names the reply by this attribute; its value is the reply id.
const REPLY_ID_ATTRIBUTE = 'data-chatgpt-selection-message-id';
const LEGACY_STOP_SELECTOR = '[data-testid="stop-button"]';
// Only a hint, for a reply that is already streaming in view: labels follow the UI language.
// "停止" is measured; the English forms and the test id are the earlier DOM's.
const STOP_LABEL = /^(?:stop(?: streaming| generating)?|停止(?:生成)?)$/i;
const ACTION_SCOPE_MAX_PARENT_DEPTH = 6;
const MAX_TITLE_LENGTH = 80;

function isRendered(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function queryAll(selector: string, root: ParentNode = document): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function closest(element: Element, selector: string): Element | null {
  try {
    return element.closest(selector);
  } catch {
    return null;
  }
}

function hasStopLabel(button: HTMLButtonElement): boolean {
  if (button.matches(LEGACY_STOP_SELECTOR)) return true;
  return STOP_LABEL.test(normalizeText(button.getAttribute('aria-label')));
}

export interface ChatGptPage {
  /** Whether a rendered composer shows a stop control under a label this build knows. */
  hasLabelledStopControl(): boolean;
  /** The latest rendered prompt has no rendered reply with text after it yet. */
  isAwaitingReply(): boolean;
  /** Whether a click landed on the composer's stop control. */
  isStopControlTarget(target: EventTarget | null): boolean;
  /** Whether a click or key press sends the composer's prompt. */
  isSendGesture(event: Event): boolean;
  getLatestReply(): HTMLElement | null;
  /** The prompt the reply answers: the bubble in its own turn, else the latest rendered one. */
  getPromptForReply(reply: HTMLElement | null): string;
}

function readPage(selectors: ChatgptNotificationSelectors): ChatGptPage {
  // Cached OFF aliases keep the baseline closest-root checks without new ownership inference.
  const online = getSiteSelectorView('chatgpt').semanticSource !== 'adapter';
  const repairedComposer = online && selectors.composer !== BUNDLED_NOTIFICATION_SELECTORS.composer;
  const repairedRoot =
    online && selectors.composerRoot !== BUNDLED_NOTIFICATION_SELECTORS.composerRoot;
  /** The roots of the rendered composers; a hidden earlier conversation keeps its own. */
  const composerRoots = (): Element[] => {
    const roots = new Set<Element>();
    for (const composer of queryAll(selectors.composer)) {
      if (!(composer instanceof HTMLElement)) continue;
      const root =
        repairedComposer && !repairedRoot
          ? nativeSiteComposerRoot('chatgpt', composer)
          : closest(composer, selectors.composerRoot);
      if (root && isRendered(composer)) roots.add(root);
    }
    return [...roots];
  };

  const getLatestReply = (): HTMLElement | null => {
    const replies = queryAll(selectors.assistantTurn);
    for (let index = replies.length - 1; index >= 0; index -= 1) {
      const reply = replies[index];
      if (reply instanceof HTMLElement && isRendered(reply) && normalizeText(reply.textContent))
        return reply;
    }
    return null;
  };

  const latestRenderedPrompt = (): Element | undefined =>
    queryAll(selectors.userTurn).filter(isRendered).at(-1);

  return {
    hasLabelledStopControl: () =>
      composerRoots().some((root) =>
        queryAll('button', root).some(
          (button) =>
            button instanceof HTMLButtonElement && hasStopLabel(button) && isRendered(button),
        ),
      ),

    isAwaitingReply: () => {
      const prompt = latestRenderedPrompt();
      if (!prompt) return false;
      const reply = getLatestReply();
      return !reply || !!(prompt.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_PRECEDING);
    },

    // Its label is localized, so a known label, or else the composer's only kind of
    // button that draws its icon inline rather than from the sprite, marks it.
    isStopControlTarget: (target) => {
      if (!(target instanceof Element)) return false;
      const button = target.closest('button');
      if (
        !button ||
        (repairedComposer || repairedRoot
          ? !composerRoots().some((root) => root.contains(button))
          : !closest(button, selectors.composerRoot))
      )
        return false;
      if (hasStopLabel(button)) return true;
      // Work mode's 选择项目 / 文件 buttons also draw inline svgs, but carry visible text.
      return (
        button.type === 'button' &&
        !!button.querySelector('svg') &&
        !button.querySelector('use') &&
        normalizeText(button.textContent) === ''
      );
    },

    isSendGesture: (event) => {
      if (!(event.target instanceof Element)) return false;
      if (event.type === 'click') return !!closest(event.target, selectors.sendButton);
      if (event.type !== 'keydown' || !(event instanceof KeyboardEvent)) return false;
      return (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        !!closest(event.target, selectors.composer)
      );
    },

    getLatestReply,

    getPromptForReply: (reply) => {
      const turn = reply ? closest(reply, TURN_SELECTOR) : null;
      const own = turn ? queryAll(selectors.userTurn, turn)[0] : undefined;
      if (own) return normalizeText(own.textContent);
      return normalizeText(latestRenderedPrompt()?.textContent);
    },
  };
}

/** Freeze data at startup; prove each current operation's DOM only when the data differs. */
export function createChatGptPage(adapter: SiteAdapter | null): ChatGptPage {
  if (!hasNotificationSelectorFixes()) return readPage(notificationSelectorsOf(adapter));
  // A page can start before its renamed thread/composer mounts; reprove each current operation.
  const current = () => readPage(notificationSelectorsOf(adapter));
  return {
    hasLabelledStopControl: () => current().hasLabelledStopControl(),
    isAwaitingReply: () => current().isAwaitingReply(),
    isStopControlTarget: (target) => current().isStopControlTarget(target),
    isSendGesture: (event) => current().isSendGesture(event),
    getLatestReply: () => current().getLatestReply(),
    getPromptForReply: (reply) => current().getPromptForReply(reply),
  };
}

/** Which reply, and what it says: a regenerated reply gets a new id, a new send a new node. */
export function getReplyIdentity(reply: HTMLElement): string {
  return `${reply.getAttribute(REPLY_ID_ATTRIBUTE) ?? ''}|${normalizeText(reply.textContent)}`;
}

function actionScope(reply: HTMLElement): HTMLElement | null {
  const turn = reply.closest<HTMLElement>(TURN_SELECTOR);
  if (turn) return turn;
  let scope: HTMLElement | null = reply;
  for (let depth = 0; scope && depth < ACTION_SCOPE_MAX_PARENT_DEPTH; depth += 1) {
    scope = scope.parentElement;
  }
  return scope;
}

/**
 * Whether the reply's action row (copy, read aloud, regenerate) has rendered.
 * Labels are localized, so any button after the reply in its turn counts: the
 * prompt's own buttons come before it.
 */
export function hasReplyActions(reply: HTMLElement): boolean {
  const scope = actionScope(reply);
  if (!scope) return false;
  return Array.from(scope.querySelectorAll(chatgptPageData.replyActions)).some(
    (button) =>
      !reply.contains(button) &&
      !!(reply.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}

export function getChatGptConversationTitle(): string {
  const title = normalizeText(document.title.replace(/\s*[-|–]\s*ChatGPT\s*$/i, ''));
  if (!title || /^chatgpt$/i.test(title)) return '';
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/** The route's conversation id; null on a page without one (a new chat). */
export function readConversationId(pathname: string = location.pathname): string | null {
  return readChatGptConversationPath(pathname)?.id ?? null;
}

/**
 * A new chat is addressed in steps: `/` → `/c/local-chatgpt:<uuid>` while the
 * first reply is written → `/c/<id>` once the server names it. Those steps keep
 * the conversation; any other route change leaves it.
 */
export function isSameConversation(previous: string | null, next: string | null): boolean {
  if (previous === next) return true;
  const provisional = (id: string | null): boolean => id !== null && id.startsWith('local-');
  if (previous === null) return provisional(next);
  return provisional(previous) && next !== null && !provisional(next);
}
