import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { navigateToForkConversation } from '../forkNavigation';
import { findForkSidebarLink } from '../forkSidebar';

describe('fork navigation with online sidebar discovery', () => {
  let stopSelectors: (() => void) | undefined;
  let listeners: AbortController;
  let clicks: string[];

  beforeEach(() => {
    // jsdom rejects Vitest's window proxy in view; omit only that realm field.
    const NativeMouseEvent = MouseEvent;
    vi.stubGlobal(
      'MouseEvent',
      class extends NativeMouseEvent {
        constructor(type: string, options?: MouseEventInit) {
          super(type, { ...options, view: null });
        }
      },
    );
    history.replaceState({}, '', '/u/1/app/current');
    document.body.innerHTML = `
      <aside class="decoy-root"><a id="decoy" href="/u/1/app/next">Same URL, unrelated control</a></aside>
      <bard-sidenav><div data-test-id="conversation">
        <a id="stale-account" href="/u/0/app/next">Old account</a>
        <a id="native" href="/u/1/app/next">Next conversation</a>
      </div></bard-sidenav>`;
    listeners = new AbortController();
    clicks = [];
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(
        type,
        (event) => {
          clicks.push(`${type}:${(event.target as Element).id}`);
          if (type === 'click') event.preventDefault();
        },
        { signal: listeners.signal },
      );
    }
  });

  afterEach(() => {
    stopSelectors?.();
    stopSelectors = undefined;
    listeners.abort();
    document.body.replaceChildren();
    history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  function navigate() {
    navigateToForkConversation({ conversationId: 'next', conversationUrl: '/app/next' });
  }

  it('selects the same native node and event order through an online profile', async () => {
    const accepts = (url: URL) => url.pathname === '/u/1/app/next';
    const bundled = findForkSidebarLink(accepts);
    navigate();
    const bundledClicks = [...clicks];
    clicks = [];
    stopSelectors = await installGeminiSelectorPatch({
      'sidebar.links': ['#stale-account', '#native'],
      'sidebar.forkRoots': ['bard-sidenav'],
    });

    expect(findForkSidebarLink(accepts)).toBe(bundled);
    expect(bundled).toBe(document.getElementById('native'));
    navigate();
    expect(clicks).toEqual(bundledClicks);
    expect(clicks).toEqual([
      'pointerdown:native',
      'mousedown:native',
      'mouseup:native',
      'click:native',
    ]);
  });

  it('opens the native conversation after an online match finds an unrelated control', async () => {
    stopSelectors = await installGeminiSelectorPatch({
      'sidebar.links': ['#decoy'],
      'sidebar.forkRoots': ['.decoy-root'],
    });

    navigate();
    expect(clicks).toEqual([
      'pointerdown:native',
      'mousedown:native',
      'mouseup:native',
      'click:native',
    ]);
  });

  it('recovers the current-account link when an online list selects a stale account', async () => {
    stopSelectors = await installGeminiSelectorPatch({ 'sidebar.links': ['#stale-account'] });

    navigate();
    expect(clicks).toEqual([
      'pointerdown:native',
      'mousedown:native',
      'mouseup:native',
      'click:native',
    ]);
    expect(window.location.pathname).toBe('/u/1/app/current');
  });

  it('uses the packaged router fallback when no native link can be proven', async () => {
    document.querySelector('bard-sidenav')!.remove();
    stopSelectors = await installGeminiSelectorPatch({
      'sidebar.links': ['#decoy'],
      'sidebar.forkRoots': ['.decoy-root'],
    });

    navigate();
    expect(window.location.pathname).toBe('/u/1/app/next');
    expect(clicks).toEqual([]);
  });
});
