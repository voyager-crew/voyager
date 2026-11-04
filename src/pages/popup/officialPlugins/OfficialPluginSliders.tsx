import React, { useEffect, useRef, useState } from 'react';

import { FontSizeSlider } from '@/components/ui/font-size-slider';
import { FontSizeValue } from '@/components/ui/font-size-value';
import { Slider } from '@/components/ui/slider';
import { SliderRow } from '@/components/ui/slider-row';
import { isFontSizeSetting } from '@/features/plugins/runtime/fontSizeSetting';
import type { PluginManifest, PluginSettingValue, PluginSettings } from '@/features/plugins/types';
import type { TranslationKey } from '@/utils/translations';

import { pickLocalizedSetting } from '../components/PluginIdentity';
import type { OfficialPluginSlider } from './officialPluginRegistry';

interface PluginSliderProps {
  readonly id: string;
  readonly label: string;
  readonly presentation: OfficialPluginSlider;
  readonly min: number;
  readonly max: number;
  /** The stored reading, as the slider shows it. */
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly t: (key: TranslationKey) => string;
  readonly fontSize: boolean;
}

function PluginSlider({
  id,
  label,
  presentation,
  min,
  max,
  value,
  onCommit,
  t,
  fontSize,
}: PluginSliderProps) {
  const [draft, setDraft] = useState(value);
  const dragging = useRef(false);
  // Follow storage (a restore, another window) except while the user holds the thumb.
  useEffect(() => {
    if (!dragging.current) setDraft(value);
  }, [value]);
  const shown =
    draft === 0 && presentation.zeroLabel
      ? t(presentation.zeroLabel)
      : `${draft}${presentation.unit}`;
  const Range = fontSize ? FontSizeSlider : Slider;
  return (
    <SliderRow
      className="mt-2.5"
      label={label}
      labelId={id}
      value={
        fontSize ? (
          <FontSizeValue
            label={label}
            resetLabel={`${t('themeColorReset')} (100%)`}
            value={draft}
            min={min}
            max={max}
            onCommit={(next) => {
              dragging.current = false;
              setDraft(next);
              onCommit(next);
            }}
          />
        ) : (
          shown
        )
      }
      minLabel={t(presentation.minLabel)}
      maxLabel={t(presentation.maxLabel)}
    >
      <Range
        min={min}
        max={max}
        step={presentation.step}
        value={draft}
        aria-labelledby={id}
        aria-valuetext={shown}
        onValueChange={(next) => {
          dragging.current = true;
          setDraft(next);
        }}
        onValueCommit={(next) => {
          const moved = dragging.current;
          dragging.current = false;
          // Only a value the user moved writes. A bare click must not save the browser's
          // step-snapped reading (312 shows as 316 on a 180 + 8n sidebar grid), and a
          // stored legacy sidebar percentage stays as it is until a new width is picked.
          if (!moved || next === value) {
            setDraft(value);
            return;
          }
          setDraft(next);
          onCommit(next);
        }}
      />
    </SliderRow>
  );
}

/**
 * The number settings of an enabled official plugin row, one slider each,
 * saved when the user releases the thumb or finishes a keyboard step: a sync
 * write per drag step would burn through the storage write quota.
 */
export function OfficialPluginSliders({
  manifest,
  sliders,
  settings,
  onCommit,
  language,
  t,
}: {
  readonly manifest: PluginManifest;
  readonly sliders: Readonly<Record<string, OfficialPluginSlider>>;
  readonly settings: PluginSettings;
  readonly onCommit: (values: Readonly<Record<string, PluginSettingValue>>) => void;
  readonly language: string;
  readonly t: (key: TranslationKey) => string;
}) {
  const fields = manifest.contributes.settings ?? {};
  return (
    <div role="group" className="mt-1">
      {Object.entries(sliders).map(([key, presentation]) => {
        const field = fields[key];
        if (field?.type !== 'number') return null;
        const stored = Number(settings[key] ?? field.default);
        const value = presentation.toDisplay ? presentation.toDisplay(stored) : stored;
        return (
          <PluginSlider
            key={key}
            id={`official-plugin-slider-${manifest.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${key}`}
            label={
              presentation.label
                ? t(presentation.label)
                : pickLocalizedSetting(manifest, key, field, language).label
            }
            presentation={presentation}
            fontSize={isFontSizeSetting(manifest, key)}
            min={field.min ?? 0}
            max={field.max ?? 100}
            value={value}
            onCommit={(next) => onCommit({ [key]: next })}
            t={t}
          />
        );
      })}
    </div>
  );
}
