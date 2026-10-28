import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations, type Translation } from '@/utils/translations';

import Popup from '../../Popup';
import { extensionApi, popupRows, resetPopupBrowser } from './popupHarness';

// Keep Popup, its hooks and the packaged manifests real; replace only browser APIs.
vi.mock('webextension-polyfill', async () => ({
  default: (await import('./popupHarness')).extensionApi,
}));

const CLAUDE = 'https://claude.ai/';
const CHATGPT = 'https://chatgpt.com/c/abc';

/** Plugin sites: each feature has one place, a row of the site's plugin card. */
describe.each(['en', 'ar'] as const)('the plugin card on a plugin site (%s)', (language) => {
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;
  let text: Translation;
  const rtl = language === 'ar' ? 'rtl' : null;

  beforeEach(async () => {
    text = await loadTranslations(language);
    ({ local, sync } = resetPopupBrowser());
    sync[StorageKeys.LANGUAGE] = language;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const mount = async (url: string) => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 9, url }]);
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
  /** The card a node sits in, named by its title. */
  const cardTitle = (node: Element) => {
    let element: Element | null = node.parentElement;
    while (element && !element.querySelector(':scope > div h3, :scope > h3')) {
      element = element.parentElement;
    }
    return element?.querySelector('h3')?.textContent;
  };

  describe('visual effects', () => {
    const id = OFFICIAL_PLUGIN_IDS.visualEffects;
    // Prompt Manager on this site is one of the two ways Voyager's page script reaches it.
    const activate = () => {
      sync[StorageKeys.PROMPT_CUSTOM_WEBSITES] = ['claude.ai'];
      extensionApi.permissions.contains.mockResolvedValue(true);
    };

    it.each([
      ['missing', {}, false],
      ['off', { [StorageKeys.GV_VISUAL_EFFECT]: 'off' }, false],
      ['legacy snow', { [StorageKeys.GV_SNOW_EFFECT]: true }, true],
      ['rain', { [StorageKeys.GV_VISUAL_EFFECT]: 'rain' }, true],
    ] as const)('shows a %s stored effect the way the page reads it', async (_l, stored, on) => {
      activate();
      Object.assign(sync, stored);
      await mount(CLAUDE);
      expect(toggle(id).checked).toBe(on);
      expect(row(id)!.querySelectorAll('button[aria-pressed]')).toHaveLength(on ? 3 : 0);
    });

    it('is a row of the site’s plugin card, and the old card is gone', async () => {
      activate();
      await mount(CLAUDE);
      expect(cardTitle(row(id)!)).toBe(text.pluginsTitle);
      expect(row(id)!.closest('ul')!.getAttribute('dir')).toBe(rtl);
      expect(container.textContent).not.toContain(text.visualEffectHint);
      expect(container.querySelectorAll(`[data-official-plugin="${id}"]`)).toHaveLength(1);
    });

    it('its switch writes the effect pair, and a pick writes it again', async () => {
      activate();
      await mount(CLAUDE);
      await act(async () => toggle(id).click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_VISUAL_EFFECT]: 'snow',
        [StorageKeys.GV_SNOW_EFFECT]: false,
      });
      const sakura = [...row(id)!.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === text.visualEffectSakura,
      )!;
      await act(async () => sakura.click());
      expect(extensionApi.storage.sync.set).toHaveBeenLastCalledWith({
        [StorageKeys.GV_VISUAL_EFFECT]: 'sakura',
        [StorageKeys.GV_SNOW_EFFECT]: false,
      });
      expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    });

    it('is left out until Voyager can run on the site', async () => {
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'rain';
      await mount(CLAUDE);
      expect(row(id)).toBeNull();
      expect(container.querySelector('button[aria-pressed]')).toBeNull();
    });

    it('appears once a default-on plugin gets the site’s access, without reopening', async () => {
      // ChatGPT folders is on by default, but runs only after its host access is granted.
      await mount(CHATGPT);
      expect(row(id)).toBeNull();
      extensionApi.permissions.contains.mockResolvedValue(true);
      const [onGranted] = extensionApi.permissions.onAdded.addListener.mock.calls.at(-1)!;
      await act(async () => (onGranted as () => void)());
      expect(toggle(id)).toBeTruthy();
    });

    it('a granted page shows it even when a plugin’s companion frame origin is not granted', async () => {
      // Claude reading width also asks for its artifact frame's origin; the page script needs
      // only claude.ai, which is what the background registers.
      local[StorageKeys.PLUGINS_STATE] = {
        'voyager.claude-reading-width': { enabled: true, installedAt: 1 },
      };
      extensionApi.permissions.contains.mockImplementation(async ({ origins }) =>
        origins.every((origin: string) => origin === 'https://claude.ai/*'),
      );
      await mount(CLAUDE);
      expect(toggle(id)).toBeTruthy();
    });

    it('a page Voyager cannot run on still lists the shared choice', async () => {
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'sakura';
      await mount('chrome://newtab/');
      expect(toggle(id).checked).toBe(true);
      expect(
        row(id)!.closest('ul')!.parentElement!.closest('[dir]')?.getAttribute('dir') ?? null,
      ).toBe(rtl);
      await act(async () => toggle(id).click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_VISUAL_EFFECT]: 'off',
        [StorageKeys.GV_SNOW_EFFECT]: false,
      });
    });
  });

  describe('the timeline rail', () => {
    const optionsButton = () =>
      container.querySelector<HTMLButtonElement>('button[aria-expanded][aria-controls]');
    const timesSwitch = () => container.querySelector<HTMLInputElement>('#show-message-timestamps');

    it('keeps its options under its plugin row, behind Options, with no timeline card', async () => {
      local[StorageKeys.PLUGINS_STATE] = {
        'voyager.claude-timeline': { enabled: true, installedAt: 1 },
      };
      await mount(CLAUDE);
      expect(container.textContent).not.toContain(text.timelineOptions);
      expect(container.querySelector('#timeline-enabled')).toBeNull();
      const button = optionsButton()!;
      expect(button.textContent).toBe(text.pluginRowOptions);
      expect(cardTitle(button)).toBe(text.pluginsTitle);
      expect(button.closest('[dir]')?.getAttribute('dir') ?? null).toBe(rtl);
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector('#hide-container')).toBeNull();

      await act(async () => button.click());
      const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
      const labels = [...panel.querySelectorAll('button')].map((entry) => entry.textContent);
      expect(labels).toContain(text.resetTimelinePosition);
      expect(labels).toContain(text.viewStarredHistory);
    });

    it('while the rail is off, its Options still open the Saved Library and message times', async () => {
      await mount(CHATGPT);
      await act(async () => optionsButton()!.click());
      const shownButton = (label: string) =>
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent === label && !button.closest('[hidden]'),
        );
      // The rail's own controls keep their values but wait for the rail.
      expect(shownButton(text.timelineStyleCompact)!.disabled).toBe(true);
      expect(shownButton(text.resetTimelinePosition)!.disabled).toBe(true);
      expect(timesSwitch()!.disabled).toBe(false);
      await act(async () => timesSwitch()!.click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: true,
      });
      expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
      await act(async () => shownButton(text.viewStarredHistory)!.click());
      expect(container.textContent).not.toContain(text.pluginsTitle);
    });

    it.each([
      ['missing', undefined, false],
      ['false', false, false],
      ['true', true, true],
    ] as const)(
      'on ChatGPT, shows a %s message-times switch in the rail options and writes only its key',
      async (_label, stored, on) => {
        if (stored !== undefined) sync[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS] = stored;
        local[StorageKeys.PLUGINS_STATE] = {
          'voyager.chatgpt-timeline': { enabled: true, installedAt: 1 },
        };
        await mount(CHATGPT);
        await act(async () => optionsButton()!.click());
        expect(timesSwitch()!.checked).toBe(on);
        await act(async () => timesSwitch()!.click());
        expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
          [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: !on,
        });
        expect(timesSwitch()!.checked).toBe(!on);
      },
    );
  });
});
