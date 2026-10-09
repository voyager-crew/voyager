// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * Message times on a catalog timeline (ChatGPT's bundled site.json), with the
 * "message timestamps" setting on: a message the user sends is stamped, and
 * turns ChatGPT mounts from history are not, however late they appear.
 */
import './testSetup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys, type TurnId } from '@/core/types/common';
import {
  type MemoryStorage,
  createMemoryStorage,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { turnNavigatorPrimitive } from '@/features/plugins/verbs/turnNavigator';
import { SEND_TIME_RECORD_MESSAGE } from '@/features/timeline/adapters/catalog/sendTimesMessages';
import {
  CATALOG_SEND_CONVERSATIONS_LIMITED,
  CATALOG_SEND_CONVERSATIONS_UNLIMITED,
} from '@/features/timeline/adapters/catalog/sendTimesStore';
import { createSendTimeMessageHandler } from '@/pages/background/sendTimeMessages';
import {
  MAX_TIMESTAMP_CONVERSATIONS,
  TimestampService,
} from '@/pages/content/timestamp/TimestampService';

vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

const SENT_AT = new Date(2026, 9, 5, 12, 34, 56).getTime();
const SENT_LABEL = new TimestampService().formatAbsoluteTime(SENT_AT);

let storage: MemoryStorage;
let scope: PluginScope;
let thread: HTMLElement;
let composer: HTMLElement;
let background: ReturnType<typeof createSendTimeMessageHandler>;
/** The background's replies reach this page once it resolves. */
let replyGate: Promise<void>;

/** A top-frame content script of ours on `url`. */
function tabOn(url: string): chrome.runtime.MessageSender {
  return { id: chrome.runtime.id, tab: { url } as chrome.tabs.Tab, frameId: 0 };
}

/** Another ChatGPT tab on chat one saves a send through the background. */
async function saveFromAnotherTab(turnKey: string, sentAt: number): Promise<void> {
  const payload = { site: 'chatgpt', conversationId: 'one', turnKey, sentAt };
  await background({ type: SEND_TIME_RECORD_MESSAGE, payload }, tabOn('https://chatgpt.com/c/one'));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

const ONE_KEY = 'gvMessageTimestamps:chatgpt:conv:one';
const INDEX_KEY = 'gvMessageTimestamps:chatgpt:index';

/** Every stored key holding message times, Gemini's or a catalog site's. */
function storedTimeKeys(): string[] {
  return [...storage.values.local.keys()].filter((key) => key.startsWith('gvMessageTimestamps'));
}

/** Lets timer-scheduled storage writes land. */
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One exchange as ChatGPT renders it (see `chatgptThreadFixture`): an item keyed
 * by `data-turn-key`, the prompt in its bubble, then the reply, if any.
 */
function exchange(key: string, prompt: string, reply?: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', key);
  item.innerHTML = `<h4 class="sr-only">You said:</h4>
    <div data-chatgpt-search-unit-key="${key}-u" data-chatgpt-search-message-ids="${key}">
      <div class="group/user-message flex flex-col items-end">
        <div data-user-message-bubble="true"><div dir="auto"></div></div>
        <div><span data-state="closed"><button aria-label="Copy message">Copy</button></span></div>
      </div>
    </div>`;
  item.querySelector('[dir="auto"]')!.textContent = prompt;
  if (reply !== undefined) {
    item.insertAdjacentHTML(
      'beforeend',
      `<div data-chatgpt-search-unit-key="${key}-a" data-chatgpt-search-message-ids="${key}-a">
         <h4 data-conversation-role="assistant">ChatGPT said:</h4>
         <div data-chatgpt-selection-conversation-id="one" data-chatgpt-selection-message-id="${key}-a">
           <div data-markdown-text-style="assistant-message" dir="auto"><p></p></div>
         </div>
       </div>`,
    );
    item.querySelector('p')!.textContent = reply;
  }
  return item;
}

function itemOf(key: string): HTMLElement {
  const item = document.querySelector<HTMLElement>(`[data-turn-key="${key}"]`);
  if (!item) throw new Error(`no turn "${key}"`);
  return item;
}

/** The send times shown in the thread, inside turn `key` or anywhere. */
function inlineTimes(key?: string): string[] {
  const root = key === undefined ? document : itemOf(key);
  return Array.from(root.querySelectorAll('.gv-timestamp'), (label) => label.textContent ?? '');
}

function dotFor(prompt: string): HTMLElement {
  const dot = Array.from(document.querySelectorAll<HTMLElement>('.timeline-dot')).find(
    (candidate) => candidate.getAttribute('aria-label') === prompt,
  );
  if (!dot) throw new Error(`no dot for "${prompt}"`);
  return dot;
}

/** The tooltip the rail shows when the pointer rests on `prompt`'s dot. */
async function tooltipOf(prompt: string): Promise<string> {
  const tip = document.querySelector<HTMLElement>('.timeline-tooltip')!;
  tip.textContent = '';
  dotFor(prompt).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await vi.waitFor(() => expect(tip.textContent).toContain(prompt));
  return tip.textContent ?? '';
}

/** Mounts ChatGPT's timeline on the current thread, as a page load does. */
async function openTimeline(): Promise<void> {
  scope = new PluginScope();
  turnNavigatorPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: requireBundledSiteAdapter('chatgpt'),
      pluginId: 'voyager.chatgpt-timeline',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  await vi.waitFor(() => dotFor('Earlier question'));
}

/** The user sends `prompt` at `at` and ChatGPT renders it as turn `key`. */
async function send(prompt: string, key: string, at = SENT_AT, reply?: string): Promise<void> {
  composer.textContent = prompt;
  vi.setSystemTime(at);
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  composer.textContent = '';
  vi.setSystemTime(at + 5_000);
  thread.append(exchange(key, prompt, reply));
  await vi.waitFor(() => dotFor(prompt));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SENT_AT);
  history.replaceState({}, '', '/c/one');
  document.body.innerHTML =
    '<main></main><form><div id="prompt-textarea" contenteditable="true"></div></form>';
  thread = document.querySelector('main')!;
  composer = document.querySelector('#prompt-textarea')!;
  thread.append(exchange('turn-1', 'Earlier question'));
  storage = createMemoryStorage();
  storage.values.sync.set(StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, true);
  vi.stubGlobal('chrome', { ...chrome, storage: storage.api });
  // The background owns writes; each test gets a fresh worker.
  background = createSendTimeMessageHandler();
  replyGate = Promise.resolve();
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: { type: string },
    callback: (value: unknown) => void,
  ) => {
    if (request.type === 'gv.starred.getForConversation') callback({ ok: true, messages: [] });
    const reply = background(request, tabOn(location.href));
    void reply?.then((value) => replyGate.then(() => callback(value)));
  }) as typeof chrome.runtime.sendMessage);
  await openTimeline();
});

afterEach(async () => {
  await scope.dispose();
  document.body.innerHTML = '';
  history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('catalog timeline message times', () => {
  it('a sent message gets a timestamp; scrolled-in history does not', async () => {
    composer.textContent = 'New question';
    vi.setSystemTime(SENT_AT);
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    vi.setSystemTime(SENT_AT + 5_000);
    thread.append(exchange('turn-2', 'New question'));
    await flush();
    // The user scrolls up and ChatGPT mounts an older message.
    thread.prepend(exchange('turn-0', 'Oldest question'));
    await vi.waitFor(() => dotFor('New question') && dotFor('Oldest question'));

    expect(await tooltipOf('New question')).toContain(SENT_LABEL);
    for (const history of ['Oldest question', 'Earlier question']) {
      expect(await tooltipOf(history)).not.toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    }
    await vi.waitFor(() => expect(storedTimeKeys()).toContain(ONE_KEY));
    expect(storage.values.local.has(StorageKeys.GV_MESSAGE_TIMESTAMPS)).toBe(false);
  });

  it('a stamped turn reads back the same minute after reload', async () => {
    const sends = [
      { prompt: 'First new question', key: 'turn-2', at: SENT_AT + 234 },
      { prompt: 'Second new question', key: 'turn-3', at: SENT_AT + 61_999 },
      { prompt: 'Third new question', key: 'turn-4', at: SENT_AT + 3_600_500 },
    ];
    const label = (at: number) => new TimestampService().formatAbsoluteTime(at);
    for (const { prompt, key, at } of sends) {
      await send(prompt, key, at);
      await vi.waitFor(async () => expect(await tooltipOf(prompt)).toContain(label(at)));
    }
    await macrotask();

    await scope.dispose();
    await openTimeline();
    for (const { prompt, at } of sends) {
      await vi.waitFor(async () => expect(await tooltipOf(prompt)).toContain(label(at)));
    }
  });

  it('with message timestamps turned off, a send leaves no time behind', async () => {
    storage.external('sync', StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, false);
    await flush();
    composer.textContent = 'New question';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    thread.append(exchange('turn-2', 'New question'));
    await vi.waitFor(() => dotFor('New question'));
    await flush();

    expect(await tooltipOf('New question')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(storedTimeKeys()).toEqual([]);
  });

  it("a Gemini tab's save leaves a ChatGPT send time in place", async () => {
    storage.values.local.set(StorageKeys.GV_MESSAGE_TIMESTAMPS, {
      version: 2,
      conversations: { 'gemini-old': { 'r-1': SENT_AT - 60_000 } },
    });
    // A Gemini tab loaded its times before the ChatGPT send.
    const geminiTab = new TimestampService();
    await geminiTab.initialize();

    await send('New question', 'turn-2');
    await vi.waitFor(async () => expect(await tooltipOf('New question')).toContain(SENT_LABEL));
    await macrotask();
    void geminiTab.recordTimestamp('gemini-new', 'r-2' as TurnId, SENT_AT + 1_000);
    await vi.waitFor(() =>
      expect(storage.values.local.get(StorageKeys.GV_MESSAGE_TIMESTAMPS)).toMatchObject({
        conversations: { 'gemini-new': { 'r-2': SENT_AT + 1_000 } },
      }),
    );

    // The ChatGPT page is reloaded.
    await scope.dispose();
    await openTimeline();
    await vi.waitFor(async () => expect(await tooltipOf('New question')).toContain(SENT_LABEL));
  });

  it("ChatGPT sends never evict Gemini's message times", async () => {
    const gemini = {
      version: 2,
      conversations: Object.fromEntries(
        Array.from({ length: MAX_TIMESTAMP_CONVERSATIONS }, (_, i) => [
          `gemini-${i}`,
          { 'r-1': SENT_AT - 1_000_000 + i },
        ]),
      ),
    };
    storage.values.local.set(StorageKeys.GV_MESSAGE_TIMESTAMPS, structuredClone(gemini));

    await send('New question', 'turn-2');
    await vi.waitFor(async () => expect(await tooltipOf('New question')).toContain(SENT_LABEL));
    await macrotask();

    expect(storage.values.local.get(StorageKeys.GV_MESSAGE_TIMESTAMPS)).toEqual(gemini);
  });

  it('two ChatGPT tabs stamping different chats keep both times', async () => {
    // Hold this tab's first time write until another tab has sent in its own chat.
    const local = storage.api.local as unknown as Record<string, (...args: unknown[]) => unknown>;
    const set = local.set;
    let release: (() => void) | null = null;
    local.set = (items: unknown, ...rest: unknown[]) => {
      const keys = Object.keys(items as Record<string, unknown>);
      if (release || !keys.some((key) => key.startsWith('gvMessageTimestamps'))) {
        return set(items, ...rest);
      }
      return new Promise((resolve) => {
        release = () => resolve(set(items, ...rest));
      });
    };

    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(release).not.toBeNull());
    // The other tab, on chat two, loaded before this write and sends now.
    await scope.dispose();
    history.replaceState({}, '', '/c/two');
    await openTimeline();
    await send('Question in chat two', 'turn-3');
    await macrotask();
    release!();
    await vi.waitFor(async () =>
      expect(await tooltipOf('Question in chat two')).toContain(SENT_LABEL),
    );

    await scope.dispose();
    await openTimeline();
    await vi.waitFor(async () =>
      expect(await tooltipOf('Question in chat two')).toContain(SENT_LABEL),
    );
    await scope.dispose();
    history.replaceState({}, '', '/c/one');
    await openTimeline();
    await vi.waitFor(async () => expect(await tooltipOf('New question')).toContain(SENT_LABEL));
  });

  describe('a late reply never hides a send time another tab just saved', () => {
    const OTHER_AT = SENT_AT + 60_000;
    const OTHER_LABEL = new TimestampService().formatAbsoluteTime(OTHER_AT);
    const OTHER_PROMPT = 'Question from another tab';

    /** The other tab's turn, once this page shows it. */
    async function showOtherTabsTurn(): Promise<void> {
      thread.append(exchange('turn-3', OTHER_PROMPT));
      await vi.waitFor(() => dotFor(OTHER_PROMPT));
    }

    it("when this tab's own send replies after the other tab's save", async () => {
      let deliver!: () => void;
      replyGate = new Promise((resolve) => (deliver = resolve));
      await send('New question', 'turn-2');
      await vi.waitFor(() => expect(storage.values.local.has(ONE_KEY)).toBe(true));
      await saveFromAnotherTab('turn-3', OTHER_AT);
      await showOtherTabsTurn();
      await macrotask();

      // The reply holds only this tab's send.
      deliver();
      await macrotask();

      expect(await tooltipOf(OTHER_PROMPT)).toContain(OTHER_LABEL);
      expect(await tooltipOf('New question')).toContain(SENT_LABEL);
    });

    it("when the chat's first read returns after the other tab's save", async () => {
      // The reopened page's first read of chat one sees storage before the save, then stalls.
      const local = storage.api.local as unknown as Record<string, (...args: unknown[]) => unknown>;
      const get = local.get;
      let stalled = false;
      let resume!: () => void;
      const resumed = new Promise<void>((resolve) => (resume = resolve));
      local.get = async (keys: unknown, ...rest: unknown[]) => {
        const result = await get(keys, ...rest);
        if (!stalled && Array.isArray(keys) && keys.length === 1 && keys[0] === ONE_KEY) {
          stalled = true;
          await resumed;
        }
        return result;
      };
      await scope.dispose();
      await openTimeline();
      await vi.waitFor(() => expect(stalled).toBe(true));

      await saveFromAnotherTab('turn-3', OTHER_AT);
      await macrotask();
      resume();
      await macrotask();
      await showOtherTabsTurn();

      expect(await tooltipOf(OTHER_PROMPT)).toContain(OTHER_LABEL);
    });
  });

  it('a send time an earlier build kept in Gemini’s store still shows, and is left there', async () => {
    const gemini = {
      version: 2,
      conversations: { 'chatgpt:conv:one': { 'turn-1': SENT_AT - 60_000 } },
    };
    storage.values.local.set(StorageKeys.GV_MESSAGE_TIMESTAMPS, structuredClone(gemini));
    await scope.dispose();
    await openTimeline();

    const earlier = new TimestampService().formatAbsoluteTime(SENT_AT - 60_000);
    await vi.waitFor(async () => expect(await tooltipOf('Earlier question')).toContain(earlier));
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(storage.values.local.has(ONE_KEY)).toBe(true));
    expect(storage.values.local.get(StorageKeys.GV_MESSAGE_TIMESTAMPS)).toEqual(gemini);
  });

  it.each([
    ['without unlimited storage', [], CATALOG_SEND_CONVERSATIONS_LIMITED],
    ['with unlimited storage', ['unlimitedStorage'], CATALOG_SEND_CONVERSATIONS_UNLIMITED],
  ])('ChatGPT keeps the times of its most recent chats %s', async (_label, permissions, cap) => {
    vi.stubGlobal('chrome', {
      ...chrome,
      runtime: { ...chrome.runtime, getManifest: () => ({ permissions }) },
    });
    const older = Array.from({ length: cap }, (_, i) => `chatgpt:conv:old-${i}`);
    older.forEach((conversation, i) => {
      storage.values.local.set(`gvMessageTimestamps:${conversation}`, {
        v: 1,
        b: Math.floor(SENT_AT / 1000) - 100_000 + i,
        k: ['t'],
        d: [0],
      });
    });
    storage.values.local.set(INDEX_KEY, { v: 1, conversations: older });

    await send('New question', 'turn-2');
    await vi.waitFor(() =>
      expect(storage.values.local.has('gvMessageTimestamps:chatgpt:conv:old-0')).toBe(false),
    );
    await macrotask();

    const index = storage.values.local.get(INDEX_KEY) as { conversations: string[] };
    expect(index.conversations).toHaveLength(cap);
    expect(index.conversations).toContain('chatgpt:conv:one');
    expect(index.conversations).not.toContain('chatgpt:conv:old-0');
    expect(storage.values.local.has('gvMessageTimestamps:chatgpt:conv:old-1')).toBe(true);
    expect(storage.values.local.has(ONE_KEY)).toBe(true);
  });
});

describe('message times in the ChatGPT thread', () => {
  const bubbleOf = (key: string): HTMLElement =>
    itemOf(key).querySelector<HTMLElement>('[data-user-message-bubble]')!;

  it('a ChatGPT user message shows its send time when message times are on', async () => {
    await send('New question', 'turn-2');

    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
    // Above the bubble, inside the prompt's right-aligned block, never inside the message.
    const label = itemOf('turn-2').querySelector('.gv-timestamp')!;
    expect(label.nextElementSibling).toBe(bubbleOf('turn-2'));
    expect(bubbleOf('turn-2').textContent).toBe('New question');
    // History with no stored time shows none.
    expect(inlineTimes('turn-1')).toEqual([]);
  });

  it('turning message times off removes the inline times', async () => {
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));

    storage.external('sync', StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, false);
    await vi.waitFor(() => expect(inlineTimes()).toEqual([]));

    storage.external('sync', StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS, true);
    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
  });

  it('a re-rendered ChatGPT turn shows its time once', async () => {
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));

    // ChatGPT remounts the whole item, as scrolling it out and back does.
    itemOf('turn-2').replaceWith(exchange('turn-2', 'New question'));
    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));
    expect(inlineTimes()).toEqual([SENT_LABEL]);

    // ChatGPT re-renders only the bubble, leaving the label beside it.
    const bubble = bubbleOf('turn-2');
    const fresh = bubble.cloneNode(true) as HTMLElement;
    bubble.replaceWith(fresh);
    await vi.waitFor(() =>
      expect(itemOf('turn-2').querySelector('.gv-timestamp')?.nextElementSibling).toBe(fresh),
    );
    expect(inlineTimes()).toEqual([SENT_LABEL]);
  });

  it('an assistant message gets no inline time', async () => {
    await send('New question', 'turn-2', SENT_AT, 'An answer');
    await vi.waitFor(() => expect(inlineTimes('turn-2')).toEqual([SENT_LABEL]));

    const reply = itemOf('turn-2').querySelector('[data-chatgpt-search-unit-key="turn-2-a"]')!;
    expect(reply.querySelector('.gv-timestamp')).toBeNull();
    expect(reply.previousElementSibling?.querySelector('.gv-timestamp')).not.toBeNull();
  });

  it('leaving the chat or closing the timeline removes the inline times', async () => {
    await send('New question', 'turn-2');
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));

    // The host routes to another chat before it swaps the thread.
    history.pushState({}, '', '/c/two');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(inlineTimes()).toEqual([]));

    history.replaceState({}, '', '/c/one');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(inlineTimes()).toEqual([SENT_LABEL]));
    await scope.dispose();
    expect(inlineTimes()).toEqual([]);
  });
});
