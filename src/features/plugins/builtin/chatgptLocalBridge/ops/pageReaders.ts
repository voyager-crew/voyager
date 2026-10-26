/**
 * Read-only views of the ChatGPT page the bridge ops share. Measured live on
 * 2026-10-17 (zh-CN UI); structure and attributes come first, localized text
 * is never a primary selector:
 * - `[data-turn-key]` items hold one prompt and its reply. The prompt is
 *   `[data-user-message-bubble]` inside a `[data-chatgpt-search-unit-key]`
 *   unit ending in `:user`; the reply is `[data-chatgpt-selection-message-id]`
 *   inside a unit ending in `:assistant`, which also carries the localized
 *   `h4[data-conversation-role="assistant"]` heading ("ChatGPT 说：").
 * - `[data-talvt-turn-state="complete"]` inside an item marks a finished turn;
 *   the value while generating was not observed.
 * - The send control has no test id: the composer form's `button[type=submit]`.
 * - Earlier conversations of the tab stay in the DOM under `display: none`.
 */
import { getSiteSelectorView, withPageSemanticSelectors } from '@/core/selectors';
import { chatgptSignalSelector } from '@/core/selectors/chatgptSignals';
import { findComposer } from '@/core/services/composer';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import {
  createChatGptPage,
  readConversationId,
} from '@/features/plugins/builtin/chatgptResponseNotification/page';
import {
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_SEND_CONTROL_SELECTOR,
} from '@/features/plugins/builtin/chatgptTemporaryHandoff/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import type { SiteAdapter } from '@/features/plugins/types';
import {
  findAssistantReply,
  findUserBubble,
  isRendered,
  mountedTurnItems,
  readTurnKey,
  resolveVisibleConversationRoot,
} from '@/pages/content/export/adapter/chatgptThread';

import {
  chatgptComposerRootOf,
  resolveChatgptComposer,
  resolveChatgptSend,
} from '../../chatgptComposerTargets';

/** The protocol's id shape; a new chat's provisional `local-…:<uuid>` id never passes. */
const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const USER_UNIT_SELECTOR = chatgptPageData.userUnit;
const ASSISTANT_UNIT_SELECTOR = chatgptPageData.assistantUnit;
const MESSAGE_IDS_ATTRIBUTE = 'data-chatgpt-search-message-ids';
const REPLY_ID_ATTRIBUTE = 'data-chatgpt-selection-message-id';
const ASSISTANT_HEADING_SELECTOR = chatgptPageData.assistantHeading;
const TURN_STATE_ATTRIBUTE = chatgptPageData.turnStateAttribute;
const TURN_STATE_COMPLETE = chatgptPageData.turnStateComplete;
const SUBMIT_SELECTOR = chatgptPageData.submit;

export function siteOf(adapter: SiteAdapter | null): SiteAdapter {
  return withPageSemanticSelectors(adapter ?? chatgptAdapter, [
    'composer',
    'composerRoot',
    'sendButton',
    'userTurn',
    'assistantTurn',
  ]);
}

/** Compare texts as the editor and the thread render them: line breaks and runs of spaces vary. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[​﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The route's conversation id once the server named it; `null` on `/` or a provisional id. */
export function settledConversationId(pathname: string = location.pathname): string | null {
  const id = readConversationId(pathname);
  return id !== null && CONVERSATION_ID_PATTERN.test(id) ? id : null;
}

export function findComposerField(adapter: SiteAdapter | null): HTMLElement | null {
  // OFF keeps the baseline adapter-first read, including its original fallback order.
  if (getSiteSelectorView('chatgpt').semanticSource === 'adapter')
    return findComposer(siteOf(adapter)) ?? findComposer(CHATGPT_COMPOSER_SELECTOR);
  return resolveChatgptComposer(
    () => findComposer(chatgptAdapter) ?? findComposer(CHATGPT_COMPOSER_SELECTOR),
    adapter,
  );
}

export function composerFormOf(field: HTMLElement): HTMLElement {
  return chatgptComposerRootOf(field) ?? field.parentElement ?? field;
}

export function isEnabledButton(button: HTMLButtonElement): boolean {
  return !button.disabled && button.getAttribute('aria-disabled') !== 'true';
}

function queryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

/** The composer form's own submit button, unique; the site data and older test ids as fallbacks. */
function findFallbackSendButton(
  field: HTMLElement,
  adapter: SiteAdapter = chatgptAdapter,
): HTMLButtonElement | null {
  const own = queryAll<HTMLButtonElement>(composerFormOf(field), SUBMIT_SELECTOR).filter(
    isRendered,
  );
  if (own.length === 1) return own[0];
  if (own.length > 1) return null;
  for (const selector of [adapter.selectors.sendButton, CHATGPT_SEND_CONTROL_SELECTOR]) {
    if (!selector) continue;
    const found = queryAll<HTMLButtonElement>(document, selector).filter(isRendered);
    if (found.length === 1 && found[0] instanceof HTMLButtonElement) return found[0];
  }
  return null;
}

export function findSendButton(
  field: HTMLElement,
  adapter: SiteAdapter | null,
): HTMLButtonElement | null {
  // The baseline tries the field's own submit before the cached adapter's fallback control.
  if (getSiteSelectorView('chatgpt').semanticSource === 'adapter')
    return findFallbackSendButton(field, siteOf(adapter));
  return resolveChatgptSend(field, adapter, () => findFallbackSendButton(field));
}

/** A stop control in a rendered composer, by its known label or its inline-svg shape. */
export function hasStopControl(adapter: SiteAdapter | null): boolean {
  const page = createChatGptPage(siteOf(adapter));
  const field = findComposerField(adapter);
  if (!field) return false;
  return queryAll<HTMLButtonElement>(composerFormOf(field), 'button').some(
    (button) => isRendered(button) && page.isStopControlTarget(button),
  );
}

export function conversationItems(): HTMLElement[] {
  return mountedTurnItems(resolveVisibleConversationRoot());
}

export function findItem(turnKey: string): HTMLElement | null {
  return conversationItems().find((item) => readTurnKey(item) === turnKey) ?? null;
}

export { readTurnKey };

/** The item's prompt text, or `null` for an item without a prompt. */
export function userTextOf(item: HTMLElement): string | null {
  const bubble = findUserBubble(item) ?? item.querySelector<HTMLElement>(USER_UNIT_SELECTOR);
  return bubble ? normalizeForCompare(bubble.textContent ?? '') : null;
}

/** The reply element of an item: the selection target, else its `:assistant` unit. */
export function findReply(item: HTMLElement): HTMLElement | null {
  const reply =
    findAssistantReply(item) ?? item.querySelector<HTMLElement>(ASSISTANT_UNIT_SELECTOR);
  return reply && isRendered(reply) ? reply : null;
}

/** The reply's message id, from the selection target or its unit's message ids. */
export function replyIdOf(reply: HTMLElement): string | null {
  const own = reply.getAttribute(REPLY_ID_ATTRIBUTE)?.trim();
  if (own) return own;
  const unit = reply.closest(`[${MESSAGE_IDS_ATTRIBUTE}]`);
  return unit?.getAttribute(MESSAGE_IDS_ATTRIBUTE)?.trim().split(/\s+/)[0] || null;
}

/** The turn whose reply id or turn key is `key`, with its reply. */
export function findReplyByKey(key: string): { item: HTMLElement; reply: HTMLElement } | null {
  for (const item of conversationItems()) {
    const reply = findReply(item);
    if (!reply) continue;
    if (replyIdOf(reply) === key || readTurnKey(item) === key) return { item, reply };
  }
  return null;
}

/** The reply's text without the localized role heading. */
export function replyTextOf(reply: HTMLElement): string {
  const headings = queryAll<HTMLElement>(reply, ASSISTANT_HEADING_SELECTOR);
  if (headings.length === 0) return normalizeForCompare(reply.textContent ?? '');
  const clone = reply.cloneNode(true) as HTMLElement;
  queryAll(clone, ASSISTANT_HEADING_SELECTOR).forEach((heading) => heading.remove());
  return normalizeForCompare(clone.textContent ?? '');
}

/** `complete`, another observed value, or `null` when the item carries no turn state. */
export function turnStateOf(item: HTMLElement): string | null {
  const nodes = [item, ...queryAll<HTMLElement>(item, `[${TURN_STATE_ATTRIBUTE}]`)].filter((node) =>
    node.hasAttribute(TURN_STATE_ATTRIBUTE),
  );
  if (nodes.length === 0) return null;
  const pending = nodes
    .map((node) => node.getAttribute(TURN_STATE_ATTRIBUTE) ?? '')
    .find((value) => value !== TURN_STATE_COMPLETE);
  return pending ?? TURN_STATE_COMPLETE;
}

export function isCompleteTurnState(state: string | null): boolean {
  return state === TURN_STATE_COMPLETE;
}

export function hasThinkingSignal(item: HTMLElement): boolean {
  return queryAll<HTMLElement>(item, chatgptSignalSelector('actions.thinking', item)).some(
    isRendered,
  );
}

/** Which thinking or streaming markers show in the item, for a failure's evidence. */
export function thinkingSignalsOf(item: HTMLElement): string[] {
  return chatgptSignalSelector('actions.thinking', item)
    .split(', ')
    .filter((selector) => queryAll<HTMLElement>(item, selector).some(isRendered));
}

/** Small, stable string hash for change detection (not for integrity). */
export function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
