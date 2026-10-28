import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadAllTranslations, loadTranslations } from '@/utils/translations';

import Popup from '../../Popup';
import {
  MOVED_SWITCHES,
  RETIRED_LAYOUT_LABELS,
  RETIRED_SWITCH_IDS,
} from './officialPluginListSwitches';
import {
  AI_STUDIO,
  browserTarget,
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

describe('the official plugin list in the popup', () => {
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
  const listedIds = () => popupRows(container).listedIds();

  it('lists every moved switch once, in eight topic cards, and no old card repeats one', async () => {
    await mount();
    const cards = [...container.querySelectorAll<HTMLElement>('[data-plugin-topic]')].map(
      (card) => ({
        title: card.querySelector('h3')!.textContent,
        rows: [...card.querySelectorAll<HTMLElement>('[data-official-plugin]')].map(
          (element) => element.dataset.officialPlugin,
        ),
      }),
    );
    expect(cards).toEqual([
      {
        title: en.pluginTopicLayout,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiChatWidth,
          OFFICIAL_PLUGIN_IDS.geminiChatFontSize,
          OFFICIAL_PLUGIN_IDS.geminiChatLineHeight,
          OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
          OFFICIAL_PLUGIN_IDS.geminiHideInputHalo,
          OFFICIAL_PLUGIN_IDS.visualEffects,
        ],
      },
      {
        title: en.pluginTopicSidebar,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
          OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide,
          OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide,
          OFFICIAL_PLUGIN_IDS.geminiGemsSidebar,
        ],
      },
      {
        title: en.pluginTopicTimeline,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiTimeline,
          OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps,
          OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll,
          OFFICIAL_PLUGIN_IDS.geminiHighlight,
        ],
      },
      {
        title: en.pluginTopicContent,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiCodeCollapse,
          OFFICIAL_PLUGIN_IDS.geminiUserLatex,
          OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
          OFFICIAL_PLUGIN_IDS.geminiMarkdownFix,
        ],
      },
      {
        title: en.pluginTopicCharts,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiMermaid,
          OFFICIAL_PLUGIN_IDS.geminiWaveDrom,
          OFFICIAL_PLUGIN_IDS.geminiECharts,
        ],
      },
      {
        title: en.pluginTopicExport,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiExport,
          OFFICIAL_PLUGIN_IDS.geminiCanvasCopy,
          OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport,
          OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload,
          OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview,
        ],
      },
      {
        title: en.pluginTopicInput,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend,
          OFFICIAL_PLUGIN_IDS.geminiVimInput,
          OFFICIAL_PLUGIN_IDS.geminiInputCollapse,
          OFFICIAL_PLUGIN_IDS.geminiPromptHistory,
          OFFICIAL_PLUGIN_IDS.geminiDraftSave,
          OFFICIAL_PLUGIN_IDS.geminiQuoteReply,
        ],
      },
      {
        title: en.pluginTopicConversations,
        rows: [
          OFFICIAL_PLUGIN_IDS.geminiFork,
          OFFICIAL_PLUGIN_IDS.geminiBatchDelete,
          OFFICIAL_PLUGIN_IDS.geminiDefaultModel,
          OFFICIAL_PLUGIN_IDS.geminiResearchPack,
          OFFICIAL_PLUGIN_IDS.geminiUsageStatus,
          OFFICIAL_PLUGIN_IDS.geminiResponseNotification,
          OFFICIAL_PLUGIN_IDS.geminiContextSync,
          OFFICIAL_PLUGIN_IDS.geminiSiteCheck,
        ],
      },
    ]);
    // The single Plugins card is gone: no card is titled Plugins any more.
    expect(
      [...container.querySelectorAll('h3')].map((heading) => heading.textContent),
    ).not.toContain(en.pluginsTitle);
    // The old Context Sync card is gone, and nothing offers a sync while its row is off.
    expect(
      [...container.querySelectorAll('h3')].map((heading) => heading.textContent),
    ).not.toContain(en.contextSync);
    expect(container.textContent).not.toContain(en.syncToIDE);
    expect(new Set(listedIds()).size).toBe(listedIds().length);
    for (const id of RETIRED_SWITCH_IDS) expect(container.querySelector(`#${id}`)).toBeNull();
    for (const label of RETIRED_LAYOUT_LABELS) {
      expect(container.querySelector(`input[aria-label="${label}"]`), label).toBeNull();
    }
    // The manifest name, without its site prefix, labels the switch.
    const mermaidLabel = row(OFFICIAL_PLUGIN_IDS.geminiMermaid)!.querySelector('label')!;
    expect(mermaidLabel.textContent).not.toMatch(/^Gemini/);
    expect(mermaidLabel.htmlFor).toBe(toggle(OFFICIAL_PLUGIN_IDS.geminiMermaid).id);
    expect(toggle(OFFICIAL_PLUGIN_IDS.geminiMermaid).getAttribute('aria-describedby')).toBeTruthy();
  });

  it.each([
    ['missing', undefined],
    ['false', false],
    ['true', true],
  ] as const)('shows a %s stored switch the way the page reads it', async (_label, stored) => {
    for (const { key } of MOVED_SWITCHES) {
      if (stored === undefined) delete sync[key];
      else sync[key] = stored;
    }
    await mount();
    const shown = Object.fromEntries(MOVED_SWITCHES.map(({ id }) => [id, toggle(id).checked]));
    expect(shown).toEqual(
      Object.fromEntries(MOVED_SWITCHES.map(({ id, missing }) => [id, stored ?? missing])),
    );
  });

  it('each switch writes only its old sync key and never the plugin state', async () => {
    await mount();
    for (const { id, key, missing, ...rest } of MOVED_SWITCHES) {
      if ('control' in rest || 'pairedWrite' in rest) continue;
      extensionApi.storage.sync.set.mockClear();
      await act(async () => toggle(id).click());
      expect(toggle(id).checked).toBe(!missing);
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({ [key]: !missing });
    }
    expect(sync[StorageKeys.INPUT_HALO_HIDDEN]).toBe(true);
    expect(local[StorageKeys.PLUGINS_STATE]).toBeUndefined();
    expect(
      extensionApi.storage.local.set.mock.calls.some(([updates]) =>
        Object.hasOwn(updates as object, StorageKeys.PLUGINS_STATE),
      ),
    ).toBe(false);
  });

  it('a switch whose write fails shows the stored value again', async () => {
    sync[StorageKeys.MERMAID_ENABLED] = false;
    extensionApi.storage.sync.set.mockImplementation((_updates: unknown, callback?: unknown) => {
      if (typeof callback !== 'function') return Promise.reject(new Error('quota'));
      extensionApi.runtime.lastError = { message: 'quota' };
      callback();
      extensionApi.runtime.lastError = undefined;
      return undefined;
    });
    await mount();
    await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiMermaid).click());
    expect(toggle(OFFICIAL_PLUGIN_IDS.geminiMermaid).checked).toBe(false);
    expect(sync[StorageKeys.MERMAID_ENABLED]).toBe(false);
  });

  it.each([
    ['光晕', OFFICIAL_PLUGIN_IDS.geminiHideInputHalo],
    ['代码块', OFFICIAL_PLUGIN_IDS.geminiCodeCollapse],
    ['用量', OFFICIAL_PLUGIN_IDS.geminiUsageStatus],
    [en.enableQuoteReply, OFFICIAL_PLUGIN_IDS.geminiQuoteReply],
    [zh.enableForkFeature, OFFICIAL_PLUGIN_IDS.geminiFork],
    [en.allowCollapseWhenNotEmpty, OFFICIAL_PLUGIN_IDS.geminiInputCollapse],
    ['回车', OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend],
    [en.inputVimMode, OFFICIAL_PLUGIN_IDS.geminiVimInput],
    [zh.draftAutoSave, OFFICIAL_PLUGIN_IDS.geminiDraftSave],
    ['字号', OFFICIAL_PLUGIN_IDS.geminiChatFontSize],
    ['行高', OFFICIAL_PLUGIN_IDS.geminiChatLineHeight],
    [en.chatParagraphSpacing, OFFICIAL_PLUGIN_IDS.geminiChatLineHeight],
    ['message width', OFFICIAL_PLUGIN_IDS.geminiChatWidth],
    ['编辑框', OFFICIAL_PLUGIN_IDS.geminiEditInputWidth],
    ['nav rail', OFFICIAL_PLUGIN_IDS.geminiSidebarWidth],
    [en.sidebarAutoHide, OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide],
    [zh.sidebarFullHide, OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide],
    ['公式', OFFICIAL_PLUGIN_IDS.geminiFormulaCopy],
    [en.formulaCopyFormatUnicodeMath, OFFICIAL_PLUGIN_IDS.geminiFormulaCopy],
    [en.showHighlightTimelineMarkers, OFFICIAL_PLUGIN_IDS.geminiHighlight],
    [zh.enableHighlights, OFFICIAL_PLUGIN_IDS.geminiHighlight],
    ['推送', OFFICIAL_PLUGIN_IDS.geminiResponseNotification],
    [en.syncServerPort, OFFICIAL_PLUGIN_IDS.geminiContextSync],
    ['vscode', OFFICIAL_PLUGIN_IDS.geminiContextSync],
    ['宝石', OFFICIAL_PLUGIN_IDS.geminiGemsSidebar],
    ['notebook', OFFICIAL_PLUGIN_IDS.geminiGemsSidebar],
    ['canvas', OFFICIAL_PLUGIN_IDS.geminiCanvasCopy],
    ['导出', OFFICIAL_PLUGIN_IDS.geminiExport],
    [en.visualEffectSakura, OFFICIAL_PLUGIN_IDS.visualEffects],
    ['樱花', OFFICIAL_PLUGIN_IDS.visualEffects],
    ['thinking', OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport],
    ['markdown', OFFICIAL_PLUGIN_IDS.geminiMarkdownFix],
    ['ruler', OFFICIAL_PLUGIN_IDS.geminiTimeline],
    ['收藏', OFFICIAL_PLUGIN_IDS.geminiTimeline],
    [en.draggableTimeline, OFFICIAL_PLUGIN_IDS.geminiTimeline],
    [zh.showMessageTimestamps, OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps],
    ['去水印', OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload],
    [en.nanobananaBadgeRecommended, OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload],
    [zh.nanobananaPreviewLabel, OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview],
    ['批量删除', OFFICIAL_PLUGIN_IDS.geminiBatchDelete],
    ['bulk', OFFICIAL_PLUGIN_IDS.geminiBatchDelete],
  ])('an old search for "%s" still finds its row', async (query, id) => {
    local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = query;
    await mount();
    await act(async () => loadAllTranslations());
    expect(row(id)).not.toBeNull();
    // The search still filters: not every row answers.
    expect(listedIds().length).toBeLessThan(MOVED_SWITCHES.length);
  });

  it.each([
    [
      en.generalOptions,
      [
        OFFICIAL_PLUGIN_IDS.geminiHideInputHalo,
        OFFICIAL_PLUGIN_IDS.geminiCodeCollapse,
        OFFICIAL_PLUGIN_IDS.geminiUserLatex,
        OFFICIAL_PLUGIN_IDS.geminiMermaid,
        OFFICIAL_PLUGIN_IDS.geminiWaveDrom,
        OFFICIAL_PLUGIN_IDS.geminiECharts,
        OFFICIAL_PLUGIN_IDS.geminiQuoteReply,
        OFFICIAL_PLUGIN_IDS.geminiResearchPack,
        OFFICIAL_PLUGIN_IDS.geminiDefaultModel,
        OFFICIAL_PLUGIN_IDS.geminiUsageStatus,
        OFFICIAL_PLUGIN_IDS.geminiHighlight,
        OFFICIAL_PLUGIN_IDS.geminiResponseNotification,
      ],
    ],
    [en.formulaCopyFormat, [OFFICIAL_PLUGIN_IDS.geminiFormulaCopy]],
    [en.contextSync, [OFFICIAL_PLUGIN_IDS.geminiContextSync]],
    [zh.contextSync, [OFFICIAL_PLUGIN_IDS.geminiContextSync]],
    [en.gemsSidebarCount, [OFFICIAL_PLUGIN_IDS.geminiGemsSidebar]],
    [en.visualEffect, [OFFICIAL_PLUGIN_IDS.visualEffects]],
    [zh.formulaCopyFormat, [OFFICIAL_PLUGIN_IDS.geminiFormulaCopy]],
    [en.folderOptions, [OFFICIAL_PLUGIN_IDS.geminiFork]],
    [en.promptManagerOptions, [OFFICIAL_PLUGIN_IDS.geminiPromptHistory]],
    [
      en.timelineOptions,
      [
        OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll,
        OFFICIAL_PLUGIN_IDS.geminiTimeline,
        OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps,
      ],
    ],
    [
      zh.timelineOptions,
      [
        OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll,
        OFFICIAL_PLUGIN_IDS.geminiTimeline,
        OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps,
      ],
    ],
    [
      en.inputCollapseOptions,
      [
        OFFICIAL_PLUGIN_IDS.geminiInputCollapse,
        OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend,
        OFFICIAL_PLUGIN_IDS.geminiVimInput,
        OFFICIAL_PLUGIN_IDS.geminiDraftSave,
      ],
    ],
    [
      zh.inputCollapseOptions,
      [OFFICIAL_PLUGIN_IDS.geminiInputCollapse, OFFICIAL_PLUGIN_IDS.geminiVimInput],
    ],
    [
      en.nanobananaOptions,
      [OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload, OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview],
    ],
    [
      zh.nanobananaOptions,
      [OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload, OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview],
    ],
    [en.chatWidth, [OFFICIAL_PLUGIN_IDS.geminiChatWidth]],
    [zh.chatFontSize, [OFFICIAL_PLUGIN_IDS.geminiChatFontSize]],
    [en.chatLineHeight, [OFFICIAL_PLUGIN_IDS.geminiChatLineHeight]],
    [en.editInputWidth, [OFFICIAL_PLUGIN_IDS.geminiEditInputWidth]],
    [zh.sidebarWidth, [OFFICIAL_PLUGIN_IDS.geminiSidebarWidth]],
    [
      en.sidebarAutoHide,
      [OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide, OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide],
    ],
  ])(
    'a remembered search for the old card title "%s" still shows its moved rows',
    async (query, ids) => {
      local[StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY] = query;
      await mount();
      for (const id of ids) expect(row(id), id).not.toBeNull();
    },
  );

  it.each([
    ['missing', undefined, false],
    ['false', false, false],
    ['true', true, true],
  ] as const)(
    'on AI Studio, lists Enter send and formula copy and shows a %s stored switch as the page reads it',
    async (_label, stored, expected) => {
      extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
      if (stored !== undefined) sync[StorageKeys.AISTUDIO_ENTER_SEND] = stored;
      await mount();
      // Each in its topic card: layout, sidebar, answer content, input, conversations.
      expect(
        [...container.querySelectorAll<HTMLElement>('[data-plugin-topic]')].map((card) => [
          card.dataset.pluginTopic,
          [...card.querySelectorAll<HTMLElement>('[data-official-plugin]')].map(
            (element) => element.dataset.officialPlugin,
          ),
        ]),
      ).toEqual([
        ['pluginsLayout', [OFFICIAL_PLUGIN_IDS.visualEffects]],
        ['pluginsSidebar', [OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth]],
        ['pluginsContent', [OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy]],
        ['pluginsInput', [OFFICIAL_PLUGIN_IDS.aistudioEnterSend]],
        [
          'pluginsConversations',
          [OFFICIAL_PLUGIN_IDS.aistudioBatchDelete, OFFICIAL_PLUGIN_IDS.aistudioSiteCheck],
        ],
      ]);
      expect(toggle(OFFICIAL_PLUGIN_IDS.aistudioEnterSend).checked).toBe(expected);
      expect(container.querySelector('#changelog-notify-badge')).not.toBeNull();
    },
  );

  it('the AI Studio Enter send switch writes only its own sync key', async () => {
    extensionApi.tabs.query.mockResolvedValue([{ id: 8, url: AI_STUDIO }]);
    await mount();
    await act(async () => toggle(OFFICIAL_PLUGIN_IDS.aistudioEnterSend).click());
    expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.AISTUDIO_ENTER_SEND]: true,
    });
    expect(sync[StorageKeys.CTRL_ENTER_SEND]).toBeUndefined();
  });

  it('offers the Safari Enter fix only in Safari', async () => {
    await mount();
    expect(row(OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix)).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    browserTarget.safari = true;
    await mount();
    expect(listedIds()).toContain(OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix);
  });

  it.each([
    ['missing', undefined, false],
    ['false', false, false],
    ['true', true, true],
  ] as const)(
    'shows a %s stored Safari Enter fix the way the page reads it, and writes only its key',
    async (_label, stored, expected) => {
      browserTarget.safari = true;
      if (stored !== undefined) sync[StorageKeys.SAFARI_ENTER_FIX] = stored;
      await mount();
      expect(toggle(OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix).checked).toBe(expected);
      await act(async () => toggle(OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix).click());
      expect(extensionApi.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
        [StorageKeys.SAFARI_ENTER_FIX]: !expected,
      });
    },
  );
});
