// @vitest-environment-options { "url": "https://gemini.google.com/u/1/app" }
/**
 * Gemini's folders as the page runs them: the content script's start point
 * (`admitGeminiFolders`) holding the folder session, and the packaged
 * `voyager.gemini-folders` plugin mounted by `PluginHost` on Gemini's bundled
 * `site.json`, over an in-memory `chrome.storage`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@locales/en/messages.json';
import ja from '@locales/ja/messages.json';

import {
  accountIsolationService,
  buildScopedStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import { ACCOUNT_NOTICE_GRACE_MS } from '@/features/plugins/verbs/folders/accountNotice';
import {
  hideGeminiAccount,
  showGeminiAccount,
} from '@/pages/content/folder/__tests__/geminiAccountControl';
import { mountSidebar } from '@/pages/content/folder/__tests__/sidebarRuntimeHarness';
import { sidebarTree } from '@/pages/content/folder/__tests__/sidebarTreeDriver';
import type { GeminiFolderSession } from '@/pages/content/folder/session/geminiFolderSession';
import { geminiFolderLeases } from '@/pages/content/folder/session/geminiFolderSessions';
import { admitGeminiFolders } from '@/pages/content/geminiFolderStartup';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';
import { setCachedLanguage } from '@/utils/i18n';

import profile from '../../__tests__/fixtures/geminiFolderData.json';

const messageListeners = vi.hoisted(
  () => new Set<(message: unknown, sender: unknown, respond: (r: unknown) => void) => unknown>(),
);

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => path,
      onMessage: {
        addListener: (listener: never) => messageListeners.add(listener),
        removeListener: (listener: never) => messageListeners.delete(listener),
      },
      sendMessage: async () => undefined,
    },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const ID = OFFICIAL_PLUGIN_IDS.geminiFolders;
const KEY = StorageKeys.FOLDER_DATA;
const PANEL = '.gv-folder-container';
const FILED = 'aaaaaaaaaaaaaaaa';

const folder = (name: string, conversations: string[] = []): FolderData => ({
  folders: [{ id: name, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
  folderContents: {
    [name]: conversations.map((hex) => ({
      conversationId: `c_${hex}`,
      title: `Chat ${hex.slice(0, 2)}`,
      url: `https://gemini.google.com/u/1/app/${hex}`,
      addedAt: 1,
    })),
  },
});
const STORED = folder('Thesis', [FILED]);

let original: typeof chrome.storage;
let memory: MemoryStorage;
let host: PluginHost | null;
let lifetime: AbortController;
let cleanup: CleanupManager;
let session: GeminiFolderSession | null;

async function pass(): Promise<void> {
  await settle(20);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await settle(20);
}

async function openPage(options: { admit?: boolean } = {}): Promise<PluginHost> {
  const admission = createOfficialAdmission();
  const admitted =
    options.admit === false
      ? null
      : admitGeminiFolders(admission, { cleanupManager: cleanup, lifetime: lifetime.signal });
  admission.close();
  host = new PluginHost({
    url: location.href,
    sources: [new BundledCatalogPluginSource()],
    doc: document,
    admission,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
  session = await admitted;
  await pass();
  return host;
}

const status = () => host?.getStatuses().find((entry) => entry.id === ID)?.kind;
const panel = () => document.querySelector(PANEL);
const outline = () => sidebarTree(document).outline();
const folderWrites = () =>
  memory.writes.filter((write) => write.key === KEY || write.key.startsWith(`${KEY}:acct:`));

/** What the popup's cloud upload is answered with. */
function requestData(): unknown {
  let answer: unknown;
  for (const listener of messageListeners) {
    listener({ type: 'gv.sync.requestData' }, {}, (response) => (answer = response));
  }
  return answer;
}

/** The popup's cloud upload request, answered once the page is ready to answer it. */
function requestUpload(): Promise<unknown> {
  return new Promise((resolve) => {
    for (const listener of messageListeners) {
      listener({ type: 'gv.sync.requestData' }, {}, resolve);
    }
  });
}

async function keyOf(account: string, routeUserId = '1'): Promise<string> {
  const scope = await accountIsolationService.resolveAccountScope({
    pageUrl: `https://gemini.google.com/u/${routeUserId}/app`,
    email: `${account}@example.com`,
    routeUserId,
  });
  return buildScopedStorageKey(KEY, scope.accountKey);
}

beforeEach(() => {
  original = globalThis.chrome.storage;
  memory = createMemoryStorage();
  globalThis.chrome.storage = memory.api;
  memory.values.sync.set(StorageKeys.LANGUAGE, 'en');
  memory.values.local.set(KEY, structuredClone(STORED));
  lifetime = new AbortController();
  cleanup = new CleanupManager();
  host = null;
  session = null;
  messageListeners.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  document.body.innerHTML = '';
  const { recentsSection } = mountSidebar();
  recentsSection.innerHTML =
    `<div data-test-id="conversation" jslog='["c_${FILED}"]'>` +
    `<a href="/u/1/app/${FILED}"><span class="conversation-title">Chat aa</span></a></div>` +
    `<div data-test-id="conversation" jslog='["c_bbbbbbbbbbbbbbbb"]'>` +
    '<a href="/u/1/app/bbbbbbbbbbbbbbbb"><span class="conversation-title">Loose</span></a></div>';
});

afterEach(async () => {
  host?.stop();
  lifetime.abort();
  cleanup.executeCleanups();
  await pass();
  globalThis.chrome.storage = original;
  window.history.replaceState({}, '', '/u/1/app');
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Gemini folders as an official plugin', () => {
  it('shows what the folder manager stored, on by default, without rewriting it', async () => {
    await openPage();

    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(status()).toBe('mounted');
    expect(outline()).toEqual(['Thesis', '  · Chat aa']);
    expect(folderWrites()).toEqual([]);
    expect(memory.values.local.get(KEY)).toEqual(STORED);
  });

  it("opens a folder manager user's profile as the folder manager drew it", async () => {
    memory.values.local.set(KEY, structuredClone(profile.stored));
    await openPage();

    await vi.waitFor(() => expect(panel()).not.toBeNull());
    // The outline `geminiFolderData.test.ts` pins for the same profile.
    expect(outline()).toEqual([
      '· 会话 2',
      '· 会话 4',
      '· 会话 1',
      '· 会话 5',
      '· 会话 3',
      'Voyager 测试 1',
      'Voyager 测试 2',
      'Voyager 测试 3',
      '  · 会话 16',
      '  · 会话 17',
      '  · 会话 15',
      '  Voyager 测试 4',
      '  Voyager 测试 5',
      '    · 会话 23',
      '    · 会话 25',
      '    · 会话 24',
      '    · 会话 26',
    ]);
    expect(folderWrites()).toEqual([]);
    expect(memory.values.local.get(KEY)).toEqual(profile.stored);
  });

  it('turns off and on with the Folders card switch, live, keeping the data and the session', async () => {
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(geminiFolderLeases()).toBe(2);

    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: false });
    await vi.waitFor(() => expect(panel()).toBeNull());
    await pass();
    // The page still holds the session: sync answers and Folder-as-Project outlive the plugin.
    expect(geminiFolderLeases()).toBe(1);
    expect(requestData()).toMatchObject({ ok: true, data: STORED });
    expect(document.head.querySelector('style[class^="gv-folder-"]')).toBeNull();

    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: true });
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(outline()).toEqual(['Thesis', '  · Chat aa']);
    expect(memory.values.local.get(KEY)).toEqual(STORED);
    expect(folderWrites()).toEqual([]);
  });

  it('stays off while the Folders card switch is off', async () => {
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    await openPage();

    expect(status()).not.toBe('mounted');
    expect(panel()).toBeNull();
    expect(geminiFolderLeases()).toBe(1);
  });

  it('mounts nothing unless the page admitted the folders', async () => {
    await openPage({ admit: false });

    expect(status()).not.toBe('mounted');
    expect(panel()).toBeNull();
    expect(geminiFolderLeases()).toBe(0);
  });

  it("hides the sidebar rows of filed chats with Gemini's own switch, live", async () => {
    const hidden = () =>
      [...document.querySelectorAll('.gv-conversation-archived a')].map((link) =>
        link.getAttribute('href'),
      );
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(hidden()).toEqual([]);

    // AI Studio's own switch leaves Gemini's sidebar alone.
    await memory.api.sync.set({ [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO]: true });
    await pass();
    expect(hidden()).toEqual([]);

    await memory.api.sync.set({ [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS]: true });
    await vi.waitFor(() => expect(hidden()).toEqual([`/u/1/app/${FILED}`]));

    // Turning the folders off shows every row again: nothing would show the filed ones.
    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: false });
    await vi.waitFor(() => expect(panel()).toBeNull());
    expect(hidden()).toEqual([]);
  });

  it('relabels the folder section once a newly selected language has loaded', async () => {
    const title = () => panel()?.querySelector('.gv-folder-header .title')?.textContent?.trim();
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(title()).toBe(en.folder_title.message);

    try {
      // What i18n's own storage listener runs for the popup's choice: load the chunk, then apply.
      await setCachedLanguage('ja');
      expect(title()).toBe(ja.folder_title.message);
    } finally {
      await setCachedLanguage('en');
    }
  });
});

describe("Gemini folders' account gate", () => {
  beforeEach(() => {
    memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
  });

  it("shows no folders and writes none until Gemini's account control can be read", async () => {
    const aKey = await keyOf('a');
    memory.values.local.set(aKey, structuredClone(STORED));
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    // No account is known: nothing of any bucket shows, nothing is answered or written.
    expect(outline()).toEqual([]);
    expect(requestData()).toEqual({ ok: false });
    document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')?.click();
    await pass();
    expect(folderWrites()).toEqual([]);

    showGeminiAccount('a@example.com');
    await vi.waitFor(() => expect(outline()).toEqual(['Thesis', '  · Chat aa']), {
      timeout: 4000,
    });
    expect(requestData()).toMatchObject({ ok: true, data: STORED });
    expect(folderWrites()).toEqual([]);
    expect(memory.values.local.get(KEY)).toEqual(STORED);
  });

  it("says why the folders are hidden instead of loading forever while Gemini's account stays unreadable", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    memory.values.local.set(await keyOf('a'), structuredClone(STORED));
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const container = () => panel() as HTMLElement;
    const notice = () => container().querySelector(':scope > .gv-folder-account-notice');
    const list = () => container().querySelector<HTMLElement>(':scope > .gv-folder-list')!;
    // Gemini draws its account button a moment after the panel: no warning yet, only the wait.
    expect(notice()).toBeNull();
    expect(container().inert).toBe(true);
    await vi.advanceTimersByTimeAsync(ACCOUNT_NOTICE_GRACE_MS);

    expect(container().getAttribute('aria-busy')).toBe('false');
    expect(notice()?.textContent).toBe(
      "Can't confirm which account this page is signed in to, so folders are hidden. They're still saved.",
    );
    expect(notice()?.getAttribute('role')).toBe('status');
    expect(list().inert).toBe(true);
    expect(container().querySelector<HTMLButtonElement>('.gv-folder-add-btn')!.disabled).toBe(true);
    expect(outline()).toEqual([]);

    showGeminiAccount('a@example.com');
    await vi.waitFor(() => expect(outline()).toEqual(['Thesis', '  · Chat aa']), {
      timeout: 4000,
    });
    expect(notice()).toBeNull();
    expect(list().inert).toBe(false);
    expect(container().inert).toBe(false);
    expect(container().getAttribute('aria-busy')).toBe('false');
  });

  it('shows no account warning on a page whose account button is drawn within the grace', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    memory.values.local.set(await keyOf('a'), structuredClone(STORED));
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    await vi.advanceTimersByTimeAsync(ACCOUNT_NOTICE_GRACE_MS - 1000);

    expect(panel()!.querySelector('.gv-folder-account-notice')).toBeNull();
    showGeminiAccount('a@example.com');
    await vi.waitFor(() => expect(outline()).toEqual(['Thesis', '  · Chat aa']), {
      timeout: 4000,
    });
    await vi.advanceTimersByTimeAsync(ACCOUNT_NOTICE_GRACE_MS * 2);
    expect(panel()!.querySelector('.gv-folder-account-notice')).toBeNull();
  });

  it("closes on another account's page and reopens on that account's folders", async () => {
    const [aKey, bKey] = [await keyOf('a'), await keyOf('b')];
    memory.values.local.set(aKey, folder('Private a'));
    memory.values.local.set(bKey, folder('Private b'));
    showGeminiAccount('a@example.com');
    await openPage();
    await vi.waitFor(() => expect(outline()).toEqual(['Private a']));

    // Account b signs in on the same route slot.
    showGeminiAccount('b@example.com');
    await vi.waitFor(() => expect(outline()).toEqual(['Private b']), { timeout: 4000 });
    expect(memory.values.local.get(aKey)).toEqual(folder('Private a'));
    expect(folderWrites()).toEqual([]);
  });

  it('writes nothing and claims no folders when the route switches to an unreadable account with the folders off', async () => {
    window.history.replaceState({}, '', '/u/0/app');
    const [aKey, bKey] = [await keyOf('a', '0'), await keyOf('b', '1')];
    memory.values.local.set(aKey, folder('Private a'));
    // Unscoped data from before isolation: a route slot alone must never claim it.
    memory.values.local.set(KEY, folder('Legacy', ['cccccccccccccccc']));
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    showGeminiAccount('a@example.com');
    await openPage();
    memory.writes.length = 0;
    const backups = () => Object.keys(localStorage).filter((key) => key.startsWith('gvBackup_'));
    const backupsBefore = backups();

    // Account b's page, before Gemini draws b's account button.
    hideGeminiAccount();
    window.history.pushState({}, '', '/u/1/app');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await pass();

    expect(memory.writes).toEqual([]);
    expect(backups()).toEqual(backupsBefore);
    await session!.ensureDataLoaded();
    expect(session!.getFolders()).toEqual([]);
    expect(memory.writes).toEqual([]);

    // Once b is known, b gets b's own folders; neither a's nor the legacy ones.
    memory.values.local.set(bKey, folder('Private b'));
    showGeminiAccount('b@example.com');
    await session!.ensureDataLoaded();
    expect(session!.getFolders().map((entry) => entry.name)).toEqual(['Private b']);
    expect(memory.values.local.get(aKey)).toEqual(folder('Private a'));
    expect(folderWrites()).toEqual([]);
  }, 10_000);

  it('uploads the folders of an account whose control was unreadable at start with the folders off', async () => {
    const aKey = await keyOf('a');
    // That account's folders exist only in the page's own copy, from an older build.
    localStorage.setItem(aKey, JSON.stringify(folder('Private a')));
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    await openPage();
    expect(memory.values.local.get(aKey)).toBeUndefined();

    showGeminiAccount('a@example.com');
    const answer = await requestUpload();

    expect(answer).toMatchObject({ ok: true, data: folder('Private a') });
    expect(memory.values.local.get(aKey)).toEqual(folder('Private a'));
  });

  it("turning folders on right after an account switch opens the new account's folders", async () => {
    const [aKey, bKey] = [await keyOf('a'), await keyOf('b')];
    memory.values.local.set(aKey, folder('Private a'));
    memory.values.local.set(bKey, folder('Private b'));
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    showGeminiAccount('a@example.com');
    await openPage();
    expect(panel()).toBeNull();

    showGeminiAccount('b@example.com');
    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: true });

    await vi.waitFor(() => expect(outline()).toEqual(['Private b']), { timeout: 4000 });
    expect(memory.values.local.get(aKey)).toEqual(folder('Private a'));
    expect(folderWrites()).toEqual([]);
  });
});
