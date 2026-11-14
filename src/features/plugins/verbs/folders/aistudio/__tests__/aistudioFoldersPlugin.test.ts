// @vitest-environment-options { "url": "https://aistudio.google.com/prompts/new_chat" }
/**
 * AI Studio's folders as the page runs them: the content script's start point
 * (`admitAIStudioFolders`) holding the folder session, and the packaged
 * `voyager.aistudio-folders` plugin mounted by `PluginHost` on AI Studio's
 * bundled `site.json`, over an in-memory `chrome.storage`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountIsolationService,
  buildScopedStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { createOfficialAdmission } from '@/features/plugins/runtime/officialAdmission';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import { admitAIStudioFolders } from '@/pages/content/aistudioFolderStartup';
import { nameInput, treeRoot } from '@/pages/content/folder/__tests__/aistudioTreeDriver';
import { menuItem, treeDriver } from '@/pages/content/folder/floatingTree/__tests__/treeDriver';
import { aistudioFolderLeases } from '@/pages/content/folder/session/aistudioFolderSessions';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => path,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      sendMessage: async () => undefined,
    },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const ID = OFFICIAL_PLUGIN_IDS.aistudioFolders;
const KEY = StorageKeys.FOLDER_DATA_AISTUDIO;
const PANEL = '.gv-aistudio.gv-folder-container';

const STORED: FolderData = {
  folders: [
    { id: 'f1', name: 'Thesis', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: {
    f1: [
      {
        conversationId: 'p1',
        title: 'Draft',
        url: 'https://aistudio.google.com/prompts/p1',
        addedAt: 1,
      },
    ],
    [AISTUDIO_ROOT_BUCKET_ID]: [],
  },
};

let original: typeof chrome.storage;
let memory: MemoryStorage;
let host: PluginHost | null;
let lifetime: AbortController;

async function pass(): Promise<void> {
  await settle(20);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await settle(20);
}

async function openPage(options: { master?: boolean } = {}): Promise<PluginHost> {
  const master = options.master ?? true;
  memory.values.sync.set(StorageKeys.GV_AISTUDIO_ENABLED, master);
  const admission = createOfficialAdmission();
  admitAIStudioFolders(admission, { masterOn: master, lifetime: lifetime.signal });
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
  await pass();
  return host;
}

const status = () => host?.getStatuses().find((entry) => entry.id === ID)?.kind;
const panel = () => document.querySelector(PANEL);
/** Writes of folder data, global or per account; the one-time migration marker is not data. */
const folderWrites = () =>
  memory.writes.filter((write) => write.key === KEY || write.key.startsWith(`${KEY}:acct:`));
const outline = () =>
  treeDriver({ root: treeRoot(), rootBucketId: AISTUDIO_ROOT_BUCKET_ID }).outline();

beforeEach(() => {
  original = globalThis.chrome.storage;
  memory = createMemoryStorage();
  globalThis.chrome.storage = memory.api;
  memory.values.sync.set(StorageKeys.LANGUAGE, 'en');
  memory.values.local.set(KEY, structuredClone(STORED));
  lifetime = new AbortController();
  host = null;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  document.body.innerHTML =
    '<span class="account-switcher-text" data-email="a@example.com">a@example.com</span>' +
    '<div class="nav-content v3-left-nav"><nav><div class="empty-space"></div></nav></div>';
});

afterEach(async () => {
  host?.stop();
  lifetime.abort();
  await pass();
  globalThis.chrome.storage = original;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.className = '';
});

describe('AI Studio folders as an official plugin', () => {
  it('shows what the folder manager stored, on by default, without rewriting it', async () => {
    await openPage();

    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(status()).toBe('mounted');
    expect(outline()).toEqual(['Thesis', '  · Draft']);
    expect(folderWrites()).toEqual([]);
    expect(memory.values.local.get(KEY)).toEqual(STORED);
  });

  it('turns off and on with the folders switch, live, keeping the data and the session', async () => {
    await openPage();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(aistudioFolderLeases()).toBe(2);

    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: false });
    await vi.waitFor(() => expect(panel()).toBeNull());
    await pass();
    // The page still holds the session: sync answers and the account scope outlive the plugin.
    expect(aistudioFolderLeases()).toBe(1);
    expect(document.documentElement.classList.contains('gv-aistudio-root')).toBe(false);

    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: true });
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(outline()).toEqual(['Thesis', '  · Draft']);
    expect(memory.values.local.get(KEY)).toEqual(STORED);
    expect(folderWrites()).toEqual([]);
  });

  it('stays off while the folders switch is off', async () => {
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    await openPage();

    expect(status()).not.toBe('mounted');
    expect(panel()).toBeNull();
    expect(aistudioFolderLeases()).toBe(1);
  });

  it('moves the folders stored in sync to local with the folders switched off', async () => {
    memory.values.local.delete(KEY);
    memory.values.sync.set(KEY, structuredClone(STORED));
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    await openPage();

    await vi.waitFor(() => expect(memory.values.local.get(`${KEY}:legacySyncImported`)).toBe(true));
    expect(memory.values.local.get(KEY)).toEqual(STORED);
    expect(panel()).toBeNull();
  });

  it('mounts without a reload when Voyager is turned back on for AI Studio', async () => {
    await openPage({ master: false });
    expect(panel()).toBeNull();

    await memory.api.sync.set({ [StorageKeys.GV_AISTUDIO_ENABLED]: true });

    await vi.waitFor(() => expect(panel()).not.toBeNull());
    expect(outline()).toEqual(['Thesis', '  · Draft']);
  });

  it("hides the Library rows of filed prompts with AI Studio's own switch, live", async () => {
    window.history.replaceState({}, '', '/library');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<table class="mat-mdc-table"><tr class="mat-mdc-row"><td><a href="/prompts/p1">Draft</a></td></tr>' +
        '<tr class="mat-mdc-row"><td><a href="/prompts/p2">Loose</a></td></tr></table>',
    );
    const hidden = () =>
      [...document.querySelectorAll('tr.gv-conversation-archived a')].map((link) =>
        link.getAttribute('href'),
      );
    try {
      await openPage();
      await vi.waitFor(() => expect(panel()).not.toBeNull());
      expect(hidden()).toEqual([]);

      // Gemini's own switch leaves AI Studio's Library alone.
      await memory.api.sync.set({ [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS]: true });
      await pass();
      expect(hidden()).toEqual([]);

      await memory.api.sync.set({
        [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO]: true,
      });
      await vi.waitFor(() => expect(hidden()).toEqual(['/prompts/p1']));
      expect(panel()).not.toBeNull();

      await memory.api.sync.set({
        [StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO]: false,
      });
      await vi.waitFor(() => expect(hidden()).toEqual([]));
    } finally {
      window.history.replaceState({}, '', '/prompts/new_chat');
    }
  });

  it('"New chat in this folder" opens the new chat and files the prompt its first run creates', async () => {
    window.history.replaceState({}, '', '/prompts/p1');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a href="/prompts/new_chat">New chat</a>' +
        '<ms-prompt-box><textarea formcontrolname="promptText"></textarea>' +
        '<ms-run-button><button>Run</button></ms-run-button></ms-prompt-box>',
    );
    // AI Studio's router: its own links route in place.
    document.addEventListener(
      'click',
      (event) => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!link) return;
        event.preventDefault();
        window.history.pushState({}, '', link.getAttribute('href'));
      },
      { signal: lifetime.signal },
    );
    // Only the route poll is virtual.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const poll = async () => {
      vi.advanceTimersByTime(400);
      await pass();
    };
    try {
      await openPage();
      await vi.waitFor(() => expect(panel()).not.toBeNull());

      treeDriver({ root: treeRoot(), rootBucketId: AISTUDIO_ROOT_BUCKET_ID }).openMenuByButton(
        'Thesis',
      );
      menuItem('New chat in this folder').click();
      expect(location.pathname).toBe('/prompts/new_chat');
      await poll();
      document.querySelector('textarea')!.value = 'Hello';
      document.querySelector<HTMLButtonElement>('ms-run-button > button')!.click();
      window.history.pushState({}, '', '/prompts/p9');
      await poll();

      await vi.waitFor(() =>
        expect(
          (memory.values.local.get(KEY) as FolderData).folderContents.f1.map(
            (prompt) => prompt.conversationId,
          ),
        ).toEqual(['p1', 'p9']),
      );
    } finally {
      vi.useRealTimers();
      window.history.replaceState({}, '', '/prompts/new_chat');
    }
  });

  it("turning folders on right after an account switch opens the new account's folders", async () => {
    const folder = (name: string): FolderData => ({
      folders: [{ id: name, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
      folderContents: { [name]: [], [AISTUDIO_ROOT_BUCKET_ID]: [] },
    });
    const keyOf = async (account: string) => {
      const scope = await accountIsolationService.resolveAccountScope({
        pageUrl: location.href,
        email: `${account}@example.com`,
      });
      return buildScopedStorageKey(KEY, scope.accountKey);
    };
    const [aKey, bKey] = [await keyOf('a'), await keyOf('b')];
    memory.values.local.set(aKey, folder('Private a'));
    memory.values.local.set(bKey, folder('Private b'));
    memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED, true);
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    await openPage();
    expect(panel()).toBeNull();

    // Account b signs in, and folders go on before the account poll notices.
    const indicator = document.querySelector('.account-switcher-text')!;
    indicator.setAttribute('data-email', 'b@example.com');
    indicator.textContent = 'b@example.com';
    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: true });

    await vi.waitFor(() => expect(outline()).toEqual(['Private b']));
    document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')!.click();
    const input = nameInput()!;
    input.value = 'Made on b';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() =>
      expect((memory.values.local.get(bKey) as FolderData).folders.map((f) => f.name)).toContain(
        'Made on b',
      ),
    );
    expect(memory.values.local.get(aKey)).toEqual(folder('Private a'));
  });

  it("a B → C switch during the awaited account refresh still opens C's folders and never writes B", async () => {
    const folder = (name: string): FolderData => ({
      folders: [{ id: name, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 }],
      folderContents: { [name]: [], [AISTUDIO_ROOT_BUCKET_ID]: [] },
    });
    const keyOf = async (account: string) => {
      const scope = await accountIsolationService.resolveAccountScope({
        pageUrl: location.href,
        email: `${account}@example.com`,
      });
      return buildScopedStorageKey(KEY, scope.accountKey);
    };
    const [aKey, bKey, cKey] = [await keyOf('a'), await keyOf('b'), await keyOf('c')];
    for (const [key, name] of [
      [aKey, 'Private a'],
      [bKey, 'Private b'],
      [cKey, 'Private c'],
    ]) {
      memory.values.local.set(key, folder(name));
    }
    memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED, true);
    memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
    // No account poll: only the enable may notice the switches.
    vi.spyOn(window, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);
    await openPage();
    const signIn = (account: string) => {
      const indicator = document.querySelector('.account-switcher-text')!;
      indicator.setAttribute('data-email', `${account}@example.com`);
      indicator.textContent = `${account}@example.com`;
    };
    // B's scope resolves only once the page already shows C.
    const resolve = accountIsolationService.resolveAccountScope.bind(accountIsolationService);
    let release!: () => void;
    const held = new Promise<void>((done) => (release = done));
    const resolving = vi
      .spyOn(accountIsolationService, 'resolveAccountScope')
      .mockImplementationOnce(async (input) => {
        const scope = await resolve(input);
        await held;
        return scope;
      });

    signIn('b');
    await memory.api.sync.set({ [StorageKeys.FOLDER_ENABLED]: true });
    await vi.waitFor(() => expect(resolving).toHaveBeenCalled());
    signIn('c');
    release();

    await vi.waitFor(() => expect(outline()).toEqual(['Private c']));
    document.querySelector<HTMLButtonElement>('.gv-folder-add-btn')!.click();
    const input = nameInput()!;
    input.value = 'Made on c';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() =>
      expect((memory.values.local.get(cKey) as FolderData).folders.map((f) => f.name)).toContain(
        'Made on c',
      ),
    );
    expect(memory.values.local.get(bKey)).toEqual(folder('Private b'));
    expect(memory.values.local.get(aKey)).toEqual(folder('Private a'));
  });
});
