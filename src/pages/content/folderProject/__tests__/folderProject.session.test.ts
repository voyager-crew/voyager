// @vitest-environment-options { "url": "https://gemini.google.com/u/1/app" }
/**
 * Folder-as-Project over Gemini's real folder session and an in-memory
 * `chrome.storage`: what the picker loads, takes and injects as the session
 * loads, binds and changes accounts.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  accountIsolationService,
  buildScopedStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { hideGeminiAccount, showGeminiAccount } from '../../folder/__tests__/geminiAccountControl';
import { GeminiFolderSession } from '../../folder/session/geminiFolderSession';

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

vi.mock('../../utils/inputHelper', () => ({
  setInputText: (input: HTMLElement, text: string) => {
    input.textContent = text;
  },
}));

vi.mock('../../chatInput/index', () => ({
  findChatInput: () => document.querySelector<HTMLElement>('#test-chat-input'),
}));

const KEY = StorageKeys.FOLDER_DATA;

const folder = (id: string, name: string, instructions?: string): FolderData => ({
  folders: [
    { id, name, parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1, instructions },
  ],
  folderContents: { [id]: [] },
});

let original: typeof chrome.storage;
let memory: MemoryStorage;
let session: GeminiFolderSession | null;
let folderReads: number;

async function pass(): Promise<void> {
  await settle(20);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await settle(20);
}

async function keyOf(account: string): Promise<string> {
  const scope = await accountIsolationService.resolveAccountScope({
    pageUrl: location.href,
    email: `${account}@example.com`,
    routeUserId: '1',
  });
  return buildScopedStorageKey(KEY, scope.accountKey);
}

/** Gemini's new-chat page: its composer and the model picker the folder picker sits beside. */
function mountComposer(): HTMLElement {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div id="test-chat-input" contenteditable="true" role="textbox"></div>' +
      '<div class="model-picker-container"><button></button></div>',
  );
  const anchor = document.querySelector<HTMLElement>('.model-picker-container')!;
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect);
  return document.getElementById('test-chat-input')!;
}

async function openNewChat(): Promise<typeof import('../pendingFolder')> {
  session = new GeminiFolderSession();
  await session.init();
  const { startFolderProject } = await import('../index');
  startFolderProject(session);
  await pass();
  return import('../pendingFolder');
}

const chip = () => document.querySelector<HTMLButtonElement>('.gv-fp-chip');

beforeEach(() => {
  vi.resetModules();
  original = globalThis.chrome.storage;
  memory = createMemoryStorage();
  const get = memory.api.local.get.bind(memory.api.local) as (
    keys: unknown,
    callback?: unknown,
  ) => Promise<Record<string, unknown>>;
  folderReads = 0;
  memory.api.local.get = ((keys: unknown, callback?: unknown) => {
    const named: unknown[] = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
    if (named.some((key) => typeof key === 'string' && key.startsWith(KEY))) folderReads += 1;
    return get(keys, callback);
  }) as typeof memory.api.local.get;
  globalThis.chrome.storage = memory.api;
  memory.values.sync.set(StorageKeys.LANGUAGE, 'en');
  memory.values.sync.set(StorageKeys.FOLDER_PROJECT_ENABLED, true);
  memory.values.sync.set(StorageKeys.FOLDER_ENABLED, false);
  session = null;
  localStorage.clear();
  document.body.innerHTML = '';
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  // Folder-as-Project's own off path removes its listeners.
  await memory.api.sync.set({ [StorageKeys.FOLDER_PROJECT_ENABLED]: false });
  await pass();
  const { clearNewChatFolder } = await import('../pendingFolder');
  clearNewChatFolder();
  await session?.close();
  globalThis.chrome.storage = original;
  window.history.replaceState({}, '', '/u/1/app');
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

it.each([
  ['the account has no folders yet', null],
  ['the handed-off folder was deleted', folder('kept', 'Kept')],
])('stops loading the folders when %s', async (_case, stored) => {
  if (stored) memory.values.local.set(KEY, stored);
  mountComposer();
  const { handOffNewChatFolder, pendingNewChatFolder } = await import('../pendingFolder');
  handOffNewChatFolder('gone');
  await openNewChat();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const settled = folderReads;

  await new Promise((resolve) => setTimeout(resolve, 300));
  await pass();

  // Each load announced the folders ready, which must not start another load.
  expect(folderReads).toBe(settled);
  expect(folderReads).toBeLessThan(6);
  expect(chip()?.dataset.selected).toBeUndefined();
  expect(pendingNewChatFolder()).toBe('gone');
});

it("never puts one account's folder instructions into another account's chat", async () => {
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
  const [aKey, bKey] = [await keyOf('a'), await keyOf('b')];
  memory.values.local.set(aKey, folder('work', 'Work', 'Private to account a'));
  memory.values.local.set(bKey, folder('home', 'Home'));
  showGeminiAccount('a@example.com');
  const input = mountComposer();
  await openNewChat();
  chip()!.click();
  await pass();
  [...document.querySelectorAll<HTMLElement>('.gv-fp-item')]
    .find((item) => item.textContent?.includes('Work'))!
    .click();
  expect(chip()!.dataset.selected).toBe('work');

  // The same tab, same URL, now signed in as b.
  showGeminiAccount('b@example.com');
  memory.writes.length = 0;
  input.textContent = 'hello';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  window.history.pushState({}, '', '/u/1/app/abcdef0123456789');
  await new Promise((resolve) => setTimeout(resolve, 700));
  await pass();

  expect(input.textContent).toBe('hello');
  expect(input.textContent).not.toContain('Private to account a');
  expect(memory.writes.filter((write) => write.key.startsWith(KEY))).toEqual([]);
  expect(memory.values.local.get(bKey)).toEqual(folder('home', 'Home'));
});

/** Opens the picker and picks `name` from its options. */
async function pick(name: string): Promise<void> {
  chip()!.click();
  await pass();
  option(name)!.click();
}
const option = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.gv-fp-item')].find((item) =>
    item.textContent?.includes(name),
  );

async function send(input: HTMLElement, text: string): Promise<void> {
  input.textContent = text;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  window.history.pushState({}, '', '/u/1/app/abcdef0123456789');
  await new Promise((resolve) => setTimeout(resolve, 700));
  await pass();
}

it("keeps a folder chosen before Gemini's account control appears, with isolation off", async () => {
  memory.values.local.set(KEY, folder('work', 'Work', 'Be brief.'));
  const input = mountComposer();
  await openNewChat();
  await pick('Work');

  // The same account's control is drawn after the choice: one bucket either way.
  showGeminiAccount('a@example.com');
  await send(input, 'hello');

  expect(input.textContent).toContain('Be brief.');
  const stored = memory.values.local.get(KEY) as FolderData;
  expect(stored.folderContents.work.map((entry) => entry.conversationId)).toEqual([
    'abcdef0123456789',
  ]);
});

it("never files another account's chat from options listed before the account switched", async () => {
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
  const [aKey, bKey] = [await keyOf('a'), await keyOf('b')];
  memory.values.local.set(aKey, folder('work', 'Work', 'Private to account a'));
  memory.values.local.set(bKey, folder('home', 'Home'));
  showGeminiAccount('a@example.com');
  const input = mountComposer();
  await openNewChat();
  chip()!.click();
  await pass();
  const stale = option('Work')!;

  // The same URL now shows b, and the folders rebind to it.
  showGeminiAccount('b@example.com');
  await session!.ensureDataLoaded();
  await pass();
  memory.writes.length = 0;
  stale.click();
  await send(input, 'hello');

  expect(chip()?.dataset.selected).toBeUndefined();
  expect(input.textContent).toBe('hello');
  expect(memory.writes.filter((write) => write.key.startsWith(KEY))).toEqual([]);
  expect(memory.values.local.get(bKey)).toEqual(folder('home', 'Home'));
});

it("never owns one account's options by the account that took the page while they loaded", async () => {
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
  memory.values.local.set(await keyOf('a'), folder('work', 'Work', 'Private to account a'));
  memory.values.local.set(await keyOf('b'), folder('home', 'Home'));
  showGeminiAccount('a@example.com');
  const input = mountComposer();
  await openNewChat();
  // b takes the page the moment a's folders have been read for the dropdown.
  const read = session!.getFolders.bind(session!);
  vi.spyOn(session!, 'getFolders').mockImplementation(() => {
    const listed = read();
    showGeminiAccount('b@example.com');
    return listed;
  });

  chip()!.click();
  await pass();
  expect(option('Work')).toBeUndefined();
  // The new account can still load and choose its own options after the old load was dropped.
  vi.mocked(session!.getFolders).mockRestore();
  chip()!.click();
  await pick('Home');
  expect(chip()?.dataset.selected).toBe('home');
  await send(input, 'hello');

  expect(input.textContent).toBe('hello');
});

it("never sends one account's instructions when a retried send finds the account unreadable", async () => {
  memory.values.sync.set(StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI, true);
  memory.values.local.set(await keyOf('a'), folder('work', 'Work', 'Private to account a'));
  showGeminiAccount('a@example.com');
  const input = mountComposer();
  await openNewChat();
  await pick('Work');

  // The first send fails: the page stays on the new chat with a's instructions in the composer.
  input.textContent = 'hello';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(input.textContent).toContain('Private to account a');

  // The account control goes away, and the send is tried again.
  hideGeminiAccount();
  memory.writes.length = 0;
  await send(input, input.textContent ?? '');

  expect(input.textContent).toBe('hello');
  expect(memory.writes.filter((write) => write.key.startsWith(KEY))).toEqual([]);
});
