// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * ChatGPT's Activity view, against the real store and storage: a send in a
 * filed chat records when it was sent, nothing else does, and the section's
 * bell shows the chats by that time. The transcript is ChatGPT's current
 * layout: one `[data-turn-key]` item per exchange with the prompt in
 * `[data-user-message-bubble]`, under a composer form with its send button.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { ConversationReference, FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';
import { initI18n, setCachedLanguage, getTranslationSyncUnsafe as t } from '@/utils/i18n';

import { type SidebarFixture, makeRows, mountSidebarFixture } from './chatgptSidebarFixture';
import { activateChatGptFolders } from './chatgptSite';
import { headerLabels } from './sectionHeaderDriver';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id' },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const KEY = StorageKeys.FOLDER_DATA_CHATGPT;
const ROOT = ROOT_CONVERSATIONS_ID;
const TITLES = ['Launch plan', 'Old notes'];
// The sidebar shows the same titles, so title sync leaves them alone.
const ROWS = makeRows(TITLES.length).map((row, index) => ({ ...row, title: TITLES[index] }));
const [WORK_CHAT, OLD_CHAT] = ROWS.map((row) => row.id);
/** Noon, so three hours either way stays on the same local day. */
const NOON = new Date(2026, 9, 5, 12, 0, 0).getTime();
const MINUTE = 60_000;

function ref(id: string, title: string, sortIndex: number): ConversationReference {
  return {
    conversationId: `chatgpt:conv:${id}`,
    title,
    url: `https://chatgpt.com/c/${id}`,
    addedAt: 1,
    sortIndex,
  };
}

/** Work holds both chats. */
const DATA: FolderData = {
  folders: [
    {
      id: 'work',
      name: 'Work',
      parentId: null,
      isExpanded: true,
      sortIndex: 0,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  folderContents: {
    work: [ref(WORK_CHAT, 'Launch plan', 0), ref(OLD_CHAT, 'Old notes', 1)],
    [ROOT]: [],
  },
};

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let scope: PluginScope;
let sidebar: SidebarFixture;
let thread: HTMLElement;
let composer: HTMLElement;
let turnCount = 0;

beforeAll(async () => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  await initI18n();
  globalThis.chrome.storage = originalStorage;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  memory.values.local.set(KEY, structuredClone(DATA));
  scope = new PluginScope();
  sidebar = mountSidebarFixture(ROWS);
  thread = document.createElement('main');
  const form = document.createElement('form');
  composer = document.createElement('div');
  composer.setAttribute('data-composer-markdown', '');
  composer.setAttribute('contenteditable', 'true');
  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.setAttribute('data-testid', 'send-button');
  sendButton.setAttribute('aria-label', 'Send prompt');
  form.append(composer, sendButton);
  document.body.append(thread, form);
});

afterEach(async () => {
  await scope.dispose();
  sidebar.destroy();
  document.body.replaceChildren();
  globalThis.chrome.storage = originalStorage;
  history.replaceState(null, '', '/');
  vi.useRealTimers();
});

async function nextPass(): Promise<void> {
  await settle(5);
  // The send tracker ends one submission on a 0 ms timer. jsdom's frame interval can fire
  // before that timer when the event loop is late, so a frame alone left the next Enter
  // inside the previous submission; a 0 ms timer queued after it always fires after it.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settle(20);
}

function shadow(): ShadowRoot {
  const host = document.querySelector<HTMLElement>('.gv-chatgpt-folder-section');
  if (!host?.shadowRoot) throw new Error('the folder section is not mounted');
  return host.shadowRoot;
}

async function activate(): Promise<void> {
  await activateChatGptFolders(scope, {}, requireBundledSiteAdapter('chatgpt'));
  await nextPass();
}

/** ChatGPT's router moving to `path`, as its links and its new-chat redirect do. */
async function route(path: string): Promise<void> {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await nextPass();
}

/** One exchange item, as ChatGPT renders it. */
function exchange(prompt: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-turn-key', `turn-${(turnCount += 1)}`);
  item.innerHTML = '<div><div data-user-message-bubble="true"></div></div><div>Answer</div>';
  item.querySelector('[data-user-message-bubble]')!.textContent = prompt;
  return item;
}

function pressEnter(): void {
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

/** The user types `prompt` and presses Enter; ChatGPT clears the composer and renders the message. */
async function send(prompt: string): Promise<void> {
  composer.textContent = prompt;
  pressEnter();
  composer.textContent = '';
  thread.append(exchange(prompt));
  await nextPass();
}

/** Delays the stored folders' first read until the returned `release` runs. */
function holdFolderLoad(): { release: () => void; started: () => boolean } {
  const read = memory.api.local.get;
  let release!: () => void;
  const loading = new Promise<void>((resolve) => (release = resolve));
  let folderRead = false;
  memory.api.local.get = (async (keys: unknown) => {
    if (keys === KEY) {
      folderRead = true;
      await loading;
    }
    return read(keys as never);
  }) as typeof read;
  return { release, started: () => folderRead };
}

function lastTurnAt(id: string): number | undefined {
  const data = memory.values.local.get(KEY) as FolderData;
  return Object.values(data.folderContents)
    .flat()
    .find((conversation) => conversation.conversationId === `chatgpt:conv:${id}`)?.lastTurnAt;
}

function bell(): HTMLButtonElement {
  return shadow().querySelector<HTMLButtonElement>('.gv-chatgpt-folder-section__activity')!;
}

describe('ChatGPT folder Activity', () => {
  it('sending a message in a filed ChatGPT chat records its turn time', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    thread.append(exchange('Draft the launch plan'));
    await activate();

    vi.setSystemTime(NOON + MINUTE);
    await send('Add a timeline');

    expect(lastTurnAt(WORK_CHAT)).toBe(NOON + MINUTE);
    expect(lastTurnAt(OLD_CHAT)).toBeUndefined();
  });

  it('opening an old ChatGPT chat records no turn time', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();

    // ChatGPT swaps in the other chat's transcript in batches, and remounts it once.
    await route(`/c/${OLD_CHAT}`);
    thread.append(exchange('First question'));
    await nextPass();
    thread.append(exchange('Second question'));
    await nextPass();
    const remounted = Array.from(thread.children, (item) => item.cloneNode(true));
    thread.replaceChildren(...remounted);
    await nextPass();

    expect(lastTurnAt(OLD_CHAT)).toBeUndefined();
    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();

    await send('Picking this back up');
    expect(lastTurnAt(OLD_CHAT)).toBe(NOON);
  });

  it('loading older messages records no turn time', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    thread.append(exchange('Recent question'));
    await activate();
    await send('Follow-up');
    expect(lastTurnAt(WORK_CHAT)).toBe(NOON);

    vi.setSystemTime(NOON + 10 * MINUTE);
    thread.prepend(exchange('An older question'), exchange('An even older question'));
    await nextPass();

    expect(lastTurnAt(WORK_CHAT)).toBe(NOON);
  });

  it('opening an old chat right after sending on a new chat does not stamp it', async () => {
    await activate();
    await send('A brand-new chat');

    // Before ChatGPT names the new chat, the user opens an old one, by a link
    // or a search result; its transcript replaces the outgoing message later.
    history.pushState(null, '', `/c/${OLD_CHAT}`);
    thread.append(document.createElement('div'));
    await nextPass();
    thread.replaceChildren(exchange('An old question'));
    await nextPass();

    expect(lastTurnAt(OLD_CHAT)).toBeUndefined();
  });

  it('a prompt ChatGPT refused does not stamp the chat when its last message loads', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();

    // ChatGPT is not ready for it, so the prompt stays in the composer unsent.
    composer.textContent = 'Not sent yet';
    pressEnter();
    thread.append(exchange("Yesterday's last question"));
    await nextPass();

    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();
  });

  it('a refused prompt does not stamp a chat whose last message merely contains it', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();

    composer.textContent = 'continue';
    pressEnter();
    thread.append(exchange('please continue'));
    await nextPass();

    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();
  });

  it('a file sent without a prompt records its turn time', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();

    const preview = document.createElement('div');
    preview.setAttribute('data-attachment-id', 'file-1');
    composer.closest('form')!.append(preview);
    pressEnter();
    preview.remove();
    thread.append(exchange(''));
    await nextPass();

    expect(lastTurnAt(WORK_CHAT)).toBe(NOON);
  });

  it('an empty Enter in a new chat does not stamp the old chat opened next', async () => {
    await activate();

    pressEnter();
    await route(`/c/${OLD_CHAT}`);
    thread.append(exchange('An old question'));
    await nextPass();

    expect(lastTurnAt(OLD_CHAT)).toBeUndefined();
  });

  it('a send after an empty Enter is stamped with its own time', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();

    pressEnter();
    vi.setSystemTime(NOON + MINUTE);
    await send('The real prompt');

    expect(lastTurnAt(WORK_CHAT)).toBe(NOON + MINUTE);
  });

  it('a send in another chat after one ChatGPT never showed is still recorded', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();

    // ChatGPT is still answering, so this Enter sends nothing.
    composer.textContent = 'Queued while it answers';
    pressEnter();
    await route(`/c/${OLD_CHAT}`);
    vi.setSystemTime(NOON + MINUTE);
    await send('Picking this back up');

    expect(lastTurnAt(OLD_CHAT)).toBe(NOON + MINUTE);
    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();
  });

  it('a send whose older messages load before it shows still records its own turn', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    thread.append(exchange('Recent question'));
    await activate();

    composer.textContent = 'Follow-up';
    pressEnter();
    composer.textContent = '';
    thread.prepend(exchange('An older question'));
    await nextPass();
    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();

    thread.append(exchange('Follow-up'));
    await nextPass();
    expect(lastTurnAt(WORK_CHAT)).toBe(NOON);
  });

  it('a message sent while ChatGPT folders are still loading still records its turn time', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    const load = holdFolderLoad();
    const activation = activateChatGptFolders(scope, {}, requireBundledSiteAdapter('chatgpt'));
    await vi.waitFor(() => expect(load.started()).toBe(true));

    vi.setSystemTime(NOON + MINUTE);
    await send('Ship while it loads');
    load.release();
    await activation;
    await nextPass();

    expect(lastTurnAt(WORK_CHAT)).toBe(NOON + MINUTE);
  });

  it('a message sent while ChatGPT folders load is not saved once they are turned off', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    const load = holdFolderLoad();
    const activation = activateChatGptFolders(scope, {}, requireBundledSiteAdapter('chatgpt'));
    await vi.waitFor(() => expect(load.started()).toBe(true));
    await send('Ship while it loads');

    // The folders finish loading while turning off is still under way.
    const turningOff = scope.dispose();
    load.release();
    await activation;
    await turningOff;
    await nextPass();

    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();
  });

  it('temporary chats record nothing', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}?temporary-chat=true`);
    await activate();

    await send('Off the record');
    expect(lastTurnAt(WORK_CHAT)).toBeUndefined();

    await route(`/c/${WORK_CHAT}`);
    await send('On the record');
    expect(lastTurnAt(WORK_CHAT)).toBe(NOON);
  });

  it('the header shows exactly import/export, cloud, settings, Activity and create, in that order', async () => {
    await activate();

    expect(headerLabels()).toEqual([
      t('folder_import_export'),
      t('folder_cloud'),
      t('folder_settings'),
      t('folder_activity_turn_on'),
      t('floatingPanelCreateFolder'),
    ]);
  });

  it('the activity bell stays beside the create button while other header actions are hidden', async () => {
    await activate();
    bell().click();
    await nextPass();

    const buttons = [
      ...shadow().querySelectorAll<HTMLButtonElement>('.gv-folder-header-actions button'),
    ];
    const at = buttons.indexOf(bell());
    const hiddenAtRest = buttons.filter(
      (button) =>
        button.classList.contains('gv-folder-header-reveal') &&
        button.getAttribute('aria-pressed') !== 'true',
    );
    expect(bell().getAttribute('aria-pressed')).toBe('true');
    expect(buttons.slice(at + 1).map((button) => button.getAttribute('aria-label'))).toEqual([
      t('floatingPanelCreateFolder'),
    ]);
    expect(hiddenAtRest.length).toBeGreaterThan(0);
    expect(hiddenAtRest.every((button) => buttons.indexOf(button) < at)).toBe(true);
  });

  it("activity times use Voyager's language, not the browser's", async () => {
    // An English (US) browser: an unspecified locale formats as en-US.
    const toLocaleTimeString = Date.prototype.toLocaleTimeString;
    const englishBrowser = vi
      .spyOn(Date.prototype, 'toLocaleTimeString')
      .mockImplementation(function (
        this: Date,
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) {
        const browserDefault = locales === undefined || (Array.isArray(locales) && !locales.length);
        return toLocaleTimeString.call(this, browserDefault ? 'en-US' : locales, options);
      });
    try {
      history.replaceState(null, '', `/c/${WORK_CHAT}`);
      await activate();
      await send('Ship it');
      setCachedLanguage('zh');
      bell().click();
      await nextPass();

      const time = shadow().querySelector('.gv-folder-activity-time')?.textContent;
      expect(time).toBe(
        new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(NOON),
      );
      expect(time).not.toMatch(/AM|PM/);
    } finally {
      setCachedLanguage('en');
      englishBrowser.mockRestore();
    }
  });

  it('the ChatGPT bell shows the activity list with a just-sent chat under Priority', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();
    await send('Ship it');
    bell().click();
    await nextPass();

    expect(bell().getAttribute('aria-pressed')).toBe('true');
    const priority = shadow().querySelector('.gv-folder-activity-group-priority');
    const rows = Array.from(
      priority?.querySelectorAll('.gv-folder-activity-item .gv-conversation-title') ?? [],
      (title) => title.textContent,
    );
    expect(rows).toEqual(['Launch plan']);
    expect(shadow().querySelector<HTMLElement>('.gv-floating-folder-panel__body')!.hidden).toBe(
      true,
    );
  });

  it('the ChatGPT activity view stays open after reload', async () => {
    history.replaceState(null, '', `/c/${WORK_CHAT}`);
    await activate();
    await send('Ship it');
    bell().click();
    await nextPass();

    await scope.dispose();
    scope = new PluginScope();
    await activate();

    expect(bell().getAttribute('aria-pressed')).toBe('true');
    const list = shadow().querySelector<HTMLElement>('.gv-folder-activity-list')!;
    expect(list.hidden).toBe(false);
    expect(list.querySelector('.gv-conversation-title')?.textContent).toBe('Launch plan');
  });
});
