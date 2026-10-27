import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { openSidebarConversationForExport } from '../sidebarConversationNavigation';
import { findRepairedSidebarConversationLink } from '../sidebarConversationTarget';

const ID = 'fedcba9876543210';

function mount(native = false) {
  const sidebar = document.createElement('bard-sidenav');
  const row = document.createElement('div');
  row.className = 'online-row';
  if (native) row.dataset.testId = 'conversation';
  else row.setAttribute('jslog', `["c_${ID}"]`);
  const link = document.createElement('a');
  link.href = `/u/1/app/${ID}`;
  link.innerHTML = '<span class="title-text">Selected chat</span>';
  row.append(link);
  const trigger = document.createElement('button');
  trigger.setAttribute('aria-label', 'More options for Selected chat');
  sidebar.append(row, trigger);
  document.body.append(sidebar);
  const events: string[] = [];
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
    link.addEventListener(type, (event) => {
      events.push(type);
      if (type !== 'click') return;
      event.preventDefault();
      history.pushState({}, '', `/u/1/app/${ID}`);
      const user = document.createElement('div');
      user.className = 'export-user';
      document.body.append(user);
    });
  }
  return { sidebar, row, link, trigger, events };
}

describe('sidebar export uses the repaired native SPA link', () => {
  let originalUrl: string;
  let stopSnapshot: (() => void) | undefined;

  beforeEach(() => {
    // jsdom rejects Vitest's window proxy in view; preserve the native events without that field.
    const NativeMouseEvent = MouseEvent;
    vi.stubGlobal(
      'MouseEvent',
      class extends NativeMouseEvent {
        constructor(type: string, options?: MouseEventInit) {
          super(type, { ...options, view: null });
        }
      },
    );
    originalUrl = location.href;
    history.replaceState({}, '', '/u/1/app/current');
    document.body.replaceChildren();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopSnapshot?.();
    stopSnapshot = undefined;
    document.body.replaceChildren();
    history.replaceState({}, '', originalUrl);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('clicks the proven renamed row anchor and waits for its route and rendered user turn', async () => {
    const { trigger, events } = mount();
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    const pending = openSidebarConversationForExport(
      trigger,
      () => ['.export-user'],
      (key) => key,
    );
    await vi.advanceTimersByTimeAsync(12500);

    expect(await pending).toBe(true);
    expect(events).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
    expect(location.pathname).toBe(`/u/1/app/${ID}`);
    expect(document.querySelector('.export-user')).not.toBeNull();
  });

  it('preserves native link events and document query counts with online fixes off', async () => {
    const { trigger, events } = mount(true);
    const queries = vi.spyOn(document, 'querySelectorAll');

    const pending = openSidebarConversationForExport(
      trigger,
      () => ['.export-user'],
      (key) => key,
    );
    await vi.advanceTimersByTimeAsync(12500);

    expect(await pending).toBe(true);
    expect(events).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
    expect(queries.mock.calls).toEqual([
      ['[data-test-id="conversation"]'],
      ['[data-test-id="conversation"] a[href], a[data-test-id="conversation"][href]'],
    ]);
  });

  it('keeps a current repaired row from supplying a link for a different requested ID', async () => {
    const { trigger, link } = mount();
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    expect(findRepairedSidebarConversationLink(trigger, 'abcdef0123456789')).toBeNull();
    expect(findRepairedSidebarConversationLink(trigger, ID)).toBe(link);

    link.href = `/u/2/app/${ID}`;
    expect(findRepairedSidebarConversationLink(trigger, ID)).toBeNull();
  });

  it('preserves native-marker link navigation with an equivalent online row selector', async () => {
    const { trigger, link } = mount(true);
    stopSnapshot = await installGeminiSelectorPatch({ 'sidebar.row': ['.online-row'] });

    const clicked: HTMLAnchorElement[] = [];
    link.addEventListener('click', () => clicked.push(link));
    const pending = openSidebarConversationForExport(
      trigger,
      () => ['.export-user'],
      (key) => key,
    );
    await vi.advanceTimersByTimeAsync(12500);

    expect(await pending).toBe(true);
    expect(clicked).toEqual([link]);
  });
});
