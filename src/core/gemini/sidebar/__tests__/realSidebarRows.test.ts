// @vitest-environment-options {"url":"https://gemini.google.com/app/0000000000000001"}
import { afterEach, expect, it, vi } from 'vitest';

import { readGeminiActiveSidebarTitle } from '@/core/gemini/sidebarTitles';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { resolveSidebarConversationTarget } from '@/pages/content/export/sidebarConversationTarget';

import { mountRealGeminiSidebar } from './realSidebarFixture';

let retire = () => {};
afterEach(() => {
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('renamed sidebar rows inside the shared main still export the requested conversation', async () => {
  const { sidebar, rows, ids } = mountRealGeminiSidebar();
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-label', 'More options for Chat 2');
  sidebar.append(trigger);
  const bundled = resolveSidebarConversationTarget(trigger);
  expect(bundled).toEqual({
    conversationId: ids[1],
    url: `${location.origin}/app/${ids[1]}`,
    title: 'Chat 2',
  });
  for (const row of rows) row.className = 'repaired-row';
  retire = await installGeminiSelectorPatch({ 'sidebar.row': ['.repaired-row'] });
  expect(resolveSidebarConversationTarget(trigger)).toEqual(bundled);
  for (const row of rows) row.removeAttribute('data-test-id');
  expect(resolveSidebarConversationTarget(trigger)).toEqual(bundled);

  const second = rows[1];
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  second.before(dialog);
  dialog.append(second);
  expect(resolveSidebarConversationTarget(trigger)).toBeNull();
  dialog.replaceWith(second);
  expect(resolveSidebarConversationTarget(trigger)).toEqual(bundled);
});

it('a shared main does not hide the native current-chat title used by a repaired heading', async () => {
  const { main, chatWindow, rows } = mountRealGeminiSidebar();
  const heading = document.createElement('span');
  heading.className = 'gds-label-l repaired-heading';
  heading.textContent = 'Chat 1';
  main.querySelector('top-bar-actions')!.append(heading);
  const read = () => readGeminiActiveSidebarTitle('active', () => true);
  const native = rows[0].querySelector<HTMLElement>('.title-text')!;
  native.classList.add('conversation-title');
  rows[0].classList.add('conversation-list-item', 'active');
  expect(read()).toBe('Chat 1');
  retire = await installGeminiSelectorPatch({ 'title.active': ['.repaired-heading'] });
  expect(read()).toBe('Chat 1');
  rows[0].classList.remove('active');
  // A chat-body copy of the current link cannot supply conflicting sidebar identity evidence.
  const copy = rows[0].querySelector('a')!.cloneNode(true);
  if (!(copy instanceof HTMLAnchorElement)) throw new Error('Expected a native link clone');
  copy.setAttribute('aria-label', 'Unrelated preview');
  chatWindow.append(copy);
  expect(read()).toBe('Chat 1');
});
