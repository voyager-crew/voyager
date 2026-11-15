import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHADOW_SURFACE_ATTR, installShadowKeyGuard } from '..';
import {
  destroyMountedTrees,
  mountConsumer,
} from '../../folder/floatingTree/__tests__/treeConsumers';
import {
  deepActiveElement,
  settle,
  treeDriver,
} from '../../folder/floatingTree/__tests__/treeDriver';
import { folder, spyActions } from '../../folder/floatingTree/__tests__/treeFixtures';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const cleanups: (() => void)[] = [];

afterEach(() => {
  destroyMountedTrees();
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
});

function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}, type = 'keydown') {
  const event = new KeyboardEvent(type, {
    key: name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function guardAndPage() {
  const stop = installShadowKeyGuard();
  cleanups.push(stop);
  const pageSaw: string[] = [];
  const page = (event: KeyboardEvent) => pageSaw.push(`${event.type}:${event.key}`);
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    window.addEventListener(type, page, true);
    cleanups.push(() => window.removeEventListener(type, page, true));
  }
  return { stop, pageSaw };
}

function surface(role = 'treeitem', marked = true) {
  const host = document.createElement('div');
  if (marked) host.setAttribute(SHADOW_SURFACE_ATTR, '');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const widget = document.createElement('div');
  widget.setAttribute('role', role);
  widget.tabIndex = 0;
  root.append(widget);
  return { host, root, widget };
}

function folderTree() {
  const actions = spyActions();
  const tree = mountConsumer(
    'panel',
    {
      folders: [folder('a', 'Alpha'), folder('b', 'Beta')],
      folderContents: { a: [], b: [] },
    },
    actions,
  );
  const rows = Array.from(tree.root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  return { tree, rows, actions };
}

describe('shadow widget key guard', () => {
  it('keeps ArrowDown on a tree row away from the page and moves tree focus', () => {
    const { pageSaw } = guardAndPage();
    const { rows } = folderTree();
    rows[0].focus();
    key(rows[0], 'ArrowDown');
    expect(deepActiveElement()).toBe(rows[1]);
    expect(pageSaw).toEqual([]);
  });

  it('submits a folder rename on Enter when Firefox leaves the replay composed', async () => {
    // Firefox's KeyboardEvent constructor ignores composed:false, so a keydown
    // replay re-enters the guard and the name field never sees Enter.
    const RealKeyboardEvent = window.KeyboardEvent;
    let made = 0;
    class FirefoxKeyboardEvent extends RealKeyboardEvent {
      constructor(type: string, init?: KeyboardEventInit) {
        made += 1;
        if (made > 12) throw new Error(`replay loop at ${made}`);
        super(type, { ...init, composed: true });
      }
    }
    vi.stubGlobal('KeyboardEvent', FirefoxKeyboardEvent);
    try {
      const { pageSaw } = guardAndPage();
      const { tree, actions } = folderTree();
      const view = treeDriver(tree);
      view.startRename('Alpha');
      await settle();
      view.pressInInput('Escape');
      await settle();
      expect(view.nameInput()).toBeNull();

      view.startRename('Alpha');
      await settle();
      const input = view.nameInput()!;
      input.value = '工作';
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          isComposing: true,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      expect(actions.onRenameFolder).not.toHaveBeenCalled();
      expect(input.isConnected).toBe(true);

      view.typeName('Renamed');
      view.pressInInput('Enter');
      expect(actions.onRenameFolder).toHaveBeenCalledWith('a', 'Renamed');
      expect(pageSaw).toEqual([]);
      expect(made).toBeGreaterThan(0);
      expect(made).toBeLessThan(12);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps Enter on a tree row away from the page and activates the folder', () => {
    const { pageSaw } = guardAndPage();
    const { rows, actions } = folderTree();
    rows[0].focus();
    expect(key(rows[0], 'Enter').defaultPrevented).toBe(true);
    expect(actions.onToggleFolderExpanded).toHaveBeenCalledWith('a');
    expect(pageSaw).toEqual([]);
  });

  it('keeps letter keys from a menu item inside its shadow root', () => {
    const { pageSaw } = guardAndPage();
    const { widget, root } = surface('menuitem');
    const copies: KeyboardEvent[] = [];
    root.addEventListener('keydown', (event) => copies.push(event as KeyboardEvent));
    expect(key(widget, 'j').defaultPrevented).toBe(false);
    expect(pageSaw).toEqual([]);
    expect(copies).toHaveLength(1);
    expect(copies[0].composed).toBe(false);
  });

  it('protects the tree own row even without an ARIA role', () => {
    const { pageSaw } = guardAndPage();
    const { widget } = surface();
    widget.removeAttribute('role');
    widget.className = 'gv-floating-folder-panel__tree-row';
    key(widget, 'j');
    expect(pageSaw).toEqual([]);
  });

  it('protects a native menu button nested inside a menu', () => {
    const { pageSaw } = guardAndPage();
    const { widget } = surface('menu');
    const button = widget.appendChild(document.createElement('button'));
    const seen = vi.fn();
    button.addEventListener('keydown', seen);
    key(button, 'ArrowDown');
    expect(seen).toHaveBeenCalledOnce();
    expect(pageSaw).toEqual([]);
  });

  it.each(['Tab', 'Escape'])('lets widget %s reach document handlers without replay', (name) => {
    const { pageSaw } = guardAndPage();
    const { widget } = surface('menuitem');
    const seen: Event[] = [];
    widget.addEventListener('keydown', (event) => seen.push(event));
    const original = key(widget, name);
    expect(pageSaw).toEqual([`keydown:${name}`]);
    expect(seen).toEqual([original]);
    expect(original.defaultPrevented).toBe(false);
  });

  it.each(['Tab', 'Escape'])(
    'still keeps text-field %s inside, including fields in widgets',
    (name) => {
      const { pageSaw } = guardAndPage();
      const { widget } = surface('tree');
      const input = widget.appendChild(document.createElement('input'));
      const seen = vi.fn((event: KeyboardEvent) => event.preventDefault());
      input.addEventListener('keydown', seen);
      expect(key(input, name).defaultPrevented).toBe(true);
      expect(seen).toHaveBeenCalledOnce();
      expect(pageSaw).toEqual([]);
    },
  );

  it('leaves an ordinary page control outside shadow surfaces unaffected', () => {
    const { pageSaw } = guardAndPage();
    const button = document.body.appendChild(document.createElement('button'));
    expect(key(button, 'Enter').defaultPrevented).toBe(false);
    expect(pageSaw).toEqual(['keydown:Enter']);
  });

  it('leaves an ordinary button in a marked surface unaffected', () => {
    const { pageSaw } = guardAndPage();
    const { widget } = surface('dialog');
    const button = widget.appendChild(document.createElement('button'));
    key(button, 'j');
    expect(pageSaw).toEqual(['keydown:j']);
  });

  it('leaves a widget in an unmarked root unaffected', () => {
    const { pageSaw } = guardAndPage();
    const { widget } = surface('treeitem', false);
    key(widget, 'j');
    expect(pageSaw).toEqual(['keydown:j']);
  });

  it('stops guarding a widget when its surface marker is removed', () => {
    const { pageSaw } = guardAndPage();
    const { host, widget } = surface();
    host.removeAttribute(SHADOW_SURFACE_ATTR);
    key(widget, 'j');
    expect(pageSaw).toEqual(['keydown:j']);
  });

  it('stops guarding widget keys after teardown', () => {
    const { pageSaw, stop } = guardAndPage();
    const { widget } = surface();
    stop();
    key(widget, 'j');
    expect(pageSaw).toEqual(['keydown:j']);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    'preserves browser Find with a modifier held before tree focus (%o)',
    (init) => {
      guardAndPage();
      const { rows } = folderTree();
      key(document.body, 'ctrlKey' in init ? 'Control' : 'Meta', init);
      rows[0].focus();
      expect(key(rows[0], 'f', init).defaultPrevented).toBe(false);
      expect(deepActiveElement()).toBe(rows[0]);
    },
  );

  it('keeps tree hotkeys working when a key is released in another guarded root', () => {
    guardAndPage();
    const { rows } = folderTree();
    const other = surface('menuitem').widget;
    rows[0].focus();
    key(rows[0], 'j');
    other.focus();
    key(other, 'j', {}, 'keyup');
    rows[0].focus();
    key(rows[0], 'ArrowDown');
    expect(deepActiveElement()).toBe(rows[1]);
  });

  it('replays widget keypress and keyup only inside the shadow root', () => {
    const { pageSaw } = guardAndPage();
    const { widget } = surface();
    const seen: string[] = [];
    for (const type of ['keypress', 'keyup']) {
      widget.addEventListener(type, (event) => seen.push(event.type));
      key(widget, 'j', {}, type);
    }
    expect(seen).toEqual(['keypress', 'keyup']);
    expect(pageSaw).toEqual([]);
  });
});
