// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { askConfirm } from '@/core/ui/confirm';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { confirmDriver } from '@/tests/confirmDriver';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';
import { initI18n } from '@/utils/i18n';

import { type SidebarFixture, makeRows, mountSidebarFixture } from './chatgptSidebarFixture';
import {
  CHATGPT_FOLDERS_GUIDE_DEBUG_EVENT,
  CHATGPT_FOLDERS_GUIDE_ID,
  activateChatGptFolders,
} from './chatgptSite';

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    runtime: { id: 'test-extension-id' },
    i18n: { getUILanguage: () => 'en' },
  },
}));

const SECTION = '.gv-chatgpt-folder-section';
const ROWS = makeRows(6);
/** Longer than the coachmark's entrance/exit animation. */
const ANIMATION_MS = 260;
const RECENTS = '[data-chatgpt-project-conversation-drop-target]';
const HEADER_CLASS = 'gv-chatgpt-folder-section__header';

/**
 * jsdom has no layout. Every element is laid out inside the window unless a test
 * places it: `place(predicate, rect)` gives matching elements another rect.
 */
const ON_SCREEN = { top: 100, left: 10, width: 220, height: 32 };
type Rect = typeof ON_SCREEN;
let placements: Array<[(element: Element) => boolean, Rect]> = [];
function place(match: (element: Element) => boolean, rect: Rect): void {
  placements.unshift([match, rect]);
}
const isHeader = (element: Element) => element.classList.contains(HEADER_CLASS);
function rectOf(element: Element): DOMRect {
  const { top, left, width, height } =
    placements.find(([match]) => match(element))?.[1] ?? ON_SCREEN;
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

/** IntersectionObserver stand-in: `intersect(el)` reports a visibility change of `el`. */
const observers = new Set<FakeIntersectionObserver>();
class FakeIntersectionObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: () => void) {
    observers.add(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
}
function intersect(target: Element): void {
  for (const observer of observers) if (observer.targets.has(target)) observer.callback();
}

function header(): HTMLElement {
  return document
    .querySelector<HTMLElement>(SECTION)!
    .shadowRoot!.querySelector<HTMLElement>(`.${HEADER_CLASS}`)!;
}

let memory: MemoryStorage;
let originalStorage: typeof chrome.storage;
let scope: PluginScope;
let sidebar: SidebarFixture;

async function nextPass(): Promise<void> {
  await settle(5);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await settle(20);
}

const animation = () => new Promise<void>((resolve) => setTimeout(resolve, ANIMATION_MS));

function bubble(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.gv-coach');
}

function seen(): unknown {
  return memory.values.sync.get(StorageKeys.COACHMARKS_SEEN);
}

beforeAll(async () => {
  memory = createMemoryStorage();
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  await initI18n();
  globalThis.chrome.storage = originalStorage;
});

beforeEach(() => {
  memory = createMemoryStorage();
  memory.values.sync.delete(StorageKeys.COACHMARKS_SEEN);
  originalStorage = globalThis.chrome.storage;
  globalThis.chrome.storage = memory.api;
  scope = new PluginScope();
  sidebar = mountSidebarFixture(ROWS);
  placements = [];
  observers.clear();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(async () => {
  await scope.dispose();
  await animation();
  sidebar.destroy();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('dir');
  globalThis.chrome.storage = originalStorage;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function activate(): Promise<void> {
  await activateChatGptFolders(scope);
  await nextPass();
}

describe('ChatGPT folders sidebar guide', () => {
  it('auto-shows despite CSS-hidden Prompt Manager dialogs and menus', async () => {
    const hidden = document.createElement('div');
    hidden.className = 'gv-hidden';
    hidden.style.display = 'none';
    hidden.innerHTML = '<div id="gv-pm-panel" role="dialog"></div><div role="menu"></div>';
    document.body.append(hidden);
    place((element) => hidden.contains(element), { top: 0, left: 0, width: 0, height: 0 });

    await activate();
    expect(bubble()).not.toBeNull();
    expect(seen()).toBeUndefined();
  });

  it('ignores an invisible dialog but still waits when it becomes visible', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.style.visibility = 'hidden';
    document.body.append(dialog);
    await activate();
    expect(bubble()).not.toBeNull();
    await scope.dispose();
    await animation();

    scope = new PluginScope();
    dialog.style.visibility = 'visible';
    await activate();
    expect(bubble()).toBeNull();
    dialog.remove();
    sidebar.rerenderList();
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('waits while a Voyager confirm is open, and shows once it is answered', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const answered = askConfirm({
      message: 'Remove?',
      anchor,
      tone: 'danger',
      choices: [{ id: 'remove', label: 'Remove' }],
    });
    await activate();
    expect(bubble()).toBeNull();

    confirmDriver.answer('Cancel');
    await answered;
    sidebar.rerenderList();
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('points at the section once it has rendered, and shows only once', async () => {
    await activate();

    const shown = bubble();
    expect(shown?.textContent).toContain('Your folders are in the sidebar');
    expect(shown?.classList.contains('gv-coach--rtl')).toBe(false);
    expect(document.querySelector(SECTION)?.isConnected).toBe(true);

    shown!.querySelector<HTMLButtonElement>('.gv-coach-dismiss')!.click();
    await animation();
    expect(bubble()).toBeNull();
    expect(seen()).toEqual([CHATGPT_FOLDERS_GUIDE_ID]);

    await scope.dispose();
    scope = new PluginScope();
    await activate();
    sidebar.rerenderList();
    await nextPass();
    expect(bubble()).toBeNull();
  });

  it('still shows when the floating panel was left open', async () => {
    memory.values.local.set(StorageKeys.CHATGPT_FOLDER_PANEL, { open: true });
    await activate();
    expect(bubble()).not.toBeNull();
  });

  it('waits for the section instead of showing without it', async () => {
    const recents = sidebar.sidebar.querySelector(RECENTS)!;
    const parent = recents.parentElement!;
    recents.remove();
    await activate();
    expect(document.querySelector(SECTION)).toBeNull();
    expect(bubble()).toBeNull();

    parent.append(recents);
    await nextPass();
    expect(document.querySelector(SECTION)?.isConnected).toBe(true);
    expect(bubble()).not.toBeNull();
  });

  it('never opens over an open menu, and shows after it closes', async () => {
    const menu = sidebar.openMenu(ROWS[1].id);
    await activate();
    sidebar.rerenderList();
    await nextPass();
    expect(bubble()).toBeNull();

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextPass();
    sidebar.rerenderList();
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('waits while the section is naming a new folder', async () => {
    const menu = sidebar.openMenu(ROWS[1].id);
    await activate();
    const root = document.querySelector<HTMLElement>(SECTION)!.shadowRoot!;
    root.querySelector<HTMLButtonElement>('.gv-chatgpt-folder-section__create')!.click();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextPass();
    sidebar.rerenderList();
    await nextPass();
    expect(root.querySelector('.gv-floating-folder-panel__inline-input')).not.toBeNull();
    expect(bubble()).toBeNull();

    root
      .querySelector<HTMLInputElement>('.gv-floating-folder-panel__inline-input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    sidebar.rerenderList();
    await nextPass();
    expect(root.querySelector('.gv-floating-folder-panel__inline-input')).toBeNull();
    expect(bubble()).not.toBeNull();
  });

  it('waits while the header is scrolled out of the sidebar, and shows once it scrolls in', async () => {
    sidebar.sidebar.style.overflowY = 'auto';
    place((element) => element === sidebar.sidebar, { top: 0, left: 0, width: 260, height: 400 });
    place(isHeader, { top: 640, left: 10, width: 220, height: 32 });
    await activate();
    sidebar.rerenderList();
    await nextPass();
    expect(bubble()).toBeNull();

    place(isHeader, { top: 380, left: 10, width: 220, height: 32 });
    sidebar.sidebar.dispatchEvent(new Event('scroll'));
    await nextPass();
    expect(bubble()).toBeNull();

    place(isHeader, ON_SCREEN);
    sidebar.sidebar.dispatchEvent(new Event('scroll'));
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('waits below the window, and while the sidebar is collapsed, until shown', async () => {
    place(isHeader, { top: 900, left: 10, width: 220, height: 32 });
    await activate();
    expect(bubble()).toBeNull();

    // Collapsed: laid out with no size.
    place(isHeader, { top: 100, left: 0, width: 0, height: 0 });
    window.dispatchEvent(new Event('resize'));
    await nextPass();
    expect(bubble()).toBeNull();

    place(isHeader, ON_SCREEN);
    intersect(header());
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('waits while the sidebar only peeks on hover, and shows once it is docked', async () => {
    // ChatGPT's collapsed rail slides the sidebar out as an overlay on hover; the
    // guide's scrim would end the peek and close the guide unseen, over and over.
    const panel = document.createElement('aside');
    panel.setAttribute('data-slate-sidebar-peeking', 'true');
    sidebar.sidebar.replaceWith(panel);
    panel.append(sidebar.sidebar);
    await activate();
    sidebar.rerenderList();
    await nextPass();
    expect(document.querySelector(SECTION)?.isConnected).toBe(true);
    expect(bubble()).toBeNull();
    expect(seen()).toBeUndefined();

    // Docking changes only the marker: nothing inside the sidebar moves.
    panel.removeAttribute('data-slate-sidebar-peeking');
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('waits while the header is hidden, and shows once it is visible', async () => {
    // jsdom caches computed styles inside a shadow root, so the style is stubbed.
    let hidden = true;
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = computed(element, pseudo);
      if (!hidden || !isHeader(element)) return style;
      return new Proxy(style, {
        get: (target, key) => (key === 'visibility' ? 'hidden' : Reflect.get(target, key)),
      });
    });
    await activate();
    expect(bubble()).toBeNull();

    hidden = false;
    sidebar.sidebar.dispatchEvent(new Event('scroll'));
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('closes unseen when the header scrolls away, and comes back with it', async () => {
    sidebar.sidebar.style.overflowY = 'auto';
    place((element) => element === sidebar.sidebar, { top: 0, left: 0, width: 260, height: 400 });
    await activate();
    expect(bubble()).not.toBeNull();

    place(isHeader, { top: -200, left: 10, width: 220, height: 32 });
    sidebar.sidebar.dispatchEvent(new Event('scroll'));
    await nextPass();
    await animation();
    expect(bubble()).toBeNull();
    expect(seen()).toBeUndefined();

    place(isHeader, ON_SCREEN);
    sidebar.sidebar.dispatchEvent(new Event('scroll'));
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('closes unseen when ChatGPT drops the section, and comes back with it', async () => {
    await activate();
    expect(bubble()).not.toBeNull();

    const recents = sidebar.sidebar.querySelector(RECENTS)!;
    const parent = recents.parentElement!;
    recents.remove();
    await nextPass();
    await animation();
    expect(bubble()).toBeNull();
    expect(seen()).toBeUndefined();

    parent.append(recents);
    await nextPass();
    expect(bubble()).not.toBeNull();
  });

  it('closes unseen and leaves nothing behind when turned off', async () => {
    await activate();
    expect(bubble()).not.toBeNull();

    await scope.dispose();
    await animation();
    expect(bubble()).toBeNull();
    expect(document.querySelector('.gv-coach-scrim')).toBeNull();
    expect(seen()).toBeUndefined();
  });

  it('lays itself out right to left on an RTL page', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    await activate();
    expect(bubble()?.classList.contains('gv-coach--rtl')).toBe(true);
  });

  it('shows again from the debug event after it was seen', async () => {
    memory.values.sync.set(StorageKeys.COACHMARKS_SEEN, [CHATGPT_FOLDERS_GUIDE_ID]);
    await activate();
    expect(bubble()).toBeNull();

    document.dispatchEvent(new Event(CHATGPT_FOLDERS_GUIDE_DEBUG_EVENT));
    await nextPass();
    expect(bubble()).not.toBeNull();
  });
});
