// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/history" }
import { afterEach, expect, it } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';

import { findThreadExtent, hasPendingHistory, mountedTurnItems } from '../chatgptThread';

let lifetime: SiteSelectorLifetime | undefined;
afterEach(() => {
  lifetime?.stop();
  document.body.replaceChildren();
});
async function online(locators: Record<string, string[]>): Promise<void> {
  lifetime?.stop();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: 'chatgpt', catalogRevision: 2, locators }),
  });
  await lifetime.ready;
}
function page(native = true): HTMLElement {
  document.body.innerHTML = `<main><section class="list" ${native ? 'data-chatgpt-conversation-selection-target' : ''}><div class="loading" ${native ? 'role="status"' : 'aria-busy="true"'}>Loading older messages</div><div id="extent"><article class="partial"><section class="partial-extent"><div data-turn-key="older"><div data-user-message-bubble>Older prompt</div></div></section></article><article data-turn-key="newer"><div data-user-message-bubble>Newer prompt</div></article></div></section></main>`;
  return document.querySelector('[data-turn-key]')!;
}
const profiles = { 'export.threadList': ['.list'], 'export.historyPending': ['.loading'] };

it('the same complete thread keeps its crawl extent, pending state and IDs through both data sources', async () => {
  const first = page();
  const before = [
    findThreadExtent(first),
    hasPendingHistory(document, first),
    mountedTurnItems(document),
  ];
  await online(profiles);
  expect([
    findThreadExtent(first),
    hasPendingHistory(document, first),
    mountedTurnItems(document),
  ]).toEqual(before);
  expect(before[0]).toBe(document.getElementById('extent'));
  expect(before[1]).toBe(true);
});

it('a renamed thread still crawls its complete extent while older messages load', async () => {
  const first = page(false);
  await online(profiles);
  expect(findThreadExtent(first)).toBe(document.getElementById('extent'));
  expect(hasPendingHistory(document, first)).toBe(true);
  document.querySelector('.loading')!.setAttribute('aria-busy', 'false');
  expect(hasPendingHistory(document, first)).toBe(false);
});

it('virtual-list bookkeeping does not hide the pending marker or reject the real thread', async () => {
  const first = page(false);
  const list = document.querySelector('.list')!;
  const bookkeeping = document.createElement('div');
  bookkeeping.setAttribute('data-turn-id-container', 'paginated-root:history');
  list.before(bookkeeping);
  bookkeeping.append(list);
  await online(profiles);
  expect(findThreadExtent(first)).toBe(document.getElementById('extent'));
  expect(hasPendingHistory(document, first)).toBe(true);
});

it('a partial thread wrapper cannot make the crawl skip another mounted turn', async () => {
  const first = page(false);
  await online({ 'export.threadList': ['.partial'] });
  const partialExtent = findThreadExtent(first);
  await online({ 'export.threadList': ['.list'] });
  expect([partialExtent, findThreadExtent(first)]).toEqual([
    null,
    document.getElementById('extent'),
  ]);
});

it('a remote wrapper cannot replace a surviving native list with a different crawl extent', async () => {
  const first = page();
  const list = document.querySelector('.list')!;
  const wrapper = document.createElement('section');
  wrapper.className = 'wrong-list';
  list.before(wrapper);
  wrapper.append(list);
  await online({ 'export.threadList': ['.wrong-list'] });
  expect(findThreadExtent(first)).toBe(document.getElementById('extent'));
});

it('a dialog that contains turn IDs cannot become the main thread list', async () => {
  const first = page(false);
  const list = document.querySelector('.list')!;
  list.setAttribute('role', 'dialog');
  await online(profiles);
  const dialogExtent = findThreadExtent(first);
  list.removeAttribute('role');
  expect([dialogExtent, findThreadExtent(first)]).toEqual([
    null,
    document.getElementById('extent'),
  ]);
});

it('a static header cannot keep the history crawl waiting after its real status disappears', async () => {
  const first = page();
  const status = document.querySelector('.loading')!;
  status.insertAdjacentHTML('afterend', '<div class="wrong">Older messages</div>');
  await online({ 'export.historyPending': ['.wrong'] });
  expect(hasPendingHistory(document, first)).toBe(true);
  status.remove();
  expect(hasPendingHistory(document, first)).toBe(false);
});

it('a status from a reply cannot keep the completed history crawl pending', async () => {
  const first = page();
  document.querySelector('.loading')!.remove();
  first.insertAdjacentHTML('afterbegin', '<span role="status" class="wrong">Reply progress</span>');
  await online({ 'export.historyPending': ['.wrong'] });
  expect(hasPendingHistory(document, first)).toBe(false);
  document
    .querySelector('.list')!
    .insertAdjacentHTML('afterbegin', '<span role="status" class="loading">Loading history</span>');
  await online({ 'export.historyPending': ['.loading'] });
  expect(hasPendingHistory(document, first)).toBe(true);
});

it('a partial loading alias cannot hide a surviving native history status', async () => {
  const first = page();
  document
    .querySelector('.loading')!
    .insertAdjacentHTML(
      'afterend',
      '<span class="busy" aria-busy="true" hidden>Another status</span>',
    );
  await online({ 'export.historyPending': ['.busy'] });
  expect(hasPendingHistory(document, first)).toBe(true);
});
