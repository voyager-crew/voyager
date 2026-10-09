import type { ConversationReference } from '@/core/types/folder';

import { readChatGptConversation } from './chatgptIdentity';

/** ChatGPT's own sidebar; its conversation links are router links. */
const SIDEBAR_SELECTOR = 'nav[aria-label], #stage-slideover-sidebar';
const ACTIVE_LINK_SELECTOR = `:is(${SIDEBAR_SELECTOR}) a[aria-current="page"]`;
/**
 * What ChatGPT names a conversation before it has a title, by the primary
 * subtag of the page's UI language. Only the page's own language counts: a chat
 * on English ChatGPT may really be titled "新聊天", and must keep that title.
 */
const PLACEHOLDERS_BY_LANGUAGE: Readonly<Record<string, readonly string[]>> = {
  en: ['New chat'],
  zh: ['新聊天', '新对话', '新對話'],
  ja: ['新しいチャット'],
  ko: ['새 채팅'],
  es: ['Nuevo chat'],
  fr: ['Nouveau chat', 'Nouvelle discussion'],
  de: ['Neuer Chat'],
  pt: ['Novo chat', 'Nova conversa'],
  it: ['Nuova chat'],
  nl: ['Nieuwe chat'],
  pl: ['Nowy czat'],
  tr: ['Yeni sohbet'],
  ru: ['Новый чат'],
  uk: ['Новий чат'],
  ar: ['محادثة جديدة', 'دردشة جديدة'],
  hi: ['नई चैट'],
  id: ['Obrolan baru'],
  vi: ['Đoạn chat mới'],
  th: ['แชทใหม่'],
};

/** The placeholders for the page's language; English when it is unset or unlisted. */
function placeholderTitles(doc: Document): readonly string[] {
  const language = doc.documentElement.lang.trim().toLowerCase().split(/[-_]/)[0];
  return PLACEHOLDERS_BY_LANGUAGE[language] ?? PLACEHOLDERS_BY_LANGUAGE.en;
}

/** A title ChatGPT shows before it names a conversation, in `doc`'s UI language. */
export function isPlaceholderTitle(title: string, doc: Document = document): boolean {
  return title === 'ChatGPT' || placeholderTitles(doc).includes(title);
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
  if (title && !isPlaceholderTitle(title, doc)) return title;
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
