import React from 'react';

import { Switch } from '@/components/ui/switch';
import { StorageKeys } from '@/core/types/common';
import { resolveVisualEffect } from '@/core/utils/visualEffectValues';
import type { LegacySettingSnapshot } from '@/features/plugins/storage/legacySettingBindings';
import type { TranslationKey } from '@/utils/translations';

import { VisualEffectChoices } from '../components/VisualEffectChoices';
import { ContextSyncPanel } from './ContextSyncPanel';
import { TimelinePanel } from './TimelinePanel';
import type { OfficialPanelId } from './officialPluginRegistry';
import type { ContextSyncRequest } from './useContextSyncRequest';

/** What every panel gets: its keys from the live snapshot, and the overlay's writer. */
export interface OfficialPanelProps {
  readonly values: LegacySettingSnapshot;
  readonly write: (payload: Record<string, unknown>) => void;
  /** Context Sync's request, kept above the panel so it outlives a collapse. */
  readonly contextSync?: ContextSyncRequest;
  /** Opens the Saved Library (starred messages) view of the popup. */
  readonly openStarredHistory?: () => void;
  /** The row's id, for ids unique per row. */
  readonly idPrefix: string;
  readonly t: (key: TranslationKey) => string;
}

/**
 * Gemini and AI Studio share one switch and one set of formula options, each
 * declared in its manifest; this says so under either row.
 */
function FormulaCopyPanel({ t }: OfficialPanelProps) {
  return (
    <p className="text-muted-foreground text-[11px] leading-snug">{t('formulaCopyScopeNote')}</p>
  );
}

/** Whether saved highlights also mark the timeline; the highlights themselves stay. */
function HighlightPanel({ values, write, idPrefix, t }: OfficialPanelProps) {
  // On unless stored off, as the highlight runtime reads it.
  const markers = values[StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED] !== false;
  const hintId = `${idPrefix}-markers-hint`;
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0 flex-1">
        <span className="text-foreground/80 block text-xs">
          {t('showHighlightTimelineMarkers')}
        </span>
        <span id={hintId} className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">
          {t('showHighlightTimelineMarkersHint')}
        </span>
      </span>
      <Switch
        size="sm"
        checked={markers}
        aria-label={t('showHighlightTimelineMarkers')}
        aria-describedby={hintId}
        onChange={(event) =>
          write({ [StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED]: event.target.checked })
        }
      />
    </div>
  );
}

/**
 * The effect to show while the row is on (Off is its switch). Picking writes the
 * pair the retired Visual Effects card wrote, clearing the legacy snow flag.
 */
function VisualEffectPanel({ values, write, t }: OfficialPanelProps) {
  const effect = resolveVisualEffect(
    values[StorageKeys.GV_VISUAL_EFFECT],
    values[StorageKeys.GV_SNOW_EFFECT],
  );
  return (
    <VisualEffectChoices
      value={effect}
      onChange={(next) =>
        write({ [StorageKeys.GV_VISUAL_EFFECT]: next, [StorageKeys.GV_SNOW_EFFECT]: false })
      }
      t={t}
      className="mt-2"
    />
  );
}

export const OFFICIAL_PANELS: Readonly<
  Record<OfficialPanelId, (props: OfficialPanelProps) => React.ReactElement>
> = {
  formulaCopy: FormulaCopyPanel,
  highlight: HighlightPanel,
  contextSync: ContextSyncPanel,
  visualEffect: VisualEffectPanel,
  timeline: TimelinePanel,
};
