import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { setPageUrl } from '@/tests/pageUrl';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}));

vi.mock('@/utils/i18n', () => ({
  getTranslationSync: (key: string) => {
    const translations: Record<string, string> = {
      gemsHide: 'Hide Gems',
      gemsShow: 'Show Gems',
      sidebarCollapseNudgeTitle: 'Collapsed sections are still here',
      sidebarCollapseNudgeBody:
        'A slim bar stays in the sidebar. Click it anytime to expand this section again.',
      sidebarCollapseNudgeDismiss: 'Got it',
    };

    return translations[key] || key;
  },
}));

describe('gemsHider', () => {
  let cleanup: (() => void) | null = null;
  let localState: Record<string, boolean>;
  // Keys whose storage callbacks are held until the test releases them.
  let heldGets: Set<string>;
  let heldSets: Set<string>;
  let pendingCallbacks: Array<() => void>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    localStorage.clear();
    Object.defineProperty(chrome.runtime, 'lastError', {
      value: null,
      configurable: true,
    });

    setPageUrl('https://gemini.google.com/');

    localState = {};
    heldGets = new Set();
    heldSets = new Set();
    pendingCallbacks = [];
    (
      chrome.storage as unknown as {
        local: {
          get: Mock;
          set: Mock;
        };
      }
    ).local = {
      get: vi
        .fn()
        .mockImplementation(
          (
            defaults: Record<string, boolean>,
            callback: (result: Record<string, boolean>) => void,
          ) => {
            const key = Object.keys(defaults)[0];
            const answer = () =>
              callback({
                [key]: Object.prototype.hasOwnProperty.call(localState, key)
                  ? localState[key]
                  : defaults[key],
              });
            if (heldGets.has(key)) pendingCallbacks.push(answer);
            else answer();
          },
        ),
      set: vi.fn().mockImplementation((update: Record<string, boolean>, callback?: () => void) => {
        Object.assign(localState, update);
        const key = Object.keys(update)[0];
        if (heldSets.has(key)) pendingCallbacks.push(() => callback?.());
        else callback?.();
      }),
    };
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
  });

  function createLegacyGemsSection(): HTMLElement {
    const host = document.createElement('div');
    const container = document.createElement('div');
    container.className = 'gems-list-container';

    const arrowIcon = document.createElement('div');
    arrowIcon.setAttribute('data-test-id', 'arrow-icon');
    container.appendChild(arrowIcon);

    host.appendChild(container);
    document.body.appendChild(host);

    return container;
  }

  function createNotebookSection(): HTMLElement {
    // Mirrors Gemini's 2026 expandable-section layout. The header is itself a
    // <button>, so the hider mounts its toggle in absolute mode on the section
    // wrapper (rather than nested inside the header button).
    const host = document.createElement('infinite-scroller');
    const container = document.createElement('expandable-section');
    container.setAttribute('data-test-id', 'notebooks-expandable-section');

    const header = document.createElement('button');
    header.className = 'expandable-section-header';
    header.setAttribute('data-test-id', 'expandable-section-toggle');

    const title = document.createElement('span');
    title.className = 'expandable-section-title gds-body-s';
    title.textContent = 'Notebooks';
    header.appendChild(title);

    container.appendChild(header);
    host.appendChild(container);
    document.body.appendChild(host);

    return container;
  }

  async function startFeature(): Promise<void> {
    const { startGemsHider } = await import('../index');
    cleanup = startGemsHider();
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await Promise.resolve();
  }

  async function flushAsyncWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('does not inject a hide control on Notebooks (slot is now used by the folder-anchor swap toggle)', async () => {
    localState[StorageKeys.GEMS_HIDDEN] = true;

    const gems = createLegacyGemsSection();
    const notebooks = createNotebookSection();

    await startFeature();

    // Gems still gets its toggle (legacy layout still supported).
    expect(gems.querySelector('.gv-sidebar-section-toggle-btn')?.getAttribute('title')).toBe(
      'Hide Gems',
    );
    // Notebooks no longer gets one — the same corner is owned by the folder
    // manager's anchor swap button.
    expect(notebooks.querySelector('.gv-sidebar-section-toggle-btn')).toBeNull();
    // And no peek bar is mounted for the notebooks section.
    expect(
      document.querySelector(
        '[data-gv-sidebar-section-id="notebooks"].gv-sidebar-section-peek-bar',
      ),
    ).toBeNull();
  });

  it('leaves Voyager Folders to its built-in collapse and Activity controls', async () => {
    document.body.innerHTML = `
      <div class="gv-folder-container">
        <div class="gv-folder-header"><div class="gv-folder-header-actions"></div></div>
        <div class="gv-folder-list"></div>
      </div>
    `;

    await startFeature();

    expect(
      document.querySelector('.gv-folder-container .gv-sidebar-section-toggle-btn'),
    ).toBeNull();
    expect(document.querySelector('[data-gv-sidebar-section-id="folders"]')).toBeNull();
  });

  it('processes all sections added across one debounce window', async () => {
    await startFeature();

    const gems = createLegacyGemsSection();
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(50);

    const secondGems = createLegacyGemsSection();
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(100);
    await flushAsyncWork();

    expect(gems.querySelector('.gv-sidebar-section-toggle-btn')?.getAttribute('title')).toBe(
      'Hide Gems',
    );
    expect(secondGems.querySelector('.gv-sidebar-section-toggle-btn')?.getAttribute('title')).toBe(
      'Hide Gems',
    );
  });

  it('falls back to localStorage when storage.local.set reports lastError', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (chrome.storage.local.set as Mock).mockImplementation(
      (_update: Record<string, boolean>, callback?: () => void) => {
        Object.defineProperty(chrome.runtime, 'lastError', {
          value: { message: 'storage failed' },
          configurable: true,
        });
        callback?.();
        Object.defineProperty(chrome.runtime, 'lastError', {
          value: null,
          configurable: true,
        });
      },
    );

    const gems = createLegacyGemsSection();
    await startFeature();

    gems
      .querySelector<HTMLButtonElement>('.gv-sidebar-section-toggle-btn')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushAsyncWork();

    expect(localStorage.getItem(StorageKeys.GEMS_HIDDEN)).toBe('true');
    warn.mockRestore();
  });

  async function releaseHeldStorage(): Promise<void> {
    heldGets.clear();
    heldSets.clear();
    const callbacks = pendingCallbacks;
    pendingCallbacks = [];
    callbacks.forEach((callback) => callback());
    await flushAsyncWork();
  }

  function stopFeature(): void {
    cleanup?.();
    cleanup = null;
  }

  function clickHide(section: HTMLElement): void {
    section
      .querySelector<HTMLButtonElement>('.gv-sidebar-section-toggle-btn')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  it('starts no gems hider observer when stopped before its delayed init', async () => {
    const gems = createLegacyGemsSection();
    const { startGemsHider } = await import('../index');
    startGemsHider()();

    await vi.advanceTimersByTimeAsync(500);
    const lateGems = createLegacyGemsSection();
    await vi.advanceTimersByTimeAsync(200);

    expect(gems.querySelector('.gv-sidebar-section-toggle-btn')).toBeNull();
    expect(lateGems.querySelector('.gv-sidebar-section-toggle-btn')).toBeNull();
    expect(document.getElementById('gv-sidebar-section-hider-style')).toBeNull();
  });

  it('starts no gems hider when stopped before the page finished loading', async () => {
    const gems = createLegacyGemsSection();
    const { startGemsHider } = await import('../index');
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      startGemsHider()();
    } finally {
      Reflect.deleteProperty(document, 'readyState');
    }

    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.advanceTimersByTimeAsync(200);

    expect(gems.querySelector('.gv-sidebar-section-toggle-btn')).toBeNull();
    expect(document.getElementById('gv-sidebar-section-hider-style')).toBeNull();
  });

  it('keeps a restarted gems hider running when an earlier stop is called again', async () => {
    const gems = createLegacyGemsSection();
    const { startGemsHider } = await import('../index');
    const firstStop = startGemsHider();
    await vi.advanceTimersByTimeAsync(500);
    firstStop();

    cleanup = startGemsHider();
    await vi.advanceTimersByTimeAsync(500);
    firstStop();

    expect(gems.querySelector('.gv-sidebar-section-toggle-btn')).not.toBeNull();
  });

  it('does not apply the stored hidden state after the gems hider stopped', async () => {
    localState[StorageKeys.GEMS_HIDDEN] = true;
    heldGets.add(StorageKeys.GEMS_HIDDEN);
    const gems = createLegacyGemsSection();
    await startFeature();
    const host = gems.parentElement!;

    // The host detaches the sidebar while the read is in flight, so the stop cannot reach it.
    host.remove();
    stopFeature();
    document.body.appendChild(host);
    await releaseHeldStorage();

    expect(gems.classList.contains('gv-sidebar-section-hidden')).toBe(false);
  });

  it('keeps a hide click stored but leaves the sidebar alone when the gems hider stops meanwhile', async () => {
    const gems = createLegacyGemsSection();
    await startFeature();
    heldSets.add(StorageKeys.GEMS_HIDDEN);

    clickHide(gems);
    await flushAsyncWork();
    // Detached while the write is in flight, so the stop's DOM sweep cannot reach it.
    const host = gems.parentElement!;
    host.remove();
    stopFeature();
    document.body.appendChild(host);
    await releaseHeldStorage();

    expect(localState[StorageKeys.GEMS_HIDDEN]).toBe(true);
    expect(gems.classList.contains('gv-sidebar-section-hidden')).toBe(false);
    expect(document.querySelector('.gv-sidebar-collapse-nudge')).toBeNull();
    expect(localState).not.toHaveProperty(StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN);
  });

  it('clears its controls, markers and listeners from a sidebar the host detached before the stop', async () => {
    const gems = createLegacyGemsSection();
    await startFeature();
    const host = gems.parentElement!;
    const toggle = gems.querySelector<HTMLElement>('.gv-sidebar-section-toggle-btn')!;
    const peekBar = host.querySelector<HTMLElement>('.gv-sidebar-section-peek-bar')!;

    host.remove();
    stopFeature();
    document.body.appendChild(host);

    expect(host.querySelector('.gv-sidebar-section-toggle-btn')).toBeNull();
    expect(host.querySelector('.gv-sidebar-section-peek-bar')).toBeNull();
    expect(gems.hasAttribute('data-gv-sidebar-section-hider')).toBe(false);
    expect(gems.classList.contains('gv-sidebar-section-hider-target')).toBe(false);

    // A page script still holding the old controls gets no tooltip and no write.
    peekBar.dispatchEvent(new MouseEvent('mouseenter'));
    peekBar.dispatchEvent(new FocusEvent('focus'));
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    expect(document.getElementById('gv-sidebar-section-tooltip')).toBeNull();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    // Turned on again, it sets the reattached section up once.
    await startFeature();
    expect(gems.querySelectorAll('.gv-sidebar-section-toggle-btn')).toHaveLength(1);
    expect(host.querySelectorAll('.gv-sidebar-section-peek-bar')).toHaveLength(1);
  });

  it('keeps a show click stored but leaves the sidebar alone when the gems hider stops meanwhile', async () => {
    localState[StorageKeys.GEMS_HIDDEN] = true;
    const gems = createLegacyGemsSection();
    await startFeature();
    const host = gems.parentElement!;
    expect(gems.classList.contains('gv-sidebar-section-hidden')).toBe(true);
    heldSets.add(StorageKeys.GEMS_HIDDEN);

    host
      .querySelector<HTMLElement>('.gv-sidebar-section-peek-bar')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    // Detached while the write is in flight, so the stop's DOM sweep cannot reach it.
    host.remove();
    stopFeature();
    document.body.appendChild(host);
    await releaseHeldStorage();

    expect(localState[StorageKeys.GEMS_HIDDEN]).toBe(false);
    expect(gems.classList.contains('gv-sidebar-section-hidden')).toBe(false);
    expect(host.querySelector('.gv-sidebar-section-peek-bar')).toBeNull();
  });

  it('takes down a shown collapse nudge and its listener when the host detached the sidebar before the stop', async () => {
    const gems = createLegacyGemsSection();
    await startFeature();
    const host = gems.parentElement!;

    clickHide(gems);
    await flushAsyncWork();
    const card = host.querySelector<HTMLElement>('.gv-sidebar-collapse-nudge');
    expect(card).not.toBeNull();
    const dismiss = card!.querySelector<HTMLButtonElement>('button')!;
    // The stop comes from a later task, after the hider has taken the card's remover.
    await flushAsyncWork();

    host.remove();
    stopFeature();
    document.body.appendChild(host);

    expect(host.querySelector('.gv-sidebar-collapse-nudge')).toBeNull();
    // The dismiss listener stops propagation; with it gone the click reaches the card.
    const reached = vi.fn();
    card!.addEventListener('click', reached);
    dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(reached).toHaveBeenCalledOnce();
  });

  it('mounts no collapse nudge after the gems hider stopped during its storage reads', async () => {
    const gems = createLegacyGemsSection();
    await startFeature();
    heldGets.add(StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN);

    clickHide(gems);
    await flushAsyncWork();
    stopFeature();
    await releaseHeldStorage();

    expect(document.querySelector('.gv-sidebar-collapse-nudge')).toBeNull();
    expect(localState).not.toHaveProperty(StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN);

    // Stopped while the shown flag is being written: the flag stays, the nudge never mounts.
    const nextGems = createLegacyGemsSection();
    await startFeature();
    delete localState[StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN];
    heldSets.add(StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN);

    clickHide(nextGems);
    await flushAsyncWork();
    stopFeature();
    await releaseHeldStorage();

    expect(localState[StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN]).toBe(true);
    expect(document.querySelector('.gv-sidebar-collapse-nudge')).toBeNull();
  });
});
