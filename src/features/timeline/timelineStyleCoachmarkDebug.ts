import { maybeShowTimelineStyleCoachmark } from './timelineStyleCoachmark';

export const TIMELINE_STYLE_COACHMARK_DEBUG_EVENT = 'gv:debug:timelineStyleCoachmark';

/** Debug hooks belong to the active rail, including a guide still awaiting translations. */
export function startTimelineStyleCoachmarkDebug(signal: AbortSignal): () => void {
  const show = () => {
    if (!signal.aborted) void maybeShowTimelineStyleCoachmark({ force: true, signal });
  };
  const property = '__gvTimelineStyleCoachmark';
  const previous = Object.getOwnPropertyDescriptor(window, property);
  const stop = () => {
    signal.removeEventListener('abort', stop);
    document.removeEventListener(TIMELINE_STYLE_COACHMARK_DEBUG_EVENT, show);
    if (Object.getOwnPropertyDescriptor(window, property)?.value !== show) return;
    if (previous) Object.defineProperty(window, property, previous);
    else Reflect.deleteProperty(window, property);
  };
  if (signal.aborted) return stop;
  Object.defineProperty(window, property, { value: show, configurable: true });
  document.addEventListener(TIMELINE_STYLE_COACHMARK_DEBUG_EVENT, show);
  signal.addEventListener('abort', stop, { once: true });
  return stop;
}
