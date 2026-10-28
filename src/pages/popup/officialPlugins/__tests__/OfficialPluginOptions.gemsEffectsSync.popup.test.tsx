import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import { domId } from '../OfficialPluginRow';
import {
  AI_STUDIO,
  GEMINI_TAB,
  emitSyncChange,
  extensionApi,
  popupRows,
  resetPopupBrowser,
} from './popupHarness';

const en = await loadTranslations('en');

// Keep Popup, its hooks and the packaged manifests real; replace only browser APIs.
vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));
vi.mock('@/core/utils/browser', async (importOriginal) => {
  const { browserTarget } = await import('./popupHarness');
  return {
    ...(await importOriginal<typeof import('@/core/utils/browser')>()),
    isSafari: () => browserTarget.safari,
  };
});

/** The Recent Gems count, the visual effects choices and the Context Sync panel. */
describe('official plugin rows with a count, choices or a panel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ sync } = resetPopupBrowser());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <LanguageProvider>
          <Popup />
        </LanguageProvider>,
      );
    });
  };
  const row = (id: string) => popupRows(container).row(id);
  const toggle = (id: string) => popupRows(container).toggle(id);
  // The options under an enabled row, labelled with its name.
  const options = (id: string) =>
    container.querySelector<HTMLElement>(`#${domId('official-plugin-options', id)}`);
  const drag = (input: HTMLInputElement, value: number | string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        String(value),
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const pluginStateWritten = () =>
    extensionApi.storage.local.set.mock.calls.some(([updates]) =>
      Object.hasOwn(updates as object, StorageKeys.PLUGINS_STATE),
    );

  describe('the recent Gems row', () => {
    const id = OFFICIAL_PLUGIN_IDS.geminiGemsSidebar;
    const count = () => row(id)!.querySelector<HTMLInputElement>('input[type="range"]');

    it.each([undefined, true])(
      'shows Recent Gems on and adjustable with stored enabled=%s',
      async (stored) => {
        if (stored !== undefined) sync[StorageKeys.GV_GEMS_SIDEBAR_ENABLED] = stored;
        sync[StorageKeys.GV_GEMS_SIDEBAR_COUNT] = 6;
        await mount();
        expect(toggle(id).disabled).toBe(false);
        expect(toggle(id).checked).toBe(true);
        expect(count()!.disabled).toBe(false);
        expect(count()!.value).toBe('6');
      },
    );

    it('reads a stored count of 0 as a hidden list, with the row still on', async () => {
      sync[StorageKeys.GV_GEMS_SIDEBAR_COUNT] = 0;
      await mount();
      expect(toggle(id).checked).toBe(true);
      expect(count()!.value).toBe('0');
      expect(count()!.getAttribute('aria-valuetext')).toBe(en.gemsSidebarCountHidden);
      expect(row(id)!.textContent).toContain(en.gemsSidebarCountHidden);
      expect(row(id)!.textContent).not.toMatch(/\bOff\b/);
    });

    it('saves the count on release, to its old key only', async () => {
      await mount();
      expect(count()!.getAttribute('aria-valuetext')).toBe('3');
      drag(count()!, 5);
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      await act(async () => count()!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_GEMS_SIDEBAR_COUNT]: 5,
      });
      expect(pluginStateWritten()).toBe(false);
    });

    it('turns off and back on with its switch, keeping the stored count', async () => {
      sync[StorageKeys.GV_GEMS_SIDEBAR_COUNT] = 6;
      await mount();
      await act(async () => toggle(id).click());
      expect(toggle(id).checked).toBe(false);
      expect(count()).toBeNull();
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_GEMS_SIDEBAR_ENABLED]: false,
      });
      expect(sync[StorageKeys.GV_GEMS_SIDEBAR_COUNT]).toBe(6);

      extensionApi.storage.sync.set.mockClear();
      await act(async () => toggle(id).click());
      expect(toggle(id).checked).toBe(true);
      expect(count()!.value).toBe('6');
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_GEMS_SIDEBAR_ENABLED]: true,
      });
    });
  });

  describe('the visual effects row', () => {
    const id = OFFICIAL_PLUGIN_IDS.visualEffects;
    const choices = () =>
      [...row(id)!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].map((button) => [
        button.textContent,
        button.getAttribute('aria-pressed'),
      ]);
    const choice = (label: string) =>
      [...row(id)!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(
        (button) => button.textContent === label,
      )!;
    // Effect choices anywhere but under the row: the retired card's.
    const choicesOffTheRow = () =>
      [...container.querySelectorAll('button[aria-pressed]')].filter(
        (button) => !row(id)?.contains(button),
      );

    it.each([
      ['missing', {}, false],
      ['off', { [StorageKeys.GV_VISUAL_EFFECT]: 'off' }, false],
      ['legacy snow', { [StorageKeys.GV_SNOW_EFFECT]: true }, true],
      ['sakura', { [StorageKeys.GV_VISUAL_EFFECT]: 'sakura' }, true],
    ] as const)(
      'replaces the old card on Gemini and reads a %s stored effect as the page does',
      async (_label, stored, on) => {
        Object.assign(sync, stored);
        await mount();
        expect(choicesOffTheRow()).toEqual([]);
        expect(toggle(id).checked).toBe(on);
        expect(row(id)!.querySelectorAll('button[aria-pressed]').length).toBe(on ? 3 : 0);
      },
    );

    it('offers Snow, Sakura and Rain under the row, since Off is its switch', async () => {
      sync[StorageKeys.GV_SNOW_EFFECT] = true;
      await mount();
      expect(choices()).toEqual([
        [en.visualEffectSnow, 'true'],
        [en.visualEffectSakura, 'false'],
        [en.visualEffectRain, 'false'],
      ]);
    });

    it('picking an effect writes the pair the card always wrote', async () => {
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'snow';
      await mount();
      await act(async () => choice(en.visualEffectRain).click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_VISUAL_EFFECT]: 'rain',
        [StorageKeys.GV_SNOW_EFFECT]: false,
      });
      expect(choice(en.visualEffectRain).getAttribute('aria-pressed')).toBe('true');
      expect(pluginStateWritten()).toBe(false);
    });

    it('its switch turns the effect off, and on again as Snow', async () => {
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'sakura';
      await mount();
      await act(async () => toggle(id).click());
      await act(async () => toggle(id).click());
      expect(extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload)).toEqual([
        { [StorageKeys.GV_VISUAL_EFFECT]: 'off', [StorageKeys.GV_SNOW_EFFECT]: false },
        { [StorageKeys.GV_VISUAL_EFFECT]: 'snow', [StorageKeys.GV_SNOW_EFFECT]: false },
      ]);
      expect(choice(en.visualEffectSnow).getAttribute('aria-pressed')).toBe('true');
    });

    it('is a row on AI Studio too', async () => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'rain';
      await mount();
      expect(choicesOffTheRow()).toEqual([]);
      expect(toggle(id).checked).toBe(true);
    });

    it('a custom site lists the same row in its plugin card, and no card', async () => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 9, url: 'https://example.com/chat' }]);
      extensionApi.permissions.contains.mockResolvedValue(true);
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['example.com'];
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'rain';
      await mount();
      expect(toggle(id).checked).toBe(true);
      expect(choicesOffTheRow()).toEqual([]);
      expect(container.textContent).not.toContain(en.visualEffectHint);
    });
  });

  describe('the context sync row', () => {
    const id = OFFICIAL_PLUGIN_IDS.geminiContextSync;
    const port = () =>
      row(id)!.querySelector<HTMLInputElement>(`#${domId('official-plugin-options', id)}-port`);
    const isSyncRequest = (message: unknown) =>
      (message as { action?: string } | undefined)?.action === 'sync_to_ide';
    const syncButton = () =>
      [...row(id)!.querySelectorAll('button')].find(
        (button) => button.textContent === en.syncToIDE,
      );

    beforeEach(() => {
      // The local CoBridge server answers, so the panel reads the IDE as online.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
      // The panel probes the server only while it is on screen; here it always is.
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(private readonly notify: (entries: { isIntersecting: boolean }[]) => void) {}
          observe() {
            this.notify([{ isIntersecting: true }]);
          }
          disconnect() {}
        },
      );
    });

    it('turns on with its own switch and shows the stored port in its options', async () => {
      sync[StorageKeys.CONTEXT_SYNC_PORT] = 4000;
      await mount();
      expect(options(id)).toBeNull();
      await act(async () => toggle(id).click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.CONTEXT_SYNC_ENABLED]: true,
      });
      expect(port()!.value).toBe('4000');
    });

    it('saves a typed port to its old key', async () => {
      sync[StorageKeys.CONTEXT_SYNC_ENABLED] = true;
      await mount();
      expect(port()!.value).toBe('3030');
      await act(async () => drag(port()!, 5000));
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.CONTEXT_SYNC_PORT]: 5000,
      });
      expect(port()!.value).toBe('5000');
    });

    it('turned off elsewhere, it takes its Sync button away at once', async () => {
      sync[StorageKeys.CONTEXT_SYNC_ENABLED] = true;
      await mount();
      expect(syncButton()!.disabled).toBe(false);
      await act(async () => emitSyncChange({ [StorageKeys.CONTEXT_SYNC_ENABLED]: false }));
      expect(toggle(id).checked).toBe(false);
      expect(syncButton()).toBeUndefined();
    });

    const deferSync = () => {
      const pending = { answer: (_response: unknown) => {} };
      extensionApi.tabs.sendMessage.mockImplementation((_tabId: number, message: unknown) =>
        isSyncRequest(message)
          ? new Promise((resolve) => (pending.answer = resolve))
          : Promise.resolve(),
      );
      return pending;
    };
    const syncRequests = () =>
      extensionApi.tabs.sendMessage.mock.calls.filter(([, message]) => isSyncRequest(message));
    const typeSearch = async (query: string) => {
      const box = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, query);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    it('a search that hides its card mid-sync does not allow a second sync', async () => {
      sync[StorageKeys.CONTEXT_SYNC_ENABLED] = true;
      const pending = deferSync();
      await mount();
      await act(async () => syncButton()!.click());
      await typeSearch(en.pinTimelinePreview);
      expect(row(id)).toBeNull();
      await typeSearch('');
      await act(async () => {});
      expect(syncButton()!.disabled).toBe(true);
      await act(async () => syncButton()!.click());
      expect(syncRequests()).toHaveLength(1);
      await act(async () => pending.answer({ status: 'success' }));
      expect(row(id)!.textContent).toContain(en.syncedSuccess);
    });

    it('a success that lands while a search hides it waits to be seen, then fades', async () => {
      sync[StorageKeys.CONTEXT_SYNC_ENABLED] = true;
      const pending = deferSync();
      await mount();
      await act(async () => syncButton()!.click());
      await typeSearch(en.pinTimelinePreview);
      expect(row(id)).toBeNull();
      vi.useFakeTimers();
      try {
        await act(async () => pending.answer({ status: 'success' }));
        await act(async () => vi.advanceTimersByTime(10_000));
        await typeSearch('');
        expect(row(id)!.textContent).toContain(en.syncedSuccess);
        await act(async () => vi.advanceTimersByTime(3_000));
        expect(row(id)!.textContent).not.toContain(en.syncedSuccess);
      } finally {
        vi.useRealTimers();
      }
    });

    it('asks the Gemini tab to send its context', async () => {
      sync[StorageKeys.CONTEXT_SYNC_ENABLED] = true;
      extensionApi.tabs.sendMessage.mockResolvedValue({ status: 'success' });
      await mount();
      await act(async () => syncButton()!.click());
      expect(extensionApi.tabs.sendMessage).toHaveBeenCalledWith(GEMINI_TAB.id, {
        action: 'sync_to_ide',
      });
      expect(row(id)!.textContent).toContain(en.syncedSuccess);
    });
  });
});
