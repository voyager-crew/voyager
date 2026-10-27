// @vitest-environment-options { "url": "https://gemini.google.com/app/chips" }
import { afterEach, expect, it } from 'vitest';

import { mountRealGeminiSidebar } from '@/core/gemini/sidebar/__tests__/realSidebarFixture';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { readSentChipTargets } from '../sentChipTargets';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
});

function page() {
  const host = mountRealGeminiSidebar();
  const shell = document.createElement('div');
  shell.setAttribute('role', 'dialog');
  host.main.before(shell);
  shell.append(host.main);
  return { ...host, users: Array.from(host.chatWindow.querySelectorAll('user-query')) };
}

it('repaired sent prompt chips disappear because a shared dialog wraps the Gemini app', async () => {
  const host = page();
  stop = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['user-query'] });
  expect(readSentChipTargets(document).map(({ bubble }) => bubble)).toEqual(host.users);
  expect(readSentChipTargets(document).map(({ lines }) => lines[0]?.textContent)).toEqual(
    Array.from({ length: 10 }, (_, index) => `Question ${index + 1}`),
  );
  const preview = document.createElement('div');
  preview.setAttribute('role', 'dialog');
  host.users[0].before(preview);
  preview.append(host.users[0]);
  expect(readSentChipTargets(document)).toEqual([]);
  preview.before(host.users[0]);
  expect(readSentChipTargets(document).map(({ bubble }) => bubble)).toEqual(host.users);
});

it('bundled and remote sent chip data read the same complete messages in the captured app', async () => {
  const host = page();
  host.users.forEach((user) => user.classList.add('user-query-container'));
  const bundled = readSentChipTargets(document);
  stop = await installGeminiSelectorPatch({ 'sentChips.bubbles': ['user-query'] });
  expect(readSentChipTargets(document)).toEqual(bundled);
  expect(bundled.map(({ bubble }) => bubble)).toEqual(host.users);
});
