/**
 * The settings a packaged official plugin takes from existing Voyager values
 * (a slider's number, a sub-switch's boolean), next to the on/off switch
 * `legacySettingBindings` binds.
 *
 * For an id with an enable binding, these are its only settings: its
 * `gvPluginsState` settings are ignored, and an id without value bindings
 * runs with `{}`. Each `read` is the shared normalize the native module uses,
 * so a stored value renders the same whoever runs the feature, and reading
 * never writes the normalized value back.
 *
 * A live change the native module would ignore (for a number, a value that is
 * not a number or the key's removal) is dropped by the snapshot feed through
 * `acceptsLiveChange`, so the plugin keeps the last value, as the native
 * listener did. A boolean takes every live change: its native listener read
 * anything but `true`, removal included, as off. The first read takes
 * whatever is stored and `read` falls back to the default.
 *
 * This module imports no other binding module at runtime, so
 * `legacySettingBindings` can import it (to load and subscribe these keys)
 * without a cycle. Not part of
 * the CLI bundle (it imports `StorageKeys`): `hostPolicy` must not import it.
 */
import { StorageKeys } from '@/core/types/common';
import { normalizeAIStudioSidebarWidth } from '@/core/utils/aistudioSidebarWidthValues';
import {
  normalizeChatFontSizePercent,
  normalizeChatLineHeightPercent,
  normalizeChatWidthPercent,
  normalizeEditInputWidthPercent,
  normalizeParagraphSpacingPx,
} from '@/core/utils/chatAppearanceValues';
import { normalizeGemsSidebarCount } from '@/core/utils/gemsSidebarValues';
import { normalizeSidebarWidth } from '@/core/utils/sidebarWidthValues';
import { type VisualEffect, resolveVisualEffect } from '@/core/utils/visualEffectValues';
import { type VoyagerPalette, resolveVoyagerPalette } from '@/core/utils/voyagerPaletteValues';

import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { PluginSettings } from '../types';
import type { LegacySettingSnapshot } from './legacySettingBindings';

export interface LegacyValueBinding {
  /** The manifest setting this value fills. */
  readonly settingKey: string;
  /** The sync storage key the native module reads. */
  readonly legacyKey: string;
  /** The native module's reading of the stored value; `read(undefined)` is the default. */
  readonly read: (
    stored: unknown,
    snapshot?: LegacySettingSnapshot,
  ) => number | boolean | VisualEffect | VoyagerPalette;
  /** Extra legacy inputs for a trusted enum resolver, never plugin-supplied keys. */
  readonly additionalKeys?: readonly string[];
  /** Whether a live change to `legacyKey` replaces the current value (the native listener's test). */
  readonly acceptsLiveChange: (value: unknown) => boolean;
}

export type LegacyValueBindingTable = Readonly<Record<string, readonly LegacyValueBinding[]>>;

const isNumber = (value: unknown): boolean => typeof value === 'number';
const always = (): boolean => true;
const isTrue = (stored: unknown): boolean => stored === true;

function numberBinding(
  settingKey: string,
  legacyKey: string,
  read: (stored: unknown) => number,
): LegacyValueBinding {
  return { settingKey, legacyKey, read, acceptsLiveChange: isNumber };
}

/** A sub-switch the native module reads as `=== true`, at startup and live. */
function trueOnlyBinding(settingKey: string, legacyKey: string): LegacyValueBinding {
  return { settingKey, legacyKey, read: isTrue, acceptsLiveChange: always };
}

/** One palette shared by Gemini and AI Studio, as their switch is. */
function paletteBinding(): LegacyValueBinding {
  return {
    settingKey: 'palette',
    legacyKey: StorageKeys.VOYAGER_PALETTE,
    read: resolveVoyagerPalette,
    acceptsLiveChange: always,
  };
}

/**
 * Inert for an id until `LEGACY_ENABLE_BINDINGS` binds it: an unbound id
 * keeps reading its settings from `gvPluginsState`.
 */
export const LEGACY_VALUE_BINDINGS: LegacyValueBindingTable = {
  [OFFICIAL_PLUGIN_IDS.visualEffects]: [
    {
      settingKey: 'effect',
      legacyKey: StorageKeys.GV_VISUAL_EFFECT,
      additionalKeys: [StorageKeys.GV_SNOW_EFFECT],
      read: (stored, snapshot) =>
        resolveVisualEffect(stored, snapshot?.[StorageKeys.GV_SNOW_EFFECT]),
      acceptsLiveChange: always,
    },
  ],
  [OFFICIAL_PLUGIN_IDS.aistudioSidebarWidth]: [
    numberBinding('widthPx', StorageKeys.AISTUDIO_SIDEBAR_WIDTH, normalizeAIStudioSidebarWidth),
  ],
  [OFFICIAL_PLUGIN_IDS.geminiGemsSidebar]: [
    {
      settingKey: 'count',
      legacyKey: StorageKeys.GV_GEMS_SIDEBAR_COUNT,
      read: normalizeGemsSidebarCount,
      // Native count changes also coerced strings and reset to 3 on key removal.
      acceptsLiveChange: always,
    },
  ],
  [OFFICIAL_PLUGIN_IDS.geminiSidebarWidth]: [
    {
      settingKey: 'widthPx',
      legacyKey: StorageKeys.SIDEBAR_WIDTH,
      read: normalizeSidebarWidth,
      // The sidebar's native listener coerced finite values, including old numeric strings.
      acceptsLiveChange: (value) => Number.isFinite(Number(value)),
    },
  ],
  [OFFICIAL_PLUGIN_IDS.geminiChatFontSize]: [
    numberBinding('fontSize', StorageKeys.CHAT_FONT_SIZE, normalizeChatFontSizePercent),
  ],
  // Line height and paragraph spacing share one switch, so one plugin.
  [OFFICIAL_PLUGIN_IDS.geminiChatLineHeight]: [
    numberBinding('lineHeight', StorageKeys.CHAT_LINE_HEIGHT, normalizeChatLineHeightPercent),
    numberBinding(
      'paragraphSpacing',
      StorageKeys.CHAT_PARAGRAPH_SPACING,
      normalizeParagraphSpacingPx,
    ),
  ],
  [OFFICIAL_PLUGIN_IDS.geminiChatWidth]: [
    numberBinding('widthPercent', StorageKeys.CHAT_WIDTH, normalizeChatWidthPercent),
  ],
  [OFFICIAL_PLUGIN_IDS.geminiEditInputWidth]: [
    numberBinding('widthPercent', StorageKeys.EDIT_INPUT_WIDTH, normalizeEditInputWidthPercent),
  ],
  // Gemini's hide-archived switch: hide sidebar rows of chats already in a folder.
  [OFFICIAL_PLUGIN_IDS.geminiFolders]: [
    trueOnlyBinding('hideFiledChats', StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS),
  ],
  // AI Studio's own hide-archived switch, separate from Gemini's.
  [OFFICIAL_PLUGIN_IDS.aistudioFolders]: [
    trueOnlyBinding('hideFiledChats', StorageKeys.FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO),
  ],
  [OFFICIAL_PLUGIN_IDS.geminiInputCollapse]: [
    trueOnlyBinding('collapseWhenNotEmpty', StorageKeys.INPUT_COLLAPSE_WHEN_NOT_EMPTY),
  ],
  [OFFICIAL_PLUGIN_IDS.geminiPalette]: [paletteBinding()],
  [OFFICIAL_PLUGIN_IDS.aistudioPalette]: [paletteBinding()],
};

export function legacyValueBindingsFor(
  id: string,
  table: LegacyValueBindingTable = LEGACY_VALUE_BINDINGS,
): readonly LegacyValueBinding[] {
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : [];
}

/** The storage keys behind every value binding, each once. */
export function legacyValueKeys(
  table: LegacyValueBindingTable = LEGACY_VALUE_BINDINGS,
): readonly string[] {
  return [
    ...new Set(
      Object.values(table).flatMap((bindings) =>
        bindings.flatMap((entry) => [entry.legacyKey, ...(entry.additionalKeys ?? [])]),
      ),
    ),
  ];
}

/** The settings of bound official plugin `id`, read from its legacy value keys; `{}` without any. */
export function deriveLegacyValueSettings(
  id: string,
  legacy: LegacySettingSnapshot,
  table: LegacyValueBindingTable = LEGACY_VALUE_BINDINGS,
): PluginSettings {
  const settings: Record<string, number | boolean | VisualEffect | VoyagerPalette> = {};
  for (const entry of legacyValueBindingsFor(id, table)) {
    const stored = Object.prototype.hasOwnProperty.call(legacy, entry.legacyKey)
      ? legacy[entry.legacyKey]
      : undefined;
    settings[entry.settingKey] = entry.read(stored, legacy);
  }
  return settings;
}

/**
 * The sync write that stores manifest setting `settingKey` of bound official
 * plugin `id`: its legacy key, holding the value as the native module reads
 * it. `null` when no value binding fills that setting, which is never a
 * plugin-state write: a bound id ignores its `gvPluginsState` settings.
 */
export function legacyValueWrite(
  id: string,
  settingKey: string,
  value: unknown,
  table: LegacyValueBindingTable = LEGACY_VALUE_BINDINGS,
): Readonly<Record<string, unknown>> | null {
  const entry = legacyValueBindingsFor(id, table).find(
    (candidate) => candidate.settingKey === settingKey,
  );
  if (!entry) return null;
  return { [entry.legacyKey]: entry.read(value) };
}

/**
 * Whether a live change of `key` to `value` reaches the snapshot. A key no
 * value binding reads (an on/off switch) always does.
 */
export function acceptsLegacyLiveChange(
  key: string,
  value: unknown,
  table: LegacyValueBindingTable = LEGACY_VALUE_BINDINGS,
): boolean {
  for (const bindings of Object.values(table)) {
    for (const entry of bindings) {
      if (entry.legacyKey === key && !entry.acceptsLiveChange(value)) return false;
    }
  }
  return true;
}
