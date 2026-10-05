/**
 * Static timeline replica shown by the timeline-style coachmarks while the live
 * rail is hidden. Markers carry both layouts (full-height dots and centred
 * ticks) so CSS can morph between styles by toggling one class.
 */
import { denseMarkerOffsets } from '@/features/timeline/denseMarkerLayout';

const PREVIEW_MARKER_COUNT = 14;

export const TIMELINE_STYLE_PREVIEW_ACTIVE_INDEX = Math.floor(PREVIEW_MARKER_COUNT / 2);

function createTimelineStylePreview(
  styleClass: string,
  decorateMarker?: (marker: HTMLElement, index: number) => void,
): HTMLElement {
  const preview = document.createElement('div');
  preview.className = `gv-timeline-style-preview ${styleClass}`;
  preview.setAttribute('aria-hidden', 'true');

  const last = PREVIEW_MARKER_COUNT - 1;
  const denseOffsets = denseMarkerOffsets(PREVIEW_MARKER_COUNT);
  for (let index = 0; index < PREVIEW_MARKER_COUNT; index += 1) {
    const marker = document.createElement('span');
    marker.style.setProperty('--gv-coach-n', String(index / last));
    marker.style.setProperty('--gv-coach-offset', `${denseOffsets[index]}px`);
    if (index === TIMELINE_STYLE_PREVIEW_ACTIVE_INDEX) marker.className = 'active';
    decorateMarker?.(marker, index);
    preview.appendChild(marker);
  }

  return preview;
}

const LIVE_PLACEMENT_PROPERTIES = ['top', 'left', 'right'] as const;
const LIVE_INWARD_RIGHT_CLASS = 'gv-timeline-ruler-inward-right';

/**
 * Mirror the live rail's placement, width, container visibility and tick
 * direction. Both share the same CSS anchors (top, right/left, bottom), so only
 * the rail's inline placement is copied and the viewport keeps both in step.
 */
function mirrorLiveRail(preview: HTMLElement, liveBar: HTMLElement): void {
  for (const property of LIVE_PLACEMENT_PROPERTIES) {
    preview.style.setProperty(property, liveBar.style.getPropertyValue(property));
  }
  const barWidth = liveBar.style.getPropertyValue('--timeline-bar-width');
  preview.style.setProperty('--timeline-bar-width', barWidth);
  preview.classList.toggle('gv-no-rail', liveBar.classList.contains('timeline-no-container'));
  preview.classList.toggle('gv-inward-right', liveBar.classList.contains(LIVE_INWARD_RIGHT_CLASS));
}

/** Without a live rail the replica sits at the CSS default; point its ticks inward once. */
function pointTicksInward(preview: HTMLElement): void {
  const rect = preview.getBoundingClientRect();
  if (rect.width <= 0) return;
  const center = rect.left + rect.width / 2;
  preview.classList.toggle('gv-inward-right', center < window.innerWidth / 2);
}

export interface TimelineStylePreview {
  element: HTMLElement;
  destroy: () => void;
}

export function mountTimelineStylePreview(
  styleClass: string,
  liveBar: HTMLElement | null,
  decorateMarker?: (marker: HTMLElement, index: number) => void,
): TimelineStylePreview {
  const element = createTimelineStylePreview(styleClass, decorateMarker);
  document.body.appendChild(element);
  if (!liveBar) {
    pointTicksInward(element);
    return { element, destroy: () => element.remove() };
  }

  mirrorLiveRail(element, liveBar);
  // The hidden live rail keeps re-placing itself on resize (debounced, via
  // inline top/left); follow it so the guide's rail cannot be left offscreen.
  const observer = new MutationObserver(() => mirrorLiveRail(element, liveBar));
  observer.observe(liveBar, { attributes: true, attributeFilter: ['style', 'class'] });
  return {
    element,
    destroy: () => {
      observer.disconnect();
      element.remove();
    },
  };
}
