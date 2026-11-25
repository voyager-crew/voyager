import type { TimelineDataSession } from './TimelineDataSession';
import type { TimelineStoragePolicy } from './TimelineStoragePolicy';
import type { TimelineMarker } from './types';

/**
 * `bisect` jumps by remembered offsets; `step` scrolls a bounded step toward
 * the turn until it mounts, for hosts that reserve no height for it.
 * `releaseWith: 'wheel'` dispatches a scripted wheel before each navigation
 * scroll, for a host that pins its thread to the newest turn until a wheel.
 */
export interface TimelineHomingPolicy {
  readonly mode: 'bisect' | 'step';
  readonly releaseWith?: 'wheel';
}

export interface TimelineTurnSnapshot {
  readonly markers: TimelineMarker[];
  readonly mountedCount: number;
}

/** A source owns selectors, discovery and its host's observation rules. */
export interface TimelineTurnSource {
  readonly root: HTMLElement | null;
  readonly anchor: HTMLElement | null;
  // Virtualized hosts need remembered geometry and homing when a turn leaves the DOM.
  readonly navigation: 'mounted' | 'virtualized';
  /** How a virtualized source's navigation reaches an unmounted turn; bisect by default. */
  readonly homing?: TimelineHomingPolicy;
  /** The marker's element if the host has mounted it since the last read. */
  locate?(markerId: string): HTMLElement | null;
  initialize(signal: AbortSignal): Promise<boolean>;
  read(previous: TimelineMarker[]): TimelineTurnSnapshot;
  count(): number;
  refresh(): boolean;
  observe(callback: MutationCallback): MutationObserver;
  stop(): void;
}

export interface TimelineTimestampOwner {
  init(): Promise<void>;
  update(previous: TimelineMarker[], next: TimelineMarker[]): void;
  formatTooltipTimestamp(id: string): string | null;
  destroy(): void;
}

/** Host facts for one route; the engine owns state, geometry and UI lifetime. */
export interface TimelineAdapter {
  readonly route: { readonly siteId: string; readonly url: string };
  readonly mount: { anchor(): HTMLElement; readonly position: 'auto' | 'left' | 'right' };
  readonly storage: TimelineStoragePolicy;
  readonly turns: TimelineTurnSource;
  viewport(element: HTMLElement): HTMLElement;
  // Gemini's timestamp bridge subscribes to a page-lifetime history store independently of state.
  timestamps(state: TimelineDataSession): TimelineTimestampOwner | null;
}
