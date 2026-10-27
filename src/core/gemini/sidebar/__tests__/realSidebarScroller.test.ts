import { afterEach, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';
import { createNativePaginationNudge } from '@/pages/content/folder/nativeListPagination';

import { mountRealGeminiSidebar } from './realSidebarFixture';

let retire = () => {};
let nudge: ReturnType<typeof createNativePaginationNudge> | undefined;
afterEach(() => {
  nudge?.cancel();
  retire();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('a nested conversation navigation list does not hide the repaired sidebar paginator', async () => {
  vi.useFakeTimers();
  const { sectionParent, rows } = mountRealGeminiSidebar();
  const scroller = document.createElement('section');
  scroller.className = 'repaired-scroller';
  scroller.style.overflowY = 'auto';
  scroller.append(...sectionParent.childNodes);
  sectionParent.replaceWith(scroller);
  Object.defineProperties(scroller, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 100 },
  });
  const scrolls = vi.fn();
  scroller.addEventListener('scroll', scrolls);
  retire = await installGeminiSelectorPatch({ 'sidebar.scroller': ['.repaired-scroller'] });
  nudge = createNativePaginationNudge();
  nudge.rowHidden(rows[0]);
  await vi.advanceTimersByTimeAsync(17);
  expect(scrolls).toHaveBeenCalledOnce();
  nudge.cancel();

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  rows[0].before(dialog);
  dialog.append(rows[0]);
  nudge.rowHidden(rows[0]);
  await vi.advanceTimersByTimeAsync(17);
  expect(scrolls).toHaveBeenCalledOnce();
  dialog.replaceWith(rows[0]);
  nudge.rowHidden(rows[0]);
  await vi.advanceTimersByTimeAsync(17);
  expect(scrolls).toHaveBeenCalledTimes(2);
});
