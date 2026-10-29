import { describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { confirmDriver } from '@/tests/confirmDriver';
import { toastDriver } from '@/tests/toastDriver';

import {
  emitStorageChange,
  manager,
  openManager,
  prompt,
  setupPromptManagerTests,
  storageGet,
} from './promptManagerHarness';

vi.mock('webextension-polyfill', () => ({ default: globalThis.chrome }));
vi.mock('@/core/utils/userEvent', () => import('./ballClicks'));

setupPromptManagerTests();

describe('prompt manager shared feedback', () => {
  const deleteFirst = (panel: HTMLElement) =>
    panel.querySelector<HTMLButtonElement>('.gv-pm-del')!.click();

  it('keeps the panel open when pressing its confirm (F17)', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);
    deleteFirst(panel);
    expect(confirmDriver.message()).toBe('Delete this prompt?');
    expect(confirmDriver.focusedLabel()).toBe('Cancel');

    confirmDriver.pressInside();

    expect(panel.classList.contains('gv-hidden')).toBe(false);
    expect(confirmDriver.isOpen()).toBe(true);
    confirmDriver.answer('Cancel');
    expect(panel.querySelector('.gv-pm-item')?.textContent).toContain('Alpha');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the panel open when pressing a toast (F17)', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false } as never);
    const panel = await openManager([prompt('a', 'Alpha')]);
    panel.querySelector<HTMLButtonElement>('.gv-pm-settings')!.click();
    const toast = await vi.waitFor(() => {
      const found = toastDriver.all()[0];
      if (!found) throw new Error('settings notice not shown');
      return found;
    });

    toast.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));

    expect(panel.classList.contains('gv-hidden')).toBe(false);
    expect(toast.tone).toBe('error');
    expect(toast.role).toBe('alert');
  });

  it('dismisses the confirm on Escape without closing the panel or deleting', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);
    deleteFirst(panel);
    confirmDriver.pressEscape();
    await Promise.resolve();

    expect(confirmDriver.isOpen()).toBe(false);
    expect(panel.classList.contains('gv-hidden')).toBe(false);
    expect(panel.querySelector('.gv-pm-item')?.textContent).toContain('Alpha');
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['close', 'hide', 'destroy', 'replace'])(
    'cannot delete through an unanswered confirm after %s',
    async (action) => {
      const panel = await openManager([prompt('a', 'Alpha')]);
      deleteFirst(panel);
      if (action === 'close') document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();
      if (action === 'hide') emitStorageChange({ gvHidePromptManager: { newValue: true } }, 'sync');
      if (action === 'destroy') manager!.destroy();
      if (action === 'replace')
        emitStorageChange(
          { [StorageKeys.PROMPT_ITEMS]: { newValue: [prompt('b', 'Beta')] } },
          'local',
        );
      await Promise.resolve();

      expect(confirmDriver.isOpen()).toBe(false);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
      expect(toastDriver.messages()).not.toContain('Deleted');
    },
  );

  it('does not delete if the panel closes immediately after answering', async () => {
    const panel = await openManager([prompt('a', 'Alpha')]);
    deleteFirst(panel);
    confirmDriver.answer('Delete');
    document.querySelector<HTMLButtonElement>('#gv-pm-trigger')!.click();
    await Promise.resolve();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(panel.querySelector('.gv-pm-item')?.textContent).toContain('Alpha');
  });

  it.each(['light', 'dark'] as const)(
    'keeps the confirm in the panel’s %s theme when the page theme changes',
    async (scheme) => {
      vi.mocked(chrome.storage.sync.get).mockImplementation(
        storageGet({ [StorageKeys.LANGUAGE]: 'en', [StorageKeys.PROMPT_THEME]: scheme }),
      );
      const panel = await openManager([prompt('a', 'Alpha')]);
      deleteFirst(panel);
      document.documentElement.setAttribute(
        'data-gv-scheme',
        scheme === 'light' ? 'dark' : 'light',
      );
      document.body.classList.add('gv-rtl');
      await Promise.resolve();

      expect(confirmDriver.scheme()).toBe(scheme);
      confirmDriver.answer('Cancel');
      panel.querySelector<HTMLButtonElement>('.gv-pm-theme-toggle')!.click();
      deleteFirst(panel);
      expect(confirmDriver.scheme()).toBe(scheme === 'light' ? 'dark' : 'light');
      document.body.classList.remove('gv-rtl');
      document.documentElement.removeAttribute('data-gv-scheme');
    },
  );

  it('replaces the notice, expires it after 1800 ms, and clears it on teardown', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ ok: false } as never);
    const panel = await openManager([prompt('a', 'Alpha')]);
    const settings = panel.querySelector<HTMLButtonElement>('.gv-pm-settings')!;
    settings.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(toastDriver.all()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    settings.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(toastDriver.all()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1798);
    expect(toastDriver.all()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(toastDriver.all()).toHaveLength(0);
    settings.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(toastDriver.all()).toHaveLength(1);
    manager!.destroy();
    expect(toastDriver.all()).toHaveLength(0);
  });

  it('does not resurrect a settings notice after teardown', async () => {
    let finish!: (value: { ok: false }) => void;
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
    );
    const panel = await openManager([prompt('a', 'Alpha')]);
    panel.querySelector<HTMLButtonElement>('.gv-pm-settings')!.click();
    manager!.destroy();
    finish({ ok: false });
    await Promise.resolve();

    expect(toastDriver.messages()).toEqual([]);
  });
});
