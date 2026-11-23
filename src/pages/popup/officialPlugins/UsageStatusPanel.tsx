import React from 'react';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { StorageKeys } from '@/core/types/common';
import { type UsageDisplay, resolveUsageDisplay } from '@/core/utils/usageDisplayValues';
import type { TranslationKey } from '@/utils/translations';

import type { OfficialPanelProps } from './officialPluginPanels';

const DISPLAY_OPTIONS: readonly { value: UsageDisplay; label: TranslationKey }[] = [
  { value: 'used', label: 'usageStatusDisplayUsed' },
  { value: 'remaining', label: 'usageStatusDisplayRemaining' },
];

/** Whether Gemini's usage bars count what is used or what is left; open tabs follow it live. */
export function UsageStatusPanel({ values, write, t }: OfficialPanelProps) {
  const display = resolveUsageDisplay(values[StorageKeys.USAGE_STATUS_DISPLAY]);
  const label = t('usageStatusDisplay');
  return (
    <div>
      <p aria-hidden="true" className="text-foreground/80 mb-1.5 text-xs">
        {label}
      </p>
      <SegmentedControl
        aria-label={label}
        options={DISPLAY_OPTIONS.map((option) => ({
          value: option.value,
          label: t(option.label),
        }))}
        value={display}
        onChange={(next) => write({ [StorageKeys.USAGE_STATUS_DISPLAY]: next })}
      />
    </div>
  );
}
