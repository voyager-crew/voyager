/**
 * The rows of the official plugin list, in display order within each topic
 * card. Their shape and presentation rules live in `officialPluginRegistry.ts`.
 */
import { StorageKeys } from '@/core/types/common';
import { resolveWatermarkSettings } from '@/core/utils/watermarkSettings';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import type { LegacySettingSnapshot } from '@/features/plugins/storage/legacySettingBindings';

import type { OfficialPluginEntry } from './officialPluginRegistry';
import { sidebarWidthForDisplay } from './sidebarWidthDisplay';

const SITE_CHECK_ALIASES =
  'site check diagnostics bug report broken selector element picker 站点检查 诊断 反馈 失效';

const BATCH_DELETE_ALIASES =
  'batch delete bulk remove select multiple conversations chats 批量删除 多选 删除对话';

/** Batch selection lives in the folder surface, which the folders switch turns off. */
const NEEDS_FOLDERS: NonNullable<OfficialPluginEntry['requires']> = {
  met: (snapshot) => snapshot[StorageKeys.FOLDER_ENABLED] !== false,
  setting: 'enableFolderFeature',
  card: 'folderOptions',
};

/**
 * Both watermark switches are written together and the legacy key cleared, as
 * the NanoBanana card did: a missing split key falls back to the legacy one.
 */
function watermarkWrite(kind: 'download' | 'preview') {
  return (enabled: boolean, shown: LegacySettingSnapshot) => {
    const next = { ...resolveWatermarkSettings(shown), [kind]: enabled };
    return {
      [StorageKeys.WATERMARK_DOWNLOAD_ENABLED]: next.download,
      [StorageKeys.WATERMARK_PREVIEW_ENABLED]: next.preview,
      [StorageKeys.WATERMARK_REMOVER_ENABLED]: null,
    };
  };
}

/** Array order is the display order within each topic card. */
export const OFFICIAL_PLUGIN_ENTRIES: readonly OfficialPluginEntry[] = [
  {
    id: OFFICIAL_PLUGIN_IDS.geminiChatWidth,
    topic: 'pluginsLayout',
    formerSectionTitle: 'chatWidth',
    searchKeys: ['chatWidth', 'chatWidthNarrow', 'chatWidthWide'],
    searchAliases: ['conversation width message width content width 宽 窄 对话宽度'],
    sliders: {
      widthPercent: {
        label: 'chatWidth',
        minLabel: 'chatWidthNarrow',
        maxLabel: 'chatWidthWide',
        step: 1,
        unit: '%',
      },
    },
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiChatFontSize,
    topic: 'pluginsLayout',
    formerSectionTitle: 'chatFontSize',
    searchKeys: ['chatFontSize', 'chatFontSizeSmall', 'chatFontSizeLarge'],
    searchAliases: ['font text size typography zoom 字号 字体 大小'],
    sliders: {
      fontSize: {
        label: 'chatFontSize',
        minLabel: 'chatFontSizeSmall',
        maxLabel: 'chatFontSizeLarge',
        step: 1,
        unit: '%',
      },
    },
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiChatLineHeight,
    topic: 'pluginsLayout',
    formerSectionTitle: 'chatLineHeight',
    searchKeys: [
      'chatLineHeight',
      'chatLineHeightTight',
      'chatLineHeightLoose',
      'chatParagraphSpacing',
    ],
    searchAliases: ['line spacing paragraph leading readability 行高 段落 间距'],
    sliders: {
      lineHeight: {
        label: 'chatLineHeight',
        minLabel: 'chatLineHeightTight',
        maxLabel: 'chatLineHeightLoose',
        step: 5,
        unit: '%',
      },
      paragraphSpacing: {
        label: 'chatParagraphSpacing',
        minLabel: 'chatLineHeightTight',
        maxLabel: 'chatLineHeightLoose',
        step: 1,
        unit: 'px',
      },
    },
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
    topic: 'pluginsLayout',
    formerSectionTitle: 'editInputWidth',
    searchKeys: ['editInputWidth', 'editInputWidthNarrow', 'editInputWidthWide'],
    searchAliases: ['prompt input compose editor width 输入框 编辑框 宽度'],
    sliders: {
      widthPercent: {
        label: 'editInputWidth',
        minLabel: 'editInputWidthNarrow',
        maxLabel: 'editInputWidthWide',
        step: 1,
        unit: '%',
      },
    },
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiHideInputHalo,
    topic: 'pluginsLayout',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['hideInputHalo', 'hideInputHaloHint'],
    searchAliases: ['halo ripple 光晕 水波纹'],
  },
  {
    // One shared choice on every site. A plugin site lists this row in its own plugin card.
    id: OFFICIAL_PLUGIN_IDS.visualEffects,
    topic: 'pluginsLayout',
    formerSectionTitle: 'visualEffect',
    searchKeys: ['visualEffectHint', 'visualEffectSnow', 'visualEffectSakura', 'visualEffectRain'],
    searchAliases: ['snow sakura rain particles atmosphere 雪 樱花 雨 特效'],
    inlinePanel: 'visualEffect',
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
    topic: 'pluginsSidebar',
    formerSectionTitle: 'sidebarWidth',
    searchKeys: ['sidebarWidth', 'sidebarWidthNarrow', 'sidebarWidthWide'],
    searchAliases: ['side panel nav rail left width 侧边栏 宽度'],
    sliders: {
      widthPx: {
        label: 'sidebarWidth',
        minLabel: 'sidebarWidthNarrow',
        maxLabel: 'sidebarWidthWide',
        step: 8,
        unit: 'px',
        toDisplay: sidebarWidthForDisplay,
      },
    },
  },
  {
    // AI Studio's own pixel width; until its switch is stored it follows the folders switch.
    id: OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth,
    topic: 'pluginsSidebar',
    formerSectionTitle: 'sidebarWidth',
    searchKeys: ['sidebarWidth', 'sidebarWidthNarrow', 'sidebarWidthWide'],
    searchAliases: ['side panel nav rail left width 侧边栏 宽度'],
    sliders: {
      widthPx: {
        label: 'sidebarWidth',
        minLabel: 'sidebarWidthNarrow',
        maxLabel: 'sidebarWidthWide',
        step: 8,
        unit: 'px',
      },
    },
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide,
    topic: 'pluginsSidebar',
    formerSectionTitle: 'sidebarAutoHide',
    searchKeys: ['sidebarAutoHide', 'sidebarAutoHideHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide,
    topic: 'pluginsSidebar',
    formerSectionTitle: 'sidebarAutoHide',
    searchKeys: ['sidebarFullHide', 'sidebarFullHideHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiGemsSidebar,
    topic: 'pluginsSidebar',
    formerSectionTitle: 'gemsSidebarCount',
    searchKeys: ['gemsSidebarCountHidden', 'gemsSidebarCountMany'],
    searchAliases: ['gems notebook recent side nav gem 宝石 侧边栏 最近'],
    sliders: {
      // 0 hides the list only; the row's switch turns the feature off.
      count: {
        minLabel: 'gemsSidebarCountHidden',
        maxLabel: 'gemsSidebarCountMany',
        step: 1,
        unit: '',
        zeroLabel: 'gemsSidebarCountHidden',
      },
    },
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiTimeline,
    topic: 'pluginsTimeline',
    formerSectionTitle: 'timelineOptions',
    searchKeys: [
      'timelineEnable',
      'timelineEnableHint',
      'timelineStyle',
      'timelineStyleDots',
      'timelineStyleRuler',
      'timelineStyleCompact',
      'scrollMode',
      'flow',
      'jump',
      'hideOuterContainer',
      'draggableTimeline',
      'pinTimelinePreview',
      'pinTimelinePreviewHint',
      'enableMarkerLevel',
      'enableMarkerLevelHint',
      'resetTimelinePosition',
      'viewStarredHistory',
    ],
    searchAliases: ['timeline rail navigation bookmark star history 时间线 导航 收藏 历史'],
    panel: 'timeline',
  },
  {
    // Independent of the rail: message times show with the timeline off too.
    id: OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps,
    topic: 'pluginsTimeline',
    formerSectionTitle: 'timelineOptions',
    searchKeys: ['showMessageTimestamps', 'showMessageTimestampsHint'],
    searchAliases: ['time clock sent date 时间 时间戳'],
    experimental: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll,
    topic: 'pluginsTimeline',
    formerSectionTitle: 'timelineOptions',
    searchKeys: ['preventAutoScroll', 'preventAutoScrollHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiHighlight,
    topic: 'pluginsTimeline',
    formerSectionTitle: 'generalOptions',
    searchKeys: [
      'enableHighlights',
      'enableHighlightsHint',
      'showHighlightTimelineMarkers',
      'showHighlightTimelineMarkersHint',
    ],
    searchAliases: ['highlight marker color 高亮 标记 颜色'],
    panel: 'highlight',
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiCodeCollapse,
    topic: 'pluginsContent',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableCodeBlockCollapse', 'enableCodeBlockCollapseHint'],
    searchAliases: ['code block collapse fold expand 代码块 折叠 展开'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiUserLatex,
    topic: 'pluginsContent',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableUserLatexRendering', 'enableUserLatexRenderingHint'],
    searchAliases: ['latex math formula katex 公式 数学'],
  },
  // Two ids, one switch and one format: each site lists its own, with the same panel.
  ...[OFFICIAL_PLUGIN_IDS.geminiFormulaCopy, OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy].map(
    (id): OfficialPluginEntry => ({
      id,
      topic: 'pluginsContent',
      formerSectionTitle: 'formulaCopyFormat',
      searchKeys: [
        'enableFormulaCopy',
        'enableFormulaCopyHint',
        'formulaCopyFormatHint',
        'formulaCopyFormatLatex',
        'formulaCopyFormatUnicodeMath',
        'formulaCopyFormatNoDollar',
        'formulaCopyFormatNotion',
      ],
      searchAliases: ['math equation latex unicode notion copy formula 数学 公式 复制'],
      panel: 'formulaCopy',
    }),
  ),
  {
    id: OFFICIAL_PLUGIN_IDS.geminiMarkdownFix,
    topic: 'pluginsContent',
    searchKeys: [],
    searchAliases: ['markdown rendering format bold asterisk fix 渲染 格式 修复 加粗'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiMermaid,
    topic: 'pluginsCharts',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableMermaidRendering', 'enableMermaidRenderingHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiWaveDrom,
    topic: 'pluginsCharts',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableWaveDromRendering', 'enableWaveDromRenderingHint'],
    searchAliases: ['wavedrom wavejson timing diagram'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiECharts,
    topic: 'pluginsCharts',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableEchartsRendering', 'enableEchartsRenderingHint'],
    searchAliases: ['echarts chart diagram'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiExport,
    topic: 'pluginsExport',
    // Export never had a switch: no old row to remember, only the words someone would try.
    searchKeys: [],
    searchAliases: [
      'export conversation chat history json markdown pdf image copy reply 导出 对话 记录 图片 复制',
    ],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiCanvasCopy,
    topic: 'pluginsExport',
    // New to the popup: no old row to remember, only the words someone would try.
    searchKeys: [],
    searchAliases: ['canvas markdown copy export 画布 复制'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport,
    topic: 'pluginsExport',
    searchKeys: [],
    searchAliases: ['deep research export pdf markdown thinking report 深度研究 导出 思考'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload,
    topic: 'pluginsExport',
    formerSectionTitle: 'nanobananaOptions',
    searchKeys: ['nanobananaDownloadLabel', 'nanobananaDownloadHint', 'nanobananaBadgeRecommended'],
    searchAliases: ['watermark image banana picture photo download 水印 图片 去水印 下载'],
    enableWrite: watermarkWrite('download'),
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview,
    topic: 'pluginsExport',
    formerSectionTitle: 'nanobananaOptions',
    searchKeys: ['nanobananaPreviewLabel', 'nanobananaPreviewHint', 'nanobananaBadgeUnstable'],
    searchAliases: ['watermark image banana picture photo preview 水印 图片 预览'],
    // The card marked it unstable.
    experimental: true,
    enableWrite: watermarkWrite('preview'),
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend,
    topic: 'pluginsInput',
    formerSectionTitle: 'inputCollapseOptions',
    searchKeys: ['ctrlEnterSend', 'ctrlEnterSendHint'],
    searchAliases: ['send enter return ctrl cmd 发送 回车'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.aistudioEnterSend,
    topic: 'pluginsInput',
    formerSectionTitle: 'inputCollapseOptions',
    searchKeys: ['aistudioEnterSend', 'aistudioEnterSendHint'],
    searchAliases: ['send enter return 发送 回车'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix,
    topic: 'pluginsInput',
    formerSectionTitle: 'inputCollapseOptions',
    searchKeys: ['safariEnterFix', 'safariEnterFixHint'],
    // The fix only runs in Safari (its binding's derive), so other browsers never offered it.
    eligible: ({ isSafariBrowser }) => isSafariBrowser,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiVimInput,
    topic: 'pluginsInput',
    formerSectionTitle: 'inputCollapseOptions',
    searchKeys: ['inputVimMode', 'inputVimModeHint'],
    usageHint: 'inputVimModeHint',
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiInputCollapse,
    topic: 'pluginsInput',
    formerSectionTitle: 'inputCollapseOptions',
    searchKeys: [
      'enableInputCollapse',
      'enableInputCollapseHint',
      'inputCollapseShortcutHint',
      'allowCollapseWhenNotEmpty',
      'allowCollapseWhenNotEmptyHint',
    ],
    usageHint: 'inputCollapseShortcutHint',
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiPromptHistory,
    topic: 'pluginsInput',
    formerSectionTitle: 'promptManagerOptions',
    searchKeys: ['promptHistoryTitle', 'promptHistoryEnabledHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiDraftSave,
    topic: 'pluginsInput',
    formerSectionTitle: 'inputCollapseOptions',
    searchKeys: ['draftAutoSave', 'draftAutoSaveHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiQuoteReply,
    topic: 'pluginsInput',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableQuoteReply', 'enableQuoteReplyHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiFork,
    topic: 'pluginsConversations',
    formerSectionTitle: 'folderOptions',
    searchKeys: ['enableForkFeature', 'enableForkFeatureHint'],
    experimental: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiBatchDelete,
    topic: 'pluginsConversations',
    searchKeys: [],
    searchAliases: [BATCH_DELETE_ALIASES],
    requires: NEEDS_FOLDERS,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.aistudioBatchDelete,
    topic: 'pluginsConversations',
    searchKeys: [],
    searchAliases: [BATCH_DELETE_ALIASES],
    requires: NEEDS_FOLDERS,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiDefaultModel,
    topic: 'pluginsConversations',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['enableDefaultModelAutoApply', 'enableDefaultModelAutoApplyHint'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiResearchPack,
    topic: 'pluginsConversations',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['researchPackEnable', 'researchPackEnableHint'],
    searchAliases: [
      'research pack markdown sources citations carry chatgpt claude 研究 资料包 引用 来源',
    ],
    experimental: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiUsageStatus,
    topic: 'pluginsConversations',
    formerSectionTitle: 'generalOptions',
    searchKeys: ['usageStatusToggle', 'usageStatusToggleHint'],
    searchAliases: ['usage quota limit 用量 限额'],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiResponseNotification,
    topic: 'pluginsConversations',
    formerSectionTitle: 'generalOptions',
    searchKeys: [
      'responseCompleteNotification',
      'responseCompleteNotificationHint',
      'responseCompleteNotificationHintSafari',
    ],
    searchAliases: ['notification alert reminder notice 通知 提醒 推送'],
    // Safari delivers it through the Voyager macOS app, which the row should say.
    usageHint: ({ isSafariBrowser }) =>
      isSafariBrowser ? 'responseCompleteNotificationHintSafari' : null,
    control: 'responseNotification',
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiContextSync,
    topic: 'pluginsConversations',
    formerSectionTitle: 'contextSync',
    searchKeys: [
      'contextSyncDescription',
      'syncToIDE',
      'syncServerPort',
      'ideOnline',
      'ideOffline',
      'capturing',
      'syncedSuccess',
      'syncMode',
    ],
    searchAliases: ['ide vscode cursor local server code context cobridge 上下文 代码 编辑器 本地'],
    panel: 'contextSync',
  },
  // Gemini and AI Studio share one switch, as the batch delete rows do.
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSiteCheck,
    topic: 'pluginsConversations',
    searchKeys: [],
    searchAliases: [SITE_CHECK_ALIASES],
  },
  {
    id: OFFICIAL_PLUGIN_IDS.aistudioSiteCheck,
    topic: 'pluginsConversations',
    searchKeys: [],
    searchAliases: [SITE_CHECK_ALIASES],
  },
];
