import { afterEach, expect, it } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { findSidebarVisibilityHost, isSidebarOpen } from '@/pages/content/folder/sidebarMountDom';

import { acceptsGeminiSidebarElement } from '../proof';
import { mountRealGeminiSidebar } from './realSidebarFixture';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
});

it('closing a renamed Gemini app shell does not lose the sidebar visibility host', async () => {
  const { host, appRoot, main, container, sidebarHost, content, sidebar, chatContent, chatWindow } =
    mountRealGeminiSidebar();
  const bundled = findSidebarVisibilityHost();
  expect(bundled).toBe(host);
  host.classList.add('repaired-shell');
  retire = await installGeminiSelectorPatch({
    'sidebar.visibilityHost': ['.repaired-shell'],
    'sidebar.openHost': ['.repaired-shell'],
  });
  expect(findSidebarVisibilityHost()).toBe(bundled);
  expect(isSidebarOpen()).toBe(true);

  const renamed = document.createElement('section');
  renamed.className = host.className;
  renamed.append(...host.childNodes);
  host.replaceWith(renamed);
  appRoot.removeAttribute('id');
  expect(findSidebarVisibilityHost()).toBe(renamed);
  renamed.classList.remove('side-nav-open');
  expect(findSidebarVisibilityHost()).toBe(renamed);
  expect(isSidebarOpen()).toBe(false);
  expect(acceptsGeminiSidebarElement('sidebar.openHost', renamed, null)).toBe(false);

  const secondMain = document.createElement('main');
  document.body.append(secondMain);
  expect(findSidebarVisibilityHost()).toBeNull();
  secondMain.remove();
  expect(findSidebarVisibilityHost()).toBe(renamed);
  const nestedMain = document.createElement('main');
  chatWindow.append(nestedMain);
  expect(findSidebarVisibilityHost()).toBe(renamed);
  nestedMain.remove();

  for (const wrong of [
    document.body,
    appRoot,
    main,
    container,
    sidebarHost,
    content,
    sidebar,
    chatContent,
    chatWindow,
  ]) {
    expect(acceptsGeminiSidebarElement('sidebar.visibilityHost', wrong, null)).toBe(false);
  }
  // A higher wrapper cannot borrow a nested app's sidebar and main as its own state.
  appRoot.classList.add('repaired-shell');
  renamed.classList.remove('repaired-shell');
  expect(findSidebarVisibilityHost()).toBeNull();
  appRoot.classList.remove('repaired-shell');
  renamed.classList.add('repaired-shell', 'side-nav-open');
  expect(findSidebarVisibilityHost()).toBe(renamed);
  expect(isSidebarOpen()).toBe(true);
});

it.each([
  '<section data-gv-component="preview"><main></main></section>',
  '<section class="gv-preview"><div role="main"></div></section>',
  '<dialog><main></main></dialog>',
  '<section role="dialog"><main></main></section>',
  '<section role="alertdialog"><div role="main"></div></section>',
  '<section role="menu"><main></main></section>',
])('a main in %s does not hide the repaired Gemini sidebar visibility owner', async (markup) => {
  const { host, appRoot } = mountRealGeminiSidebar();
  document.body.insertAdjacentHTML('beforeend', markup);
  const copy = document.body.lastElementChild!;
  const bundled = findSidebarVisibilityHost();
  expect(bundled).toBe(host);
  host.classList.add('repaired-shell');
  retire = await installGeminiSelectorPatch({ 'sidebar.visibilityHost': ['.repaired-shell'] });
  expect(findSidebarVisibilityHost()).toBe(bundled);

  const renamed = document.createElement('section');
  renamed.className = 'repaired-shell';
  renamed.append(...host.childNodes);
  host.replaceWith(renamed);
  appRoot.removeAttribute('id');
  expect(findSidebarVisibilityHost()).toBe(renamed);
  expect(isSidebarOpen()).toBe(false);

  // A remote value on the excluded main cannot borrow the real app's state ownership.
  const foreignMain = copy.querySelector('main, [role="main"]')!;
  renamed.classList.remove('repaired-shell');
  foreignMain.classList.add('repaired-shell');
  expect(findSidebarVisibilityHost()).toBeNull();
  foreignMain.classList.remove('repaired-shell');
  renamed.classList.add('repaired-shell');
  expect(findSidebarVisibilityHost()).toBe(renamed);
});
