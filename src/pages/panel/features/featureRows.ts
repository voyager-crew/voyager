import type { LucideIcon } from 'lucide-react';

import type { PluginStatus } from '@/features/plugins/runtime/pluginStatus';
import {
  resolvePluginSettings,
  unavailableChoices,
} from '@/features/plugins/runtime/resolvePluginSettings';
import { legacyValueWrite } from '@/features/plugins/storage/legacyValueBindings';
import type { PluginManifest, PluginSettingValue } from '@/features/plugins/types';
import {
  displayName,
  pickLocalized,
  pickLocalizedSetting,
} from '@/pages/popup/components/PluginIdentity';
import {
  OFFICIAL_PLUGIN_TOPICS,
  type OfficialPluginTopicId,
} from '@/pages/popup/officialPlugins/officialPluginRegistry';
import type { OfficialPluginRow } from '@/pages/popup/officialPlugins/useOfficialPluginList';
import type { TranslationKey } from '@/utils/translations';

import { fillPlaceholders } from '../panelText';
import { rowIcon, rowTopic } from './rowPresentation';

export type PanelGroupId = 'entry' | OfficialPluginTopicId;

export interface PanelSlider {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The stored reading, in the manifest's units, as the slider shows it. */
  readonly value: number;
  readonly format: (value: number) => string;
  /** Saves one value; the slider calls it once, on release or per keyboard step. */
  readonly commit: (value: number) => void;
}

export interface PanelChip {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly disabled: boolean;
  }[];
  readonly pick: (value: string) => void;
}

export interface PanelRow {
  readonly id: string;
  readonly group: PanelGroupId;
  readonly name: string;
  /** Localized and English names (and an official row's popup search words), lower-cased. */
  readonly search: readonly string[];
  readonly icon: LucideIcon;
  readonly enabled: boolean;
  /** Why the switch can't move, shown as its tooltip. */
  readonly note: string | null;
  readonly locked: boolean;
  readonly toggle: (next: boolean) => void;
  readonly slider?: PanelSlider;
  readonly chip?: PanelChip;
  readonly keyCap?: { readonly label: string; readonly hint: string };
  /** The switch's element id when something outside the panel looks for it. */
  readonly switchId?: string;
}

export interface PanelGroup {
  readonly id: PanelGroupId;
  readonly label: string;
  readonly rows: readonly PanelRow[];
}

export interface RowTexts {
  readonly language: string;
  readonly t: (key: TranslationKey) => string;
  /** The English text of a key, for search. */
  readonly english: (key: TranslationKey) => string;
}

const lower = (texts: readonly (string | undefined)[]) =>
  texts.filter((text): text is string => !!text).map((text) => text.toLowerCase());

/** A popup slider spanning more than this needs a precise input, which full settings keeps. */
const PRECISE_NUMBER_MIN_RANGE = 1000;

/** An official Gemini / AI Studio row: the popup's list row, its first slider and bound choice. */
export function officialPanelRow(
  row: OfficialPluginRow,
  texts: RowTexts,
  write: {
    readonly setEnabled: (pluginId: string, enabled: boolean) => void;
    readonly setSettings: (
      pluginId: string,
      values: Readonly<Record<string, PluginSettingValue>>,
    ) => void;
  },
): PanelRow | null {
  const { manifest, entry, settings } = row;
  // A switch that is a permission flow (response notifications) stays in full settings.
  if (entry.control) return null;
  const { language, t, english } = texts;
  const requirement = row.unmetRequirement;
  const unavailable = requirement !== null && 'note' in requirement;
  const note = requirement
    ? 'note' in requirement
      ? t(requirement.note)
      : fillPlaceholders(t('pluginRowNeedsSetting'), {
          setting: t(requirement.setting),
          card: t(requirement.card),
        })
    : null;
  const fields = manifest.contributes.settings ?? {};
  let slider: PanelSlider | undefined;
  for (const [key, presentation] of Object.entries(entry.sliders ?? {})) {
    const field = fields[key];
    if (field?.type !== 'number') continue;
    const stored = Number(settings[key] ?? field.default);
    slider = {
      key,
      label: presentation.label
        ? t(presentation.label)
        : pickLocalizedSetting(manifest, key, field, language).label,
      min: field.min ?? 0,
      max: field.max ?? 100,
      step: presentation.step,
      value: presentation.toDisplay ? presentation.toDisplay(stored) : stored,
      format: (value) =>
        value === 0 && presentation.zeroLabel
          ? t(presentation.zeroLabel)
          : `${value}${presentation.unit}`,
      commit: (value) => write.setSettings(manifest.id, { [key]: value }),
    };
    break;
  }
  // A choice reaches the page only through a value binding; others stay in full settings.
  const choice = Object.entries(fields).find(
    ([key, field]) =>
      field.type === 'select' && legacyValueWrite(manifest.id, key, field.default) !== null,
  );
  const chip = choice
    ? selectChip(manifest, choice[0], String(settings[choice[0]] ?? choice[1].default), language, {
        unavailable: new Set<string>(),
        pick: (value) => write.setSettings(manifest.id, { [choice[0]]: value }),
      })
    : undefined;
  const name = displayName(pickLocalized(manifest, 'name', language));
  return {
    id: manifest.id,
    group: entry.topic,
    name,
    search: lower([
      name,
      manifest.name,
      ...entry.searchKeys.flatMap((key) => [t(key), english(key)]),
      ...(entry.searchAliases ?? []),
    ]),
    icon: rowIcon(manifest.id),
    enabled: !unavailable && row.enabled,
    note,
    locked: requirement !== null,
    toggle: (next) => write.setEnabled(manifest.id, next),
    slider,
    chip,
  };
}

function selectChip(
  plugin: PluginManifest,
  key: string,
  value: string,
  language: string,
  { unavailable, pick }: { unavailable: ReadonlySet<string>; pick: (value: string) => void },
): PanelChip | undefined {
  const field = plugin.contributes.settings?.[key];
  if (!field) return undefined;
  const localized = pickLocalizedSetting(plugin, key, field, language);
  const options = (localized.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
    disabled: unavailable.has(option.value),
  }));
  return options.length > 1 ? { key, label: localized.label, value, options, pick } : undefined;
}

/** Why a plugin's switch can't turn on here, as the popup's plugin list says it. */
function incompatibleNote(
  status: PluginStatus | undefined,
  plugin: PluginManifest,
  siteLabel: string,
  t: (key: TranslationKey) => string,
): string | null {
  switch (status?.kind) {
    case 'needs-form-factor':
      return t('pluginUnavailableOnMobile');
    case 'needs-engine':
      return fillPlaceholders(t('pluginNeedsNewerVoyager'), {
        engine: status.requiredEngine ?? plugin.engine,
      });
    case 'needs-handler':
      return t('pluginNeedsVoyagerUpdate');
    case 'needs-semantic':
    case 'needs-site-data':
      return fillPlaceholders(t('pluginNeedsSiteAdapterUpdate'), { site: siteLabel });
    default:
      return null;
  }
}

export interface CatalogRowInputs {
  readonly texts: RowTexts;
  readonly enabled: boolean;
  readonly stored: Readonly<Record<string, PluginSettingValue>> | undefined;
  readonly status: PluginStatus | undefined;
  readonly siteLabel: string;
  readonly toggle: (next: boolean) => void;
  readonly save: (key: string, value: PluginSettingValue) => void;
}

/** A plugin row on any site: its manifest's name, first number setting and first choice. */
export function catalogPanelRow(plugin: PluginManifest, inputs: CatalogRowInputs): PanelRow {
  const { texts, enabled, status, save } = inputs;
  const { language, t } = texts;
  const resolved = resolvePluginSettings(plugin, inputs.stored);
  const fields = Object.entries(plugin.contributes.settings ?? {}).filter(
    ([, field]) => field.enabledBy === undefined || resolved[field.enabledBy] === true,
  );
  const number = fields.find(
    ([, field]) =>
      field.type === 'number' && (field.max ?? 100) - (field.min ?? 0) <= PRECISE_NUMBER_MIN_RANGE,
  );
  const slider: PanelSlider | undefined = number && {
    key: number[0],
    label: number[1].messageKeys
      ? t(number[1].messageKeys.label)
      : pickLocalizedSetting(plugin, number[0], number[1], language).label,
    min: number[1].min ?? 0,
    max: number[1].max ?? 100,
    step: 1,
    value: Number(resolved[number[0]]),
    format: (value) => String(value),
    commit: (value) => save(number[0], value),
  };
  const select = fields.find(([, field]) => field.type === 'select');
  const chip = select
    ? selectChip(plugin, select[0], String(resolved[select[0]]), language, {
        unavailable: unavailableChoices(plugin, resolved, select[0]),
        pick: (value) => save(select[0], value),
      })
    : undefined;
  const name = displayName(pickLocalized(plugin, 'name', language));
  const note = incompatibleNote(status, plugin, inputs.siteLabel, t);
  return {
    id: plugin.id,
    group: rowTopic(plugin),
    name,
    search: lower([name, plugin.name, displayName(plugin.name)]),
    icon: rowIcon(plugin.id),
    enabled,
    note,
    locked: !enabled && note !== null,
    toggle: inputs.toggle,
    slider,
    chip,
  };
}

/** "入口" first, then the official topics in their order; rows keep the order given. */
export function groupPanelRows(
  rows: readonly PanelRow[],
  t: (key: TranslationKey) => string,
): PanelGroup[] {
  const order: readonly { id: PanelGroupId; label: string }[] = [
    { id: 'entry', label: t('panelEntryGroup') },
    ...OFFICIAL_PLUGIN_TOPICS.map((topic) => ({ id: topic.id, label: t(topic.tocLabel) })),
  ];
  return order.flatMap(({ id, label }) => {
    const members = rows.filter((row) => row.group === id);
    return members.length ? [{ id, label, rows: members }] : [];
  });
}

/** Rows whose localized or English name (or search words) contain the query. */
export function filterPanelGroups(groups: readonly PanelGroup[], query: string): PanelGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups.flatMap((group) => {
    const rows = group.rows.filter((row) => row.search.some((text) => text.includes(needle)));
    return rows.length ? [{ ...group, rows }] : [];
  });
}

/** Two columns in reading order, split where their heights (rows plus a label) come closest. */
export function splitColumns(groups: readonly PanelGroup[]): [PanelGroup[], PanelGroup[]] {
  const weights = groups.map((group) => group.rows.length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let best = groups.length > 0 ? 1 : 0;
  let bestGap = Number.POSITIVE_INFINITY;
  let left = 0;
  for (let index = 0; index < groups.length; index += 1) {
    left += weights[index];
    const gap = Math.abs(total - 2 * left);
    if (gap < bestGap) {
      bestGap = gap;
      best = index + 1;
    }
  }
  return [groups.slice(0, best), groups.slice(best)];
}
