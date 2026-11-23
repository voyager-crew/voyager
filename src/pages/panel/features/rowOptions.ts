/**
 * A row's declared settings as the in-page panel shows them: the first number
 * as the row's slider and the first choice as its chip, and every other one in
 * the row's options area (a boolean as a switch, a choice as a chip, a number
 * that has a slider presentation as a slider). Built from the manifest's
 * `contributes.settings`, so a setting declared once shows here as it does in
 * the popup row.
 */
import { isFontSizeSetting } from '@/features/plugins/runtime/fontSizeSetting';
import {
  compatibleSettingWrite,
  unavailableChoices,
} from '@/features/plugins/runtime/resolvePluginSettings';
import type {
  PluginManifest,
  PluginSettingValue,
  PluginSettings,
  SettingField,
} from '@/features/plugins/types';
import { pickLocalizedSetting } from '@/pages/popup/components/PluginIdentity';
import type { OfficialPluginSlider } from '@/pages/popup/officialPlugins/officialPluginRegistry';
import type { TranslationKey } from '@/utils/translations';

import type { PanelChip, PanelSlider } from './featureRows';

/** A declared setting under its row, in declaration order. */
export type PanelOption =
  | {
      readonly kind: 'switch';
      readonly key: string;
      readonly label: string;
      readonly checked: boolean;
      /** Its `enabledBy` switch is off; the value is kept. */
      readonly disabled: boolean;
      readonly set: (next: boolean) => void;
    }
  | { readonly kind: 'chip'; readonly key: string; readonly chip: PanelChip }
  | { readonly kind: 'slider'; readonly key: string; readonly slider: PanelSlider };

export interface DeclaredSettingsInput {
  readonly plugin: PluginManifest;
  /** The resolved values, as the popup row shows them. */
  readonly values: PluginSettings;
  readonly language: string;
  readonly t: (key: TranslationKey) => string;
  /** Whether a setting reaches the page from here (an official row: through its value binding). */
  readonly offers: (key: string) => boolean;
  /** How each number setting shows as a slider; a number without one stays in full settings. */
  readonly sliders?: Readonly<Record<string, OfficialPluginSlider>>;
  /** Saves one write's values: a choice a boolean requires travels with it. */
  readonly save: (values: Readonly<Record<string, PluginSettingValue>>) => void;
}

/** The label the popup shows: the extension's own message when the manifest names one. */
export function settingLabel(
  plugin: PluginManifest,
  key: string,
  field: SettingField,
  language: string,
  t: (key: TranslationKey) => string,
): string {
  return field.messageKeys
    ? t(field.messageKeys.label)
    : pickLocalizedSetting(plugin, key, field, language).label;
}

/** A choice as a chip, or nothing when it offers a single option. */
export function selectChip(
  plugin: PluginManifest,
  key: string,
  value: string,
  label: string,
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
  return options.length > 1 ? { key, label, value, options, pick } : undefined;
}

/** A number setting with its slider presentation, saving on release. */
export function presentedSlider(
  input: DeclaredSettingsInput,
  key: string,
  presentation: OfficialPluginSlider,
): PanelSlider | undefined {
  const { plugin, values, language, t } = input;
  const field = plugin.contributes.settings?.[key];
  if (field?.type !== 'number') return undefined;
  const stored = Number(values[key] ?? field.default);
  return {
    key,
    label: presentation.label
      ? t(presentation.label)
      : pickLocalizedSetting(plugin, key, field, language).label,
    min: field.min ?? 0,
    max: field.max ?? 100,
    step: presentation.step,
    value: presentation.toDisplay ? presentation.toDisplay(stored) : stored,
    format: (value) =>
      value === 0 && presentation.zeroLabel
        ? t(presentation.zeroLabel)
        : `${value}${presentation.unit}`,
    commit: (value) => input.save({ [key]: value }),
    fontSizeResetLabel: isFontSizeSetting(plugin, key)
      ? `${t('themeColorReset')} (100%)`
      : undefined,
  };
}

function write(input: DeclaredSettingsInput, key: string, value: PluginSettingValue): void {
  input.save(compatibleSettingWrite(input.plugin, { key, value }).stored);
}

/** The chip of choice `key`, with the options a `requiresChoice` switch rules out disabled. */
export function declaredChip(input: DeclaredSettingsInput, key: string): PanelChip | undefined {
  const { plugin, values, language, t } = input;
  const field = plugin.contributes.settings?.[key];
  if (field?.type !== 'select') return undefined;
  return selectChip(
    plugin,
    key,
    String(values[key] ?? field.default),
    settingLabel(plugin, key, field, language, t),
    language,
    {
      unavailable: unavailableChoices(plugin, values, key),
      pick: (value) => write(input, key, value),
    },
  );
}

/** Every declared setting the row's own slider and chip leave out, in declaration order. */
export function declaredOptions(
  input: DeclaredSettingsInput,
  inline: ReadonlySet<string>,
): PanelOption[] {
  const { plugin, values, language, t } = input;
  const options: PanelOption[] = [];
  for (const [key, field] of Object.entries(plugin.contributes.settings ?? {})) {
    if (inline.has(key) || !input.offers(key)) continue;
    if (field.type === 'boolean') {
      options.push({
        kind: 'switch',
        key,
        label: settingLabel(plugin, key, field, language, t),
        checked: values[key] === true,
        disabled: field.enabledBy !== undefined && values[field.enabledBy] !== true,
        set: (next) => write(input, key, next),
      });
    } else if (field.type === 'select') {
      const chip = declaredChip(input, key);
      if (chip) options.push({ kind: 'chip', key, chip });
    } else if (field.type === 'number') {
      const presentation = input.sliders?.[key];
      const slider = presentation && presentedSlider(input, key, presentation);
      if (slider) options.push({ kind: 'slider', key, slider });
    }
  }
  return options;
}
