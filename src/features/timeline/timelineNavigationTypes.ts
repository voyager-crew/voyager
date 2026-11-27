import type { TimelineHomingPolicy, TimelineTurnSource } from './TimelineAdapter';
import type { TimelineMarker } from './types';

export type TimelineNavigationMarker = Pick<
  TimelineMarker,
  'id' | 'element' | 'historyOnly' | 'navigationKey' | 'hash' | 'center' | 'measuredAt'
>;

export type Direction = 'previous' | 'next';

export interface TimelineNavigationOptions {
  virtualized?: boolean;
  /** Virtualized homing: remembered-offset bisection (default) or estimated jumps. */
  homing?: TimelineHomingPolicy;
  /** A homing run started or stopped waiting for the host to load older turns. */
  onHomingWait?(waiting: boolean): void;
  /** The marker's live element when the host mounted it after the last marker read. */
  locate?(markerId: string): HTMLElement | null;
  mountTurn?: TimelineTurnSource['mountTurn'];
  getMarkers(): readonly TimelineNavigationMarker[];
  getMarkerTops(): readonly number[];
  getMarkerPositions(): readonly number[];
  getTrackHeight(): number;
  /** Refresh an interaction target, or check for new turns at a navigation boundary. */
  refreshMarkers(target: HTMLElement | null, direction?: Direction): boolean;
  resolveStoredId(storedId: string): string | null;
  onActiveChange(id: string | null): void;
  onScroll(): void;
  animateRunner(fromIndex: number, toIndex: number, duration: number): void;
}
