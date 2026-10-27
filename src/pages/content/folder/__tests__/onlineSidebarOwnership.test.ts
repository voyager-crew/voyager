import { afterEach, expect, it, vi } from 'vitest';

import { closestGeminiSidebarElement } from '@/core/gemini/sidebar/queries';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { findGemsSidebarLocation } from '../../gemsSidebar/location';
import { createNativePaginationNudge } from '../nativeListPagination';
import { isOutsideFolderSelection } from '../selectionBoundaries';
import { findSidebarMount, findSidebarVisibilityHost, isSidebarOpen } from '../sidebarMountDom';

let retire: (() => void) | undefined;
let nudge: ReturnType<typeof createNativePaginationNudge> | undefined;
afterEach(() => {
  nudge?.cancel();
  retire?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.removeAttribute('class');
});
async function online(patch: Parameters<typeof installGeminiSelectorPatch>[0]) {
  retire?.();
  retire = await installGeminiSelectorPatch(patch);
}
function page() {
  document.body.innerHTML =
    '<chat-app class="app side-nav-open"><bard-sidenav><side-navigation-content><div class="overflow" data-test-id="overflow-container"><mat-nav-list><a data-test-id="gems-side-nav-entry-button" href="/gems/view">Gems</a><button id="action">Action</button></mat-nav-list><expandable-section class="recents" storagekey="chats" data-test-id="chats-expandable-section"><infinite-scroller style="overflow-y:auto" class="scroll"><div class="inner"><div data-test-id="conversation"><a href="/app/abcdef12">Chat</a></div></div></infinite-scroller></expandable-section></div></side-navigation-content></bard-sidenav><main><button id="outside">Outside</button></main></chat-app>';
  const app = document.querySelector<HTMLElement>('.app')!;
  const overflow = document.querySelector<HTMLElement>('.overflow')!;
  const scroll = document.querySelector<HTMLElement>('.scroll')!;
  const row = document.querySelector<HTMLElement>('[data-test-id="conversation"]')!;
  const action = document.getElementById('action')!;
  for (const node of [overflow, scroll, action, document.querySelector('a')!])
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 40 } as DOMRect);
  Object.defineProperties(scroll, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 100 },
    scrollTop: { configurable: true, value: 0 },
  });
  return { app, overflow, scroll, row, action, outside: document.getElementById('outside')! };
}

it('broad sidebar aliases cannot turn outside clicks into selection boundaries or move the Gems and folder mounts', async () => {
  const { overflow, outside } = page();
  const before = findSidebarMount('above-recents');
  const gems = findGemsSidebarLocation();
  await online({ 'sidebar.overflow': ['body'] });
  expect(isOutsideFolderSelection(outside, null, null, false)).toBe(true);
  expect(findSidebarMount('above-recents')?.sidebar).toBe(before?.sidebar);
  expect(findGemsSidebarLocation()).toEqual(gems);
  await online({ 'sidebar.overflow': ['.overflow'] });
  expect(isOutsideFolderSelection(overflow.querySelector('a')!, null, null, false)).toBe(false);
  expect(findSidebarMount('above-recents')?.sidebar).toBe(overflow);
});

it('a renamed sidebar keeps its native complete content and rejects an incomplete or foreign replacement', async () => {
  const { overflow, outside } = page();
  const before = findSidebarMount('above-recents');
  overflow.removeAttribute('data-test-id');
  await online({ 'sidebar.overflow': ['.overflow'] });
  expect(findSidebarMount('above-recents')?.anchor).toBe(before?.anchor);
  expect(findGemsSidebarLocation()?.overflow).toBe(overflow);
  expect(isOutsideFolderSelection(outside, null, null, false)).toBe(true);
  await online({ 'sidebar.overflow': ['.recents'] });
  expect(
    closestGeminiSidebarElement(
      overflow.querySelector('[data-test-id="conversation"]')!,
      'sidebar.overflow',
    ),
  ).toBeNull();
  expect(findSidebarMount('above-recents')).toBeNull();
  await online({ 'sidebar.overflow': ['.overflow'] });
  overflow.closest('bard-sidenav')!.setAttribute('role', 'dialog');
  expect(findSidebarMount('above-recents')).toBeNull();
  expect(findGemsSidebarLocation()).toBeNull();
  overflow.closest('bard-sidenav')!.removeAttribute('role');
  expect(findSidebarMount('above-recents')?.sidebar).toBe(overflow);
});

it('sidebar visibility and open-state aliases cannot override an existing native state owner', async () => {
  const { app } = page();
  const before = { visibility: findSidebarVisibilityHost(), open: isSidebarOpen() };
  await online({ 'sidebar.visibilityHost': ['.app'], 'sidebar.openHost': ['.app.side-nav-open'] });
  expect({ visibility: findSidebarVisibilityHost(), open: isSidebarOpen() }).toEqual(before);
  await online({ 'sidebar.openHost': ['body'] });
  expect(isSidebarOpen()).toBe(true);
  app.classList.remove('side-nav-open');
  await online({ 'sidebar.visibilityHost': ['body'], 'sidebar.openHost': ['body'] });
  expect(findSidebarVisibilityHost()).toBe(app);
  expect(isSidebarOpen()).toBe(false);
});

it('a renamed application shell proves its open state through the native sidebar state marker', async () => {
  const { app } = page();
  const replacement = document.createElement('section');
  replacement.className = app.className;
  replacement.append(...app.childNodes);
  app.replaceWith(replacement);
  await online({ 'sidebar.visibilityHost': ['.app'], 'sidebar.openHost': ['.app'] });
  expect(findSidebarVisibilityHost()).toBe(replacement);
  expect(isSidebarOpen()).toBe(true);
  replacement.classList.remove('side-nav-open');
  expect(findSidebarVisibilityHost()).toBe(replacement);
  expect(isSidebarOpen()).toBe(false);
});

it('an interaction alias cannot pause sidebar hiding for a page button or a non-button container', async () => {
  const { action, outside } = page();
  await online({ 'sidebar.interactionButton': ['button, .overflow'] });
  expect(closestGeminiSidebarElement(outside, 'sidebar.interactionButton')).toBeNull();
  expect(closestGeminiSidebarElement(action, 'sidebar.interactionButton')).toBe(action);
  const host = document.querySelector('bard-sidenav')!;
  const renamed = document.createElement('aside');
  renamed.append(...host.childNodes);
  host.replaceWith(renamed);
  await online({ 'sidebar.interactionButton': ['#action'] });
  expect(closestGeminiSidebarElement(action, 'sidebar.interactionButton')).toBe(action);
  await online({ 'sidebar.interactionButton': ['.overflow'] });
  expect(closestGeminiSidebarElement(action, 'sidebar.interactionButton')).toBeNull();
});

it('pagination keeps dispatching on the original scroller and repairs its renamed host', async () => {
  vi.useFakeTimers();
  const { scroll, row } = page();
  const scrolls = vi.fn();
  scroll.addEventListener('scroll', scrolls);
  nudge = createNativePaginationNudge();
  nudge.rowHidden(row);
  await vi.advanceTimersByTimeAsync(17);
  expect(scrolls).toHaveBeenCalledTimes(1);
  nudge.cancel();
  await online({ 'sidebar.scroller': ['.scroll'] });
  nudge.rowHidden(row);
  await vi.advanceTimersByTimeAsync(17);
  expect(scrolls).toHaveBeenCalledTimes(2);
  nudge.cancel();
  await online({ 'sidebar.scroller': ['.inner'] });
  nudge.rowHidden(row);
  await vi.advanceTimersByTimeAsync(17);
  expect(scrolls).toHaveBeenCalledTimes(3);
  nudge.cancel();
  const renamed = document.createElement('section');
  renamed.className = 'scroll';
  renamed.style.overflowY = 'auto';
  renamed.append(...scroll.childNodes);
  scroll.replaceWith(renamed);
  Object.defineProperties(renamed, { clientHeight: { value: 200 }, scrollHeight: { value: 100 } });
  const repairedScrolls = vi.fn();
  renamed.addEventListener('scroll', repairedScrolls);
  await online({ 'sidebar.scroller': ['.scroll'] });
  nudge.rowHidden(row);
  await vi.advanceTimersByTimeAsync(17);
  expect(repairedScrolls).toHaveBeenCalledTimes(1);
  renamed.closest('side-navigation-content')!.setAttribute('role', 'dialog');
  await vi.advanceTimersByTimeAsync(1000);
  expect(repairedScrolls).toHaveBeenCalledTimes(1);
});

it('a page root or Voyager preview cannot provide the sidebar state or content boundary', async () => {
  const { overflow, app } = page();
  overflow.removeAttribute('data-test-id');
  await online({ 'sidebar.overflow': ['.overflow'] });
  expect(findGemsSidebarLocation()?.overflow).toBe(overflow);
  overflow.classList.add('gv-preview');
  expect(findGemsSidebarLocation()).toBeNull();
  overflow.classList.remove('gv-preview');
  document.body.append(...app.childNodes);
  app.remove();
  document.body.classList.add('side-nav-open');
  await online({ 'sidebar.visibilityHost': ['body'], 'sidebar.openHost': ['body'] });
  expect(findSidebarVisibilityHost()).toBeNull();
  expect(isSidebarOpen()).toBe(false);
});

it('a renamed native sidebar host retains width-based state without borrowing a page panel', async () => {
  const { app } = page();
  app.classList.remove('side-nav-open');
  const host = document.querySelector('bard-sidenav')!;
  Object.defineProperty(host, 'offsetWidth', { value: 280 });
  await online({ 'sidebar.host': ['bard-sidenav'] });
  expect(isSidebarOpen()).toBe(true);
  const renamed = document.createElement('section');
  renamed.className = 'native-sidebar';
  Object.defineProperty(renamed, 'offsetWidth', { value: 280 });
  renamed.append(...host.childNodes);
  host.replaceWith(renamed);
  await online({ 'sidebar.host': ['.native-sidebar'] });
  expect(isSidebarOpen()).toBe(true);
  const content = renamed.querySelector('side-navigation-content')!;
  content.replaceWith(...content.childNodes);
  expect(isSidebarOpen()).toBe(false);
});

it('a repaired paginator cannot skip the innermost native scroll owner', async () => {
  vi.useFakeTimers();
  const { scroll, row } = page();
  const renamed = document.createElement('section');
  renamed.className = 'scroll';
  renamed.style.overflowY = 'auto';
  renamed.append(...scroll.childNodes);
  scroll.replaceWith(renamed);
  const inner = renamed.querySelector<HTMLElement>('.inner')!;
  inner.style.overflowY = 'auto';
  for (const node of [renamed, inner])
    Object.defineProperties(node, { clientHeight: { value: 200 }, scrollHeight: { value: 100 } });
  const outerScrolls = vi.fn(),
    innerScrolls = vi.fn();
  renamed.addEventListener('scroll', outerScrolls);
  inner.addEventListener('scroll', innerScrolls);
  await online({ 'sidebar.scroller': ['.scroll'] });
  nudge = createNativePaginationNudge();
  nudge.rowHidden(row);
  await vi.advanceTimersByTimeAsync(17);
  expect(outerScrolls).not.toHaveBeenCalled();
  await online({ 'sidebar.scroller': ['.inner'] });
  nudge.rowHidden(row);
  await vi.advanceTimersByTimeAsync(17);
  expect(innerScrolls).toHaveBeenCalledTimes(1);
});
