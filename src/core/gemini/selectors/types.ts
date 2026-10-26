import { PLACEMENT_KEYS, PLACEMENT_GROUPS } from '../../selectors/contracts/placement';
import { TIMELINE_TEXT_KEYS, TIMELINE_TEXT_GROUPS } from '../../selectors/contracts/timeline';
import type { SiteSelectorView } from '../../selectors/types';
import { GEMINI_ACTIVITY_PROFILE_KEYS } from './activityKeys';
import { GEMINI_CANVAS_CODE_PROFILE_KEYS } from './canvasKeys';
import { GEMINI_CODE_PROFILE_KEYS } from './codeKeys';
import { GEMINI_COMPOSER_PROFILE_KEYS } from './composerKeys';
import { GEMINI_CONTENT_PROFILE_KEYS, GEMINI_CONTEXT_IMAGE_PROFILE_KEYS } from './contentKeys';
import { GEMINI_EXTENDED_KEYS, GEMINI_EXTENDED_GROUPS } from './extendedKeys';
import { GEMINI_GEMS_NAV_PROFILE_KEYS, GEMINI_GEMS_CATALOG_PROFILE_KEYS } from './gemsKeys';
import { GEMINI_GENERATED_IMAGE_PROFILE_KEYS } from './generatedImageKeys';
import { GEMINI_IMAGE_EXPORT_PROFILE_KEYS } from './imageExportKeys';
import { GEMINI_INPUT_COLLAPSE_PROFILE_KEYS } from './inputCollapseKeys';
import { GEMINI_USER_LATEX_PROFILE_KEYS } from './mathKeys';
import { GEMINI_MENU_PROFILE_KEYS, GEMINI_EXPORT_OVERLAY_PROFILE_KEYS } from './menuKeys';
import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from './modelPickerKeys';
import { GEMINI_PROJECT_PROFILE_KEYS } from './projectKeys';
import {
  GEMINI_PROMPT_HISTORY_PROFILE_KEYS,
  GEMINI_SLASH_PROFILE_KEYS,
  GEMINI_SENT_CHIPS_PROFILE_KEYS,
} from './promptKeys';
import {
  GEMINI_RESPONSE_ACTION_PROFILE_KEYS,
  GEMINI_RESEARCH_PACK_PROFILE_KEYS,
} from './responseSurfaceKeys';
import {
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
} from './sidebarInteractionKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from './sidebarKeys';
import { GEMINI_USAGE_PROFILE_KEYS } from './usageKeys';
import { GEMINI_VIM_PROFILE_KEYS } from './vimKeys';

export const GEMINI_TURN_PROFILE_KEYS = [
  'turn.user',
  'turn.userWithHosts',
  'turn.assistant',
  'turn.assistantFallback',
  'turn.assistantWithHosts',
] as const;
export type GeminiTurnProfileKey = (typeof GEMINI_TURN_PROFILE_KEYS)[number];
export type GeminiTurnProfiles = Readonly<Record<GeminiTurnProfileKey, readonly string[]>>;

/** Published contract: Tier A requires independent proof; Tier B only places Voyager UI. */
export const GEMINI_SELECTOR_PROFILE_KEYS = [
  ...GEMINI_EXTENDED_KEYS,
  ...PLACEMENT_KEYS,
  ...TIMELINE_TEXT_KEYS,
  'turn.user',
  'turn.userWithHosts',
  'turn.assistant',
  'turn.assistantFallback',
  'turn.assistantWithHosts',
  'sidebar.overflow',
  'sidebar.notebooks',
  'sidebar.recents',
  'sidebar.allConversations',
  'sidebar.history',
  'sidebar.section',
  'sidebar.row',
  'sidebar.rowContainer',
  'sidebar.openHost',
  'sidebar.host',
  'sidebar.visibilityHost',
  'sidebar.links',
  'sidebar.conversationLinks',
  'sidebar.title',
  'sidebar.titleFallback',
  'sidebar.scroller',
  'sidebar.interactionButton',
  'sidebar.forkRoots',
  'modelPicker.trigger',
  'modelPicker.legacyPanels',
  'modelPicker.panelFallback',
  'modelPicker.overlayPane',
  'modelPicker.container',
  'modelPicker.observerRoot',
  'modelPicker.items',
  'modelPicker.modelEvidence',
  'modelPicker.modelIdItem',
  'modelPicker.modelLabel',
  'modelPicker.thinkingLabel',
  'modelPicker.thinkingRow',
  'modelPicker.thinkingItems',
  'modelPicker.thinkingContent',
  'modelPicker.modelTitleContainer',
  'modelPicker.thinkingTitleContainer',
  'modelPicker.focusInput',
  'composer.candidates',
  'composer.draftCandidates',
  'composer.sendContainers',
  'inputCollapse.wrapper',
  'vim.configuredComposer',
  'vim.candidates',
  'promptHistory.candidates',
  'slash.candidates',
  'sentChips.bubbles',
  'project.inputs',
  'activity.inputs',
  'menu.panels',
  'menu.content',
  'exportOverlay.canvas',
  'exportOverlay.composer',
  'sidebarWidth.buttons',
  'sidebarHover.dialogs',
  'sidebarHover.menus',
  'gems.navEntry',
  'gems.list',
  'gems.row',
  'gems.title',
  'gems.description',
  'gems.icon',
  'content.answer',
  'content.userLines',
  'context.images',
  'responseActions.bars',
  'researchPack.actionBars',
  'usage.root',
  'code.host',
  'userLatex.lines',
  'imageExport.searchHosts',
  'generatedImage.downloadIcon',
  'canvas.codePanels',
] as const;

export type GeminiSelectorProfileKey = (typeof GEMINI_SELECTOR_PROFILE_KEYS)[number];

/** Each surface adopts or drops its online fixes on its own; one bad group cannot void another. */
export const GEMINI_SELECTOR_PROFILE_GROUPS: readonly (readonly GeminiSelectorProfileKey[])[] = [
  ...GEMINI_EXTENDED_GROUPS,
  ...PLACEMENT_GROUPS,
  ...TIMELINE_TEXT_GROUPS,
  GEMINI_TURN_PROFILE_KEYS,
  GEMINI_SIDEBAR_PROFILE_KEYS,
  GEMINI_MODEL_PICKER_PROFILE_KEYS,
  GEMINI_COMPOSER_PROFILE_KEYS,
  GEMINI_INPUT_COLLAPSE_PROFILE_KEYS,
  GEMINI_VIM_PROFILE_KEYS,
  GEMINI_PROMPT_HISTORY_PROFILE_KEYS,
  GEMINI_SLASH_PROFILE_KEYS,
  GEMINI_SENT_CHIPS_PROFILE_KEYS,
  GEMINI_PROJECT_PROFILE_KEYS,
  GEMINI_ACTIVITY_PROFILE_KEYS,
  GEMINI_MENU_PROFILE_KEYS,
  GEMINI_EXPORT_OVERLAY_PROFILE_KEYS,
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
  GEMINI_GEMS_NAV_PROFILE_KEYS,
  GEMINI_GEMS_CATALOG_PROFILE_KEYS,
  GEMINI_CONTENT_PROFILE_KEYS,
  GEMINI_CONTEXT_IMAGE_PROFILE_KEYS,
  GEMINI_RESPONSE_ACTION_PROFILE_KEYS,
  GEMINI_RESEARCH_PACK_PROFILE_KEYS,
  GEMINI_USAGE_PROFILE_KEYS,
  GEMINI_CODE_PROFILE_KEYS,
  GEMINI_USER_LATEX_PROFILE_KEYS,
  GEMINI_IMAGE_EXPORT_PROFILE_KEYS,
  GEMINI_GENERATED_IMAGE_PROFILE_KEYS,
  GEMINI_CANVAS_CODE_PROFILE_KEYS,
];
export type GeminiSelectorProfiles = Readonly<Record<GeminiSelectorProfileKey, readonly string[]>>;

export type GeminiSelectorPatch = Readonly<
  Partial<Record<GeminiSelectorProfileKey, readonly string[]>>
>;

export type GeminiSelectorView = SiteSelectorView<GeminiSelectorProfileKey>;

export interface GeminiSelectorOperation<T> {
  readonly value: T;
  readonly view: GeminiSelectorView;
}

/** Existing turn consumers share the same page snapshot, never a second hydration. */
export type GeminiTurnView = GeminiSelectorView;
export type GeminiTurnOperation<T> = GeminiSelectorOperation<T>;
