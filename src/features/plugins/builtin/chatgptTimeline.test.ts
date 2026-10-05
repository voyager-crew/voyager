import '@/features/timeline/adapters/catalog/testSetup';
/**
 * The ChatGPT timeline is the `voyager.chatgpt-timeline` builtin manifest
 * driving the `turnNavigator` primitive with the bundled ChatGPT adapter.
 * Fixtures are small, sanitized captures of the live DOM: one
 * `[data-turn-key]` virtual-list item per exchange, which ChatGPT unmounts
 * whole off-screen; the prompt in `[data-user-message-bubble]`; the reply
 * naming its conversation in `data-chatgpt-selection-conversation-id`. Each
 * conversation is a page surface, and ChatGPT keeps earlier ones in the DOM
 * as `display: none`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { buildConversationId } from '@/features/timeline/adapters/catalog/conversationId';
import { buildTurnId } from '@/features/timeline/adapters/catalog/turnMerge';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import type { NativeOperation } from '../types';
import { turnNavigatorPrimitive } from '../verbs/turnNavigator';
import { BUILTIN_PLUGINS } from './index';

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

vi.mock('@/utils/i18n', () => ({
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
const ROUTE_SETTLE_MS = 400 + 150;
/** Longer than any settle window a timing heuristic could wait out. */
const SLOW_HOST_MS = 2_500;
const CONVERSATION_ATTR = 'data-chatgpt-selection-conversation-id';

let scope: PluginScope;
/** The open page's thread, where ChatGPT renders the exchange items. */
let thread: HTMLElement;
let targetCount: () => number;
let itemCount = 0;

function manifest() {
  const timeline = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.chatgpt-timeline');
  if (!timeline) throw new Error('voyager.chatgpt-timeline is not a builtin');
  return timeline;
}

async function mount(adapter = requireBundledSiteAdapter('chatgpt')): Promise<void> {
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

async function settle(ms = 250): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** The conversation id the URL names, as ChatGPT stamps it on replies. */
function urlConversation(): string | null {
  return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] ?? null;
}

/** A page surface with its thread, made the open one. */
function openPage(): HTMLElement {
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
function hidePage(page: HTMLElement): void {
  page.setAttribute('data-app-shell-active-page', 'false');
  page.querySelector<HTMLElement>('[data-app-shell-page-surface]')!.style.display = 'none';
}

/** ChatGPT opens the next conversation on a new page and hides the open one. */
function switchPage(): HTMLElement {
  const open = thread.closest<HTMLElement>('[data-app-shell-active-page]')!;
  hidePage(open);
  return openPage();
}

function showPage(page: HTMLElement): void {
  page.setAttribute('data-app-shell-active-page', 'true');
  page.querySelector<HTMLElement>('[data-app-shell-page-surface]')!.style.display = '';
}

/**
 * One exchange item, sanitized from the live DOM. `conversation` is what the
 * reply names: the URL's id by default, null for a reply without the id yet.
 */
function exchange(
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

function bubble(item: HTMLElement): HTMLElement {
  return item.querySelector<HTMLElement>('[data-user-message-bubble]')!;
}

function nameConversation(item: HTMLElement, conversation: string): void {
  item
    .querySelector('[data-chatgpt-selection-message-id]')!
    .setAttribute(CONVERSATION_ATTR, conversation);
}

function draftId(path = '/'): string {
  return buildConversationId(
    {
      siteId: 'chatgpt',
      conversationIdPattern: requireBundledSiteAdapter('chatgpt').conversationIdPattern,
    },
    `${location.origin}${path}`,
  );
}

function star(conversation: string, text: string): StarredMessage {
  return {
    turnId: buildTurnId(text),
    content: text,
    conversationId: conversation,
    conversationUrl: `${location.origin}/`,
    conversationTitle: 'Saved',
    starredAt: 1,
  };
}

function starred(conversation: string): string[] | undefined {
  return starStore.get(conversation)?.map((message) => message.content);
}

/** The storage echo every star write sends to open tabs. */
function notifyStars(): void {
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

async function longPress(dot: HTMLElement): Promise<void> {
  dot.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(600);
}

function dots(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
}

function labels(): string[] {
  return dots().map((dot) => dot.getAttribute('aria-label') ?? '');
}

function rect(top: number): () => DOMRect {
  return () => ({ top, bottom: top + 40, height: 40, left: 0, right: 0, width: 0 }) as DOMRect;
}

function makeScroller(options: { reverse?: boolean } = {}): HTMLElement & { scrollTo: never } {
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

describe('ChatGPT timeline', () => {
  it('shows and navigates live bubbles and older turns without duplicates', async () => {
    const scroller = makeScroller();
    for (const prompt of [
      'First question',
      'Second question',
      'Third question',
      'Fourth question',
    ]) {
      exchange(prompt);
    }
    bubble(thread.lastElementChild as HTMLElement).getBoundingClientRect = rect(700);
    await mount();

    expect(labels()).toEqual([
      'First question',
      'Second question',
      'Third question',
      'Fourth question',
    ]);
    expect(targetCount()).toBe(4);
    dots()[3].click();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 450, behavior: 'smooth' });
    expect(dots()[3].getAttribute('aria-current')).toBe('true');

    // Older pages expose only author-role; transitional pages may expose both.
    const legacy = document.createElement('section');
    legacy.setAttribute('data-testid', 'conversation-turn-5');
    legacy.innerHTML = '<div data-message-author-role="user">Older question</div>';
    const prompt = legacy.firstElementChild as HTMLElement;
    prompt.getBoundingClientRect = rect(900);
    thread.append(legacy);
    bubble(thread.firstElementChild as HTMLElement).parentElement!.setAttribute(
      'data-message-author-role',
      'user',
    );
    bubble(thread.children[1] as HTMLElement).setAttribute('data-message-author-role', 'user');
    await settle();

    expect(labels()).toEqual([
      'First question',
      'Second question',
      'Third question',
      'Fourth question',
      'Older question',
    ]);
    expect(targetCount()).toBe(5);
    dots()[4].click();
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 650, behavior: 'smooth' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('uses the remote adapter userTurn to select and navigate prompts', async () => {
    const scroller = makeScroller();
    exchange('Not selected by the remote adapter');
    const selected = bubble(exchange('Remote-selected prompt'));
    selected.classList.add('remote-user-turn');
    selected.getBoundingClientRect = rect(700);
    const adapter = requireBundledSiteAdapter('chatgpt');
    // The runtime passes the resolved remote adapter to the builtin primitive.
    await mount({
      ...adapter,
      selectors: { ...adapter.selectors, userTurn: '.remote-user-turn' },
    });

    expect(labels()).toEqual(['Remote-selected prompt']);
    expect(targetCount()).toBe(1);
    dots()[0].click();
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
    expect(dots()[0].getAttribute('aria-current')).toBe('true');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('marks every prompt, skips replies, and files stars under chatgpt with the loaded account', async () => {
    document.documentElement.setAttribute('data-theme-user-id', 'user-account-a');
    document.documentElement.setAttribute('data-theme-account-id', 'workspace-a');
    exchange('First question');
    exchange('Second question');

    await mount();

    expect(document.querySelectorAll('[data-gv-turn-navigator="chatgpt"]')).toHaveLength(1);
    expect(labels()).toEqual(['First question', 'Second question']);
    expect(targetCount()).toBe(2);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:first');

    await longPress(dots()[1]);
    await vi.waitFor(() =>
      expect(starStore.get('chatgpt:conv:first')?.[0].account).toBe(
        'chatgpt:ab894c1ca59dbaea95295fae9a616794d31cffbfdf53b53649933ca4842b5bca',
      ),
    );
    expect(starred('chatgpt:conv:first')).toEqual(['Second question']);
  });

  it('a starred prompt keeps the id stars saved by earlier versions carry', async () => {
    exchange('First question');
    exchange('Second question');
    await mount();

    await longPress(dots()[1]);

    // Literal on purpose: this id is the stored key of every existing ChatGPT star.
    await vi.waitFor(() =>
      expect(starStore.get('chatgpt:conv:first')?.map((message) => message.turnId)).toEqual([
        'c-wxhcs3',
      ]),
    );
  });

  it('scrolls the conversation container, not the window, when a dot is clicked', async () => {
    const scroller = makeScroller();
    exchange('Opening question');
    bubble(exchange('Jump here')).getBoundingClientRect = rect(700);
    await mount();

    dots()[1].click();

    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 450, behavior: 'smooth' });
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(dots()[1].getAttribute('aria-current')).toBe('true');
  });

  it('jumps through a column-reverse thread, whose offsets run negative from the newest turn', async () => {
    const scroller = makeScroller({ reverse: true });
    // Resting at scrollTop 0 shows the last 600px of 2000, so the view starts
    // 1400px in. This 40px turn starts 640px above that edge: its centre is
    // 1400 - 640 + 20 = 780px into the conversation.
    bubble(exchange('Older question')).getBoundingClientRect = rect(-640);
    exchange('Newest question');
    await mount();

    dots()[0].click();

    // Centre at 45% of the view: 780 - 0.45 * 600 = 510 from the start, which
    // a column-reverse scroller counts as 510 - 1400.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: -890, behavior: 'smooth' });
  });

  it('treats a normal scroller in rubber-band overscroll as a normal scroller', async () => {
    const scroller = makeScroller();
    // Safari reports a negative scrollTop while bouncing past the top edge.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: -20 });
    exchange('Opening question');
    bubble(exchange('Jump here')).getBoundingClientRect = rect(700);
    await mount();

    dots()[1].click();

    // -20 + 700 + 20 - 0.45 * 600, on the ordinary axis.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 430, behavior: 'smooth' });
  });

  it('homes in on an unmounted older turn through the column-reverse thread', async () => {
    const scroller = makeScroller({ reverse: true });
    // At rest the view starts 1400px in: the older turn is centred 780px in,
    // the two newer ones are on screen.
    const older = exchange('Older question');
    bubble(older).getBoundingClientRect = rect(-640);
    const middle = exchange('Middle question');
    bubble(middle).getBoundingClientRect = rect(100);
    bubble(exchange('Newest question')).getBoundingClientRect = rect(400);
    await mount();
    // Scrolled away: ChatGPT unmounts the whole item.
    older.remove();
    await settle();

    dots()[0].click();
    // Towards the older end, where the remembered centre puts it.
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: -890, behavior: 'instant' });

    // The jump landed: the item is back, the newer ones are out of view.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: -890 });
    bubble(middle).getBoundingClientRect = rect(990);
    const remounted = exchange('Older question');
    middle.before(remounted);
    bubble(remounted).getBoundingClientRect = rect(300);
    await settle(1_000);

    // Aimed at the mounted bubble: centred 510 + 300 + 20 = 830px in.
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: -840, behavior: 'smooth' });
    expect(labels()).toEqual(['Older question', 'Middle question', 'Newest question']);
  });

  it('adds a dot when a new prompt is sent', async () => {
    exchange('First question');
    await mount();

    exchange('Follow-up');
    await settle();

    expect(labels()).toEqual(['First question', 'Follow-up']);
  });

  it('keeps a dot while ChatGPT unmounts the item, and does not duplicate it on remount', async () => {
    const first = exchange('Scrolled away');
    const second = exchange('Still visible');
    await mount();
    const id = dots()[0].dataset.targetTurnId;

    first.remove();
    await settle();
    expect(labels()).toEqual(['Scrolled away', 'Still visible']);

    const remounted = exchange('Scrolled away');
    second.before(remounted);
    await settle();
    expect(labels()).toEqual(['Scrolled away', 'Still visible']);
    expect(bubble(remounted).getAttribute('data-gv-turn-id')).toBe(id);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Scrolled away']);
  });

  it('updates the dot when a prompt is edited in place, without leaving a phantom', async () => {
    const item = exchange('Hello');
    exchange('After');
    await mount();

    bubble(item).textContent = 'Hello edited';
    await settle();
    expect(labels()).toEqual(['Hello edited', 'After']);

    // The star belongs to the edited text, and survives the store's echo.
    await longPress(dots()[0]);
    notifyStars();
    await settle();

    expect(starStore.get('chatgpt:conv:first')?.map((message) => message.turnId)).toEqual([
      buildTurnId('Hello edited'),
    ]);
    expect(dots()[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('updates the dot when only the text node of a prompt changes', async () => {
    const item = exchange('Hello');
    await mount();

    (bubble(item).firstChild as Text).data = 'Hello edited';
    await settle();
    expect(labels()).toEqual(['Hello edited']);

    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Hello edited']);
  });

  it('rebuilds for the next conversation, Projects routes included', async () => {
    exchange('Old conversation');
    await mount();

    history.pushState({}, '', '/g/g-p-6a9f32f7/c/second');
    thread.replaceChildren();
    exchange('New conversation');
    await settle(ROUTE_SETTLE_MS);

    expect(labels()).toEqual(['New conversation']);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:second');
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['New conversation']);
  });

  it('refuses a turn whose reply has not named the conversation yet, then stars it once it has', async () => {
    exchange('Answered');
    await mount();

    // Sent: the prompt shows before the reply carries the conversation id.
    const pending = exchange('Streaming', null);
    await settle();
    await longPress(dots()[1]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    nameConversation(pending, 'first');
    await longPress(dots()[1]);
    expect(starred('chatgpt:conv:first')).toEqual(['Streaming']);
  });

  it('refuses a turn whose reply names another conversation', async () => {
    exchange('Mine');
    exchange('Theirs', 'elsewhere');
    await mount();

    await longPress(dots()[1]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Mine']);
  });

  it('keeps the next conversation starrable while the previous page stays hidden in the DOM', async () => {
    const pageA = document.querySelector<HTMLElement>('[data-app-shell-active-page]')!;
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    hidePage(pageA);
    const pageB = openPage();
    exchange('Prompt B');
    await settle(ROUTE_SETTLE_MS);

    expect(labels()).toEqual(['Prompt B']);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);

    // Back to the cached page: ChatGPT flips which surface is hidden.
    history.pushState({}, '', '/c/first');
    hidePage(pageB);
    showPage(pageA);
    await settle(ROUTE_SETTLE_MS);
    expect(labels()).toEqual(['Prompt A']);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:first')).toEqual(['Prompt A']);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
  });

  it('shows what is on screen while the URL changes before the page', async () => {
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    // A's page is still the open one until ChatGPT swaps it, and its turn is still A's.
    expect(labels()).toEqual(['Prompt A']);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    switchPage();
    exchange('Prompt B');
    await settle();

    expect(labels()).toEqual(['Prompt B']);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:second');
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
  });

  it("drops the previous conversation's turns, mounted or not, when its page is put away", async () => {
    const items = [exchange('Prompt A1'), exchange('Prompt A2'), exchange('Prompt A3')];
    await mount();
    items[0].remove();
    await settle();
    expect(labels()).toEqual(['Prompt A1', 'Prompt A2', 'Prompt A3']);

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    switchPage();
    exchange('Prompt B');
    await settle();

    expect(labels()).toEqual(['Prompt B']);
  });

  it('stars the next conversation as soon as the URL names what its replies name', async () => {
    exchange('Prompt A');
    await mount();

    // ChatGPT rendered B before the URL changed: B's turns are not this URL's.
    switchPage();
    exchange('Prompt B', 'second');
    await settle(600);
    expect(labels()).toEqual(['Prompt B']);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    expect(labels()).toEqual(['Prompt B']);
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
    expect(starred('chatgpt:conv:first')).toBeUndefined();
  });

  it('keeps the previous conversation off the rail when a star change lands mid-switch', async () => {
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    // Another tab starred something before this tab noticed the route change.
    notifyStars();
    switchPage();
    exchange('Prompt B');
    await settle(ROUTE_SETTLE_MS);

    expect(labels()).toEqual(['Prompt B']);
  });

  it('leaves a turn removed outright after the route changed as a dot that cannot be starred', async () => {
    const old = exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    // Removal looks like virtualization, so the dot stays; its reply still names A.
    exchange('Prompt B');
    await settle();
    old.remove();
    await settle();
    expect(labels()).toEqual(['Prompt A', 'Prompt B']);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it("stars a new chat's turns once their replies name the id ChatGPT gave it, with no reload", async () => {
    history.replaceState({}, '', '/');
    // Whether a draft's reply carries an id before the URL has one is not
    // proven live; either way nothing on / can be starred.
    const draft = exchange('Brand new chat', null);
    await mount();

    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    // Every new chat on / shares one path-hash id: nothing there is this chat's.
    expect(getStarredMessagesForConversation).not.toHaveBeenCalled();

    history.pushState({}, '', '/c/assigned-id');
    await settle(ROUTE_SETTLE_MS);
    expect(getStarredMessagesForConversation).toHaveBeenLastCalledWith('chatgpt:conv:assigned-id');
    // Still no id on the reply: unstarrable rather than guessed.
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();

    nameConversation(draft, 'assigned-id');
    await longPress(dots()[0]);
    expect(starred('chatgpt:conv:assigned-id')).toEqual(['Brand new chat']);
  });

  it('cannot star a new chat turn under a conversation opened before that one renders', async () => {
    history.replaceState({}, '', '/');
    exchange('Draft prompt', 'draft-id');
    await mount();

    history.pushState({}, '', '/c/unrelated');
    await settle(ROUTE_SETTLE_MS);
    expect(labels()).toEqual(['Draft prompt']);
    await longPress(dots()[0]);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('never moves or deletes a star stored under a new-chat id', async () => {
    history.replaceState({}, '', '/');
    const saved = star(draftId(), 'Star me');
    starStore.set(draftId(), [saved]);
    // A store near its quota drops a write without an error.
    addStarredMessage.mockImplementation(async () => {});
    exchange('Star me', null);
    await mount();

    history.pushState({}, '', '/c/assigned-id');
    await settle(ROUTE_SETTLE_MS + SLOW_HOST_MS);

    expect(removeStarredMessage).not.toHaveBeenCalled();
    expect(starStore.get(draftId())).toEqual([saved]);
  });

  it('keeps a new chat out of a conversation opened while the new chat is still on screen', async () => {
    history.replaceState({}, '', '/');
    starStore.set('chatgpt:conv:other', [star('chatgpt:conv:other', 'Other prompt')]);
    exchange('Draft prompt', null);
    await mount();
    await longPress(dots()[0]);

    history.pushState({}, '', '/c/other');
    // ChatGPT is slow to load the conversation: the new chat stays on screen.
    await settle(ROUTE_SETTLE_MS + SLOW_HOST_MS);
    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    switchPage();
    exchange('Other prompt');
    await settle();

    expect(labels()).toEqual(['Other prompt']);
    expect(dots()[0].getAttribute('aria-pressed')).toBe('true');

    exchange('Next prompt');
    await settle();
    await longPress(dots()[1]);
    expect(starred('chatgpt:conv:other')).toEqual(['Other prompt', 'Next prompt']);
  });

  it('ignores a star press in the moment between a URL change and the next refresh', async () => {
    exchange('Prompt A');
    await mount();

    dots()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(549);
    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it("stars the next conversation's turns, never the previous one's, while both are on screen", async () => {
    exchange('Prompt A');
    await mount();

    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);
    exchange('Prompt B');
    await settle();
    expect(labels()).toEqual(['Prompt A', 'Prompt B']);

    await longPress(dots()[0]);
    expect(addStarredMessage).not.toHaveBeenCalled();
    await longPress(dots()[1]);
    expect(starred('chatgpt:conv:second')).toEqual(['Prompt B']);
    expect(starred('chatgpt:conv:first')).toBeUndefined();
  });

  it('cannot star a previous-conversation turn that mounts after the URL changed', async () => {
    exchange('Prompt A');
    await mount();
    history.pushState({}, '', '/c/second');
    await settle(ROUTE_SETTLE_MS);

    thread.replaceChildren();
    await settle();
    exchange('Prompt A', 'first');
    await settle();
    expect(labels()).toEqual(['Prompt A']);
    await longPress(dots()[0]);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('drops a press begun in the previous conversation when the next one has the same prompt', async () => {
    exchange('Same prompt');
    await mount();

    dots()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    history.pushState({}, '', '/c/second');
    thread.replaceChildren();
    exchange('Same prompt');
    await settle(ROUTE_SETTLE_MS);

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('drops a star press whose read was still pending when the user moved on', async () => {
    exchange('Same prompt');
    await mount();
    let release!: (messages: StarredMessage[]) => void;
    getStarredMessagesForConversation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    dots()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(549);
    history.pushState({}, '', '/c/second');
    await vi.advanceTimersByTimeAsync(1);
    // The next conversation opens with the same prompt before that read lands.
    history.pushState({}, '', '/c/third');
    thread.replaceChildren();
    exchange('Same prompt');
    await settle(ROUTE_SETTLE_MS);
    release?.([]);
    await settle();

    expect(addStarredMessage).not.toHaveBeenCalled();
  });

  it('clears the rail when leaving for a page without turns', async () => {
    const first = exchange('Question');
    await mount();

    // The thread goes away before the URL changes: the turn mutation alone
    // still sees the old conversation and keeps its dots.
    first.remove();
    await settle();
    history.pushState({}, '', '/gpts');
    await settle(ROUTE_SETTLE_MS);

    expect(dots()).toHaveLength(0);
  });

  it('removes the rail, tooltip and every stamp on disable, and stays gone', async () => {
    exchange('Question');
    await mount();
    expect(document.querySelectorAll('[data-gv-turn-id]')).toHaveLength(1);

    await scope.dispose();
    exchange('After disable');
    history.pushState({}, '', '/c/other');
    await settle(ROUTE_SETTLE_MS);

    expect(document.querySelector('[data-gv-turn-navigator]')).toBeNull();
    expect(document.getElementById('gv-turn-navigator-tooltip')).toBeNull();
    expect(document.querySelector('.timeline-preview-panel')).toBeNull();
    expect(document.querySelectorAll('[data-gv-turn-id]')).toHaveLength(0);
  });
});
