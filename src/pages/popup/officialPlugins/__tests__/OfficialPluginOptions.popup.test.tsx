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
  browserTarget,
  emitSyncChange,
  extensionApi,
  popupRows,
  resetPopupBrowser,
} from './popupHarness';

const en = await loadTranslations('en');
const zh = await loadTranslations('zh');

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

/** Rows whose controls go beyond a switch: option panels, a permission flow, sliders. */
describe('official plugin rows with options', () => {
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

  describe('rows with options', () => {
    it.each([
      ['missing', undefined, true],
      ['false', false, false],
      ['true', true, true],
    ] as const)(
      'shows a %s stored highlight marker switch as the highlight runtime reads it',
      async (_label, stored, expected) => {
        sync[StorageKeys.HIGHLIGHT_ENABLED] = true;
        if (stored !== undefined) sync[StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED] = stored;
        await mount();
        const markers = row(OFFICIAL_PLUGIN_IDS.geminiHighlight)!.querySelector<HTMLInputElement>(
          `input[aria-label="${en.showHighlightTimelineMarkers}"]`,
        )!;
        expect(markers.checked).toBe(expected);
        await act(async () => markers.click());
        expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
          [StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED]: !expected,
        });
      },
    );
  });

  describe('the completion notification row', () => {
    const id = OFFICIAL_PLUGIN_IDS.geminiResponseNotification;

    it('asks for permission from the click instead of writing the switch', async () => {
      await mount();
      expect(toggle(id).checked).toBe(false);
      extensionApi.runtime.sendMessage.mockClear();
      act(() => toggle(id).click());
      // Chrome may close the popup for its prompt: the intent goes out before any await.
      expect(extensionApi.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ action: 'begin' }) }),
      );
      expect(toggle(id).checked).toBe(true);
      await act(async () => {});
      expect(
        extensionApi.storage.sync.set.mock.calls.some(([payload]) =>
          Object.hasOwn(payload as object, StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED),
        ),
      ).toBe(false);
    });

    it('says on Safari that the macOS app sends the notification, while it is on', async () => {
      browserTarget.safari = true;
      sync[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED] = true;
      await mount();
      expect(toggle(id).checked).toBe(true);
      expect(row(id)!.textContent).toContain(en.responseCompleteNotificationHintSafari);
    });

    it('gives no Safari hint in other browsers', async () => {
      sync[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED] = true;
      await mount();
      expect(row(id)!.textContent).not.toContain(en.responseCompleteNotificationHintSafari);
    });
  });

  describe("AI Studio's sidebar width row", () => {
    const id = OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth;
    const width = () => row(id)!.querySelector<HTMLInputElement>('input[type="range"]');
    const onAIStudio = () => extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);

    it.each([
      ['missing, folders missing', {}, true],
      ['missing, folders on', { [StorageKeys.FOLDER_ENABLED]: true }, true],
      ['missing, folders off', { [StorageKeys.FOLDER_ENABLED]: false }, false],
      [
        'false, folders on',
        { [StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]: false, [StorageKeys.FOLDER_ENABLED]: true },
        false,
      ],
      [
        'true, folders off',
        { [StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]: true, [StorageKeys.FOLDER_ENABLED]: false },
        true,
      ],
    ] as const)(
      'shows a switch stored %s the way the page reads it',
      async (_label, stored, on) => {
        onAIStudio();
        Object.assign(sync, stored);
        await mount();
        expect(toggle(id).checked).toBe(on);
        expect(width() !== null).toBe(on);
      },
    );

    it('while its switch is unstored, follows the folders switch live', async () => {
      onAIStudio();
      await mount();
      expect(toggle(id).checked).toBe(true);
      await act(async () => emitSyncChange({ [StorageKeys.FOLDER_ENABLED]: false }));
      expect(toggle(id).checked).toBe(false);
    });

    it('its first switch write stores only its own key', async () => {
      onAIStudio();
      await mount();
      await act(async () => toggle(id).click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED]: false,
      });
      expect(sync[StorageKeys.FOLDER_ENABLED]).toBeUndefined();
      expect(pluginStateWritten()).toBe(false);
    });

    it('keeps the old 240-600 px range and saves only the width on release', async () => {
      onAIStudio();
      await mount();
      expect([width()!.min, width()!.max, width()!.value]).toEqual(['240', '600', '280']);
      drag(width()!, 400);
      expect(extensionApi.storage.sync.set).not.toHaveBeenCalled();
      await act(async () => width()!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      // The unstored switch still follows the folders, so the width alone is written.
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.AISTUDIO_SIDEBAR_WIDTH]: 400,
      });
    });

    it('is not a Gemini row', async () => {
      await mount();
      expect(row(id)).toBeNull();
    });
  });

  describe('in other languages', () => {
    it('names the rows and their options from the Chinese manifests and messages', async () => {
      sync[StorageKeys.LANGUAGE] = 'zh';
      await mount();
      const label = (pluginId: string) => row(pluginId)!.querySelector('label')!.textContent;
      expect(label(OFFICIAL_PLUGIN_IDS.geminiTimeline)).toBe('显示时间线');
      expect(label(OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps)).toBe('消息时间戳');
      expect(options(OFFICIAL_PLUGIN_IDS.geminiTimeline)!.getAttribute('aria-label')).toBe(
        zh.pluginRowOptionsFor.replace('{name}', '显示时间线'),
      );
    });

    it('mirrors the topic cards for Arabic, on Gemini and AI Studio', async () => {
      sync[StorageKeys.LANGUAGE] = 'ar';
      await mount();
      const card = () => row(OFFICIAL_PLUGIN_IDS.geminiTimeline)!.closest('[dir]');
      expect(card()!.getAttribute('dir')).toBe('rtl');
      await act(async () => root.unmount());
      root = createRoot(container);
      extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
      await mount();
      expect(
        row(OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth)!.closest('[dir]')!.getAttribute('dir'),
      ).toBe('rtl');
    });
  });
});
