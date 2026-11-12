/**
 * AI Studio's folder tree, mounted by the real `AIStudioFolderManager`, against
 * the stored `FolderData`: view gestures write nothing, an edit writes only its
 * target, and drops the payload check refuses write nothing. Complements
 * `aistudioTreeCharacterization` (what each edit does) through the shared driver.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';
import { AISTUDIO_TREE_HOST_CLASS } from '@/features/plugins/verbs/folders/aistudio/tree';
import { confirmDriver } from '@/tests/confirmDriver';

import { AIStudioFolderManager } from '../../__tests__/aistudioFolderManager';
import type { FolderData } from '../../types';
import {
  type FakeTransfer,
  fakeTransfer,
  label,
  menuItem,
  openMenu,
  press,
  pressEscape,
  settle,
  treeDriver,
} from './treeDriver';
import { conv, folder } from './treeFixtures';

const { mockBrowser } = vi.hoisted(() => ({
  mockBrowser: {
    runtime: {
      id: 'test-extension-id',
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      sync: { get: vi.fn(), set: vi.fn() },
    },
  },
}));

vi.mock('webextension-polyfill', () => ({ default: mockBrowser }));

const KEY = StorageKeys.FOLDER_DATA_AISTUDIO;
const ROOT = AISTUDIO_ROOT_BUCKET_ID;
let local: Record<string, unknown>;
let sync: Record<string, unknown>;
/** `destroy` is private; tear down the way `aistudioTreeCharacterization` does. */
const managers: Array<{ destroy(): void }> = [];

function pick(values: Record<string, unknown>, keys: unknown): Record<string, unknown> {
  if (typeof keys === 'string') return structuredClone({ [keys]: values[keys] });
  if (Array.isArray(keys)) {
    return structuredClone(Object.fromEntries(keys.map((key) => [key, values[key]])));
  }
  if (keys && typeof keys === 'object') {
    return structuredClone(
      Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [key, values[key] ?? fallback]),
      ),
    );
  }
  return structuredClone(values);
}

const prompt = (id: string, title: string) => ({
  ...conv(id, title),
  url: `https://aistudio.google.com/prompts/${id}`,
});

/** Work › Notes; Loop X ⇄ Loop Y with Loop Z under Y; a prompt at the root. */
const DATA: FolderData = {
  folders: [
    folder('work', 'Work', { createdAt: 1 }),
    folder('notes', 'Notes', { parentId: 'work', createdAt: 2 }),
    folder('x', 'Loop X', { parentId: 'y', createdAt: 3 }),
    folder('y', 'Loop Y', { parentId: 'x', createdAt: 4 }),
    folder('z', 'Loop Z', { parentId: 'y', createdAt: 5 }),
  ],
  folderContents: {
    work: [prompt('p1', 'Plan')],
    notes: [],
    x: [prompt('px', 'In X')],
    y: [prompt('py', 'In Y')],
    z: [prompt('pz', 'In Z')],
    [ROOT]: [prompt('loose', 'Loose')],
  },
};

function stored(): FolderData {
  return local[KEY] as FolderData;
}

function folderWrites(): number {
  return mockBrowser.storage.local.set.mock.calls.filter(([values]) =>
    Object.hasOwn(values as object, KEY),
  ).length;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(data: FolderData = DATA) {
  (
    globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }
  ).jsdom.reconfigure({ url: 'https://aistudio.google.com/prompts/new_chat' });
  local[KEY] = structuredClone(data);
  const manager = new AIStudioFolderManager();
  managers.push(manager as unknown as { destroy(): void });
  await manager.init();
  await flush();
  const host = document.querySelector<HTMLElement>(`.${AISTUDIO_TREE_HOST_CLASS}`);
  if (!host?.shadowRoot) throw new Error('the AI Studio tree is not mounted');
  return treeDriver({ root: host.shadowRoot, rootBucketId: ROOT });
}

/** The folder deletion question in the page; null while none is open. */
function deletionQuestion(): string | null {
  const question = confirmDriver.message();
  return question === label('folder_delete_confirm') ? question : null;
}

/** Answers the open folder deletion confirm. */
function answerDeletion(answer: 'folder_delete' | 'pm_cancel'): void {
  confirmDriver.answer(label(answer));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = `
    <span class="account-switcher-text" data-email="a@example.com">a@example.com</span>
    <div class="nav-content v3-left-nav"><nav><div class="empty-space"></div></nav></div>`;
  local = {};
  sync = {
    [StorageKeys.LANGUAGE]: 'en',
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED]: false,
    geminiFolderEnabled: true,
  };
  mockBrowser.storage.local.get.mockImplementation(async (keys: unknown) => pick(local, keys));
  mockBrowser.storage.local.set.mockImplementation(async (values: Record<string, unknown>) => {
    Object.assign(local, structuredClone(values));
  });
  mockBrowser.storage.sync.get.mockImplementation(async (keys: unknown) => pick(sync, keys));
  mockBrowser.storage.sync.set.mockImplementation(async (values: Record<string, unknown>) => {
    Object.assign(sync, structuredClone(values));
  });
  chrome.storage.local.get = mockBrowser.storage.local.get as typeof chrome.storage.local.get;
  chrome.storage.local.set = mockBrowser.storage.local.set as typeof chrome.storage.local.set;
  chrome.storage.sync.get = mockBrowser.storage.sync.get as typeof chrome.storage.sync.get;
  chrome.storage.sync.set = mockBrowser.storage.sync.set as typeof chrome.storage.sync.set;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const manager of managers.splice(0)) manager.destroy();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('AI Studio folder tree against stored data', () => {
  it('writes nothing for menus, cancelled forms, cancelled deletes and drags over folders', async () => {
    const view = await mount();
    const before = folderWrites();
    const snapshot = structuredClone(stored());

    view.openMenuByButton('Work', true);
    pressEscape();
    view.openMenuByRightClick('Work');
    press(document.body);
    view.startRename('Work');
    await settle();
    view.typeName('Not saved');
    view.pressInInput('Escape');
    view.openMenuByButton('Work');
    menuItem(label('floatingPanelCreateSubfolder')).click();
    view.typeName('Not created');
    press(document.body);
    view.openMenuByButton('Work');
    menuItem(label('floatingPanelDeleteFolder')).click();
    expect(deletionQuestion()).not.toBeNull();
    answerDeletion('pm_cancel');
    view.dragOver(view.folderRow('Notes'), view.dragRow('work', 'Plan'));
    await flush();

    expect(openMenu()).toBeNull();
    expect(deletionQuestion()).toBeNull();
    expect(folderWrites()).toBe(before);
    expect(stored()).toEqual(snapshot);
  });

  it('writes nothing for a rename to the name the folder already has', async () => {
    const view = await mount();
    const before = folderWrites();
    view.startRename('Work');
    view.pressInInput('Enter');
    await flush();
    expect(folderWrites()).toBe(before);
  });

  it('saves a collapse as that folder’s isExpanded alone', async () => {
    const view = await mount();
    const expected = structuredClone(stored());
    expected.folders.find((f) => f.id === 'work')!.isExpanded = false;

    view.toggle('Work');
    await flush();
    expect(stored()).toEqual(expected);
  });

  it('deletes, once the host dialog is answered, exactly the folders shown inside', async () => {
    const view = await mount();
    expect(view.outline()).toEqual([
      'Work',
      '  Notes',
      '  · Plan',
      'Loop X',
      '  Loop Y',
      '    Loop Z',
      '      · In Z',
      '    · In Y',
      '  · In X',
      '· Loose',
    ]);

    view.openMenuByButton('Loop Y');
    menuItem(label('floatingPanelDeleteFolder')).click();
    answerDeletion('folder_delete');
    await flush();

    expect(stored().folders.map((f) => f.id)).toEqual(['work', 'notes', 'x']);
    expect(Object.keys(stored().folderContents).sort()).toEqual(
      ['notes', 'work', 'x', ROOT].sort(),
    );
    expect(view.outline()).toEqual([
      'Work',
      '  Notes',
      '  · Plan',
      'Loop X',
      '  · In X',
      '· Loose',
    ]);
  });

  describe('drops the payload check refuses', () => {
    const json = (url: string): FakeTransfer => {
      const payload = JSON.stringify({
        type: 'conversation',
        conversationId: 'evil',
        title: 'E',
        url,
      });
      return fakeTransfer({ 'application/json': payload, 'text/plain': payload });
    };

    it.each([
      ['a javascript: URL in Voyager JSON', json('javascript:alert(1)')],
      ['a data: URL in Voyager JSON', json('data:text/html,hi')],
      [
        'a javascript: link',
        fakeTransfer({ 'text/uri-list': 'javascript:alert(1)//prompts/evil' }),
      ],
      ['a link that is no prompt', fakeTransfer({ 'text/uri-list': 'https://example.test/page' })],
      ['plain text', fakeTransfer({ 'text/plain': 'just words' })],
    ])('writes nothing for %s', async (_kind, transfer) => {
      const view = await mount();
      const before = folderWrites();
      const snapshot = structuredClone(stored());

      view.drop(view.folderRow('Notes'), transfer);
      view.drop(view.rootDropTarget()!, transfer);
      await flush();

      expect(folderWrites()).toBe(before);
      expect(stored()).toEqual(snapshot);
    });

    it('still files a prompt link, so the refusals above are the check at work', async () => {
      const view = await mount();
      view.drop(
        view.folderRow('Notes'),
        fakeTransfer({ 'text/uri-list': 'https://aistudio.google.com/prompts/fresh' }),
      );
      await flush();
      expect(stored().folderContents.notes.map((c) => c.conversationId)).toEqual(['fresh']);
    });
  });
});
