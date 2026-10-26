import { GEMINI_ACTIVITY_PROFILE_KEYS } from './activityKeys';
import { GEMINI_COMPOSER_PROFILE_KEYS } from './composerKeys';
import { GEMINI_GEMS_NAV_PROFILE_KEYS, GEMINI_GEMS_CATALOG_PROFILE_KEYS } from './gemsKeys';
import { GEMINI_INPUT_COLLAPSE_PROFILE_KEYS } from './inputCollapseKeys';
import { GEMINI_MENU_PROFILE_KEYS, GEMINI_EXPORT_OVERLAY_PROFILE_KEYS } from './menuKeys';
import { GEMINI_MODEL_PICKER_PROFILE_KEYS } from './modelPickerKeys';
import { GEMINI_PROJECT_PROFILE_KEYS } from './projectKeys';
import { GEMINI_PROMPT_HISTORY_PROFILE_KEYS } from './promptKeys';
import { GEMINI_SLASH_PROFILE_KEYS } from './promptKeys';
import { GEMINI_SENT_CHIPS_PROFILE_KEYS } from './promptKeys';
import {
  GEMINI_SIDEBAR_WIDTH_PROFILE_KEYS,
  GEMINI_SIDEBAR_HOVER_PROFILE_KEYS,
} from './sidebarInteractionKeys';
import { GEMINI_SIDEBAR_PROFILE_KEYS } from './sidebarKeys';
import { GEMINI_VIM_PROFILE_KEYS } from './vimKeys';

/** Locator data only; query algorithms, identity and actions remain packaged. */
export const GEMINI_SELECTOR_HOSTS = ['gemini.google.com'] as const;
export type GeminiSelectorHost = (typeof GEMINI_SELECTOR_HOSTS)[number];

export const GEMINI_TURN_PROFILE_KEYS = [
  'turn.user',
  'turn.userWithHosts',
  'turn.assistant',
  'turn.assistantFallback',
  'turn.assistantWithHosts',
] as const;
export type GeminiTurnProfileKey = (typeof GEMINI_TURN_PROFILE_KEYS)[number];
export type GeminiTurnProfiles = Readonly<Record<GeminiTurnProfileKey, readonly string[]>>;

/** Literal format contracts; the latest, still-unpublished format includes this batch. */
export const GEMINI_V1_SELECTOR_PROFILE_KEYS = [
  'turn.user',
  'turn.userWithHosts',
  'turn.assistant',
  'turn.assistantFallback',
  'turn.assistantWithHosts',
] as const;

export const GEMINI_V2_SELECTOR_PROFILE_KEYS = [
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
  'modelPicker.selectedModel',
  'modelPicker.selectedThinking',
  'modelPicker.selectedNestedThinking',
  'modelPicker.focusInput',
] as const;

export const GEMINI_V3_SELECTOR_PROFILE_KEYS = [
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
  'modelPicker.selectedModel',
  'modelPicker.selectedThinking',
  'modelPicker.selectedNestedThinking',
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
] as const;

export const GEMINI_SELECTOR_PROFILE_KEYS = GEMINI_V3_SELECTOR_PROFILE_KEYS;
export type GeminiSelectorProfileKey = (typeof GEMINI_SELECTOR_PROFILE_KEYS)[number];

/** Each surface adopts or drops its online fixes on its own; one bad group cannot void another. */
export const GEMINI_SELECTOR_PROFILE_GROUPS: readonly (readonly GeminiSelectorProfileKey[])[] = [
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
];
export type GeminiSelectorProfiles = Readonly<Record<GeminiSelectorProfileKey, readonly string[]>>;

export interface GeminiSelectorFile {
  /** Earlier formats retain their literal allowlists until the planned format cleanup. */
  readonly format: 1 | 2 | 3;
  readonly site: 'gemini';
  readonly host: GeminiSelectorHost;
  readonly catalogRevision: number;
  readonly selectors: Readonly<Partial<Record<GeminiSelectorProfileKey, readonly string[]>>>;
}

export interface GeminiSelectorView {
  readonly profiles: GeminiSelectorProfiles;
  readonly remoteKeys: ReadonlySet<GeminiSelectorProfileKey>;
  readonly revision: number | null;
}

export interface GeminiSelectorOperation<T> {
  readonly value: T;
  readonly view: GeminiSelectorView;
}

/** Existing turn consumers share the same page snapshot, never a second hydration. */
export type GeminiTurnView = GeminiSelectorView;
export type GeminiTurnOperation<T> = GeminiSelectorOperation<T>;
