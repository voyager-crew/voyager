// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
/**
 * The ChatGPT sidebar section's folder tree against its real store and
 * storage: what each gesture writes to the stored `FolderData`, and that view
 * gestures write nothing. Pinned before the shared tree's internals move to
 * open-source packages; DOM access goes through the shared tree driver.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';
import { ROOT_CONVERSATIONS_ID } from '@/features/folder/constants';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import {
  fakeTransfer,
  label,
  menuItem,
  openMenu,
  press,
  settle,
  treeDriver,
} from '@/pages/content/folder/floatingTree/__tests__/treeDriver';
import { confirmDriver } from '@/tests/confirmDriver';
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

/** Stored with a sortIndex, as a save normalizes it, so a first save rewrites nothing else. */
function ref(id: string, title: string, sortIndex = 0) {
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

/**
 * Work › Notes, Personal, and a stored parent cycle Loop X ⇄ Loop Y with Loop Z
 * under Loop Y. "Shared" is filed in Work and Personal.
 */
const DATA: FolderData = {
  folders: [
    folder('work', 'Work', null, 0),
    folder('notes', 'Notes', 'work', 0),
    folder('personal', 'Personal', null, 1),
    folder('x', 'Loop X', 'y', 2),
    folder('y', 'Loop Y', 'x', 0),
    folder('z', 'Loop Z', 'y', 0),
  ],
  folderContents: {
    work: [ref('shared', 'Shared', 0), ref('plan', 'Plan', 1)],
    notes: [],
    personal: [ref('shared', 'Shared')],
    x: [ref('in-x', 'In X')],
    y: [ref('in-y', 'In Y')],
    z: [ref('in-z', 'In Z')],
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
  sidebar = mountSidebarFixture(makeRows(4));
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

async function activate() {
  await activateChatGptFolders(scope);
  await nextPass();
  const host = document.querySelector<HTMLElement>('.gv-chatgpt-folder-section');
  if (!host?.shadowRoot) throw new Error('the folder section is not mounted');
  return treeDriver({ root: host.shadowRoot, rootBucketId: ROOT });
}

function stored(): FolderData {
  return memory.values.local.get(KEY) as FolderData;
}

function folderWrites(): number {
  return memory.writes.filter((write) => write.area === 'local' && write.key === KEY).length;
}

/** `stored()` with `updatedAt` left out, to compare everything else. */
function withoutTimes(data: FolderData) {
  return { ...data, folders: data.folders.map(({ updatedAt: _t, ...rest }) => rest) };
}

describe('ChatGPT folder section: what it writes', () => {
  it('shows the stored tree, the cycle cut where the first stored folder stands in', async () => {
    const view = await activate();
    expect(view.outline()).toEqual([
      'Work',
      '  Notes',
      '  · Shared',
      '  · Plan',
      'Personal',
      '  · Shared',
      'Loop X',
      '  Loop Y',
      '    Loop Z',
      '      · In Z',
      '    · In Y',
      '  · In X',
    ]);
  });

  it('writes nothing for menus, cancelled forms, cancelled deletes and drags over folders', async () => {
    const view = await activate();
    const before = folderWrites();

    view.openMenuByRightClick('Work');
    press(document.body);
    view.startRename('Work');
    await settle();
    view.typeName('Not saved');
    view.pressInInput('Escape');
    view.addSubfolderButton('Personal')!.click();
    view.typeName('Not created');
    press(document.body);
    view.openMenuByRightClick('Personal');
    menuItem(label('floatingPanelDeleteFolder')).click();
    confirmDriver.answer(label('pm_cancel'));
    view.dragOver(view.folderRow('Personal'), view.dragRow('work', 'Plan'));
    await nextPass();

    expect(folderWrites()).toBe(before);
    expect(stored()).toEqual(DATA);
  });

  it('writes nothing for a rename to the same name, as the panel and AI Studio', async () => {
    const view = await activate();
    const before = folderWrites();

    view.startRename('Work');
    view.pressInInput('Enter');
    await nextPass();

    expect(folderWrites()).toBe(before);
    expect(stored()).toEqual(DATA);
  });

  it('saves a rename as the new name on that folder alone', async () => {
    const view = await activate();
    view.startRename('Work');
    view.typeName('Office');
    view.pressInInput('Enter');
    await nextPass();

    const expected = structuredClone(DATA);
    expected.folders[0].name = 'Office';
    expect(withoutTimes(stored())).toEqual(withoutTimes(expected));
    expect(view.folderNames()).toContain('Office');
  });

  it('saves a collapse as that folder’s isExpanded alone', async () => {
    const view = await activate();
    view.toggle('Work');
    await nextPass();

    const expected = structuredClone(DATA);
    expected.folders[0].isExpanded = false;
    expect(withoutTimes(stored())).toEqual(withoutTimes(expected));
    expect(view.outline().slice(0, 2)).toEqual(['Work', 'Personal']);
  });

  it("deletes after Gemini's confirm exactly the folders shown inside, cycle included", async () => {
    const view = await activate();
    view.openMenuByRightClick('Loop Y');
    menuItem(label('floatingPanelDeleteFolder')).click();
    confirmDriver.answer(label('folder_delete'));
    await nextPass();

    expect(openMenu()).toBeNull();
    expect(stored().folders.map((f) => f.id)).toEqual(['work', 'notes', 'personal', 'x']);
    expect(Object.keys(stored().folderContents).sort()).toEqual(
      ['work', 'notes', 'personal', 'x', ROOT].sort(),
    );
    expect(stored().folders.find((f) => f.id === 'x')!.parentId).toBe('y');
    expect(view.outline()).toEqual([
      'Work',
      '  Notes',
      '  · Shared',
      '  · Plan',
      'Personal',
      '  · Shared',
      'Loop X',
      '  · In X',
    ]);
  });

  it('removes a chat from the one folder whose row was used', async () => {
    const view = await activate();
    view.removeButton('personal', 'Shared').click();
    confirmDriver.answer(label('folder_remove_conversation_action'));
    await nextPass();

    expect(stored().folderContents.personal).toEqual([]);
    expect(stored().folderContents.work.map((c) => c.title)).toEqual(['Shared', 'Plan']);
  });

  it('moves a dragged row into another folder, out of the folder it was shown in', async () => {
    const view = await activate();
    view.drop(view.folderRow('Personal'), view.dragRow('work', 'Plan'));
    await nextPass();

    expect(stored().folderContents.work.map((c) => c.title)).toEqual(['Shared']);
    expect(stored().folderContents.personal.map((c) => c.title)).toEqual(['Shared', 'Plan']);
  });

  it.each([
    ['a javascript: URL', { url: 'javascript:alert(1)' }],
    ['no source folder', { sourceFolderId: undefined }],
  ])('writes nothing for a dropped payload with %s', async (_kind, extra) => {
    const view = await activate();
    const before = folderWrites();
    const payload = {
      type: 'conversation',
      conversationId: 'chatgpt:conv:plan',
      sourceFolderId: 'work',
      ...extra,
    };
    view.drop(
      view.folderRow('Personal'),
      fakeTransfer({ 'application/json': JSON.stringify(payload) }),
    );
    await nextPass();

    expect(folderWrites()).toBe(before);
    expect(stored()).toEqual(DATA);
  });

  // Siblings are the folders stored with no parent; Loop X names one, so it is not counted.
  it('creates a folder with a sortIndex after its siblings, expanded and empty', async () => {
    const view = await activate();
    document
      .querySelector('.gv-chatgpt-folder-section')!
      .shadowRoot!.querySelector<HTMLButtonElement>(
        `button[aria-label="${label('floatingPanelCreateFolder')}"]`,
      )!
      .click();
    view.typeName('Ideas');
    view.pressInInput('Enter');
    await nextPass();

    const created = stored().folders.find((f) => f.name === 'Ideas')!;
    expect(created).toMatchObject({ parentId: null, isExpanded: true, sortIndex: 2 });
    expect(stored().folderContents[created.id]).toEqual([]);
    expect(stored().folders).toHaveLength(DATA.folders.length + 1);
  });
});

describe('ChatGPT folder section: a star belongs to the conversation', () => {
  /** Whether each stored copy of "Shared" is starred: Work's, then Personal's. */
  const sharedStars = () =>
    (['work', 'personal'] as const).map(
      (id) =>
        !!stored().folderContents[id].find((c) => c.conversationId === 'chatgpt:conv:shared')
          ?.starred,
    );

  /** DATA with Personal's copy of "Shared" starred and Work's filed after "Plan". */
  function starredInPersonalOnly(): FolderData {
    const data = structuredClone(DATA);
    data.folderContents.work = [ref('plan', 'Plan', 0), ref('shared', 'Shared', 1)];
    data.folderContents.personal = [{ ...ref('shared', 'Shared'), starred: true }];
    return data;
  }

  it('starring a chat filed in two folders stars it in both', async () => {
    const view = await activate();

    view.toggleStar('work', 'Shared');
    await nextPass();

    expect(sharedStars()).toEqual([true, true]);
    expect(view.isStarred('personal', 'Shared')).toBe(true);
  });

  it('a chat starred in only one folder shows starred and first in every folder', async () => {
    memory.values.local.set(KEY, starredInPersonalOnly());
    const view = await activate();

    expect(view.isStarred('work', 'Shared')).toBe(true);
    expect(view.outline().slice(0, 4)).toEqual(['Work', '  Notes', '  · Shared', '  · Plan']);
  });

  it('unstarring a chat starred in only one folder clears it in every folder', async () => {
    memory.values.local.set(KEY, starredInPersonalOnly());
    const view = await activate();

    view.toggleStar('work', 'Shared');
    await nextPass();

    expect(sharedStars()).toEqual([false, false]);
    expect(view.isStarred('personal', 'Shared')).toBe(false);
  });
});
