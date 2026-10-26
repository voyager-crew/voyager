// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Folder } from '@/core/types/folder';

import { clearNewChatFolder, handOffNewChatFolder, pendingNewChatFolder } from '../pendingFolder';
import { createFolderProjectPicker, type FolderSnapshot } from '../picker';

vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));
vi.mock('../../folder/folderColors', () => ({
  getFolderColor: () => '#4285f4',
  isDarkMode: () => false,
}));
const folder: Folder = {
  id: 'work',
  name: 'Work',
  parentId: null,
  isExpanded: false,
  createdAt: 0,
  updatedAt: 0,
};
const snapshot: FolderSnapshot = { account: 'a', folders: [folder] };
let picker: ReturnType<typeof createFolderProjectPicker>;
const onSelect = vi.fn();
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function anchor(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'model-picker-container';
  document.body.append(element);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ height: 20 } as DOMRect);
  return element;
}
const chip = () => document.querySelector<HTMLButtonElement>('.gv-fp-chip')!;
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.useFakeTimers();
  onSelect.mockReset();
  document.body.innerHTML = '';
});
afterEach(async () => {
  picker?.remove();
  await settle();
  clearNewChatFolder();
  history.replaceState({}, '', '/u/0/app');
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('mounts only the new picker when an old mount finishes after remove and show', async () => {
  picker = createFolderProjectPicker({
    loadFolders: async () => snapshot,
    canMount: () => true,
    onSelect,
  });
  const oldShow = picker.show();
  picker.remove();
  const target = anchor();
  await picker.show();
  await oldShow;
  await vi.advanceTimersByTimeAsync(50);
  expect(document.querySelectorAll('.gv-fp-picker-container')).toHaveLength(1);
  expect(target.previousElementSibling).toBe(chip().parentElement);
});

it('a route change cancels a waiting mount and the next route can mount normally', async () => {
  picker = createFolderProjectPicker({
    loadFolders: async () => snapshot,
    canMount: () => true,
    onSelect,
  });
  const oldShow = picker.show();
  history.pushState({}, '', '/u/1/app');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await oldShow;
  anchor();
  await picker.show();
  expect(document.querySelectorAll('.gv-fp-picker-container')).toHaveLength(1);
  expect(chip().textContent).toBe('folderAsProject_selectFolder');
});

it('a removed picker cannot consume a pending folder returned by its old load', async () => {
  const loading = deferred<FolderSnapshot>();
  let read = () => loading.promise;
  picker = createFolderProjectPicker({
    loadFolders: () => read(),
    currentAccount: () => 'a',
    canMount: () => true,
    onSelect,
  });
  handOffNewChatFolder('work', 'a');
  anchor();
  await picker.show();
  picker.remove();
  loading.resolve(snapshot);
  await settle();
  expect(pendingNewChatFolder()).toBe('work');
  read = async () => snapshot;
  await picker.show();
  expect(chip().textContent).toBe('Work');
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it('account changes discard unfinished options and allow a fresh account load', async () => {
  const loading = deferred<FolderSnapshot>();
  let account = 'a';
  let read = () => loading.promise;
  const listeners = new Set<() => void>();
  picker = createFolderProjectPicker({
    loadFolders: () => read(),
    currentAccount: () => account,
    onAccountChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canMount: () => true,
    onSelect,
  });
  anchor();
  await picker.show();
  chip().click();
  account = 'b';
  for (const listener of listeners) listener();
  loading.resolve(snapshot);
  await settle();
  expect(document.querySelectorAll('.gv-fp-item')).toHaveLength(0);
  read = async () => ({ account: 'b', folders: [{ ...folder, id: 'home', name: 'Home' }] });
  chip().click();
  chip().click();
  await settle();
  document.querySelector<HTMLButtonElement>('[data-folder-id="home"]')!.click();
  expect(chip().textContent).toBe('Home');
  expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'home' }), 'user', 'b');
});

it('removing an already found mount before its await resumes cannot resurrect the picker', async () => {
  picker = createFolderProjectPicker({
    loadFolders: async () => snapshot,
    canMount: () => true,
    onSelect,
  });
  anchor();
  const old = picker.show();
  picker.remove();
  await old;
  await settle();
  expect(document.querySelectorAll('.gv-fp-picker-container')).toHaveLength(0);
  await picker.show();
  expect(document.querySelectorAll('.gv-fp-picker-container')).toHaveLength(1);
});

it('a route switch before the poll cannot take an old folder handoff', async () => {
  const loading = deferred<FolderSnapshot>();
  let read = () => loading.promise;
  picker = createFolderProjectPicker({ loadFolders: () => read(), canMount: () => true, onSelect });
  handOffNewChatFolder('work');
  anchor();
  await picker.show();
  history.pushState({}, '', '/u/1/app');
  loading.resolve({ account: null, folders: [folder] });
  await settle();
  expect(pendingNewChatFolder()).toBe('work');
  read = async () => ({ account: null, folders: [folder] });
  await picker.applyPending();
  expect(chip().textContent).toBe('Work');
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'the picker appears when an unreadable account becomes known while its anchor loads (notified=%s)',
  async (notified) => {
    let account: string | null = null;
    const listeners = new Set<() => void>();
    picker = createFolderProjectPicker({
      loadFolders: async () => snapshot,
      currentAccount: () => account,
      onAccountChange: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      canMount: () => true,
      onSelect,
    });
    const showing = picker.show();
    account = 'a';
    if (notified) for (const listener of listeners) listener();
    const target = anchor();
    await vi.advanceTimersByTimeAsync(20);
    await showing;
    expect(chip()?.textContent).toBe('folderAsProject_selectFolder');
    expect(target.previousElementSibling).toBe(chip().parentElement);
  },
);

it('folder options load when the account becomes known after opening the picker', async () => {
  let account: string | null = null;
  const loading = deferred<FolderSnapshot>();
  const listeners = new Set<() => void>();
  picker = createFolderProjectPicker({
    loadFolders: () => loading.promise,
    currentAccount: () => account,
    onAccountChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canMount: () => true,
    onSelect,
  });
  anchor();
  await picker.show();
  chip().click();
  account = 'a';
  for (const listener of listeners) listener();
  loading.resolve(snapshot);
  await settle();
  const option = document.querySelector<HTMLButtonElement>('[data-folder-id="work"]');
  expect(option?.textContent).toBe('Work');
  option!.click();
  expect(onSelect).toHaveBeenLastCalledWith(folder, 'user', 'a');
});
