import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { findSidebarMount } from '@/pages/content/folder/sidebarMountDom';

import { acceptsGeminiSidebarElement } from '../proof';
import { mountRealGeminiSidebar } from './realSidebarFixture';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
});

it.each(['top-bar-actions', 'body'])(
  'a native-looking sidebar clone in %s cannot receive the folder panel',
  async (location) => {
    const { sidebarHost, sidebar, main, recentsSection } = mountRealGeminiSidebar();
    const bundled = findSidebarMount('above-recents');
    expect(bundled?.sidebar).toBe(sidebar);
    expect(bundled?.anchor).toBe(recentsSection);
    sidebar.classList.add('repaired-overflow');
    retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.repaired-overflow'] });
    expect(findSidebarMount('above-recents')?.anchor).toBe(bundled?.anchor);
    sidebar.removeAttribute('data-test-id');
    expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);

    const clone = sidebarHost.cloneNode(true);
    if (!(clone instanceof HTMLElement)) throw new Error('Expected a native sidebar clone');
    const overflow = clone.querySelector<HTMLElement>('.repaired-overflow');
    if (!overflow) throw new Error('Expected the copied overflow');
    overflow.classList.replace('repaired-overflow', 'copied-overflow');
    const parent = location === 'body' ? document.body : main.querySelector('top-bar-actions');
    if (!parent) throw new Error('Expected the captured top bar');
    parent.append(clone);
    retire();
    retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.copied-overflow'] });
    expect(findSidebarMount('above-recents')).toBeNull();
    expect(acceptsGeminiSidebarElement('sidebar.overflow', sidebar, null)).toBe(false);
    expect(acceptsGeminiSidebarElement('sidebar.host', clone, null)).toBe(false);
    expect(acceptsGeminiSidebarElement('sidebar.host', sidebarHost, null)).toBe(false);

    clone.remove();
    retire();
    retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.repaired-overflow'] });
    expect(findSidebarMount('above-recents')?.anchor).toBe(recentsSection);
    expect(acceptsGeminiSidebarElement('sidebar.host', sidebarHost, null)).toBe(true);
  },
);

it('an unrelated navigation cannot borrow the unique native sidebar owner', async () => {
  const { sidebar, main } = mountRealGeminiSidebar();
  expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);
  sidebar.removeAttribute('data-test-id');
  const other = document.createElement('nav');
  other.innerHTML = `<div class="copied-overflow"><div data-test-id="conversation">
    <a href="/app/0000000000000001">Copied chat</a></div></div>`;
  const topBar = main.querySelector('top-bar-actions');
  if (!topBar) throw new Error('Expected the captured top bar');
  topBar.append(other);
  retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.copied-overflow'] });
  expect(findSidebarMount('above-recents')).toBeNull();
  expect(acceptsGeminiSidebarElement('sidebar.host', other, null)).toBe(false);
  other.remove();
  sidebar.classList.add('copied-overflow');
  expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);
});

it.each(['chat-window', 'dialog', 'gv-preview'])(
  'a sidebar copy in %s does not disable the real sidebar repair',
  async (kind) => {
    const { sidebarHost, sidebar, chatWindow } = mountRealGeminiSidebar();
    sidebar.removeAttribute('data-test-id');
    retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.overflow-container'] });
    const copy = sidebarHost.cloneNode(true);
    const preview = document.createElement(kind === 'dialog' ? 'dialog' : 'div');
    if (kind === 'gv-preview') preview.className = kind;
    (kind === 'chat-window' ? chatWindow : document.body).append(preview);
    preview.append(copy);
    expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);
    expect(acceptsGeminiSidebarElement('sidebar.host', sidebarHost, null)).toBe(true);
    preview.remove();
    expect(findSidebarMount('above-recents')?.sidebar).toBe(sidebar);
  },
);
