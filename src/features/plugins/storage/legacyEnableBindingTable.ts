/**
 * The packaged official plugins whose on/off switch is an existing Voyager
 * setting: which sync key each reads, its production reading and the value the
 * settings UI stores (`legacySettingBindings.ts` reads, resolves and writes
 * them). Each `read` is today's production reading of that key, invalid values
 * included, and `read(undefined)` is the production default.
 */
import { StorageKeys } from '@/core/types/common';
import { isSafari } from '@/core/utils/browser';
import { isChatWidthSwitchOn, isEditInputWidthSwitchOn } from '@/core/utils/chatAppearanceValues';
import { isSidebarWidthSwitchOn } from '@/core/utils/sidebarWidthValues';
import { resolveVisualEffect } from '@/core/utils/visualEffectValues';
import { WATERMARK_STORAGE_KEYS, resolveWatermarkSettings } from '@/core/utils/watermarkSettings';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';

export interface LegacyEnableBinding {
  readonly pluginId: string;
  readonly area: 'sync';
  readonly key: string;
  /** The production reading of the stored value; `read(undefined)` is the default. */
  readonly read: (stored: unknown) => boolean;
  /** The value the existing settings UI stores for this switch. */
  readonly write: (enabled: boolean) => unknown;
  /**
   * When the native module decides from more than `key` (or decides once per
   * page), the page's decision; `read` stays the single-key reading the popup
   * shows and writes. Every key it reads must be in `legacyBindingKeys()`.
   */
  readonly derive?: (snapshot: LegacySettingSnapshot, wasChangedLive: WasChangedLive) => boolean;
}

/** Stored values by storage key. An own key holding `undefined` means "removed". */
export type LegacySettingSnapshot = Readonly<Record<string, unknown>>;

/** Whether `key` took a live change while this page lived (the first read is no change). */
export type WasChangedLive = (key: string) => boolean;

const onUnlessFalse = (stored: unknown): boolean => stored !== false;
const onOnlyIfTrue = (stored: unknown): boolean => stored === true;
/** Off when never stored (the native read defaults to `false`); any stored value but `false` is on. */
const onUnlessMissingOrFalse = (stored: unknown): boolean =>
  stored !== undefined && stored !== false;
const storeBoolean = (enabled: boolean): boolean => enabled;

function binding(
  pluginId: string,
  key: string,
  read: (stored: unknown) => boolean,
): LegacyEnableBinding {
  return { pluginId, area: 'sync', key, read, write: storeBoolean };
}

/** Batch selection still needs the native folder surface, even after opting in explicitly. */
function batchDeleteBinding(pluginId: string): LegacyEnableBinding {
  return {
    ...binding(pluginId, StorageKeys.BATCH_DELETE_ENABLED, onUnlessFalse),
    derive: (snapshot) =>
      onUnlessFalse(snapshotValue(snapshot, StorageKeys.BATCH_DELETE_ENABLED)) &&
      onUnlessFalse(snapshotValue(snapshot, StorageKeys.FOLDER_ENABLED)),
  };
}

export const LEGACY_ENABLE_BINDINGS: Readonly<Record<string, LegacyEnableBinding>> = {
  // legacyEnableWrite writes one split key, and a missing sibling resolves to on: a popup row for
  // either switch writes both split keys and clears the legacy key (popup watermarkWrite).
  [OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload]: {
    ...binding(
      OFFICIAL_PLUGIN_IDS.geminiWatermarkDownload,
      WATERMARK_STORAGE_KEYS[0],
      onOnlyIfTrue,
    ),
    derive: (snapshot) => resolveWatermarkSettings(snapshot).download,
  },
  [OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview]: {
    ...binding(OFFICIAL_PLUGIN_IDS.geminiWatermarkPreview, WATERMARK_STORAGE_KEYS[1], onOnlyIfTrue),
    derive: (snapshot) => resolveWatermarkSettings(snapshot).preview,
  },
  [OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps]: binding(
    OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps,
    StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiBatchDelete]: batchDeleteBinding(
    OFFICIAL_PLUGIN_IDS.geminiBatchDelete,
  ),
  [OFFICIAL_PLUGIN_IDS.aistudioBatchDelete]: batchDeleteBinding(
    OFFICIAL_PLUGIN_IDS.aistudioBatchDelete,
  ),
  // One folders switch for Gemini and AI Studio, on until turned off, as the native managers read it.
  [OFFICIAL_PLUGIN_IDS.geminiFolders]: binding(
    OFFICIAL_PLUGIN_IDS.geminiFolders,
    StorageKeys.FOLDER_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.aistudioFolders]: binding(
    OFFICIAL_PLUGIN_IDS.aistudioFolders,
    StorageKeys.FOLDER_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.visualEffects]: {
    pluginId: OFFICIAL_PLUGIN_IDS.visualEffects,
    area: 'sync',
    key: StorageKeys.GV_VISUAL_EFFECT,
    read: (stored) => resolveVisualEffect(stored) !== 'off',
    write: (enabled) => (enabled ? 'snow' : 'off'),
    derive: (snapshot) =>
      resolveVisualEffect(
        snapshot[StorageKeys.GV_VISUAL_EFFECT],
        snapshot[StorageKeys.GV_SNOW_EFFECT],
      ) !== 'off',
  },
  [OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth]: {
    ...binding(
      OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth,
      StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED,
      onUnlessFalse,
    ),
    derive: (snapshot) => {
      const stored = snapshotValue(snapshot, StorageKeys.AISTUDIO_SIDEBAR_WIDTH_ENABLED);
      // Until explicitly set, preserve the folder-owned layout switch, including live changes.
      return typeof stored === 'boolean'
        ? stored
        : onUnlessFalse(snapshotValue(snapshot, StorageKeys.FOLDER_ENABLED));
    },
  },
  [OFFICIAL_PLUGIN_IDS.geminiGemsSidebar]: binding(
    OFFICIAL_PLUGIN_IDS.geminiGemsSidebar,
    StorageKeys.GV_GEMS_SIDEBAR_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiContextSync]: binding(
    OFFICIAL_PLUGIN_IDS.geminiContextSync,
    StorageKeys.CONTEXT_SYNC_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiSidebarWidth]: {
    ...binding(
      OFFICIAL_PLUGIN_IDS.geminiSidebarWidth,
      StorageKeys.SIDEBAR_WIDTH_ENABLED,
      onOnlyIfTrue,
    ),
    derive: (snapshot, wasChangedLive) =>
      isSidebarWidthSwitchOn({
        storedSwitch: snapshotValue(snapshot, StorageKeys.SIDEBAR_WIDTH_ENABLED),
        storedWidth: snapshotValue(snapshot, StorageKeys.SIDEBAR_WIDTH),
        switchChangedLive: wasChangedLive(StorageKeys.SIDEBAR_WIDTH_ENABLED),
        widthChangedLive: wasChangedLive(StorageKeys.SIDEBAR_WIDTH),
      }),
  },
  [OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide]: binding(
    OFFICIAL_PLUGIN_IDS.geminiSidebarAutoHide,
    StorageKeys.GV_SIDEBAR_AUTO_HIDE,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide]: binding(
    OFFICIAL_PLUGIN_IDS.geminiSidebarFullHide,
    StorageKeys.GV_SIDEBAR_FULL_HIDE,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiTimeline]: binding(
    OFFICIAL_PLUGIN_IDS.geminiTimeline,
    StorageKeys.GV_TIMELINE_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiResponseNotification]: binding(
    OFFICIAL_PLUGIN_IDS.geminiResponseNotification,
    StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll]: binding(
    OFFICIAL_PLUGIN_IDS.geminiPreventAutoScroll,
    StorageKeys.PREVENT_AUTO_SCROLL_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiHighlight]: binding(
    OFFICIAL_PLUGIN_IDS.geminiHighlight,
    StorageKeys.HIGHLIGHT_ENABLED,
    onOnlyIfTrue,
  ),
  // Gemini has native quote reply; leave Voyager off until a choice is stored.
  [OFFICIAL_PLUGIN_IDS.geminiQuoteReply]: binding(
    OFFICIAL_PLUGIN_IDS.geminiQuoteReply,
    StorageKeys.QUOTE_REPLY_ENABLED,
    onUnlessMissingOrFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiUsageStatus]: binding(
    OFFICIAL_PLUGIN_IDS.geminiUsageStatus,
    StorageKeys.USAGE_STATUS_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiFork]: binding(
    OFFICIAL_PLUGIN_IDS.geminiFork,
    StorageKeys.FORK_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiDraftSave]: binding(
    OFFICIAL_PLUGIN_IDS.geminiDraftSave,
    StorageKeys.DRAFT_AUTO_SAVE,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.aistudioEnterSend]: binding(
    OFFICIAL_PLUGIN_IDS.aistudioEnterSend,
    StorageKeys.AISTUDIO_ENTER_SEND,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend]: binding(
    OFFICIAL_PLUGIN_IDS.geminiCtrlEnterSend,
    StorageKeys.CTRL_ENTER_SEND,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix]: {
    ...binding(
      OFFICIAL_PLUGIN_IDS.geminiSafariEnterFix,
      StorageKeys.SAFARI_ENTER_FIX,
      onOnlyIfTrue,
    ),
    derive: (snapshot) =>
      isSafari() && snapshotValue(snapshot, StorageKeys.SAFARI_ENTER_FIX) === true,
  },
  // One switch for both sites, as the popup has always presented it.
  [OFFICIAL_PLUGIN_IDS.geminiFormulaCopy]: binding(
    OFFICIAL_PLUGIN_IDS.geminiFormulaCopy,
    StorageKeys.FORMULA_COPY_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy]: binding(
    OFFICIAL_PLUGIN_IDS.aistudioFormulaCopy,
    StorageKeys.FORMULA_COPY_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiVimInput]: binding(
    OFFICIAL_PLUGIN_IDS.geminiVimInput,
    StorageKeys.INPUT_VIM_MODE,
    onOnlyIfTrue,
  ),
  // `true` hides the halo: the feature is on.
  [OFFICIAL_PLUGIN_IDS.geminiHideInputHalo]: binding(
    OFFICIAL_PLUGIN_IDS.geminiHideInputHalo,
    StorageKeys.INPUT_HALO_HIDDEN,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiChatFontSize]: binding(
    OFFICIAL_PLUGIN_IDS.geminiChatFontSize,
    StorageKeys.CHAT_FONT_SIZE_ENABLED,
    onOnlyIfTrue,
  ),
  // Also the paragraph spacing switch: the native modules share it.
  [OFFICIAL_PLUGIN_IDS.geminiChatLineHeight]: binding(
    OFFICIAL_PLUGIN_IDS.geminiChatLineHeight,
    StorageKeys.CHAT_LINE_HEIGHT_ENABLED,
    onOnlyIfTrue,
  ),
  // A switch never stored follows the width the page first read (see `isChatWidthSwitchOn`).
  [OFFICIAL_PLUGIN_IDS.geminiChatWidth]: {
    ...binding(OFFICIAL_PLUGIN_IDS.geminiChatWidth, StorageKeys.CHAT_WIDTH_ENABLED, onOnlyIfTrue),
    derive: (snapshot, wasChangedLive) =>
      isChatWidthSwitchOn({
        storedSwitch: snapshotValue(snapshot, StorageKeys.CHAT_WIDTH_ENABLED),
        storedWidth: snapshotValue(snapshot, StorageKeys.CHAT_WIDTH),
        switchChangedLive: wasChangedLive(StorageKeys.CHAT_WIDTH_ENABLED),
        widthChangedLive: wasChangedLive(StorageKeys.CHAT_WIDTH),
      }),
  },
  // The same upgrade rule as chat width: a never-stored switch follows a customized first width.
  [OFFICIAL_PLUGIN_IDS.geminiEditInputWidth]: {
    ...binding(
      OFFICIAL_PLUGIN_IDS.geminiEditInputWidth,
      StorageKeys.EDIT_INPUT_WIDTH_ENABLED,
      onOnlyIfTrue,
    ),
    derive: (snapshot, wasChangedLive) =>
      isEditInputWidthSwitchOn({
        storedSwitch: snapshotValue(snapshot, StorageKeys.EDIT_INPUT_WIDTH_ENABLED),
        storedWidth: snapshotValue(snapshot, StorageKeys.EDIT_INPUT_WIDTH),
        switchChangedLive: wasChangedLive(StorageKeys.EDIT_INPUT_WIDTH_ENABLED),
        widthChangedLive: wasChangedLive(StorageKeys.EDIT_INPUT_WIDTH),
      }),
  },
  [OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport]: binding(
    OFFICIAL_PLUGIN_IDS.geminiDeepResearchExport,
    StorageKeys.DEEP_RESEARCH_EXPORT_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiExport]: binding(
    OFFICIAL_PLUGIN_IDS.geminiExport,
    StorageKeys.GEMINI_EXPORT_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiMarkdownFix]: binding(
    OFFICIAL_PLUGIN_IDS.geminiMarkdownFix,
    StorageKeys.MARKDOWN_FIX_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiCanvasCopy]: binding(
    OFFICIAL_PLUGIN_IDS.geminiCanvasCopy,
    StorageKeys.CANVAS_COPY_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiUserLatex]: binding(
    OFFICIAL_PLUGIN_IDS.geminiUserLatex,
    StorageKeys.USER_LATEX_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiCodeCollapse]: binding(
    OFFICIAL_PLUGIN_IDS.geminiCodeCollapse,
    StorageKeys.CODE_BLOCK_COLLAPSE_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiWaveDrom]: binding(
    OFFICIAL_PLUGIN_IDS.geminiWaveDrom,
    StorageKeys.WAVEDROM_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiECharts]: binding(
    OFFICIAL_PLUGIN_IDS.geminiECharts,
    StorageKeys.ECHARTS_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiMermaid]: binding(
    OFFICIAL_PLUGIN_IDS.geminiMermaid,
    StorageKeys.MERMAID_ENABLED,
    onUnlessFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiPromptHistory]: binding(
    OFFICIAL_PLUGIN_IDS.geminiPromptHistory,
    StorageKeys.PROMPT_HISTORY_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiInputCollapse]: binding(
    OFFICIAL_PLUGIN_IDS.geminiInputCollapse,
    StorageKeys.INPUT_COLLAPSE_ENABLED,
    onUnlessMissingOrFalse,
  ),
  [OFFICIAL_PLUGIN_IDS.geminiResearchPack]: binding(
    OFFICIAL_PLUGIN_IDS.geminiResearchPack,
    StorageKeys.RESEARCH_PACK_ENABLED,
    onOnlyIfTrue,
  ),
  // A never-set switch is on, in the popup and the content script alike.
  [OFFICIAL_PLUGIN_IDS.geminiDefaultModel]: binding(
    OFFICIAL_PLUGIN_IDS.geminiDefaultModel,
    StorageKeys.DEFAULT_MODEL_AUTO_APPLY,
    onUnlessFalse,
  ),
  // New with the plugin, so there is no older reading: off unless switched on.
  [OFFICIAL_PLUGIN_IDS.geminiSiteCheck]: binding(
    OFFICIAL_PLUGIN_IDS.geminiSiteCheck,
    StorageKeys.SITE_CHECK_ENABLED,
    onOnlyIfTrue,
  ),
  [OFFICIAL_PLUGIN_IDS.aistudioSiteCheck]: binding(
    OFFICIAL_PLUGIN_IDS.aistudioSiteCheck,
    StorageKeys.SITE_CHECK_ENABLED,
    onOnlyIfTrue,
  ),
};

/** The stored value of `key`; `undefined` when the snapshot lacks it or holds it removed. */
export function snapshotValue(legacy: LegacySettingSnapshot, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(legacy, key) ? legacy[key] : undefined;
}
