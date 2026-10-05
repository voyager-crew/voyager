import type { ConversationReference } from '@/core/types/folder';

import { readChatGptConversation } from './chatgptIdentity';

/** ChatGPT's own sidebar; its conversation links are router links. */
const SIDEBAR_SELECTOR = 'nav[aria-label], #stage-slideover-sidebar';
const ACTIVE_LINK_SELECTOR = `:is(${SIDEBAR_SELECTOR}) a[aria-current="page"]`;
/**
 * What ChatGPT shows before it names a conversation. The sidebar label follows
 * ChatGPT's UI language, so an English-only list would store "新聊天" as a title.
 */
const PLACEHOLDER_TITLES = new Set([
  'ChatGPT',
  'New chat', // en
  '新聊天', // zh-CN, zh-TW
  '新对话', // zh-CN
  '新對話', // zh-TW
  '新しいチャット', // ja
  '새 채팅', // ko
  'Nuevo chat', // es
  'Nouveau chat', // fr
  'Nouvelle discussion', // fr
  'Neuer Chat', // de
  'Novo chat', // pt
  'Nova conversa', // pt
  'Nuova chat', // it
  'Nieuwe chat', // nl
  'Nowy czat', // pl
  'Yeni sohbet', // tr
  'Новый чат', // ru
  'Новий чат', // uk
  'محادثة جديدة', // ar
  'دردشة جديدة', // ar
  'नई चैट', // hi
  'Obrolan baru', // id
  'Đoạn chat mới', // vi
  'แชทใหม่', // th
]);

/** A title ChatGPT shows before it names a conversation. */
export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER_TITLES.has(title);
}

function isTemporaryChatUrl(href: string): boolean {
  try {
    return new URL(href).searchParams.get('temporary-chat') === 'true';
  } catch {
    return false;
  }
}

function readTitle(doc: Document): string | null {
  const title = doc.title.trim();
  if (title && !PLACEHOLDER_TITLES.has(title)) return title;
  return doc.querySelector(ACTIVE_LINK_SELECTOR)?.textContent?.trim() || null;
}

/**
 * The open conversation as a folder entry, or `null` on any page that is not a
 * saved conversation (home, a Project overview, a temporary chat).
 */
export function readCurrentConversation(
  untitled: string,
  doc: Document = document,
  href: string = location.href,
  now: number = Date.now(),
): ConversationReference | null {
  if (isTemporaryChatUrl(href)) return null;
  const identity = readChatGptConversation(href);
  if (!identity) return null;
  return {
    conversationId: identity.conversationId,
    title: readTitle(doc) ?? untitled,
    url: identity.url,
    addedAt: now,
  };
}

/**
 * The sidebar's router link for conversation `id`, at whatever route it lives
 * under. Only the sidebar: a link inside a message may open a new tab or load
 * the page in full.
 */
function findSidebarLink(doc: Document, id: string): HTMLAnchorElement | null {
  for (const sidebar of doc.querySelectorAll(SIDEBAR_SELECTOR)) {
    for (const link of sidebar.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (link.target && link.target !== '_self') continue;
      if (readChatGptConversation(link.href)?.id === id) return link;
    }
  }
  return null;
}

/**
 * Opens a filed conversation inside the running app, never with a full load:
 * click ChatGPT's own sidebar link for it when one is rendered (its router
 * handles the click), else push the path and announce it with `popstate`, which client
 * routers read as a navigation. Returns `false` for a non-ChatGPT entry.
 */
export function openChatGptConversation(
  conversation: ConversationReference,
  doc: Document = document,
  win: Window = window,
): boolean {
  const identity = readChatGptConversation(conversation.url);
  if (!identity) return false;
  if (readChatGptConversation(win.location.href)?.id === identity.id) return true;

  const link = findSidebarLink(doc, identity.id);
  if (link) {
    link.click();
    return true;
  }
  // A fresh entry carries no state: copying the router's state would give two
  // entries the same router key.
  win.history.pushState(null, '', identity.path);
  win.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  return true;
}
