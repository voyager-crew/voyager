import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { loadTranslations } from '@/utils/translations';

const en = await loadTranslations('en');

/**
 * Each moved switch, its old sync key, and whether a user who never touched it
 * sees it on. Written out, not derived from the bindings, so a changed default
 * fails here. The halo row is inverted: on means the halo is hidden.
 */
export const MOVED_SWITCHES = [
  {
    id: OFFICIAL_PLUGIN_IDS.geminiHideInputHalo,
    key: StorageKeys.INPUT_HALO_HIDDEN,
    missing: false,
  },
  // With no width stored; a stored custom width is the derived case below.
  { id: OFFICIAL_PLUGIN_IDS.geminiChatWidth, key: StorageKeys.CHAT_WIDTH_ENABLED, missing: false },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiChatFontSize,
    key: StorageKeys.CHAT_FONT_SIZE_ENABLED,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiChatLineHeight,
    key: StorageKeys.CHAT_LINE_HEIGHT_ENABLED,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
    key: StorageKeys.EDIT_INPUT_WIDTH_ENABLED,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
    key: StorageKeys.SIDEBAR_WIDTH_ENABLED,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide,
    key: StorageKeys.GV_SIDEBAR_AUTO_HIDE,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide,
    key: StorageKeys.GV_SIDEBAR_FULL_HIDE,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiCodeCollapse,
    key: StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED,
    missing: true,
  },
  { id: OFFICIAL_PLUGIN_IDS.geminiUserLatex, key: StorageKeys.USER_LATEX_ENABLED, missing: true },
  { id: OFFICIAL_PLUGIN_IDS.geminiMermaid, key: StorageKeys.MERMAID_ENABLED, missing: true },
  { id: OFFICIAL_PLUGIN_IDS.geminiWaveDrom, key: StorageKeys.WAVEDROM_ENABLED, missing: true },
  { id: OFFICIAL_PLUGIN_IDS.geminiECharts, key: StorageKeys.ECHARTS_ENABLED, missing: true },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiMarkdownFix,
    key: StorageKeys.MARKDOWN_FIX_ENABLED,
    missing: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport,
    key: StorageKeys.DEEP_RESEARCH_EXPORT_ENABLED,
    missing: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiPromptHistory,
    key: StorageKeys.PROMPT_HISTORY_ENABLED,
    missing: false,
  },
  { id: OFFICIAL_PLUGIN_IDS.geminiQuoteReply, key: StorageKeys.QUOTE_REPLY_ENABLED, missing: true },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll,
    key: StorageKeys.PREVENT_AUTO_SCROLL_ENABLED,
    missing: false,
  },
  { id: OFFICIAL_PLUGIN_IDS.geminiFork, key: StorageKeys.FORK_ENABLED, missing: false },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiResearchPack,
    key: StorageKeys.RESEARCH_PACK_ENABLED,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiDefaultModel,
    key: StorageKeys.DEFAULT_MODEL_AUTO_APPLY,
    missing: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiUsageStatus,
    key: StorageKeys.USAGE_STATUS_ENABLED,
    missing: false,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiInputCollapse,
    key: StorageKeys.INPUT_COLLAPSE_ENABLED,
    missing: false,
  },
  { id: OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend, key: StorageKeys.CTRL_ENTER_SEND, missing: false },
  { id: OFFICIAL_PLUGIN_IDS.geminiVimInput, key: StorageKeys.INPUT_VIM_MODE, missing: false },
  { id: OFFICIAL_PLUGIN_IDS.geminiDraftSave, key: StorageKeys.DRAFT_AUTO_SAVE, missing: false },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
    key: StorageKeys.FORMULA_COPY_ENABLED,
    missing: true,
  },
  { id: OFFICIAL_PLUGIN_IDS.geminiHighlight, key: StorageKeys.HIGHLIGHT_ENABLED, missing: false },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiCanvasCopy,
    key: StorageKeys.CANVAS_COPY_ENABLED,
    missing: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiExport,
    key: StorageKeys.GEMINI_EXPORT_ENABLED,
    missing: true,
  },
  // The switch alone: a count of 0 hides the list but leaves it on (see its slider tests).
  {
    id: OFFICIAL_PLUGIN_IDS.geminiGemsSidebar,
    key: StorageKeys.GV_GEMS_SIDEBAR_ENABLED,
    missing: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiContextSync,
    key: StorageKeys.CONTEXT_SYNC_ENABLED,
    missing: false,
  },
  { id: OFFICIAL_PLUGIN_IDS.geminiTimeline, key: StorageKeys.GV_TIMELINE_ENABLED, missing: true },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps,
    key: StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS,
    missing: false,
  },
  // With folders on (their default); the row's folder dependency has its own tests.
  {
    id: OFFICIAL_PLUGIN_IDS.geminiBatchDelete,
    key: StorageKeys.BATCH_DELETE_ENABLED,
    missing: true,
  },
  // Each writes both split keys and clears the legacy one; see their own tests.
  {
    id: OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload,
    key: StorageKeys.WATERMARK_DOWNLOAD_ENABLED,
    missing: false,
    pairedWrite: true,
  },
  {
    id: OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview,
    key: StorageKeys.WATERMARK_PREVIEW_ENABLED,
    missing: false,
    pairedWrite: true,
  },
  // Its switch runs a permission flow instead of a write; see its own tests.
  {
    id: OFFICIAL_PLUGIN_IDS.geminiResponseNotification,
    key: StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED,
    missing: false,
    control: true,
  },
] as const satisfies readonly {
  id: string;
  key: string;
  missing: boolean;
  control?: boolean;
  pairedWrite?: boolean;
}[];

/** The switches each old card used to hold; none may render twice. */
export const RETIRED_SWITCH_IDS = [
  'hide-input-halo',
  'code-block-collapse-enabled',
  'user-latex-enabled',
  'mermaid-enabled',
  'wavedrom-enabled',
  'echarts-enabled',
  'prompt-history-enabled',
  'quote-reply-enabled',
  'prevent-auto-scroll',
  'fork-enabled',
  'research-pack-enabled',
  'default-model-auto-apply',
  'usage-status-enabled',
  'input-collapse-enabled',
  'input-collapse-when-not-empty',
  'input-vim-mode',
  'ctrl-enter-send',
  'aistudio-enter-send',
  'safari-enter-fix',
  'draft-auto-save',
  'sidebar-auto-hide',
  'sidebar-full-hide',
  'formula-copy-enabled',
  'highlights-enabled',
  'highlight-timeline-markers-enabled',
  'response-complete-notification',
  'timeline-enabled',
  'watermark-download',
  'watermark-preview',
];

/** The old layout cards' sliders and switches, labelled by their card title. */
export const RETIRED_LAYOUT_LABELS = [
  en.chatWidth,
  en.chatFontSize,
  en.chatLineHeight,
  en.chatParagraphSpacing,
  en.editInputWidth,
  en.sidebarWidth,
  en.gemsSidebarCount,
];
