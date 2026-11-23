/**
 * The official Gemini / AI Studio plugins the popup lists, and how it presents
 * them: topic card, order and the search words their old settings rows answered
 * to. Presentation only: whether a plugin runs, and which storage holds its
 * switch, stay with `featureOwners.ts` and the legacy bindings.
 *
 * The rows live in `officialPluginEntries.ts`. A plugin joins that table in the
 * same change that removes its old settings row, so one switch never shows twice (see
 * `README.md` in this directory).
 */
import { StorageKeys } from '@/core/types/common';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import {
  type LegacySettingSnapshot,
  legacyBindingKeys,
} from '@/features/plugins/storage/legacySettingBindings';
import type { TranslationKey } from '@/utils/translations';

import type { OfficialPluginTopicId } from '../utils/nativeSiteCapabilities';
import { OFFICIAL_PLUGIN_ENTRIES } from './officialPluginEntries';

export type { OfficialPluginTopicId };

/** A topic card of the official plugin list: its title, and its shorter table-of-contents link. */
export interface OfficialPluginTopic {
  readonly id: OfficialPluginTopicId;
  readonly title: TranslationKey;
  readonly tocLabel: TranslationKey;
}

/** The topic cards, in their default order; each is a popup section (`OFFICIAL_PLUGIN_TOPIC_IDS`). */
export const OFFICIAL_PLUGIN_TOPICS: readonly OfficialPluginTopic[] = [
  { id: 'pluginsLayout', title: 'pluginTopicLayout', tocLabel: 'pluginTopicLayoutShort' },
  { id: 'pluginsSidebar', title: 'pluginTopicSidebar', tocLabel: 'pluginTopicSidebarShort' },
  { id: 'pluginsTimeline', title: 'pluginTopicTimeline', tocLabel: 'pluginTopicTimelineShort' },
  { id: 'pluginsContent', title: 'pluginTopicContent', tocLabel: 'pluginTopicContentShort' },
  { id: 'pluginsCharts', title: 'pluginTopicCharts', tocLabel: 'pluginTopicChartsShort' },
  { id: 'pluginsExport', title: 'pluginTopicExport', tocLabel: 'pluginTopicExportShort' },
  { id: 'pluginsInput', title: 'pluginTopicInput', tocLabel: 'pluginTopicInputShort' },
  {
    id: 'pluginsConversations',
    title: 'pluginTopicConversations',
    tocLabel: 'pluginTopicConversationsShort',
  },
];

const TOPIC_BY_ID = new Map(OFFICIAL_PLUGIN_TOPICS.map((topic) => [topic.id, topic]));

export function officialPluginTopic(id: OfficialPluginTopicId): OfficialPluginTopic {
  return TOPIC_BY_ID.get(id)!;
}

export interface OfficialPluginEntry {
  readonly id: string;
  /** The topic card the row sits in. */
  readonly topic: OfficialPluginTopicId;
  /** The retired settings row's label and hint, so its old search words still find the row. */
  readonly searchKeys: readonly TranslationKey[];
  /** The title of the card the row left: a remembered "General Options" search still shows it. */
  readonly formerSectionTitle?: TranslationKey;
  readonly searchAliases?: readonly string[];
  readonly experimental?: boolean;
  /** Whether the row applies in this popup at all; listed everywhere its manifest matches when absent. */
  readonly eligible?: (context: OfficialPluginContext) => boolean;
  /**
   * How to use the feature once it is on (a shortcut, the keys it takes), shown
   * under the description while the row is on. `{modifier}` reads Ctrl or ⌘.
   */
  readonly usageHint?: TranslationKey | ((context: OfficialPluginContext) => TranslationKey | null);
  /** What the manifest can't declare (a note, an action, a live probe), under the row while it is on. */
  readonly panel?: OfficialPanelId;
  /** A control shown in place of the manifest's own settings, under the row while it is on. */
  readonly inlinePanel?: OfficialPanelId;
  /** A switch that is not a plain write (a permission flow); the popup supplies it. */
  readonly control?: OfficialControlId;
  /**
   * A prerequisite the feature cannot run without. An unmet setting disables
   * the switch; a note explains an unavailable feature and shows it off.
   */
  readonly requires?: {
    readonly met: (snapshot: LegacySettingSnapshot) => boolean;
  } & (
    | { readonly setting: TranslationKey; readonly card: TranslationKey }
    | { readonly note: TranslationKey }
  );
  /** The switch's sync write when one key is not enough, read against what the popup shows. */
  readonly enableWrite?: (
    enabled: boolean,
    shown: LegacySettingSnapshot,
  ) => Readonly<Record<string, unknown>>;
  /** One slider per number setting of the manifest, keyed by setting. */
  readonly sliders?: Readonly<Record<string, OfficialPluginSlider>>;
}

/** How a number setting shows as a slider; the range comes from the manifest. */
export interface OfficialPluginSlider {
  /** The manifest's localized setting label when absent. */
  readonly label?: TranslationKey;
  readonly minLabel: TranslationKey;
  readonly maxLabel: TranslationKey;
  readonly step: number;
  readonly unit: '%' | 'px' | '';
  /** What 0 reads as, when it means something other than a number. */
  readonly zeroLabel?: TranslationKey;
  /** What a stored reading looks like on this slider, when the two differ. */
  readonly toDisplay?: (value: number) => number;
}

export type OfficialPanelId = 'formulaCopy' | 'contextSync' | 'visualEffect' | 'timeline';
export type OfficialControlId = 'responseNotification';

/**
 * The sync keys each panel shows. The runtime reads them itself (no value
 * binding pushes them as plugin settings), so only the popup's snapshot
 * carries them, for the panels to show live.
 */
export const OFFICIAL_PANEL_KEYS: Readonly<Record<OfficialPanelId, readonly string[]>> = {
  formulaCopy: [],
  contextSync: [StorageKeys.CONTEXT_SYNC_PORT],
  visualEffect: [StorageKeys.GV_VISUAL_EFFECT, StorageKeys.GV_SNOW_EFFECT],
  timeline: [],
};

export const OFFICIAL_PANEL_STORAGE_KEYS: readonly string[] = [
  ...new Set(Object.values(OFFICIAL_PANEL_KEYS).flat()),
];

/** What the popup's legacy snapshot reads and follows: every binding key plus the panels' own. */
export const POPUP_LEGACY_SNAPSHOT_KEYS: readonly string[] = [
  ...new Set([...legacyBindingKeys(), ...OFFICIAL_PANEL_STORAGE_KEYS]),
];

/**
 * A plugin this device does not run (its manifest's `requires.formFactors`
 * leaves it out): the row shows it off and greyed, with why, and keeps the
 * stored choice for the user's other devices.
 */
export const UNAVAILABLE_ON_THIS_DEVICE: NonNullable<OfficialPluginEntry['requires']> = {
  met: () => false,
  note: 'pluginUnavailableOnMobile',
};

/** What a row's eligibility may depend on besides the active tab. */
export interface OfficialPluginContext {
  readonly isSafariBrowser: boolean;
}

/** Array order is the display order within each topic card. */
export { OFFICIAL_PLUGIN_ENTRIES };

/**
 * Official plugins whose switch is still an older settings card's: they get no
 * row, so one switch never shows twice. Gemini's and AI Studio's folders follow
 * the Folders card (`geminiFolderEnabled`, and each site's hide-archived switch).
 */
export const SWITCHED_BY_SETTINGS_CARD: ReadonlySet<string> = new Set([
  OFFICIAL_PLUGIN_IDS.geminiFolders,
  OFFICIAL_PLUGIN_IDS.aistudioFolders,
]);

const ENTRY_BY_ID = new Map(OFFICIAL_PLUGIN_ENTRIES.map((entry) => [entry.id, entry]));

export function officialPluginEntry(id: string): OfficialPluginEntry | null {
  return ENTRY_BY_ID.get(id) ?? null;
}
