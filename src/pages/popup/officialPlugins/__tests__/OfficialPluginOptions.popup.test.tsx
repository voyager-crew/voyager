import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadAllTranslations, loadTranslations } from '@/utils/translations';

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
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

  beforeEach(() => {
    ({ local, sync } = resetPopupBrowser());
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
    const radio = (id: string, label: string) =>
      [...row(id)!.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
        (input) => input.closest('label')!.textContent === label,
      )!;

    it('shows options under the row only while it is on, with no Options button', async () => {
      const id = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
      sync[StorageKeys.FORMULA_COPY_ENABLED] = false;
      await mount();
      expect(options(id)).toBeNull();
      expect(row(id)!.querySelector('input[type="radio"]')).toBeNull();
      await act(async () => toggle(id).click());
      expect(options(id)!.getAttribute('aria-label')).toBe(
        en.pluginRowOptionsFor.replace('{name}', 'Formula Copy'),
      );
      expect(options(id)!.textContent).toContain(en.formulaCopyScopeNote);
      expect(row(id)!.querySelectorAll('input[type="radio"]')).toHaveLength(4);
      expect(row(id)!.querySelector('button[aria-expanded]')).toBeNull();
      await act(async () => toggle(id).click());
      expect(options(id)).toBeNull();
      expect(row(id)!.querySelector('input[type="radio"]')).toBeNull();
    });

    it('shows the stored formula format and writes only the format key', async () => {
      sync[StorageKeys.FORMULA_COPY_FORMAT] = 'unicodemath';
      await mount();
      const id = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
      expect(radio(id, en.formulaCopyFormatUnicodeMath).checked).toBe(true);
      await act(async () => radio(id, en.formulaCopyFormatNotion).click());
      expect(radio(id, en.formulaCopyFormatNotion).checked).toBe(true);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.FORMULA_COPY_FORMAT]: 'notion',
      });
      expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    });

    it('a format stored elsewhere while the popup is open shows at once', async () => {
      await mount();
      const id = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
      expect(radio(id, en.formulaCopyFormatLatex).checked).toBe(true);
      await act(async () => emitSyncChange({ [StorageKeys.FORMULA_COPY_FORMAT]: 'no-dollar' }));
      expect(radio(id, en.formulaCopyFormatNoDollar).checked).toBe(true);
    });

    it('on AI Studio, the formula row edits the same shared switch and format', async () => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
      await mount();
      const id = OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy;
      expect(toggle(id).checked).toBe(true);
      await act(async () => radio(id, en.formulaCopyFormatNotion).click());
      await act(async () => toggle(id).click());
      expect(extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload)).toEqual([
        { [StorageKeys.FORMULA_COPY_FORMAT]: 'notion' },
        { [StorageKeys.FORMULA_COPY_ENABLED]: false },
      ]);
    });

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

    it('a search that lists a row with options shows them', async () => {
      local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = en.formulaCopyFormatNotion;
      await mount();
      await act(async () => loadAllTranslations());
      expect(
        radio(OFFICIAL_PLUGIN_IDS.geminiFormulaCopy, en.formulaCopyFormatNotion),
      ).toBeDefined();
    });
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

  describe('the timeline row', () => {
    const id = OFFICIAL_PLUGIN_IDS.geminiTimeline;
    const radios = (group: string) =>
      [
        ...row(id)!.querySelectorAll<HTMLButtonElement>(
          `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
        ),
      ].map((radio) => [radio.textContent, radio.getAttribute('aria-checked'), radio.disabled]);
    const radio = (group: string, label: string) =>
      row(id)!.querySelector<HTMLButtonElement>(
        `[role="radiogroup"][aria-label="${group}"] [role="radio"]:nth-child(${
          [en.timelineStyleDots, en.timelineStyleRuler, en.timelineStyleCompact].indexOf(label) + 1
        })`,
      )!;
    const option = (inputId: string) => row(id)!.querySelector<HTMLInputElement>(`#${inputId}`)!;
    const button = (label: string) =>
      [...row(id)!.querySelectorAll('button')].find((candidate) => candidate.textContent === label);

    it('replaces the Gemini timeline card, its options under the row', async () => {
      await mount();
      expect(container.querySelector('#timeline-enabled')).toBeNull();
      expect(
        [...container.querySelectorAll('h3')].map((heading) => heading.textContent),
      ).not.toContain(en.timelineOptions);
      expect(toggle(id).checked).toBe(true);
      expect(option('draggable-timeline')).not.toBeNull();
      // Message times are a row of their own, so the panel does not repeat them.
      expect(row(id)!.querySelector('#show-message-timestamps')).toBeNull();
    });

    it('shows the stored style and scroll mode as checked radios', async () => {
      sync[StorageKeys.TIMELINE_STYLE] = 'compact';
      sync.geminiTimelineScrollMode = 'jump';
      await mount();
      expect(radios(en.timelineStyle)).toEqual([
        [en.timelineStyleDots, 'false', false],
        [en.timelineStyleRuler, 'false', false],
        [en.timelineStyleCompact, 'true', false],
      ]);
      expect(radios(en.scrollMode)).toEqual([
        [en.flow, 'false', false],
        [en.jump, 'true', false],
      ]);
      // Off dots there is no container to hide.
      expect(option('hide-container').disabled).toBe(true);
    });

    it('writes each option under its old key', async () => {
      await mount();
      await act(async () => radio(en.timelineStyle, en.timelineStyleRuler).click());
      await act(async () => option('draggable-timeline').click());
      expect(extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload)).toEqual([
        { [StorageKeys.TIMELINE_STYLE]: 'ruler' },
        { geminiTimelineDraggable: true },
      ]);
      expect(pluginStateWritten()).toBe(false);
    });

    it('node levels allow only dots, and turning them on writes dots with them', async () => {
      sync[StorageKeys.TIMELINE_STYLE] = 'ruler';
      await mount();
      await act(async () => option('marker-level-enabled').click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        geminiTimelineMarkerLevel: true,
        [StorageKeys.TIMELINE_STYLE]: 'dots',
      });
      expect(radios(en.timelineStyle).map(([, checked, disabled]) => [checked, disabled])).toEqual([
        ['true', false],
        ['false', true],
        ['false', true],
      ]);
    });

    it('resets only the saved position and opens the Saved Library', async () => {
      await mount();
      await act(async () => button(en.resetTimelinePosition)!.click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        geminiTimelinePosition: null,
      });
      await act(async () => button(en.viewStarredHistory)!.click());
      expect(row(id)).toBeNull();
    });

    it.each(['ruler', '收藏', zh.timelineOptions])(
      'a search for "%s" lists the row with its options',
      async (query) => {
        local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = query;
        await mount();
        expect(option('draggable-timeline')).not.toBeNull();
      },
    );
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
