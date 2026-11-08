import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RefreshPromptText } from '../refreshPromptCard';
import { showRefreshPromptCard } from '../refreshPromptCard';
import { type RefreshPromptDeps, promptStaleTabsToRefresh } from '../updateRefreshPrompt';

const TEXT: RefreshPromptText = {
  title: 'Voyager updated',
  body: 'Refresh this page.',
  reload: 'Refresh',
  later: 'Later',
  rtl: false,
};

function deps(overrides: Partial<RefreshPromptDeps> = {}) {
  const showCard = vi.fn(async () => {});
  const all: RefreshPromptDeps = {
    voyagerMatches: async () => ['https://gemini.google.com/*'],
    queryTabs: async () => [
      { id: 1 } as chrome.tabs.Tab,
      { id: 2 } as chrome.tabs.Tab,
      { id: 3, discarded: true } as chrome.tabs.Tab,
    ],
    isLive: async (tabId) => tabId === 2,
    showCard,
    text: async () => TEXT,
    wait: async () => {},
    ...overrides,
  };
  return { all, showCard };
}

describe('promptStaleTabsToRefresh', () => {
  it('offers a refresh only in open tabs whose script no longer answers', async () => {
    const { all, showCard } = deps();

    await expect(promptStaleTabsToRefresh(all)).resolves.toBe(1);

    expect(showCard).toHaveBeenCalledExactlyOnceWith(1, TEXT);
  });

  it('carries on past a tab that refuses the card', async () => {
    const showCard = vi.fn(async (tabId: number) => {
      if (tabId === 1) throw new Error('No tab with id: 1');
    });
    const { all } = deps({ isLive: async () => false, showCard });

    await expect(promptStaleTabsToRefresh(all)).resolves.toBe(1);
    expect(showCard).toHaveBeenCalledTimes(2);
  });
});

describe('showRefreshPromptCard', () => {
  afterEach(() => {
    document.getElementById('gv-update-refresh-prompt')?.remove();
    vi.unstubAllGlobals();
  });

  function card() {
    return document.getElementById('gv-update-refresh-prompt')?.shadowRoot ?? null;
  }

  it('shows once, and leaves the page as it is when the person picks later', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    showRefreshPromptCard(TEXT);
    showRefreshPromptCard(TEXT);

    expect(document.querySelectorAll('#gv-update-refresh-prompt')).toHaveLength(1);
    expect(card()?.textContent).toContain('Voyager updated');

    card()?.querySelector<HTMLButtonElement>('.later')?.click();
    expect(card()).toBeNull();
  });
});
