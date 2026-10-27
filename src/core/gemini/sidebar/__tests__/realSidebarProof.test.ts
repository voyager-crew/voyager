import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { findSidebarMount } from '@/pages/content/folder/sidebarMountDom';

import { acceptsGeminiSidebarElement } from '../proof';
import { mountRealGeminiSidebar } from './realSidebarFixture';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('a remote Gemini sidebar locator is rejected because the app sits inside main', async () => {
  const { sidebar, recentsSection } = mountRealGeminiSidebar();
  const bundled = findSidebarMount('above-recents');
  expect(bundled?.sidebar).toBe(sidebar);
  sidebar.removeAttribute('data-test-id');
  retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.overflow-container'] });

  const repaired = findSidebarMount('above-recents');
  expect(repaired?.sidebar).toBe(sidebar);
  expect(repaired?.anchor).toBe(recentsSection);
  expect(repaired?.view.remoteKeys.has('sidebar.overflow')).toBe(true);
  expect(repaired?.anchor).toBe(bundled?.anchor);
});

it('a sidebar repair cannot adopt the shared app shell, chat or an incomplete section', () => {
  const fixture = mountRealGeminiSidebar();
  expect(acceptsGeminiSidebarElement('sidebar.overflow', fixture.sidebar, null)).toBe(true);
  for (const candidate of [
    fixture.main,
    fixture.container,
    fixture.chatContent,
    fixture.chatWindow,
    fixture.chatWindow.querySelector<HTMLElement>('user-query'),
    fixture.recentsSection,
  ]) {
    expect(acceptsGeminiSidebarElement('sidebar.overflow', candidate, null)).toBe(false);
  }
  for (const [name, value] of [
    ['role', 'dialog'],
    ['role', 'menu'],
    ['class', 'gv-preview'],
    ['contenteditable', 'true'],
  ]) {
    fixture.content.setAttribute(name, value);
    expect(acceptsGeminiSidebarElement('sidebar.overflow', fixture.sidebar, null)).toBe(false);
    fixture.content.removeAttribute(name);
    expect(acceptsGeminiSidebarElement('sidebar.overflow', fixture.sidebar, null)).toBe(true);
  }
});

it('a shared form or dialog shell keeps folders beside Recents while a nested preview cannot mount', async () => {
  const { appRoot, sidebar, content, recentsSection } = mountRealGeminiSidebar();
  sidebar.removeAttribute('data-test-id');
  retire = await installGeminiSelectorPatch({ 'sidebar.overflow': ['.overflow-container'] });
  for (const tag of ['form', 'dialog', 'nav']) {
    const shell = document.createElement(tag);
    if (shell instanceof HTMLDialogElement) shell.open = true;
    appRoot.before(shell);
    shell.append(appRoot);
    expect(findSidebarMount('above-recents')?.anchor).toBe(recentsSection);
    shell.replaceWith(appRoot);
  }
  const preview = document.createElement('dialog');
  preview.open = true;
  sidebar.before(preview);
  preview.append(sidebar);
  expect(findSidebarMount('above-recents')).toBeNull();
  content.append(sidebar);
  expect(findSidebarMount('above-recents')?.anchor).toBe(recentsSection);
});

it('a whole sidebar container cannot impersonate the original open-state owner', () => {
  const { host, container, main } = mountRealGeminiSidebar();
  host.classList.remove('side-nav-open');
  container.classList.add('side-nav-open');
  expect(acceptsGeminiSidebarElement('sidebar.openHost', container, null)).toBe(false);
  container.classList.remove('side-nav-open');
  main.classList.add('side-nav-open');
  expect(acceptsGeminiSidebarElement('sidebar.openHost', main, null)).toBe(false);
  main.classList.remove('side-nav-open');
  host.classList.add('side-nav-open');
  expect(acceptsGeminiSidebarElement('sidebar.openHost', host, null)).toBe(true);
});
