import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { scrapeGemsFromDocument, selectVisibleGems, upsertMru } from '../catalog';
import { findGemsSidebarLocation } from '../location';
import { createGemsPinControls } from '../pinToggle';
import { readGemsList } from '../selectorQueries';

function mountCatalog(): HTMLElement {
  document.body.innerHTML = `<main><div data-test-id="your-gems-list" class="online-list">
    ${['writer', 'coder']
      .map(
        (id, index) => `<bot-list-row class="online-row" data-gem="${id}">
      <a class="bot-row" href="/u/1/gem/${id}?view=chat">
        <bot-logo><span class="bot-logo-text online-icon">${index ? 'C' : 'W'}</span></bot-logo>
        <div class="bot-title"><span class="title-container online-title">${id}</span></div>
        <div class="bot-desc-container"><span class="bot-desc online-description">${id} description</span></div>
        <span class="wrong-title">different name</span><span class="wrong-description">wrong description</span>
      </a>
    </bot-list-row>`,
      )
      .join('')}
  </div></main>`;
  return document.querySelector('.online-list') as HTMLElement;
}

describe('online Gems catalog reads', () => {
  let stop: (() => void) | undefined;
  let pins: ReturnType<typeof createGemsPinControls> | undefined;

  beforeEach(() => {
    document.body.replaceChildren();
    window.history.pushState({}, '', '/u/1/gems/view');
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      [StorageKeys.GV_GEMS_PINNED]: ['coder'],
    });
  });

  afterEach(() => {
    pins?.stop();
    pins = undefined;
    stop?.();
    stop = undefined;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('reads the same Gem nodes, IDs, descriptions and pinned MRU order through bundled and remote profiles', async () => {
    mountCatalog();
    const bundled = scrapeGemsFromDocument();
    const rows = readGemsList().rows;
    stop = await installGeminiSelectorPatch({
      'gems.list': ['.online-list'],
      'gems.row': ['.online-row'],
      'gems.title': ['.online-title'],
      'gems.description': ['.online-description'],
      'gems.icon': ['.online-icon'],
    });
    expect(scrapeGemsFromDocument()).toEqual(bundled);
    expect(readGemsList().rows.map((read) => read.row)).toEqual(rows.map((read) => read.row));
    const mru = upsertMru([], bundled[0], 100);
    expect(selectVisibleGems(['coder'], mru, scrapeGemsFromDocument(), 2)).toEqual([
      bundled[1],
      { ...bundled[0], lastUsedAt: 100 },
    ]);
    pins = createGemsPinControls(new AbortController().signal);
    await pins.inject();
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.gv-gem-pin-toggle')).map(
        (button) => button.dataset.gemId,
      ),
    ).toEqual(['writer', 'coder']);
    expect(document.querySelector('[data-gem-id="coder"]')?.classList.contains('gv-pinned')).toBe(
      true,
    );
  });

  it('repairs missing list and metadata names using the complete native rows and metadata containers', async () => {
    const list = mountCatalog();
    const expected = scrapeGemsFromDocument();
    list.removeAttribute('data-test-id');
    document
      .querySelectorAll('.title-container')
      .forEach((node) => node.classList.remove('title-container'));
    document.querySelectorAll('.bot-desc').forEach((node) => node.classList.remove('bot-desc'));
    document
      .querySelectorAll('.bot-logo-text')
      .forEach((node) => node.classList.remove('bot-logo-text'));
    stop = await installGeminiSelectorPatch({
      'gems.list': ['.online-list'],
      'gems.title': ['.online-title'],
      'gems.description': ['.online-description'],
      'gems.icon': ['.online-icon'],
    });
    expect(scrapeGemsFromDocument()).toEqual(expected);
  });

  it('repairs renamed row hosts while retaining every native Gem link', async () => {
    mountCatalog();
    const expected = scrapeGemsFromDocument();
    for (const row of document.querySelectorAll('bot-list-row')) {
      const renamed = document.createElement('article');
      renamed.className = 'online-row';
      renamed.append(...row.childNodes);
      row.replaceWith(renamed);
    }
    stop = await installGeminiSelectorPatch({ 'gems.row': ['.online-row'] });
    expect(scrapeGemsFromDocument()).toEqual(expected);
  });

  it('keeps both Gems and their pin buttons when an online row list omits one Gem', async () => {
    mountCatalog();
    const expected = scrapeGemsFromDocument();
    stop = await installGeminiSelectorPatch({ 'gems.row': ['.online-row:first-child'] });
    expect(scrapeGemsFromDocument()).toEqual(expected);
    pins = createGemsPinControls(new AbortController().signal);
    await pins.inject();
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.gv-gem-pin-toggle')).map(
        (button) => button.dataset.gemId,
      ),
    ).toEqual(['writer', 'coder']);
  });

  it('keeps pin controls on the native rows when a remote wrapper holds the same links', async () => {
    mountCatalog();
    const rows = readGemsList().rows.map((read) => read.row);
    for (const row of rows) {
      const wrapper = document.createElement('div');
      wrapper.className = 'wrong-row-wrapper';
      wrapper.append(...row.childNodes);
      row.append(wrapper);
    }
    stop = await installGeminiSelectorPatch({ 'gems.row': ['.wrong-row-wrapper'] });
    expect(readGemsList().rows.map((read) => read.row)).toEqual(rows);
  });

  it('rejects same-named metadata from a different element before adopting another repaired field', async () => {
    mountCatalog();
    document.querySelectorAll('.bot-desc').forEach((node) => node.classList.remove('bot-desc'));
    const expected = scrapeGemsFromDocument();
    for (const anchor of document.querySelectorAll('a')) {
      const decoy = document.createElement('span');
      decoy.className = 'same-name';
      decoy.textContent = anchor.querySelector('.title-container')!.textContent;
      anchor.append(decoy);
    }
    stop = await installGeminiSelectorPatch({
      'gems.title': ['.same-name'],
      'gems.description': ['.online-description'],
    });
    expect(scrapeGemsFromDocument()).toEqual(expected);
  });

  it('rejects a repaired title that reads only part of its native title container', async () => {
    mountCatalog();
    document
      .querySelectorAll('.title-container')
      .forEach((node) => node.classList.remove('title-container'));
    document.querySelectorAll('.bot-title').forEach((node) => node.append(' native suffix'));
    stop = await installGeminiSelectorPatch({ 'gems.title': ['.online-title'] });
    expect(scrapeGemsFromDocument()).toEqual([]);
    stop();
    stop = await installGeminiSelectorPatch({ 'gems.title': ['.bot-title'] });
    expect(scrapeGemsFromDocument().map((gem) => gem.name)).toEqual([
      'writer native suffix',
      'coder native suffix',
    ]);
  });

  it('preserves the bundled pin href parsing while keeping malformed links out of metadata', async () => {
    mountCatalog();
    document.querySelector('a')!.setAttribute('href', '/prefix/gem/writer');
    pins = createGemsPinControls(new AbortController().signal);
    await pins.inject();
    expect(document.querySelectorAll('.gv-gem-pin-toggle')).toHaveLength(2);
    expect(scrapeGemsFromDocument().map((gem) => gem.id)).toEqual(['coder']);
  });

  it('rejects a partial repaired row list until it includes every native Gem link', async () => {
    mountCatalog();
    const expected = scrapeGemsFromDocument();
    for (const row of document.querySelectorAll('bot-list-row')) {
      const renamed = document.createElement('article');
      renamed.className = 'renamed-row';
      renamed.append(...row.childNodes);
      row.replaceWith(renamed);
    }
    stop = await installGeminiSelectorPatch({ 'gems.row': ['.renamed-row:first-child'] });
    expect(scrapeGemsFromDocument()).toEqual([]);
    stop();
    stop = await installGeminiSelectorPatch({ 'gems.row': ['.renamed-row'] });
    expect(scrapeGemsFromDocument()).toEqual(expected);
  });

  it.each([
    ['gems.title', '.wrong-title'],
    ['gems.description', '.wrong-description'],
    ['gems.icon', '.wrong-title'],
    ['gems.description', '.missing-description'],
  ] as const)(
    'keeps native metadata when %s points to different or missing content',
    async (key, selector) => {
      mountCatalog();
      const expected = scrapeGemsFromDocument();
      stop = await installGeminiSelectorPatch({ [key]: [selector] });
      expect(scrapeGemsFromDocument()).toEqual(expected);
    },
  );

  it('uses the whole bundled catalog when a matching remote list is a different list', async () => {
    const list = mountCatalog();
    const expected = scrapeGemsFromDocument();
    const wrong = list.cloneNode(true) as HTMLElement;
    wrong.removeAttribute('data-test-id');
    wrong.className = 'wrong-list';
    wrong.querySelector('.title-container')!.textContent = 'wrong name';
    list.before(wrong);
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.wrong-list'] });
    expect(scrapeGemsFromDocument()).toEqual(expected);
    expect(readGemsList().list).toBe(list);
  });

  it('rejects a repaired list that contains only part of the native catalog', async () => {
    const list = mountCatalog();
    const expected = scrapeGemsFromDocument();
    list.removeAttribute('data-test-id');
    const subset = document.createElement('section');
    subset.className = 'subset';
    subset.append(list.firstElementChild!);
    list.prepend(subset);
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.subset'] });
    expect(scrapeGemsFromDocument()).toEqual([]);
    stop();
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.online-list'] });
    expect(scrapeGemsFromDocument()).toEqual(expected);
  });

  it('does not replace the catalog with the editor preview when the native list locator is missing', async () => {
    const list = mountCatalog();
    const expected = scrapeGemsFromDocument();
    list.removeAttribute('data-test-id');
    const preview = document.createElement('bot-editor');
    const wrong = list.cloneNode(true) as HTMLElement;
    wrong.className = 'editor-preview';
    preview.append(wrong);
    document.body.append(preview);
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.editor-preview'] });
    expect(readGemsList().list).toBeNull();
    stop();
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.online-list'] });
    expect(scrapeGemsFromDocument()).toEqual(expected);
  });

  it('a late pinned read from another account does not populate the new account and a fresh read still works', async () => {
    mountCatalog();
    stop = await installGeminiSelectorPatch({ 'gems.list': ['.online-list'] });
    let resolve!: (value: Record<string, unknown>) => void;
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    pins = createGemsPinControls(new AbortController().signal);
    const pending = pins.inject();
    window.history.pushState({}, '', '/u/2/gems/view');
    resolve({ [StorageKeys.GV_GEMS_PINNED]: ['writer'] });
    await pending;
    expect(document.querySelectorAll('.gv-gem-pin-toggle')).toHaveLength(0);
    await pins.inject();
    expect(document.querySelectorAll('.gv-gem-pin-toggle')).toHaveLength(2);
    expect(document.querySelector('[data-gem-id="coder"]')?.classList.contains('gv-pinned')).toBe(
      true,
    );
  });
});

describe('online Gems nav entry', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function mountNav(): HTMLElement {
    document.body.innerHTML = `<div data-test-id="overflow-container"><mat-nav-list>
      <a data-test-id="gems-side-nav-entry-button" class="online-nav" href="/gems/view">Gems</a>
      <a class="wrong-nav" href="/settings">Settings</a>
    </mat-nav-list></div>`;
    for (const node of document.querySelectorAll('a'))
      vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 40,
      } as DOMRect);
    return document.querySelector('.online-nav') as HTMLElement;
  }

  it('uses the same entry through a remote name and repairs the missing native entry attribute', async () => {
    const entry = mountNav();
    const expected = findGemsSidebarLocation();
    stop = await installGeminiSelectorPatch({ 'gems.navEntry': ['.online-nav'] });
    expect(findGemsSidebarLocation()).toEqual(expected);
    entry.removeAttribute('data-test-id');
    expect(findGemsSidebarLocation()?.entry).toBe(entry);
  });

  it('keeps the native Gems entry when an online nav locator points to Settings', async () => {
    const entry = mountNav();
    stop = await installGeminiSelectorPatch({ 'gems.navEntry': ['.wrong-nav'] });
    expect(findGemsSidebarLocation()?.entry).toBe(entry);
    entry.removeAttribute('data-test-id');
    expect(findGemsSidebarLocation()?.entry).toBeNull();
    stop();
    stop = await installGeminiSelectorPatch({ 'gems.navEntry': ['.online-nav'] });
    expect(findGemsSidebarLocation()?.entry).toBe(entry);
  });

  it('does not attach to one of two visible native Gems links until the nav is unambiguous', async () => {
    const entry = mountNav();
    entry.removeAttribute('data-test-id');
    const second = entry.cloneNode(true) as HTMLElement;
    second.className = 'second-nav';
    entry.after(second);
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 40,
    } as DOMRect);
    stop = await installGeminiSelectorPatch({ 'gems.navEntry': ['.online-nav'] });
    expect(findGemsSidebarLocation()?.entry).toBeNull();
    second.remove();
    expect(findGemsSidebarLocation()?.entry).toBe(entry);
  });

  it('keeps the Gems expansion outside the More popover even when its link is valid', async () => {
    const entry = mountNav();
    entry.removeAttribute('data-test-id');
    const overflow = entry.closest('[data-test-id="overflow-container"]')!;
    const popover = document.createElement('div');
    popover.className = 'more-popover';
    popover.append(entry);
    overflow.append(popover);
    stop = await installGeminiSelectorPatch({ 'gems.navEntry': ['.online-nav'] });
    expect(findGemsSidebarLocation()?.entry).toBeNull();
    overflow.querySelector('mat-nav-list')!.append(entry);
    expect(findGemsSidebarLocation()?.entry).toBe(entry);
  });
});
