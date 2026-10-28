import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import { UNDO_TOAST_MS } from '../../hooks/useUndoToast';
import {
  AI_STUDIO,
  emitSyncChange,
  extensionApi,
  popupRows,
  resetPopupBrowser,
} from './popupHarness';

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

const en = await loadTranslations('en');

/** The topic cards, the table of contents above them, and the undo offer after a flip. */
describe('the official plugin topic cards', () => {
  let container: HTMLDivElement;
  let root: Root;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;
  const scrolled: { element: Element; options: ScrollIntoViewOptions | undefined }[] = [];
  const nativeScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    ({ local, sync } = resetPopupBrowser());
    scrolled.length = 0;
    // jsdom has no layout; record what the table of contents asks to bring into view.
    Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
      scrolled.push({ element: this, options: options as ScrollIntoViewOptions });
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Element.prototype.scrollIntoView = nativeScrollIntoView;
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
  const topics = () =>
    [...container.querySelectorAll<HTMLElement>('[data-plugin-topic]')].map(
      (card) => card.dataset.pluginTopic,
    );
  const toc = () => container.querySelector<HTMLElement>(`nav[aria-label="${en.popupTocLabel}"]`);
  const tocLinks = () =>
    [...(toc()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map(
      (link) => link.textContent,
    );
  const toast = () => container.querySelector<HTMLElement>('[role="status"]:has(button)');
  const typeSearch = async (query: string) => {
    const box = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, query);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const rowName = (id: string) => row(id)!.querySelector('label')!.textContent!;

  describe('the table of contents', () => {
    it('names the cards on screen in their order, Cloud Sync first', async () => {
      await mount();
      expect(tocLinks()).toEqual([
        en.cloudSync,
        en.localPluginsTitle,
        en.pluginTopicLayoutShort,
        en.pluginTopicSidebarShort,
        en.pluginTopicTimelineShort,
        en.pluginTopicContentShort,
        en.pluginTopicChartsShort,
        en.pluginTopicExportShort,
        en.pluginTopicInputShort,
        en.pluginTopicConversationsShort,
        en.folder_title,
        en.popupTocShortcuts,
        en.popupTocPrompts,
        en.popupTocGeneral,
      ]);
    });

    it('scrolls the chosen card into view below the header, smoothly unless motion is reduced', async () => {
      await mount();
      const link = (label: string) =>
        [...toc()!.querySelectorAll('button')].find((button) => button.textContent === label)!;
      await act(async () => link(en.pluginTopicChartsShort).click());
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0].element.contains(row(OFFICIAL_PLUGIN_IDS.geminiMermaid))).toBe(true);
      expect(scrolled[0].options).toEqual({ block: 'start', behavior: 'smooth' });
      // Keyboard users land on the card, not back in the header.
      expect(document.activeElement?.textContent).toBe(en.pluginTopicCharts);
      expect(scrolled[0].element.contains(document.activeElement)).toBe(true);

      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({ matches: query.includes('reduce') })),
      );
      await act(async () => link(en.cloudSync).click());
      expect(scrolled[1].element.textContent).toContain(en.cloudSyncDescription);
      expect(scrolled[1].options).toEqual({ block: 'start', behavior: 'auto' });
    });

    it('leaves out the cards a site does not show', async () => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
      await mount();
      expect(tocLinks()).toEqual([
        en.cloudSync,
        en.localPluginsTitle,
        en.pluginTopicLayoutShort,
        en.pluginTopicSidebarShort,
        en.pluginTopicContentShort,
        en.pluginTopicInputShort,
        en.pluginTopicConversationsShort,
        en.folder_title,
        en.popupTocPrompts,
        en.popupTocGeneral,
      ]);
    });

    it('steps aside while searching', async () => {
      await mount();
      await typeSearch('mermaid');
      expect(toc()).toBeNull();
      await typeSearch('');
      expect(toc()).not.toBeNull();
    });

    it('mirrors for Arabic', async () => {
      sync[StorageKeys.LANGUAGE] = 'ar';
      await mount();
      expect(container.querySelector('nav')!.getAttribute('dir')).toBe('rtl');
    });
  });

  describe('searching', () => {
    it('keeps only the cards with a matching row, and only those rows', async () => {
      local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = 'mermaid';
      await mount();
      expect(topics()).toEqual(['pluginsCharts']);
      expect(popupRows(container).listedIds()).toEqual([OFFICIAL_PLUGIN_IDS.geminiMermaid]);
    });

    it('lists a whole card when its title matches', async () => {
      local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = en.pluginTopicCharts;
      await mount();
      expect(topics()).toContain('pluginsCharts');
      const charts = container.querySelector('[data-plugin-topic="pluginsCharts"]')!;
      expect(charts.querySelectorAll('[data-official-plugin]')).toHaveLength(3);
    });

    it('still lists every card for the old Plugins card title', async () => {
      local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = en.pluginsTitle;
      await mount();
      expect(topics()).toHaveLength(8);
    });
  });

  describe('the undo offer', () => {
    const undoButton = () =>
      [...(toast()?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === en.pluginToggleUndo,
      );
    const pressUndo = async () => {
      await act(async () => undoButton()!.click());
    };

    it('puts back a stored value through the same write', async () => {
      const id = OFFICIAL_PLUGIN_IDS.geminiMermaid;
      sync[StorageKeys.MERMAID_ENABLED] = true;
      await mount();
      await act(async () => toggle(id).click());
      expect(toast()!.textContent).toContain(
        en.pluginToggleToastOff.replace('{name}', rowName(id)),
      );
      await pressUndo();
      expect(extensionApi.storage.sync.set.mock.calls.map(([payload]) => payload)).toEqual([
        { [StorageKeys.MERMAID_ENABLED]: false },
        { [StorageKeys.MERMAID_ENABLED]: true },
      ]);
      expect(toggle(id).checked).toBe(true);
      expect(toast()).toBeNull();
    });

    it('leaves a key that was never stored unstored again', async () => {
      const id = OFFICIAL_PLUGIN_IDS.geminiMermaid;
      await mount();
      await act(async () => toggle(id).click());
      expect(sync[StorageKeys.MERMAID_ENABLED]).toBe(false);
      await pressUndo();
      expect(Object.hasOwn(sync, StorageKeys.MERMAID_ENABLED)).toBe(false);
      expect(toggle(id).checked).toBe(true);
    });

    it('puts back the chosen effect, not the default one', async () => {
      const id = OFFICIAL_PLUGIN_IDS.visualEffects;
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'rain';
      await mount();
      await act(async () => toggle(id).click());
      expect(sync[StorageKeys.GV_VISUAL_EFFECT]).toBe('off');
      await pressUndo();
      expect(sync[StorageKeys.GV_VISUAL_EFFECT]).toBe('rain');
      // The legacy snow flag the switch cleared was never stored, so it is gone again.
      expect(Object.hasOwn(sync, StorageKeys.GV_SNOW_EFFECT)).toBe(false);
    });

    it('puts back an effect that only the old snow flag held', async () => {
      sync[StorageKeys.GV_SNOW_EFFECT] = true;
      await mount();
      expect(toggle(OFFICIAL_PLUGIN_IDS.visualEffects).checked).toBe(true);
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.visualEffects).click());
      await pressUndo();
      expect(sync).toEqual({ [StorageKeys.GV_SNOW_EFFECT]: true });
      expect(toggle(OFFICIAL_PLUGIN_IDS.visualEffects).checked).toBe(true);
    });

    it('puts back watermark switches that only the legacy key held', async () => {
      sync[StorageKeys.WATERMARK_REMOVER_ENABLED] = true;
      await mount();
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload).click());
      expect(sync[StorageKeys.WATERMARK_REMOVER_ENABLED]).toBeNull();
      await pressUndo();
      expect(sync).toEqual({ [StorageKeys.WATERMARK_REMOVER_ENABLED]: true });
      expect(toggle(OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload).checked).toBe(true);
      expect(toggle(OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview).checked).toBe(true);
    });

    it('is withdrawn once an option under the row changes what the flip wrote', async () => {
      sync[StorageKeys.GV_VISUAL_EFFECT] = 'off';
      await mount();
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.visualEffects).click());
      expect(undoButton()).toBeDefined();
      const rain = [
        ...row(OFFICIAL_PLUGIN_IDS.visualEffects)!.querySelectorAll<HTMLButtonElement>('button'),
      ].find((button) => button.textContent?.includes(en.visualEffectRain))!;
      await act(async () => rain.click());
      expect(toast()).toBeNull();
      expect(sync[StorageKeys.GV_VISUAL_EFFECT]).toBe('rain');
    });

    it('is withdrawn when the same key changes elsewhere', async () => {
      const id = OFFICIAL_PLUGIN_IDS.geminiECharts;
      sync[StorageKeys.ECHARTS_ENABLED] = true;
      await mount();
      await act(async () => toggle(id).click());
      expect(undoButton()).toBeDefined();
      await act(async () => emitSyncChange({ [StorageKeys.ECHARTS_ENABLED]: true }));
      expect(toast()).toBeNull();
    });

    it('closes by itself after a few seconds, without writing', async () => {
      await mount();
      vi.useFakeTimers();
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiECharts).click());
      expect(toast()).not.toBeNull();
      await act(async () => vi.advanceTimersByTime(UNDO_TOAST_MS - 1));
      expect(toast()).not.toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(toast()).toBeNull();
      expect(extensionApi.storage.sync.set).toHaveBeenCalledTimes(1);
    });

    it('stays while focus is inside, even after the pointer leaves, and hands focus back', async () => {
      const id = OFFICIAL_PLUGIN_IDS.geminiECharts;
      await mount();
      vi.useFakeTimers();
      await act(async () => toggle(id).click());
      const card = undoButton()!.parentElement!;
      await act(async () => undoButton()!.focus());
      await act(async () => {
        card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTime(UNDO_TOAST_MS * 3));
      expect(undoButton()).toBeDefined();
      await pressUndo();
      expect(document.activeElement).toBe(toggle(id));
    });

    it('is not offered for an option under a row', async () => {
      await mount();
      const notion = [
        ...row(OFFICIAL_PLUGIN_IDS.geminiFormulaCopy)!.querySelectorAll<HTMLInputElement>(
          'input[type="radio"]',
        ),
      ].find((input) => input.closest('label')!.textContent === en.formulaCopyFormatNotion)!;
      await act(async () => notion.click());
      expect(sync[StorageKeys.FORMULA_COPY_FORMAT]).toBe('notion');
      expect(toast()).toBeNull();
    });
  });

  describe('the context sync options', () => {
    it('probe the local server only once they are on screen', async () => {
      sync[StorageKeys.CONTEXT_SYNC_ENABLED] = true;
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetch);
      const observers: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
            observers.push(callback);
          }
          observe() {}
          disconnect() {}
        },
      );
      await mount();
      expect(row(OFFICIAL_PLUGIN_IDS.geminiContextSync)!.textContent).toContain(en.syncServerPort);
      expect(fetch).not.toHaveBeenCalled();
      await act(async () => observers.forEach((notify) => notify([{ isIntersecting: true }])));
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
