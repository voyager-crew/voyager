/**
 * The folder menu in a body-level popover layer, for a tree whose container
 * transforms or clips it (AI Studio's nav). The layer must behave like the
 * in-tree menu: same actions, outside click and Escape close it, and it goes
 * away with the tree.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { POPOVER_LAYER_HOST_CLASS } from '../floatingTree/popoverLayer';
import { type TreeActions, cls } from '../floatingTree/shared';
import { type FolderTreeController, mountFolderTree } from '../floatingTree/treeController';
import type { FolderData } from '../types';

vi.mock('@/utils/i18n', () => ({ getTranslationSyncUnsafe: (key: string) => key }));

const SURFACE_MARKER = 'data-gv-shadow-surface';
const mounted: Array<{ tree: FolderTreeController; host: HTMLElement }> = [];

afterEach(() => {
  for (const { tree, host } of mounted.splice(0)) {
    tree.destroy();
    host.remove();
  }
  document.documentElement.removeAttribute('data-gv-scheme');
  document.body.classList.remove('gv-rtl');
  vi.restoreAllMocks();
});

// Preact schedules a 100ms requestAnimationFrame fallback after each render; under a loaded full run it
// fired after jsdom teardown and threw "cancelAnimationFrame is not defined", failing verify:pr.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 150)));

const data: FolderData = {
  folders: [
    { id: 'a', name: 'Alpha', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
    { id: 'b', name: 'Beta', parentId: null, isExpanded: true, createdAt: 2, updatedAt: 2 },
  ],
  folderContents: { a: [], b: [] },
};

function mount(options: { layer?: boolean; actions?: TreeActions } = {}) {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const body = document.createElement('div');
  root.appendChild(body);
  document.body.appendChild(host);
  const tree = mountFolderTree({
    body,
    boundary: host,
    focusRoot: root,
    data,
    rootBucketId: 'root',
    conversationSortMode: 'manual',
    actions: options.actions ?? {},
    site: { folderMenuButton: { labelKey: 'folder_settings' } },
    ...(options.layer === false ? {} : { popoverLayer: { css: '' } }),
  });
  mounted.push({ tree, host });
  return { root, tree };
}

const layers = () => document.querySelectorAll<HTMLElement>(`.${POPOVER_LAYER_HOST_CLASS}`);
const layerRoot = () => layers()[0].shadowRoot!;
const menuIn = (root: ShadowRoot) => root.querySelector<HTMLElement>(`.${cls('context-menu')}`);

function menuButton(root: ShadowRoot, folderId: string): HTMLButtonElement {
  return root
    .querySelector(`.${cls('folder-header')}[data-folder-id="${folderId}"]`)!
    .querySelector<HTMLButtonElement>(`.${cls('icon-button--menu')}`)!;
}

/** A pointer click on the ⋮ button; `detail: 0` is Enter or Space on it. */
function openMenu(root: ShadowRoot, folderId: string, detail = 1): void {
  menuButton(root, folderId).dispatchEvent(
    new MouseEvent('click', { bubbles: true, composed: true, detail }),
  );
}

function menuItem(labelKey: string): HTMLButtonElement {
  return Array.from(layerRoot().querySelectorAll<HTMLButtonElement>(`.${cls('menu-item')}`)).find(
    (item) => item.textContent === labelKey,
  )!;
}

const escape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

describe('folder menu in a popover layer', () => {
  it('renders the menu in a surface on document.body instead of in the tree', () => {
    const { root } = mount();
    openMenu(root, 'a');

    expect(layers()).toHaveLength(1);
    expect(layers()[0].parentElement).toBe(document.body);
    expect(menuIn(layerRoot())).not.toBeNull();
    expect(menuIn(root)).toBeNull();
  });

  it('marks the layer for the key guard and mirrors the page scheme and direction', () => {
    document.documentElement.setAttribute('data-gv-scheme', 'dark');
    document.body.classList.add('gv-rtl');
    mount();
    const host = layers()[0];

    expect(host.hasAttribute(SURFACE_MARKER)).toBe(true);
    expect(host.getAttribute('data-gv-scheme')).toBe('dark');
    expect(host.hasAttribute('data-gv-rtl')).toBe(true);
  });

  it('runs the chosen action from the layer', () => {
    const onToggleFolderPinned = vi.fn();
    const { root } = mount({ actions: { onToggleFolderPinned } });
    openMenu(root, 'b');
    menuItem('floatingPanelPinFolder').click();

    expect(onToggleFolderPinned).toHaveBeenCalledWith('b');
    expect(menuIn(layerRoot())).toBeNull();
  });

  it('stays open for a click on the menu outside its items, and closes for one outside', () => {
    const { root } = mount({ actions: { confirmFolderRemoval: vi.fn() } });
    openMenu(root, 'a');

    layerRoot()
      .querySelector<HTMLElement>(`.${cls('menu-divider')}`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(menuIn(layerRoot())).not.toBeNull();

    document.body.click();
    expect(menuIn(layerRoot())).toBeNull();
  });

  it('closes on Escape', () => {
    const { root } = mount();
    openMenu(root, 'a');
    escape();

    expect(menuIn(layerRoot())).toBeNull();
  });

  it('takes focus when opened from the keyboard, and gives it back on Escape', () => {
    const { root } = mount();
    openMenu(root, 'a', 0);

    expect(layerRoot().activeElement).toBe(layerRoot().querySelector(`.${cls('menu-item')}`));
    escape();
    expect(root.activeElement).toBe(menuButton(root, 'a'));
  });

  it('leaves focus alone when opened with the pointer', () => {
    const { root } = mount();
    openMenu(root, 'a');

    expect(layerRoot().activeElement).toBeNull();
  });

  it('empties the layer when another account resets the tree', () => {
    const { root, tree } = mount();
    openMenu(root, 'a');
    tree.reset({ folders: [], folderContents: {} });

    expect(menuIn(layerRoot())).toBeNull();
  });

  it('removes its layer with the tree, every time', () => {
    for (let index = 0; index < 3; index++) {
      const { root } = mount();
      openMenu(root, 'a');
      const { tree, host } = mounted.pop()!;
      tree.destroy();
      host.remove();
    }

    expect(layers()).toHaveLength(0);
  });
});

describe('folder menu near the edge of the viewport', () => {
  const MENU = { width: 188, height: 161 };
  const BUTTON = 24;

  /**
   * Layout for jsdom: the ⋮ button sits at `button`, the menu where its style
   * puts it, and the viewport fills the window. Floating UI sizes the menu from
   * its offset box and the viewport from the root element's client box.
   */
  function layOut(button: { left: number; bottom: number }) {
    const isMenu = (el: Element) => el.classList.contains(cls('context-menu'));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (isMenu(this)) {
          const left = parseFloat(this.style.left);
          const top = parseFloat(this.style.top);
          return DOMRect.fromRect({ x: left, y: top, ...MENU });
        }
        if (this.classList.contains(cls('icon-button--menu'))) {
          return DOMRect.fromRect({
            x: button.left,
            y: button.bottom - BUTTON,
            width: BUTTON,
            height: BUTTON,
          });
        }
        return DOMRect.fromRect();
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      function (this: HTMLElement) {
        return isMenu(this) ? MENU.width : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
      function (this: HTMLElement) {
        return isMenu(this) ? MENU.height : 0;
      },
    );
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this === document.documentElement ? window.innerWidth : 0;
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this === document.documentElement ? window.innerHeight : 0;
    });
  }
  const menuBox = () => {
    const menu = menuIn(layerRoot())!;
    return { left: parseFloat(menu.style.left), top: parseFloat(menu.style.top) };
  };
  /** Floating UI positions asynchronously. */
  const positioned = () => new Promise<void>((done) => setTimeout(done, 0));

  it('moves a menu that would run past the bottom-right corner inside it', async () => {
    const button = { left: window.innerWidth - 40, bottom: window.innerHeight - 20 };
    layOut(button);
    const { root } = mount();
    openMenu(root, 'a');
    await positioned();

    // Inside the viewport, and clear of the button that opened it.
    const { left, top } = menuBox();
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left + MENU.width).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(top + MENU.height).toBeLessThanOrEqual(window.innerHeight - 8);
    const buttonTop = button.bottom - BUTTON;
    const overlaps =
      left < button.left + BUTTON &&
      left + MENU.width > button.left &&
      top < button.bottom &&
      top + MENU.height > buttonTop;
    expect(overlaps).toBe(false);
  });

  it('leaves a menu that fits where it opened', async () => {
    layOut({ left: 100, bottom: 120 });
    const { root } = mount();
    openMenu(root, 'a');
    await positioned();

    expect(menuBox()).toEqual({ left: 100, top: 120 });
  });
});

describe('folder menu without a popover layer', () => {
  it('stays in the tree and adds nothing to the page', () => {
    const { root } = mount({ layer: false });
    openMenu(root, 'a');

    expect(menuIn(root)).not.toBeNull();
    expect(layers()).toHaveLength(0);
  });

  it('also closes on Escape', () => {
    const { root } = mount({ layer: false });
    openMenu(root, 'a');
    escape();

    expect(menuIn(root)).toBeNull();
  });
});
