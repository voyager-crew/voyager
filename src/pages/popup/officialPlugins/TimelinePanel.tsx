import React from 'react';

import { Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { StorageKeys } from '@/core/types/common';

import { writePopupSyncStorage } from '../utils/popupStorage';
import type { OfficialPanelProps } from './officialPluginPanels';

/**
 * The Show Timeline row's actions, under its declared settings while it is on:
 * forget the dragged rail position, and open the Saved Library.
 */
export function TimelinePanel({ openStarredHistory, t }: OfficialPanelProps) {
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        // A one-off clear, not a setting to show: it skips the pending overlay.
        onClick={() => void writePopupSyncStorage({ [StorageKeys.TIMELINE_POSITION]: null })}
      >
        {t('resetTimelinePosition')}
      </Button>
      {openStarredHistory && (
        <Button variant="outline" size="sm" className="w-full" onClick={openStarredHistory}>
          <span className="flex items-center gap-1.5 text-xs">
            <Star aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t('viewStarredHistory')}
          </span>
        </Button>
      )}
    </div>
  );
}
