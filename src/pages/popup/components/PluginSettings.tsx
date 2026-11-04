import { FontSizeSlider } from '@/components/ui/font-size-slider';
import { FontSizeValue } from '@/components/ui/font-size-value';
import { isFontSizeSetting } from '@/features/plugins/runtime/fontSizeSetting';
import {
  compatibleSettingWrite,
  resolvePluginSettings,
  unavailableChoices,
} from '@/features/plugins/runtime/resolvePluginSettings';
import type { PluginManifest, PluginSettingValue } from '@/features/plugins/types';

import { Select } from '../../../components/ui/input';
import { Slider } from '../../../components/ui/slider';
import { SliderRow } from '../../../components/ui/slider-row';
import { Switch } from '../../../components/ui/switch';
import { useLanguage } from '../../../contexts/LanguageContext';
import { ExperimentalBadge } from './ExperimentalBadge';
import { NumberSetting } from './NumberSetting';
import { pickLocalized, pickLocalizedSetting } from './PluginIdentity';

/**
 * A popup slider track is a few hundred pixels wide, so a span up to 1,000 still
 * lands on the value people want — reading width (600–1,600) keeps its
 * original display. Font size always has a precise decimal input. Wider spans
 * also need a number input (the Pro weekly allowance is 0–10,000 but useful
 * values are 50/100/200).
 */
const PRECISE_NUMBER_MIN_RANGE = 1000;

interface PluginSettingsProps {
  readonly plugin: PluginManifest;
  readonly values?: Record<string, PluginSettingValue>;
  /** Fields already offered by a visible dedicated settings card. */
  readonly hiddenKeys?: readonly string[];
  readonly handleSetting: (id: string, key: string, value: PluginSettingValue) => void;
  readonly handleImmediateSettings: (
    id: string,
    values: Readonly<Record<string, PluginSettingValue>>,
  ) => void;
}

export function PluginSettings({
  plugin,
  values,
  hiddenKeys,
  handleSetting,
  handleImmediateSettings,
}: PluginSettingsProps) {
  const { language, t } = useLanguage();
  const settingsSchema = plugin.contributes.settings;
  const localizedName = pickLocalized(plugin, 'name', language);
  const resolved = resolvePluginSettings(plugin, values);
  if (!settingsSchema) return null;
  const entries = Object.entries(settingsSchema).filter(([key]) => !hiddenKeys?.includes(key));
  if (entries.length === 0) return null;
  const writeNow = (key: string, value: PluginSettingValue) =>
    handleImmediateSettings(plugin.id, compatibleSettingWrite(plugin, { key, value }).stored);
  return (
    <div className="mt-2 space-y-2.5" role="group" aria-label={localizedName}>
      {entries.map(([key, field]) => {
        const rawValue = resolved[key];
        const localized = pickLocalizedSetting(plugin, key, field, language);
        const settingText = field.messageKeys
          ? { ...localized, label: t(field.messageKeys.label) }
          : localized;
        const hint = field.messageKeys?.hint ? t(field.messageKeys.hint) : undefined;
        // CSS-gated controls must stay inert until their controlling switch is on.
        const disabled = field.enabledBy !== undefined && resolved[field.enabledBy] !== true;

        if (field.type === 'boolean') {
          const checked = rawValue === true;
          return (
            <div
              key={key}
              className={`flex justify-between gap-3 ${hint ? 'items-start' : 'items-center'}`}
            >
              <span className={`min-w-0 flex-1 ${disabled ? 'opacity-50' : ''}`}>
                <span className="text-foreground/80 flex items-center gap-1 text-xs">
                  {settingText.label}
                  {field.experimental && <ExperimentalBadge title={t('experimentalLabel')} />}
                </span>
                {hint && (
                  <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
                    {hint}
                  </span>
                )}
              </span>
              <Switch
                size="sm"
                checked={checked}
                disabled={disabled}
                aria-label={settingText.label}
                onChange={(event) => writeNow(key, event.target.checked)}
              />
            </div>
          );
        }

        if (field.type === 'select') {
          const unavailable = unavailableChoices(plugin, resolved, key);
          return (
            <label
              key={key}
              className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}
            >
              <span className="text-foreground/80 min-w-0 text-xs">{settingText.label}</span>
              <Select
                size="sm"
                value={String(rawValue)}
                disabled={disabled}
                onChange={(event) => writeNow(key, event.target.value)}
              >
                {settingText.options?.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={unavailable.has(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          );
        }

        if (field.type !== 'number') return null;
        const value = Number(rawValue);
        const min = field.min ?? 0;
        const max = field.max ?? 100;
        const fontSize = isFontSizeSetting(plugin, key);
        const Range = fontSize ? FontSizeSlider : Slider;
        const needsPreciseInput = max - min > PRECISE_NUMBER_MIN_RANGE;
        return (
          <SliderRow
            key={key}
            title={`${settingText.label}: ${value}`}
            className={disabled ? 'opacity-50' : undefined}
            label={settingText.label}
            value={
              fontSize ? (
                <FontSizeValue
                  label={settingText.label}
                  resetLabel={`${t('themeColorReset')} (100%)`}
                  value={value}
                  min={min}
                  max={max}
                  disabled={disabled}
                  onCommit={(next) => handleSetting(plugin.id, key, next)}
                />
              ) : needsPreciseInput ? (
                <NumberSetting
                  label={settingText.label}
                  value={value}
                  min={min}
                  max={max}
                  disabled={disabled}
                  onChange={(next) => handleSetting(plugin.id, key, next)}
                />
              ) : (
                String(value)
              )
            }
            // Under the label row, not beside the value: a long hint gets the card's full width.
            hint={hint}
            minLabel={settingText.minLabel}
            maxLabel={settingText.maxLabel}
          >
            <Range
              min={min}
              max={max}
              value={value}
              disabled={disabled}
              aria-label={settingText.label}
              onValueChange={(next) => handleSetting(plugin.id, key, next)}
            />
          </SliderRow>
        );
      })}
    </div>
  );
}
