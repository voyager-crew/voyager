// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * Dragging in ChatGPT's folder section, against its real store and storage:
 * every drag Gemini's folder sidebar offers.
 * A drop lands where the pointer is, so each target reports a 40px-tall rect.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import {
  type FakeTransfer,
  type TreeDriver,
  fakeTransfer,
  treeDriver,
} from '@/pages/content/folder/floatingTree/__tests__/treeDriver';
import {
  type MemoryStorage,
  createMemoryStorage,
  settle as settleStorage,
} from '@/tests/memoryStorage';
import { initI18n } from '@/utils/i18n';

import { type SidebarFixture, makeRows, mountSidebarFixture } from './chatgptSidebarFixture';
import { activateChatGptFolders } from './chatgptSite';

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
const LIT = 'gv-floating-folder-panel__drop-target';

function ref(id: string, title: string, sortIndex: number) {
  return {
    conversationId: `chatgpt:conv:${id}`,
    title,
    url: `https://chatgpt.com/c/${id}`,
    addedAt: 1,
    sortIndex,
  };
}

function folder(id: string, name: string, parentId: string | null, sortIndex: number) {
  return { id, name, parentId, isExpanded: true, sortIndex, createdAt: 1, updatedAt: 1 };
}

/** Work › Notes, then Personal and Ideas at the root. */
const DATA: FolderData = {
  folders: [
    folder('work', 'Work', null, 0),
    folder('notes', 'Notes', 'work', 0),
    folder('personal', 'Personal', null, 1),
    folder('ideas', 'Ideas', null, 2),
  ],
  folderContents: {
    work: [ref('a', 'Alpha', 0), ref('b', 'Beta', 1), ref('c', 'Gamma', 2)],
    notes: [],
    personal: [ref('d', 'Delta', 0)],
    ideas: [],
    [ROOT]: [],
  },
};

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let scope: PluginScope;
let sidebar: SidebarFixture;

beforeAll(async () => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  await initI18n();
  globalThis.chrome.storage = originalStorage;
});

beforeEach(() => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  memory.values.local.set(KEY, structuredClone(DATA));
  scope = new PluginScope();
  sidebar = mountSidebarFixture(makeRows(2));
});

afterEach(async () => {
  await scope.dispose();
  sidebar.destroy();
  document.body.replaceChildren();
  globalThis.chrome.storage = originalStorage;
  vi.restoreAllMocks();
});

async function nextPass(): Promise<void> {
  await settleStorage(5);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settleStorage(20);
}

async function activate(): Promise<{ view: TreeDriver; heading: HTMLElement }> {
  await activateChatGptFolders(scope);
  await nextPass();
  const host = document.querySelector<HTMLElement>('.gv-chatgpt-folder-section');
  if (!host?.shadowRoot) throw new Error('the folder section is not mounted');
  const heading = host.shadowRoot.querySelector<HTMLElement>('.gv-chatgpt-folder-section__header')!;
  return { view: treeDriver({ root: host.shadowRoot, rootBucketId: ROOT }), heading };
}

function stored(): FolderData {
  return memory.values.local.get(KEY) as FolderData;
}

function titles(bucketId: string): string[] {
  return [...stored().folderContents[bucketId]]
    .sort((x, y) => (x.sortIndex ?? 0) - (y.sortIndex ?? 0))
    .map((c) => c.title);
}

function rootFolderNames(): string[] {
  return stored()
    .folders.filter((f) => f.parentId === null)
    .sort((x, y) => (x.sortIndex ?? 0) - (y.sortIndex ?? 0))
    .map((f) => f.name);
}

function parentOf(folderId: string): string | null | undefined {
  return stored().folders.find((f) => f.id === folderId)?.parentId;
}

function dragEvent(type: string, transfer: FakeTransfer, clientY = 20): Event {
  const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return event;
}

/** Starts dragging a folder row, as the browser does. */
function dragFolder(view: TreeDriver, name: string): FakeTransfer {
  const transfer = fakeTransfer();
  view.folderRow(name).dispatchEvent(dragEvent('dragstart', transfer));
  return transfer;
}

/**
 * Drags over `target` at `y` px into its 40px height and returns whether it
 * took the drag; a refused drag gets no drop, as in a browser.
 */
function over(target: HTMLElement, transfer: FakeTransfer, y = 20): boolean {
  Object.defineProperty(target, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 200, width: 200 }),
  });
  const event = dragEvent('dragover', transfer, y);
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function dropAt(target: HTMLElement, transfer: FakeTransfer, y = 20): boolean {
  const accepted = over(target, transfer, y);
  if (accepted) target.dispatchEvent(dragEvent('drop', transfer, y));
  return accepted;
}

describe('ChatGPT folder section: dragging chats', () => {
  it('reorders a chat within its folder, below the chat it is dropped on', async () => {
    const { view } = await activate();
    dropAt(view.conversationRow('work', 'Gamma'), view.dragRow('work', 'Alpha'), 30);
    await nextPass();

    expect(titles('work')).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(view.outline().slice(0, 5)).toEqual([
      'Work',
      '  Notes',
      '  · Beta',
      '  · Gamma',
      '  · Alpha',
    ]);
  });

  it('moves a chat into another folder above the chat it is dropped on', async () => {
    const { view } = await activate();
    dropAt(view.conversationRow('work', 'Beta'), view.dragRow('personal', 'Delta'), 10);
    await nextPass();

    expect(titles('work')).toEqual(['Alpha', 'Delta', 'Beta', 'Gamma']);
    expect(titles('personal')).toEqual([]);
  });

  it('marks the edge a chat would land at with a line, not the whole row', async () => {
    const { view } = await activate();
    const gamma = view.conversationRow('work', 'Gamma');
    over(gamma, view.dragRow('work', 'Alpha'), 30);

    expect(gamma.getAttribute('data-drop-position')).toBe('after');
    expect(gamma.classList.contains(LIT)).toBe(false);
  });

  it('files a chat at the root when dropped on the section heading', async () => {
    const { view, heading } = await activate();
    expect(dropAt(heading, view.dragRow('work', 'Alpha'))).toBe(true);
    await nextPass();

    expect(titles(ROOT)).toEqual(['Alpha']);
    expect(titles('work')).toEqual(['Beta', 'Gamma']);
    expect(heading.classList.contains(LIT)).toBe(false);
  });
});

describe('ChatGPT folder section: dragging folders', () => {
  it('reorders root folders, above the folder it is dropped on the top edge of', async () => {
    const { view } = await activate();
    dropAt(view.folderRow('Work'), dragFolder(view, 'Ideas'), 5);
    await nextPass();

    expect(rootFolderNames()).toEqual(['Ideas', 'Work', 'Personal']);
  });

  it('nests a folder in the one it is dropped on the middle of', async () => {
    const { view } = await activate();
    const personal = view.folderRow('Personal');
    const transfer = dragFolder(view, 'Ideas');
    over(personal, transfer);
    expect(personal.classList.contains(LIT)).toBe(true);
    dropAt(personal, transfer);
    await nextPass();

    expect(parentOf('ideas')).toBe('personal');
    expect(view.outline()).toContain('  Ideas');
  });

  it('moves a subfolder to the root beside the root folder it is dropped below', async () => {
    const { view } = await activate();
    dropAt(view.folderRow('Personal'), dragFolder(view, 'Notes'), 35);
    await nextPass();

    expect(rootFolderNames()).toEqual(['Work', 'Personal', 'Notes', 'Ideas']);
  });

  it('moves a subfolder to the root when dropped on the section heading', async () => {
    const { view, heading } = await activate();
    expect(dropAt(heading, dragFolder(view, 'Notes'))).toBe(true);
    await nextPass();

    expect(parentOf('notes')).toBeNull();
  });

  it('lands a folder dragged over a chat in that chat’s folder, with no line between chats', async () => {
    const { view } = await activate();
    const beta = view.conversationRow('work', 'Beta');
    const transfer = dragFolder(view, 'Ideas');
    over(beta, transfer, 10);
    expect(beta.hasAttribute('data-drop-position')).toBe(false);
    expect(beta.classList.contains(LIT)).toBe(true);
    dropAt(beta, transfer, 10);
    await nextPass();

    expect(parentOf('ideas')).toBe('work');
  });
});

describe('ChatGPT folder section: folder depth', () => {
  it('nests a folder with subfolders past the depth a new folder may have, as Gemini does', async () => {
    const { view } = await activate();
    // Work holds Notes: under Personal, Notes sits two levels down.
    expect(dropAt(view.folderRow('Personal'), dragFolder(view, 'Work'))).toBe(true);
    await nextPass();

    expect(parentOf('work')).toBe('personal');
    expect(parentOf('notes')).toBe('work');
  });

  it('drops a folder beside a subfolder, among that subfolder’s siblings', async () => {
    const { view } = await activate();
    expect(dropAt(view.folderRow('Notes'), dragFolder(view, 'Ideas'), 35)).toBe(true);
    await nextPass();
    expect(parentOf('ideas')).toBe('work');
  });
});
