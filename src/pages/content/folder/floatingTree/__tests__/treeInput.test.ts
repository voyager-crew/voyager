/**
 * Pointer, keyboard and drag input on the tree's rows, and what the tree leaves
 * behind when it is torn down.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AISTUDIO_PROMPT_DRAG_TYPES } from '@/features/plugins/verbs/folders/aistudio/tree';

import type { FolderData } from '../../types';
import { FOLDER_TOGGLE_DELAY_MS, type TreeActions, cls } from '../shared';
import { mountFolderTree } from '../treeController';
import { CONSUMERS, type ConsumerId, destroyMountedTrees, mountConsumer } from './treeConsumers';
import {
  deepActiveElement,
  fakeTransfer,
  keydown,
  openMenu,
  pressEscape,
  settle,
  treeDriver,
} from './treeDriver';
import { calledSpies, conv, deepFreeze, folder, spyActions } from './treeFixtures';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

afterEach(() => {
  vi.useRealTimers();
  destroyMountedTrees();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const rootOf = (consumer: ConsumerId) =>
  consumer === 'aistudio' ? '__uncategorized__' : '__root_conversations__';

/** A folder holding a subfolder, each with a chat, and a closed folder after them. */
function nested(rootBucketId: string): FolderData {
  return {
    folders: [
      folder('p', 'Parent', { createdAt: 1, sortIndex: 0 }),
      folder('k', 'Kid', { parentId: 'p', createdAt: 2 }),
      folder('q', 'Closed', { createdAt: 3, sortIndex: 1, isExpanded: false }),
    ],
    folderContents: {
      p: [conv('pc', 'In parent')],
      k: [conv('kc', 'In kid')],
      q: [],
      [rootBucketId]: [],
    },
  };
}

function mount(consumer: ConsumerId, data?: FolderData, extra: Partial<TreeActions> = {}) {
  const actions = spyActions();
  const tree = mountConsumer(consumer, data ?? nested(rootOf(consumer)), {
    ...actions,
    ...extra,
  });
  return { tree, view: treeDriver(tree), actions };
}

const click = (target: Element, init: MouseEventInit = {}) =>
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...init }),
  );

const treeitem = (element: Element): HTMLElement => {
  const item = element.closest<HTMLElement>('[role="treeitem"]');
  if (!item) throw new Error('not inside a tree item');
  return item;
};

describe.each(CONSUMERS)('$name: a click with a modifier key', ({ consumer }) => {
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])(
    'neither toggles a folder nor opens a chat (%o)',
    (modifier) => {
      // A site that renames on double-click (ChatGPT) toggles after a pause.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { view, actions } = mount(consumer);

      click(view.folderRow('Parent'), modifier);
      click(view.titleButton('p', 'In parent'), modifier);
      vi.advanceTimersByTime(FOLDER_TOGGLE_DELAY_MS);
      expect(actions.onToggleFolderExpanded).not.toHaveBeenCalled();
      expect(actions.onNavigate).not.toHaveBeenCalled();
      expect(view.isExpanded('Parent')).toBe(true);

      // The same clicks without the modifier do both.
      click(view.titleButton('p', 'In parent'));
      click(view.folderRow('Parent'));
      vi.advanceTimersByTime(FOLDER_TOGGLE_DELAY_MS);
      expect(actions.onNavigate).toHaveBeenCalledTimes(1);
      expect(actions.onToggleFolderExpanded.mock.calls).toEqual([['p']]);
    },
  );
});

describe('a drag from outside onto a chat row', () => {
  it('files into the folder that shows the row, the innermost one, not its parent', () => {
    const onDrop = vi.fn<(e: DragEvent, folderId: string) => boolean>(() => true);
    const { view } = mount('aistudio', undefined, {
      onDrop,
      acceptsDrag: (types) => AISTUDIO_PROMPT_DRAG_TYPES.some((type) => types.includes(type)),
    });
    // A prompt link from the page: no Voyager JSON at all.
    const link = () => fakeTransfer({ 'text/uri-list': 'https://aistudio.google.com/prompts/x' });

    expect(view.drop(view.conversationRow('k', 'In kid'), link())).toBe(true);
    expect(view.drop(view.conversationRow('p', 'In parent'), link())).toBe(true);
    expect(onDrop.mock.calls.map(([, folderId]) => folderId)).toEqual(['k', 'p']);
  });
});

describe('keyboard', () => {
  it('lets Ctrl/Cmd + a letter through to the page, so Find still opens', () => {
    const { view } = mount('panel');
    const row = treeitem(view.folderRow('Parent'));
    row.focus();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);

    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = new KeyboardEvent('keydown', {
        key: 'f',
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      row.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(seen).toHaveBeenCalledTimes(2);
    expect(deepActiveElement()).toBe(row);
  });

  it('ignores tree keys pressed with a modifier that went down before the tree had focus', () => {
    const { view, actions } = mount('panel');
    const closed = treeitem(view.folderRow('Closed'));
    const chat = treeitem(view.conversationRow('p', 'In parent'));
    // Only the modified key reaches the tree: Ctrl/Cmd/Alt/Shift went down elsewhere.
    const press = (row: HTMLElement, key: string, init: KeyboardEventInit) => {
      row.focus();
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      row.dispatchEvent(event);
      row.dispatchEvent(
        new KeyboardEvent('keyup', { key, bubbles: true, composed: true, ...init }),
      );
      return event;
    };

    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      for (const [row, key] of [
        [closed, 'ArrowRight'],
        [closed, 'Home'],
        [closed, 'End'],
        [chat, 'Enter'],
      ] as const) {
        expect(press(row, key, init).defaultPrevented).toBe(false);
        expect(deepActiveElement()).toBe(row);
      }
    }
    expect(actions.onToggleFolderExpanded).not.toHaveBeenCalled();
    expect(actions.onNavigate).not.toHaveBeenCalled();

    // The same keys unmodified still act.
    expect(press(closed, 'ArrowRight', {}).defaultPrevented).toBe(true);
    expect(actions.onToggleFolderExpanded.mock.calls).toEqual([['q']]);
    press(chat, 'Enter', {});
    expect(actions.onNavigate).toHaveBeenCalledTimes(1);
  });

  it('leaves arrow keys alone on the create form of an empty tree', async () => {
    const { tree, view } = mount('panel', {
      folders: [],
      folderContents: { [rootOf('panel')]: [] },
    });
    const errors = vi.fn();
    window.addEventListener('error', errors);
    tree.startCreateRootFolder();
    await settle();
    view.typeName('First');

    for (const name of ['floatingPanelSave', 'floatingPanelCancel'] as const) {
      const button = view.formButton(name);
      button.focus();
      for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
        expect(keydown(button, key).defaultPrevented).toBe(false);
        expect(deepActiveElement()).toBe(button);
      }
    }
    window.removeEventListener('error', errors);
    expect(errors).not.toHaveBeenCalled();
    expect(view.nameInput()?.value).toBe('First');
  });

  it('keeps arrow keys working after F2 renames, though the field kept its keyup inside', async () => {
    const { view } = mount('panel');
    const parent = treeitem(view.folderRow('Parent'));
    parent.focus();

    keydown(parent, 'F2');
    await settle();
    const input = view.nameInput()!;
    expect(deepActiveElement()).toBe(input);
    // The release lands in the field; the panel's shadow surface keeps it from the page.
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'F2', bubbles: true, composed: true }));
    keydown(input, 'Escape');
    await settle();
    expect(view.nameInput()).toBeNull();

    parent.focus();
    keydown(parent, 'ArrowDown');
    expect(deepActiveElement()).toBe(treeitem(view.folderRow('Kid')));
  });

  it('forgets a held key when the window loses focus', () => {
    const { view } = mount('panel');
    const parent = treeitem(view.folderRow('Parent'));
    parent.focus();

    // Alt-Tab away: the keyup goes to another window.
    keydown(parent, 'Alt');
    window.dispatchEvent(new FocusEvent('blur'));

    keydown(parent, 'ArrowDown');
    expect(deepActiveElement()).toBe(treeitem(view.folderRow('Kid')));
  });
});

describe.each(CONSUMERS)('$name: frozen data', ({ consumer }) => {
  it('survives browsing, editing and dragging without a write', async () => {
    const data = deepFreeze(nested(rootOf(consumer)));
    const before = JSON.stringify(data);
    const { view, actions } = mount(consumer, data);

    const parent = treeitem(view.folderRow('Parent'));
    parent.focus();
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'ArrowLeft']) {
      keydown(deepActiveElement() ?? parent, key);
    }
    view.toggle('Closed');
    view.startRename('Kid');
    await settle();
    view.typeName('Renamed');
    view.pressInInput('Escape');
    view.openMenuByRightClick('Parent');
    expect(openMenu()).not.toBeNull();
    pressEscape();
    view.dragOver(view.conversationRow('k', 'In kid'), fakeTransfer({ 'text/uri-list': 'x' }));
    view.dragOver(view.folderRow('Closed'), view.dragRow('p', 'In parent'));
    await settle();

    expect(JSON.stringify(data)).toBe(before);
    expect(calledSpies(actions).every((name) => name === 'onToggleFolderExpanded')).toBe(true);
  });
});

describe('teardown', () => {
  /** Listeners added and not yet removed, by target and type. */
  function trackListeners() {
    const live = new Map<string, number>();
    const count = (target: string, type: string, delta: number) => {
      const key = `${target}:${type}`;
      live.set(key, (live.get(key) ?? 0) + delta);
    };
    const targets: Array<[string, EventTarget]> = [
      ['window', window],
      ['document', document],
    ];
    for (const [name, target] of targets) {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation(
        (type: string, listener: EventListenerOrEventListenerObject | null, options?) => {
          count(name, type, 1);
          add(type, listener, options);
        },
      );
      vi.spyOn(target, 'removeEventListener').mockImplementation(
        (type: string, listener: EventListenerOrEventListenerObject | null, options?) => {
          count(name, type, -1);
          remove(type, listener, options);
        },
      );
    }
    return () => [...live].filter(([, n]) => n !== 0).map(([key, n]) => `${key}=${n}`);
  }

  it('releases every listener, including the open menu’s position tracking', () => {
    // Give the menu a size, so floating-ui tracks it as it would on a page.
    const isMenu = (el: HTMLElement) => el.classList.contains(cls('context-menu'));
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return isMenu(this) ? 180 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return isMenu(this) ? 160 : 0;
      },
    );
    const leaks = trackListeners();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const body = document.createElement('div');
    root.appendChild(body);
    document.body.appendChild(host);
    const tree = mountFolderTree({
      body,
      boundary: host,
      focusRoot: root,
      data: nested('__root__'),
      rootBucketId: '__root__',
      conversationSortMode: 'manual',
      actions: spyActions(),
      popoverLayer: { css: '' },
    });
    const view = treeDriver({ root, rootBucketId: '__root__' });
    treeitem(view.folderRow('Parent')).focus();

    view.openMenuByRightClick('Parent');
    expect(leaks()).toContain('window:resize=1');
    pressEscape();
    expect(leaks().filter((entry) => entry.startsWith('window:resize'))).toEqual([]);

    view.openMenuByRightClick('Kid');
    tree.destroy();
    expect(leaks()).toEqual([]);
  });
});
