// @vitest-environment-options {"url":"https://gemini.google.com/app/0000000000000001"}
import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { findSidebarToggle } from '@/pages/content/sidebarAutoHide/sidebarDom';

import { findGeminiNewChat } from '../actions';
import { mountRealGeminiSidebar } from './realSidebarFixture';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('a shared dialog shell does not suppress the proven native sidebar toggle', async () => {
  const { appRoot, toggle, main } = mountRealGeminiSidebar();
  toggle.id = 'repaired-toggle';
  const shell = document.createElement('dialog');
  shell.open = true;
  appRoot.before(shell);
  shell.append(appRoot);
  retire = await installGeminiSelectorPatch({ 'sidebar.toggleButton': ['#repaired-toggle'] });
  const clicks = vi.fn();
  toggle.addEventListener('click', clicks);
  findSidebarToggle()?.click();
  expect(clicks).toHaveBeenCalledOnce();

  const nested = document.createElement('div');
  nested.setAttribute('role', 'menu');
  main.append(nested);
  nested.append(toggle);
  findSidebarToggle()?.click();
  expect(clicks).toHaveBeenCalledOnce();
  nested.replaceWith(toggle);
  findSidebarToggle()?.click();
  expect(clicks).toHaveBeenCalledTimes(2);
});

it('a repaired new-chat link cannot borrow the same route from the chat content', async () => {
  const { appRoot, sidebar, chatWindow } = mountRealGeminiSidebar();
  const link = document.createElement('a');
  link.id = 'repaired-new-chat';
  link.href = '/app';
  sidebar.prepend(link);
  const form = document.createElement('form');
  appRoot.before(form);
  form.append(appRoot);
  retire = await installGeminiSelectorPatch({ 'sidebar.newChat': ['#repaired-new-chat'] });
  const destinations: string[] = [];
  link.addEventListener('click', (event) => {
    event.preventDefault();
    destinations.push(link.pathname);
  });
  findGeminiNewChat()?.click();
  expect(destinations).toEqual(['/app']);
  chatWindow.append(link);
  findGeminiNewChat()?.click();
  expect(destinations).toEqual(['/app']);
  sidebar.prepend(link);
  findGeminiNewChat()?.click();
  expect(destinations).toEqual(['/app', '/app']);
});
