import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { LIBRARY_OPEN_MESSAGE } from '@/features/savedLibrary/openLibraryPage';
import { makeRecord } from '@/pages/content/highlight/__tests__/fixtures';
import { loadTranslations } from '@/utils/translations';

import { StarredHistory } from '../StarredHistory';

const en = await loadTranslations('en');

vi.mock('webextension-polyfill', () => ({ default: chrome }));

let root: Root;
let container: HTMLElement;
let pageUrl: string;
let starText: string | undefined;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  pageUrl = 'https://claude.ai/chat/current';
  starText = undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({
    [StorageKeys.LANGUAGE]: 'en',
  }));
  vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({}));
  vi.mocked(chrome.storage.local.set).mockResolvedValue();
  vi.mocked(chrome.tabs.query).mockImplementation(async () => [
    { id: 7, url: pageUrl } as chrome.tabs.Tab,
  ]);
  chrome.tabs.update = vi.fn().mockResolvedValue({});
  vi.mocked(chrome.tabs.create).mockImplementation(async () => ({}) as chrome.tabs.Tab);
  vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({ ok: false }));
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    async (message: unknown, callback?: unknown) => {
      const type = (message as { type: string }).type;
      if (type === 'gv.starred.getAll') {
        const response = {
          ok: true,
          data: {
            messages: {
              'claude:conv:saved': [
                {
                  conversationId: 'claude:conv:saved',
                  conversationUrl: 'https://claude.ai/chat/saved',
                  turnId: 'turn-one',
                  content: 'Saved answer',
                  text: starText,
                  starredAt: 100,
                },
              ],
            },
          },
        };
        if (typeof callback === 'function') callback(response);
        return response;
      }
      return { ok: false, error: 'Storage unavailable' };
    },
  );
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () => {
    root.render(
      <LanguageProvider>
        <StarredHistory onClose={() => {}} />
      </LanguageProvider>,
    );
  });
}
async function viewHighlights() {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(en.savedLibraryHighlights),
  )!;
  await act(async () => button.click());
}

it('the popup can expand a full user prompt and find words missing from its preview', async () => {
  starText = 'Saved user prompt\nHidden-only NEBULA\nAnother line';
  await mount();
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const full = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(full.textContent).toBe('Saved answer');
  expect(toggle.textContent).toBe('Show full text');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(full.textContent).toBe(starText);
  expect(full.closest('[data-library-item-id]')?.textContent).not.toContain('Saved answer');
  expect(chrome.tabs.update).not.toHaveBeenCalled();
  expect(chrome.tabs.create).not.toHaveBeenCalled();
  await act(async () => toggle.click());
  expect(full.textContent).toBe('Saved answer');
  expect(toggle.textContent).toBe('Show full text');
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'nebula',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.querySelectorAll('[data-library-item-id]')).toHaveLength(1);
  expect(container.querySelector('[data-library-open]')?.textContent).toContain('Saved answer');
});

it.each([
  'https://claude.ai/chat/current',
  'https://chatgpt.com/c/current',
  'https://chat.deepseek.com/a/chat/s/current',
])('Saved Library lists stars without a highlight load error on %s', async (url) => {
  pageUrl = url;
  await mount();
  expect(container.textContent).toContain('Saved answer');
  await viewHighlights();
  expect(container.textContent).toContain(en.savedLibraryNoHighlights);
  expect(container.textContent).not.toContain(en.pm_starred_load_error);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'gv.highlight.list' }),
  );
});

it.each([
  'https://gemini.google.com/u/1/app/current',
  'https://aistudio.google.com/u/1/prompts/current',
])('Saved Library still reports a real highlight load failure on %s', async (url) => {
  pageUrl = url;
  await mount();
  expect(container.textContent).toContain('Saved answer');
  await viewHighlights();
  expect(container.textContent).toContain(en.pm_starred_load_error);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'gv.highlight.list' }),
  );
});

it('opens a saved Claude star in the current Claude tab', async () => {
  await mount();
  const card = container.querySelector<HTMLButtonElement>('[data-library-open]')!;
  await act(async () => card.click());
  expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
    url: 'https://claude.ai/chat/saved#gv-turn-turn-one',
  });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});

it.each([true, false])(
  'the popup checks ChatGPT account before navigating its source tab (readable=%s)',
  async (readable) => {
    pageUrl = 'https://chatgpt.com/c/current';
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (
      message: { type: string },
      callback?: (value: unknown) => void,
    ) => {
      if (message.type === 'gv.starred.getAll') {
        const response = {
          ok: true,
          data: {
            messages: {
              'chatgpt:conv:saved': [
                {
                  conversationId: 'chatgpt:conv:saved',
                  conversationUrl: 'https://chatgpt.com/c/saved',
                  turnId: 'turn-one',
                  content: 'Saved answer',
                  starredAt: 100,
                  account: `chatgpt:${'a'.repeat(64)}`,
                },
              ],
            },
          },
        };
        callback?.(response);
        return response;
      }
      return { ok: false };
    }) as typeof chrome.runtime.sendMessage);
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () =>
      readable ? { ok: true, account: `chatgpt:${'b'.repeat(64)}` } : { ok: false },
    );
    await mount();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-library-open]')!.click(),
    );
    if (readable) {
      expect(chrome.tabs.update).not.toHaveBeenCalled();
      const host = document.querySelector<HTMLElement>('[data-gv-layer="popover"]')!;
      expect(host.shadowRoot!.textContent).toContain('This star was saved in Account 1.');
      const button = [...host.shadowRoot!.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === 'Open anyway',
      )!;
      await act(async () => button.click());
    }
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: 'https://chatgpt.com/c/saved#gv-turn-turn-one',
    });
    expect(window.close).toHaveBeenCalled();
  },
);

it('keeps a starred row after a failed removal and allows retry', async () => {
  let removed = false;
  let attempts = 0;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (
    message: { type: string; payload?: { conversationId?: string; turnId?: string } },
    callback?: (value: unknown) => void,
  ) => {
    if (message.type === 'gv.starred.getAll') {
      callback?.({
        ok: true,
        data: {
          messages: removed
            ? {}
            : {
                'claude:conv:saved': [
                  {
                    conversationId: 'claude:conv:saved',
                    conversationUrl: 'https://claude.ai/chat/saved',
                    turnId: 'turn-one',
                    content: 'Saved answer',
                    starredAt: 100,
                  },
                ],
              },
        },
      });
      return;
    }
    if (message.type === 'gv.starred.remove') {
      removed = ++attempts > 1;
      callback?.({ ok: removed, error: removed ? undefined : 'Storage unavailable' });
      return;
    }
    return { ok: false };
  }) as typeof chrome.runtime.sendMessage);
  await mount();
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${en.removeFromStarred}"]`,
  )!;

  await act(async () => button.click());
  expect(container.textContent).toContain('Saved answer');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.starredDeleteFailed);
  expect(
    container.querySelector(`button[aria-label="${button.getAttribute('aria-label')}"]`),
  ).not.toBeNull();

  await act(async () => button.click());
  expect(container.textContent).not.toContain('Saved answer');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
    {
      type: 'gv.starred.remove',
      payload: { conversationId: 'claude:conv:saved', turnId: 'turn-one' },
    },
    expect.any(Function),
  );
});

it('keeps a highlight row and reports highlight removal failure when the request throws', async () => {
  pageUrl = 'https://gemini.google.com/u/1/app/current';
  vi.spyOn(StarredMessagesService, 'getAllStarredMessagesSorted').mockResolvedValue([]);
  vi.spyOn(accountIsolationService, 'resolveAccountScope').mockResolvedValue({
    accountKey: 'opaque-account',
    accountId: 1,
    routeUserId: '1',
    emailHash: null,
  });
  const highlight = makeRecord({
    quote: { exact: 'Highlighted answer', prefix: '', suffix: '' },
    position: { start: 0, end: 18 },
    sourceTextHash: 'text-hash',
  });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (message: { type: string }) => {
    if (message.type === 'gv.highlight.list') return { ok: true, records: [highlight] };
    throw new Error('Highlight storage unavailable');
  }) as typeof chrome.runtime.sendMessage);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await mount();
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${en.pm_delete}"]`,
  )!;
  await act(async () => button.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.highlightDeleteFailed);
  expect(container.textContent).toContain('Highlighted answer');
  expect(
    container.querySelector(`button[aria-label="${button.getAttribute('aria-label')}"]`),
  ).not.toBeNull();
});

it('opens the full library from the popup without navigating the source tab', async () => {
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (
    message: { type: string },
    callback?: (value: unknown) => void,
  ) => {
    if (message.type === 'gv.starred.getAll') {
      callback?.({ ok: true, data: { messages: {} } });
      return;
    }
    return { ok: message.type === LIBRARY_OPEN_MESSAGE };
  }) as typeof chrome.runtime.sendMessage);
  await mount();
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${en.savedLibraryOpenFull}"]`,
  )!;
  await act(async () => button.click());
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: LIBRARY_OPEN_MESSAGE });
  expect(chrome.tabs.update).not.toHaveBeenCalled();
});

it("a failed read after an account switch does not keep the previous account's highlights deletable", async () => {
  pageUrl = 'https://gemini.google.com/u/1/app/current';
  const listeners = new Set<Parameters<typeof chrome.storage.onChanged.addListener>[0]>();
  vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
    listeners.delete(listener);
  });
  const highlight = makeRecord({
    quote: { exact: 'Account A highlighted answer', prefix: '', suffix: '' },
    position: { start: 0, end: 28 },
    sourceTextHash: 'hash',
  });
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (
    message: { type: string; payload?: { scope?: { accountKey: string } } },
    callback?: (value: unknown) => void,
  ) => {
    if (message.type === 'gv.starred.getAll') {
      callback?.({
        ok: true,
        data: {
          messages: {
            'claude:conv:saved': [
              {
                conversationId: 'claude:conv:saved',
                conversationUrl: 'https://claude.ai/chat/saved',
                turnId: 'saved',
                content: 'Readable star',
                starredAt: 1,
              },
            ],
          },
        },
      });
      return;
    }
    if (message.type === 'gv.highlight.list' && message.payload?.scope?.accountKey === 'route:1')
      return { ok: true, records: [highlight] };
    throw new Error('Account B temporarily unavailable');
  }) as typeof chrome.runtime.sendMessage);
  await mount();
  expect(container.textContent).toContain('Account A highlighted answer');
  expect(container.querySelector(`button[aria-label="${en.pm_delete}"]`)).not.toBeNull();
  pageUrl = 'https://gemini.google.com/u/2/app/current';
  await act(async () => {
    for (const listener of listeners)
      listener({ [StorageKeys.SAVED_LIBRARY_STARS]: { newValue: { messages: {} } } }, 'local');
  });
  expect(container.textContent).toContain('Readable star');
  expect(container.textContent).not.toContain('Account A highlighted answer');
  expect(container.querySelector(`button[aria-label="${en.pm_delete}"]`)).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.pm_starred_load_error);
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'gv.highlight.deleteStored' }),
  );
});

it('reports an accurate library-open failure without hiding readable stars', async () => {
  const original = vi.mocked(chrome.runtime.sendMessage).getMockImplementation()!;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (
    message: { type: string },
    callback?: unknown,
  ) => {
    if (message.type === LIBRARY_OPEN_MESSAGE) throw new Error('Tabs unavailable');
    return Reflect.apply(original, chrome.runtime, [message, callback]);
  }) as typeof chrome.runtime.sendMessage);
  await mount();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(`button[aria-label="${en.savedLibraryOpenFull}"]`)!
      .click(),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(en.savedLibraryOpenFailed);
  expect(container.textContent).toContain('Saved answer');
});
