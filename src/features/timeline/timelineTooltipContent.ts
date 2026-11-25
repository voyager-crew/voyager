import type { TimelineTooltipContent } from './TimelineTooltip';
import type { DotElement, TimelineMarker } from './types';

export interface TimelineTooltipSources {
  readonly markerMap: ReadonlyMap<string, TimelineMarker>;
  readonly isStarred: (id: string) => boolean;
  readonly formatTimestamp: (id: string) => string | null | undefined;
}

/** A dot's tooltip: its label, a star mark and the send time when the site keeps one. */
export function timelineTooltipContent(
  dot: DotElement,
  sources: TimelineTooltipSources,
): TimelineTooltipContent {
  const id = dot.dataset.targetTurnId ?? '';
  const marker = sources.markerMap.get(id);
  let text = (dot.getAttribute('aria-label') || '').trim();
  if (id && sources.isStarred(id)) text = `★ ${text}`;
  const timestamp = sources.formatTimestamp(id);
  if (timestamp) text = timestamp + '\n' + text;
  return {
    text,
    summary: marker?.summary ?? dot.getAttribute('aria-label') ?? '',
    assistantSummary: marker?.assistantSummary ?? '',
    starred: sources.isStarred(id),
    timestamp: id ? (sources.formatTimestamp(id) ?? null) : null,
  };
}
