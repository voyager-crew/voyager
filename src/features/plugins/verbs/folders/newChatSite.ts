/**
 * "New chat in this folder" on a site whose folders come from data: the new
 * chat is the site's own (`createMode/newChat.ts`), sends are read through its
 * `composer` and `sendButton` keys, and the new conversation is filed as "Add
 * current conversation" files the open one.
 */
import type { ConversationReference } from '@/core/types/folder';
import type { ToastTone } from '@/core/ui/toast/types';
import type { SiteAdapter } from '@/features/plugins/types';
import { newChatTarget, samePath } from '@/pages/content/createMode/newChat';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

import type { NewChatPort } from './newChatFiling';
import type { SiteFoldersAdapter, SiteFoldersStore } from './types';

export interface NewChatSiteView {
  file(folderId: string, conversation: ConversationReference): void;
  notify(message: string, tone: ToastTone): void;
}

/** `null` where the site names no new chat, composer or send button. */
export function siteNewChatPort(
  site: SiteFoldersAdapter,
  adapter: SiteAdapter | null,
  store: SiteFoldersStore,
  view: NewChatSiteView,
): NewChatPort | null {
  const target = adapter ? newChatTarget(adapter.id) : null;
  const composer = adapter?.selectors.composer;
  const sendButton = adapter?.selectors.sendButton;
  if (!target || !composer || !sendButton) return null;
  const conversationIdOf = (href: string) => site.identity.conversationIdOf(href);
  return {
    newChatLink: () => target.link(document),
    isNewChat: (href) => {
      const url = new URL(href, location.href);
      return !conversationIdOf(url.href) && samePath(url.pathname, target.path(url));
    },
    conversationIdOf,
    composer,
    sendButton,
    folderName: (folderId) =>
      store.data.folders.find((folder) => folder.id === folderId)?.name ?? null,
    file: (folderId, conversationId) => {
      // Read now: a chat the site keeps nowhere (ChatGPT's temporary chats) gives none.
      const conversation = site.page.current(t(site.messages.untitled));
      if (!conversation) {
        view.notify(t(site.messages.noConversation), 'info');
        return;
      }
      if (conversation.conversationId === conversationId && store.ready) {
        view.file(folderId, conversation);
      }
    },
    notify: (message, tone) => view.notify(message, tone),
  };
}
