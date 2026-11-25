/**
 * Which turn sits nearest the anchor line on a virtualized host (#1116).
 *
 * Only turns measured in the latest pass count. An unmounted turn keeps the
 * centre of an older coordinate frame, or 0 when it never mounted (a history
 * entry), and clamping those into a monotonic list made a plateau after the
 * mounted window: a search at or past the target landed on the plateau's end,
 * the conversation's last turn.
 */

export interface MeasuredCenter {
  readonly id: string;
  readonly center: number;
}

/** The id whose centre is nearest `ref`; `centers` ascend in turn order. */
export function nearestTurnId(centers: readonly MeasuredCenter[], ref: number): string | null {
  if (!centers.length) return null;
  let low = 0;
  let high = centers.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (centers[mid].center <= ref) low = mid + 1;
    else high = mid;
  }
  const previous = centers[Math.max(0, low - 1)];
  const next = centers[Math.min(centers.length - 1, low)];
  return Math.abs(next.center - ref) < Math.abs(previous.center - ref) ? next.id : previous.id;
}

/**
 * The centres the active search reads: the turns measured in `pass`, or every
 * remembered centre when none is mounted. Either list is kept monotonic, since
 * a host can report neighbours slightly out of order while it re-measures.
 */
export function searchableCenters(
  markers: readonly {
    readonly id: string;
    readonly center?: number;
    readonly measuredAt?: number;
  }[],
  pass: number,
): MeasuredCenter[] {
  const measured = markers.filter((marker) => marker.measuredAt === pass);
  const source = measured.length ? measured : markers;
  const centers: MeasuredCenter[] = [];
  for (const marker of source) {
    const previous = centers[centers.length - 1]?.center;
    const center = marker.center ?? 0;
    centers.push({
      id: marker.id,
      center: previous !== undefined && center < previous ? previous : center,
    });
  }
  return centers;
}
