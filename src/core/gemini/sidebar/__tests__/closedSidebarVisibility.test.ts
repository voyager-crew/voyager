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
