import '@/features/timeline/adapters/catalog/testSetup';
/**
 * Shared page fixtures and mocks for the ChatGPT timeline suites.
 *
 * The ChatGPT timeline is the `voyager.chatgpt-timeline` builtin manifest
 * driving the `turnNavigator` primitive with the bundled ChatGPT adapter.
 * Fixtures are small, sanitized captures of the live DOM: one
 * `[data-turn-key]` virtual-list item per exchange, which ChatGPT unmounts
 * whole off-screen; the prompt in `[data-user-message-bubble]`; the reply
 * naming its conversation in `data-chatgpt-selection-conversation-id`. Each
 * conversation is a page surface, and ChatGPT keeps earlier ones in the DOM
 * as `display: none`.
 */
import { afterEach, beforeEach, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { buildConversationId } from '@/features/timeline/adapters/catalog/conversationId';
import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { PluginScope } from '../../runtime/pluginScope';
import type { NativeOperation } from '../../types';
import { turnNavigatorPrimitive } from '../../verbs/turnNavigator';
import { BUILTIN_PLUGINS } from '../index';

/** In-memory stand-in for the background's starred-message store. */
const {
  starStore,
  addToStore,
  getStarredMessagesForConversation,
  addStarredMessage,
  removeStarredMessage,
} = vi.hoisted(() => {
  const store = new Map<string, StarredMessage[]>();
  const addToStore = async (message: StarredMessage): Promise<void> => {
    const list = (store.get(message.conversationId) ?? []).filter(
      (item) => item.turnId !== message.turnId,
    );
    store.set(message.conversationId, [...list, message]);
  };
  return {
    starStore: store,
    addToStore,
    getStarredMessagesForConversation: vi.fn(async (conversationId: string) => [
      ...(store.get(conversationId) ?? []),
    ]),
    addStarredMessage: vi.fn(addToStore),
    removeStarredMessage: vi.fn(async (conversationId: string, turnId: string) => {
      const list = (store.get(conversationId) ?? []).filter((item) => item.turnId !== turnId);
      if (list.length) store.set(conversationId, list);
      else store.delete(conversationId);
    }),
  };
});

export {
  starStore,
  addToStore,
  getStarredMessagesForConversation,
  addStarredMessage,
  removeStarredMessage,
};

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/savedLibrary/StarredMessagesService', async (importOriginal) => ({
  StarredMessagesService: {
    backfillStarredTexts: vi.fn().mockResolvedValue(undefined),
    decodeStorageChange: (
      await importOriginal<typeof import('@/features/savedLibrary/StarredMessagesService')>()
    ).StarredMessagesService.decodeStorageChange,
    addStarredMessage,
    getStarredMessagesForConversation,
    removeStarredMessage,
  },
}));
vi.mock('@/features/plugins/storage/pluginState', () => ({
  setPluginSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

/** Poll of the shared route watcher plus the navigator's refresh debounce. */
export const ROUTE_SETTLE_MS = 400 + 150;
/** Longer than any settle window a timing heuristic could wait out. */
export const SLOW_HOST_MS = 2_500;
export const CONVERSATION_ATTR = 'data-chatgpt-selection-conversation-id';

export let scope: PluginScope;
/** The open page's thread, where ChatGPT renders the exchange items. */
export let thread: HTMLElement;
export let targetCount: () => number;
export let itemCount = 0;

export function manifest() {
  const timeline = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.chatgpt-timeline');
  if (!timeline) throw new Error('voyager.chatgpt-timeline is not a builtin');
  return timeline;
}

export async function mount(adapter = requireBundledSiteAdapter('chatgpt')): Promise<void> {
  const op = manifest().contributes.domOps?.find((entry): entry is NativeOperation => {
    return entry.op === 'native';
  });
  if (!op) throw new Error('the ChatGPT timeline needs a native op');
  const params = turnNavigatorPrimitive.validateParams(op.params);
  if (!params.success) throw new Error('invalid turnNavigator params');
  turnNavigatorPrimitive.activate(scope, params.data, {
    doc: document,
    adapter,
    pluginId: manifest().id,
    settings: {},
    setTargetCounter: (count) => {
      targetCount = count;
    },
  });
  await settle();
}

export async function settle(ms = 250): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** The conversation id the URL names, as ChatGPT stamps it on replies. */
export function urlConversation(): string | null {
  return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
}

/** A page surface with its thread, made the open one. */
export function openPage(): HTMLElement {
  const page = document.createElement('div');
  page.setAttribute('data-app-shell-active-page', 'true');
  page.innerHTML = `
    <div data-app-shell-page-surface="true">
      <div data-app-action-timeline-scroll="" role="presentation"><div class="thread"></div></div>
    </div>`;
  document.getElementById('workspace')!.append(page);
  thread = page.querySelector<HTMLElement>('.thread')!;
  return page;
}

/** ChatGPT keeps a left conversation's page, hidden. */
export function hidePage(page: HTMLElement): void {
  page.setAttribute('data-app-shell-active-page', 'false');
  page.querySelector<HTMLElement>('[data-app-shell-page-surface]')!.style.display = 'none';
}

/** ChatGPT opens the next conversation on a new page and hides the open one. */
export function switchPage(): HTMLElement {
  const open = thread.closest<HTMLElement>('[data-app-shell-active-page]')!;
  hidePage(open);
  return openPage();
}

export function showPage(page: HTMLElement): void {
  page.setAttribute('data-app-shell-active-page', 'true');
  page.querySelector<HTMLElement>('[data-app-shell-page-surface]')!.style.display = '';
}

/**
 * One exchange item, sanitized from the live DOM. `conversation` is what the
 * reply names: the URL's id by default, null for a reply without the id yet.
 */
export function exchange(
  prompt: string,
  conversation: string | null = urlConversation(),
  answer = 'Answer',
): HTMLElement {
  const key = `turn-${(itemCount += 1)}`;
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', key);
  item.innerHTML = `
    <div data-content-search-turn-key="${key}">
      <h4 class="sr-only"></h4>
      <div data-chatgpt-search-unit-key="" data-chatgpt-search-message-ids="">
        <div data-content-search-unit-key=""><div><div data-user-message-bubble="true"></div></div></div>
      </div>
      <div data-content-search-unit-key="" data-chatgpt-search-unit-key="" data-chatgpt-search-message-ids="">
        <h4 data-conversation-role="assistant" class="sr-only"></h4>
        <div data-chatgpt-selection-message-id="m-${key}"></div>
      </div>
    </div>`;
  item.querySelector('[data-user-message-bubble]')!.textContent = prompt;
  const reply = item.querySelector('[data-chatgpt-selection-message-id]')!;
  reply.textContent = answer;
  if (conversation !== null) reply.setAttribute(CONVERSATION_ATTR, conversation);
  thread.append(item);
  return item;
}

export function bubble(item: HTMLElement): HTMLElement {
  return item.querySelector<HTMLElement>('[data-user-message-bubble]')!;
}

export function nameConversation(item: HTMLElement, conversation: string): void {
  item
    .querySelector('[data-chatgpt-selection-message-id]')!
    .setAttribute(CONVERSATION_ATTR, conversation);
}

export function draftId(path = '/'): string {
  return buildConversationId(
    {
      siteId: 'chatgpt',
      conversationIdPattern: requireBundledSiteAdapter('chatgpt').conversationIdPattern,
    },
    `${location.origin}${path}`,
  );
}

export function star(conversation: string, text: string): StarredMessage {
  return {
    turnId: buildTurnId(text),
    content: text,
    conversationId: conversation,
    conversationUrl: `${location.origin}/`,
    conversationTitle: 'Saved',
    starredAt: 1,
  };
}

export function starred(conversation: string): string[] | undefined {
  return starStore.get(conversation)?.map((message) => message.content);
}

/** The storage echo every star write sends to open tabs. */
export function notifyStars(): void {
  const listeners = vi.mocked(chrome.storage.onChanged.addListener).mock.calls;
  for (const [notify] of listeners)
    notify(
      {
        [StorageKeys.SAVED_LIBRARY_STARS]: {
          newValue: { messages: Object.fromEntries(starStore) },
        },
      },
      'local',
    );
}

export async function longPress(dot: HTMLElement): Promise<void> {
  dot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(600);
}

export function dots(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
}

export function labels(): string[] {
  return dots().map((dot) => dot.getAttribute('aria-label') ?? '');
}

export function rect(top: number): () => DOMRect {
  return () => ({ top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0 }) as DOMRect;
}

export function makeScroller(
  options: { reverse?: boolean } = {},
): HTMLElement & { scrollTo: never } {
  const scroller = thread.parentElement!;
  scroller.style.overflowY = 'auto';
  if (options.reverse) {
    scroller.style.display = 'flex';
    scroller.style.flexDirection = 'column-reverse';
  }
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 2000 },
  });
  scroller.getBoundingClientRect = rect(0);
  scroller.scrollTo = vi.fn() as never;
  return scroller as HTMLElement & { scrollTo: never };
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, '', '/c/first');
  document.body.innerHTML = '<div data-app-shell-workspace-row="true" id="workspace"></div>';
  openPage();
  itemCount = 0;
  scope = new PluginScope();
  targetCount = () => -1;
  starStore.clear();
  getStarredMessagesForConversation.mockClear();
  addStarredMessage.mockClear();
  addStarredMessage.mockImplementation(addToStore);
  removeStarredMessage.mockClear();
  window.scrollTo = vi.fn();
});

afterEach(async () => {
  await scope.dispose();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme-user-id');
  document.documentElement.removeAttribute('data-theme-account-id');
  vi.useRealTimers();
});
