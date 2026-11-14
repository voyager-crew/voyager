// @vitest-environment jsdom
/**
 * "New chat in this folder" through the page's own path (`PluginHost`, the
 * bundled catalog plugin and each site's `site.json`) on two sites' fixtures:
 * the item opens the site's new chat, and only the conversation the user's
 * send there creates lands in the folder.
 */
import type { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FolderData } from '@/core/types/folder';
import type { MemoryStorage } from '@/tests/memoryStorage';
import { initI18n } from '@/utils/i18n';

import * as claude from './claudeHarness';
import * as deepseek from './deepseekHarness';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id', getURL: (path: string) => path },
    i18n: { getUILanguage: () => 'en' },
  },
}));

declare const jsdom: JSDOM;

interface Harness {
  installStorage(enabled: boolean): MemoryStorage;
  restoreStorage(): void;
  openPage(memory: MemoryStorage): Promise<{ stored(): FolderData; close(): Promise<void> }>;
  mountSidebar(): unknown;
  nextPass(): Promise<void>;
  SECTION: string;
}

interface SiteCase {
  readonly name: string;
  readonly harness: Harness;
  readonly origin: string;
  readonly newChatPath: string;
  readonly chatPath: (id: string) => string;
  readonly storedId: (id: string) => string;
  /** The stored folder `f1`'s name. */
  readonly folder: string;
  /** The site's sidebar row the user may open instead. */
  readonly rowId: string;
  /** The site's composer and send button, as its site.json names them. */
  readonly composer: string;
  readonly send: 'enter' | 'button';
}

const NEW_ID = '0badc0de-0000-4000-8000-000000000001';

const SITES: readonly SiteCase[] = [
  {
    name: 'Claude',
    harness: claude,
    origin: 'https://claude.ai',
    newChatPath: '/new',
    chatPath: (id) => `/chat/${id}`,
    storedId: (id) => `claude:conv:${id}`,
    folder: 'Thesis',
    rowId: claude.RECENTS[1].id,
    composer: `<div data-composer-card-holder><div>
      <div data-testid="chat-input" contenteditable="true"></div>
      <button type="button" data-testid="chat-input-send">Send</button></div></div>`,
    send: 'button',
  },
  {
    name: 'DeepSeek',
    harness: deepseek,
    origin: 'https://chat.deepseek.com',
    newChatPath: '/',
    chatPath: (id) => `/a/chat/s/${id}`,
    storedId: (id) => `deepseek:conv:${id}`,
    folder: 'Work',
    rowId: deepseek.ROWS[1].id,
    composer: `<div><div><textarea class="ds-scroll-area"></textarea></div>
      <div class="ds-button ds-button--primary ds-button--circle" role="button"></div></div>`,
    send: 'enter',
  },
];

let close: (() => Promise<void>) | null = null;
let router: AbortController | null = null;

beforeAll(async () => {
  claude.installStorage(false);
  await initI18n();
  claude.restoreStorage();
});

afterEach(async () => {
  await close?.();
  close = null;
  router?.abort();
  router = null;
  for (const { harness } of SITES) harness.restoreStorage();
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** The site's SPA: its own links route in place, as its router does. */
function routeLinksInApp(): void {
  router = new AbortController();
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link || event.defaultPrevented) return;
      event.preventDefault();
      history.pushState(null, '', link.getAttribute('href'));
    },
    { signal: router.signal },
  );
}

async function openSite(site: SiteCase) {
  jsdom.reconfigure({ url: `${site.origin}${site.chatPath(site.rowId)}` });
  // Only the route watcher's poll is virtual; the page's own start-up keeps real time.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  site.harness.mountSidebar();
  const chrome = document.createElement('div');
  chrome.innerHTML = `<a href="${site.newChatPath}">New chat</a>${site.composer}`;
  document.body.append(chrome);
  routeLinksInApp();
  const page = await site.harness.openPage(site.harness.installStorage(true));
  close = page.close;
  await site.harness.nextPass();
  const poll = async () => {
    vi.advanceTimersByTime(400);
    await site.harness.nextPass();
  };
  return { page, poll };
}

function chooseNewChatIn(site: SiteCase): void {
  const section = document.querySelector<HTMLElement>(site.harness.SECTION)!;
  const header = [
    ...section.shadowRoot!.querySelectorAll('.gv-floating-folder-panel__folder-header'),
  ].find((folder) => folder.textContent?.includes(site.folder));
  if (!header) throw new Error(`no folder ${site.folder}`);
  header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  const layer = document.querySelector('.gv-folder-tree-popover-layer')!.shadowRoot!;
  const item = [...layer.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'New chat in this folder',
  );
  if (!item) throw new Error('no "New chat in this folder" item');
  item.click();
}

function send(site: SiteCase): void {
  if (site.send === 'button') {
    document.querySelector<HTMLElement>('[data-testid="chat-input"]')!.textContent = 'Hello';
    document.querySelector<HTMLElement>('[data-testid="chat-input-send"]')!.click();
    return;
  }
  const field = document.querySelector<HTMLTextAreaElement>('textarea.ds-scroll-area')!;
  field.value = 'Hello';
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

const filed = (page: { stored(): FolderData }) =>
  page.stored().folderContents.f1.map((entry) => entry.conversationId);

describe.each(SITES)('New chat in this folder on $name', (site) => {
  it('opens the site’s new chat and files the conversation the first send creates', async () => {
    const { page, poll } = await openSite(site);

    chooseNewChatIn(site);
    expect(location.pathname).toBe(site.newChatPath);
    await poll();
    send(site);
    history.pushState(null, '', site.chatPath(NEW_ID));
    await poll();

    expect(filed(page)).toContain(site.storedId(NEW_ID));
  });

  it('files nothing when the user opens a sidebar chat right after sending', async () => {
    const { page, poll } = await openSite(site);
    const before = filed(page);

    chooseNewChatIn(site);
    await poll();
    send(site);
    document.querySelector<HTMLElement>(`a[href="${site.chatPath(site.rowId)}"]`)!.click();
    await poll();

    expect(location.pathname).toBe(site.chatPath(site.rowId));
    expect(filed(page)).toEqual(before);
  });

  it('files nothing when the chat gets a route without a send', async () => {
    const { page, poll } = await openSite(site);
    const before = filed(page);

    chooseNewChatIn(site);
    await poll();
    history.pushState(null, '', site.chatPath(NEW_ID));
    await poll();

    expect(filed(page)).toEqual(before);
  });
});

describe('The new chat’s folder chip on Claude', () => {
  const site = SITES[0];
  const chip = () =>
    document.querySelector<HTMLElement>('.gv-new-chat-folder-chip')?.shadowRoot ?? null;
  const shown = () => {
    const root = chip();
    const host = document.querySelector('.gv-new-chat-folder-chip');
    if (!root || !host?.closest('[data-composer-card-holder]')) return null;
    return {
      label: root.querySelector('.label')!.textContent,
      clearable: !root.querySelector<HTMLButtonElement>('.clear')!.hidden,
    };
  };
  const openNewChat = async (poll: () => Promise<void>) => {
    document.querySelector<HTMLElement>(`a[href="${site.newChatPath}"]`)!.click();
    await poll();
  };

  it('offers the folders on the new chat, and files the chat into the one picked', async () => {
    const { page, poll } = await openSite(site);
    expect(shown()).toBeNull();

    await openNewChat(poll);
    expect(shown()).toEqual({ label: 'Folders', clearable: false });
    chip()!.querySelector<HTMLButtonElement>('.pick')!.click();
    const picker = document.querySelector(claude.PICKER)!.shadowRoot!;
    picker.querySelector<HTMLButtonElement>('[data-folder-id="f1"]')!.click();
    expect(shown()).toEqual({ label: site.folder, clearable: true });

    send(site);
    history.pushState(null, '', site.chatPath(NEW_ID));
    await poll();

    expect(filed(page)).toContain(site.storedId(NEW_ID));
    expect(shown()).toBeNull();
  });

  it('files nothing once × dropped the folder the menu chose', async () => {
    const { page, poll } = await openSite(site);
    const before = filed(page);

    chooseNewChatIn(site);
    await poll();
    expect(shown()).toEqual({ label: site.folder, clearable: true });
    chip()!.querySelector<HTMLButtonElement>('.clear')!.click();
    expect(shown()).toEqual({ label: 'Folders', clearable: false });

    send(site);
    history.pushState(null, '', site.chatPath(NEW_ID));
    await poll();

    expect(filed(page)).toEqual(before);
  });

  it('leaves the composer when the user leaves the new chat, and with the folders', async () => {
    const { poll } = await openSite(site);

    await openNewChat(poll);
    expect(shown()).not.toBeNull();
    history.pushState(null, '', site.chatPath(site.rowId));
    await poll();
    expect(shown()).toBeNull();

    await openNewChat(poll);
    expect(shown()).not.toBeNull();
    await close?.();
    close = null;
    expect(document.querySelector('.gv-new-chat-folder-chip')).toBeNull();
    expect(document.querySelector('[data-composer-card-holder] > div')!.className).toBe('');
  });
});
