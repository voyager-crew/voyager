/**
 * "New chat in this folder" where the folders run as a plugin: the item opens
 * the site's own new chat, and the conversation the user's first send there
 * creates is filed into the folder once the route names it. Opening a chat
 * from a link instead, leaving the new chat, back or forward, or waiting too
 * long files nothing. Each site supplies a `NewChatPort`; everything else
 * lives on one machine per folders runtime, so turning the folders off (or the
 * restart an account change brings) drops a pending folder with its listeners.
 */
import { readComposerText } from '@/core/services/composer/draft';
import { isImeKeyEvent } from '@/core/services/composer/sendKeys/sendKeyIntent';
import type { ToastTone } from '@/core/ui/toast/types';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { type Stay, startMachine } from '@/features/plugins/runtime/stateMachine';
import { clickNativeControl } from '@/pages/content/createMode/newChat';
import type { TreeActions } from '@/pages/content/folder/floatingTree/shared';
import { type RouteChange, watchRouteChanges } from '@/pages/content/utils/routeWatcher';
import { getTranslationSyncUnsafe as t } from '@/utils/i18n';

export interface NewChatPort {
  /** The site's own control that opens a new chat, or null. */
  newChatLink(): HTMLElement | null;
  isNewChat(href: string): boolean;
  /** The conversation `href` opens; null for the new-chat page and anything else. */
  conversationIdOf(href: string): string | null;
  /** The site's prompt field and send button, from its semantic keys. */
  readonly composer: string;
  readonly sendButton: string;
  folderName(folderId: string): string | null;
  /** Files `conversationId`, the conversation the page now shows, into `folderId`. */
  file(folderId: string, conversationId: string): void;
  notify(message: string, tone: ToastTone): void;
}

export type NewChatState =
  | { readonly status: 'idle' }
  | { readonly status: 'opening'; readonly folderId: string }
  | { readonly status: 'composing'; readonly folderId: string }
  | { readonly status: 'sent'; readonly folderId: string }
  | { readonly status: 'filing'; readonly folderId: string; readonly conversationId: string };

export type NewChatEvent =
  | { readonly type: 'request'; readonly folderId: string; readonly onNewChat: boolean }
  | { readonly type: 'arrivedNewChat' }
  | { readonly type: 'send' }
  | { readonly type: 'conversationRoute'; readonly conversationId: string }
  | { readonly type: 'leftNewChat' }
  | { readonly type: 'conversationClick' }
  | { readonly type: 'timeout' }
  | { readonly type: 'filed' };

/** How long the site's new chat may take to open, and the new conversation to get its route. */
export const OPENING_MS = 15_000;
export const SENT_MS = 60_000;

const IDLE: NewChatState = { status: 'idle' };

export function transition(state: NewChatState, event: NewChatEvent): NewChatState {
  switch (event.type) {
    case 'request':
      return { status: event.onNewChat ? 'composing' : 'opening', folderId: event.folderId };
    case 'arrivedNewChat':
      return state.status === 'opening' ? { status: 'composing', folderId: state.folderId } : state;
    case 'send':
      return state.status === 'composing' ? { status: 'sent', folderId: state.folderId } : state;
    case 'conversationRoute':
      if (state.status === 'sent') {
        return {
          status: 'filing',
          folderId: state.folderId,
          conversationId: event.conversationId,
        };
      }
      return state.status === 'idle' || state.status === 'filing' ? state : IDLE;
    case 'leftNewChat':
    case 'conversationClick':
      return state.status === 'idle' || state.status === 'filing' ? state : IDLE;
    case 'timeout':
      return state.status === 'opening' || state.status === 'sent' ? IDLE : state;
    case 'filed':
      return state.status === 'filing' ? IDLE : state;
    default: {
      const _exhaustive: never = event;
      return state;
    }
  }
}

/** What a route change means for a pending folder. */
export function routeEvent(port: NewChatPort, change: RouteChange): NewChatEvent {
  if (port.isNewChat(change.currentHref)) return { type: 'arrivedNewChat' };
  const conversationId = port.conversationIdOf(change.currentHref);
  // Back, forward or a History API open lands on a chat the send did not create.
  if (conversationId && change.trigger === 'poll' && port.isNewChat(change.previousHref)) {
    return { type: 'conversationRoute', conversationId };
  }
  return { type: 'leftNewChat' };
}

type NewChatStay = Stay<NewChatState, NewChatEvent>;

const plainLeftClick = (event: MouseEvent): boolean =>
  event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

/** A click that opens an existing conversation, which the next route change then belongs to. */
function watchConversationClicks(port: NewChatPort, stay: NewChatStay): void {
  stay.scope.on(
    document,
    'click',
    (event) => {
      if (!plainLeftClick(event) || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (link && port.conversationIdOf(link.href)) stay.send({ type: 'conversationClick' });
    },
    { capture: true },
  );
}

function watchSends(port: NewChatPort, stay: NewChatStay): void {
  stay.scope.on(
    document,
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || event.shiftKey || isImeKeyEvent(event)) return;
      const field =
        event.target instanceof Element ? event.target.closest<HTMLElement>(port.composer) : null;
      // An empty composer sends nothing.
      if (field && readComposerText(field).trim() !== '') stay.send({ type: 'send' });
    },
    { capture: true },
  );
  stay.scope.on(
    document,
    'click',
    (event) => {
      const button = event.target instanceof Element ? event.target.closest(port.sendButton) : null;
      if (button && !button.matches(':disabled, [aria-disabled="true"]')) {
        stay.send({ type: 'send' });
      }
    },
    { capture: true },
  );
}

export interface NewChatFiling {
  readonly menuItems: NonNullable<TreeActions['folderMenuItems']>;
}

export function startNewChatFiling(scope: PluginScope, port: NewChatPort): NewChatFiling {
  const machine = startMachine<NewChatState, NewChatEvent>(
    {
      id: 'new-chat-filing',
      transition,
      effects: {
        opening: (stay) => {
          stay.scope.timer(() => stay.send({ type: 'timeout' }), OPENING_MS);
          watchConversationClicks(port, stay);
        },
        composing: (stay) => {
          watchSends(port, stay);
          watchConversationClicks(port, stay);
        },
        sent: (stay) => {
          stay.scope.timer(() => stay.send({ type: 'timeout' }), SENT_MS);
          watchConversationClicks(port, stay);
        },
        filing: (stay) => {
          const { folderId, conversationId } = stay.state();
          port.file(folderId, conversationId);
          stay.send({ type: 'filed' });
        },
      },
    },
    IDLE,
  );
  scope.effect(() => () => machine.stop(), 'new-chat-filing');
  scope.effect(
    () =>
      watchRouteChanges((change) => {
        if (machine.state.status !== 'idle') machine.send(routeEvent(port, change));
      }),
    'new-chat-filing:route',
  );

  const request = (folderId: string): void => {
    if (scope.isDisposed) return;
    const name = port.folderName(folderId);
    if (name === null) return;
    const onNewChat = port.isNewChat(location.href);
    if (!onNewChat) {
      const link = port.newChatLink();
      if (!link) {
        port.notify(t('folder_new_chat_unavailable'), 'error');
        return;
      }
      clickNativeControl(link);
    }
    machine.send({ type: 'request', folderId, onNewChat });
    port.notify(t('folder_new_chat_pending').split('{folder}').join(name), 'info');
  };

  return {
    menuItems: (folder) => [
      { labelKey: 'folder_new_chat_in_folder', run: () => request(folder.id) },
    ],
  };
}
