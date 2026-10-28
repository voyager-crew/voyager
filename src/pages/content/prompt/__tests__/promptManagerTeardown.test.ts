import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';

import { startPromptManager } from '../index';
import { renderPromptMarkdown } from '../promptMarkdownLoader';
import { resolvePromptSiteAdapter } from '../resolvePromptSiteAdapter';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));

let manager: Awaited<ReturnType<typeof startPromptManager>> | undefined;

function storageGet(values: Record<string, unknown>): typeof chrome.storage.sync.get {
  const get = (
    keys: string | string[] | Record<string, unknown> | null = null,
    callback?: (items: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> => {
    const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
    const names =
      keys === null
        ? Object.keys(values)
        : typeof keys === 'string'
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : Object.keys(keys);
    const result = Object.fromEntries(names.map((key) => [key, values[key] ?? defaults[key]]));
    callback?.(result);
    return Promise.resolve(result);
  };
  return get as typeof chrome.storage.sync.get;
}

async function mountManager(): Promise<HTMLElement> {
  manager = await startPromptManager(resolvePromptSiteAdapter('https://gemini.google.com/app'));
  const panel = document.querySelector<HTMLElement>('#gv-pm-panel');
  expect(panel).not.toBeNull();
  return panel!;
}

function togglePanel(): void {
  document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();
}

beforeAll(async () => {
  // Load the real renderer outside fake time; the regressions concern its scheduled DOM work.
  await renderPromptMarkdown('Warm **preview**');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.body.replaceChildren();
  localStorage.clear();
  vi.mocked(chrome.storage.sync.get).mockImplementation(
    storageGet({ [StorageKeys.LANGUAGE]: 'en' }),
  );
  vi.mocked(chrome.storage.local.get).mockImplementation(
    storageGet({
      [StorageKeys.PROMPT_ITEMS]: [
        { id: 'a', name: 'Alpha', text: 'Write **{{topic}}**', tags: ['work'], createdAt: 1 },
      ],
    }),
  );
  vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: true, records: [] } as never);
  vi.spyOn(console, 'warn');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  manager?.destroy();
  manager = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('prompt manager teardown', () => {
  it.each([
    { action: 'open', destroyed: false },
    { action: 'open', destroyed: true },
    { action: 'return', destroyed: false },
    { action: 'return', destroyed: true },
  ])(
    'a detached tag filter still changes its overflow hint after $action (destroyed=$destroyed)',
    async ({ action, destroyed }) => {
      const panel = await mountManager();
      const tags = panel.querySelector<HTMLElement>('.gv-pm-tags')!;
      const wrap = panel.querySelector<HTMLElement>('.gv-pm-tags-wrap')!;
      vi.advanceTimersToNextFrame();
      expect(wrap.classList.contains('gv-pm-tags-scrollable')).toBe(false);

      togglePanel();
      if (action === 'return') {
        panel.querySelector<HTMLButtonElement>('.gv-pm-backup-btn')!.click();
        vi.advanceTimersToNextFrame();
        panel.querySelector<HTMLButtonElement>('.gv-pm-saved-footer-primary')!.click();
      }
      Object.defineProperty(tags, 'clientHeight', { configurable: true, value: 20 });
      Object.defineProperty(tags, 'scrollHeight', { configurable: true, value: 100 });
      if (destroyed) manager!.destroy();
      vi.advanceTimersToNextFrame();

      expect(wrap.classList.contains('gv-pm-tags-scrollable')).toBe(!destroyed);
    },
  );

  it.each([false, true])(
    'a detached prompt row still renders Markdown on the next frame (destroyed=%s)',
    async (destroyed) => {
      const panel = await mountManager();
      togglePanel();
      vi.advanceTimersToNextFrame();
      panel.querySelector<HTMLButtonElement>('.gv-pm-view-mode')!.click();
      const markdown = panel.querySelector<HTMLElement>('.gv-md')!;
      expect(markdown.textContent).toBe('');

      if (destroyed) manager!.destroy();
      vi.advanceTimersToNextFrame();
      await vi.advanceTimersByTimeAsync(0);

      expect(markdown.textContent?.trim()).toBe(destroyed ? '' : 'Write topic');
      if (!destroyed) expect(markdown.querySelector('.gv-pm-var')?.textContent).toBe('topic');
    },
  );

  it.each([false, true])(
    'a destroyed panel still ends a pending theme transition after 450 ms (destroyed=%s)',
    async (destroyed) => {
      const panel = await mountManager();
      panel.querySelector<HTMLButtonElement>('.gv-pm-theme-toggle')!.click();
      expect(panel.classList.contains('gv-pm-transitioning')).toBe(true);
      vi.advanceTimersByTime(100);
      panel.querySelector<HTMLButtonElement>('.gv-pm-theme-toggle')!.click();

      if (destroyed) manager!.destroy();
      vi.advanceTimersByTime(350);
      expect(panel.classList.contains('gv-pm-transitioning')).toBe(destroyed);
      vi.advanceTimersByTime(100);
      expect(panel.classList.contains('gv-pm-transitioning')).toBe(destroyed);
    },
  );

  it.each([false, true])(
    'a destroyed template fill still swallows the composer Enter key (destroyed=%s)',
    async (destroyed) => {
      const panel = await mountManager();
      togglePanel();
      panel
        .querySelector<HTMLElement>('.gv-pm-item-text')!
        .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
      const slot = document.querySelector<HTMLElement>('.gv-pm-slot')!;
      slot.textContent = 'gravity';
      slot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(document.querySelector('.gv-pm-fill')).toBeNull();
      const keyup = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true });
      document.dispatchEvent(keyup);
      expect(keyup.defaultPrevented).toBe(true);

      if (destroyed) manager!.destroy();
      else vi.advanceTimersByTime(0);

      for (const type of ['keyup', 'keypress']) {
        const event = new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      if (destroyed) {
        // Teardown released the guard; its deferred release must not reach the page again.
        const pageCalls = [
          vi.spyOn(window, 'clearTimeout'),
          vi.spyOn(window, 'removeEventListener'),
        ];
        vi.advanceTimersByTime(0);
        for (const call of pageCalls) expect(call).not.toHaveBeenCalled();
      }
    },
  );

  it.each([false, true])(
    'a destroyed saved library leaves its download URL alive until another task (destroyed=%s)',
    async (destroyed) => {
      const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
      const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
      let created!: () => void;
      const downloaded = new Promise<void>((resolve) => {
        created = resolve;
      });
      const revoke = vi.fn();
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: () => {
          created();
          return 'blob:prompt-highlights';
        },
      });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      vi.spyOn(accountIsolationService, 'resolveAccountScope').mockResolvedValue({
        accountKey: 'opaque-account',
        accountId: 1,
        routeUserId: null,
        emailHash: null,
      });
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
        ok: true,
        data: 'exported highlights',
        filename: 'highlights.json',
        records: [],
      } as never);
      try {
        const panel = await mountManager();
        togglePanel();
        panel.querySelector<HTMLButtonElement>('.gv-pm-backup-btn')!.click();
        panel.querySelector<HTMLButtonElement>('.gv-pm-saved-export-option')!.click();
        await downloaded;
        expect(revoke).not.toHaveBeenCalled();

        if (destroyed) manager!.destroy();
        else vi.advanceTimersByTime(0);

        expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:prompt-highlights');
        vi.advanceTimersByTime(0);
        expect(revoke).toHaveBeenCalledTimes(1);
      } finally {
        if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
        else Reflect.deleteProperty(URL, 'createObjectURL');
        if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
        else Reflect.deleteProperty(URL, 'revokeObjectURL');
      }
    },
  );

  it('a destroyed saved library still starts a download when its export replies late', async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const create = vi.fn(() => 'blob:late-highlights');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let requested!: () => void;
    const request = new Promise<void>((resolve) => {
      requested = resolve;
    });
    let finish!: (response: { ok: true; data: string }) => void;
    const response = new Promise<{ ok: true; data: string }>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(accountIsolationService, 'resolveAccountScope').mockResolvedValue({
      accountKey: 'opaque-account',
      accountId: 1,
      routeUserId: null,
      emailHash: null,
    });
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (message: { type: string }) => {
      if (message.type !== 'gv.highlight.export') return { ok: true, records: [] };
      requested();
      return response;
    }) as typeof chrome.runtime.sendMessage);
    try {
      const panel = await mountManager();
      togglePanel();
      panel.querySelector<HTMLButtonElement>('.gv-pm-backup-btn')!.click();
      panel.querySelector<HTMLButtonElement>('.gv-pm-saved-export-option')!.click();
      await request;
      manager!.destroy();
      finish({ ok: true, data: 'late highlights' });
      await response;
      await vi.advanceTimersByTimeAsync(0);

      expect(create).not.toHaveBeenCalled();
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });
});
