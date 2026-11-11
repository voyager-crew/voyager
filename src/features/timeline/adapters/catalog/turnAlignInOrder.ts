import type { Marker, MountedEntry } from './turnMerge';

/**
 * A run too long to align exactly, matched in one ordered pass over the
 * markers and the run together, all texts at once.
 *
 * A text's slack is how many of its markers ahead could go unmatched: its
 * markers left minus its turns left. A turn may skip a marker only while
 * that marker's text has slack, so it never jumps past a marker another turn
 * of the run still needs; a text with no slack pairs in order, which no
 * uniform shift can upset. Among the markers with its text it may reach, a
 * turn takes the nearest by position (earliest on a tie). A turn that can
 * reach none skips the blocking marker for the next one with its text only
 * when it sits nearer to that one, so a turn that went missing does not
 * shift every turn after it onto its neighbour's id.
 *
 * Positions are searched on estimates sorted in DOM order (`freshCenters`),
 * so a stale centre cannot attract a turn far from its place.
 *
 * The reachable bound only moves forward, so finding it is linear overall;
 * each turn and the estimates add binary searches. Cost: (run + markers) x
 * log(markers).
 */
export function alignInOrder(
  known: readonly Marker[],
  run: readonly MountedEntry[],
  lo: number,
  hi: number,
  drifts: readonly number[],
): number[] {
  const estimate = freshCenters(known, lo, hi);
  const indexesByHash = new Map<string, number[]>();
  const markersLeft = new Map<string, number>();
  for (let j = lo; j < hi; j++) {
    const { hash } = known[j];
    const indexes = indexesByHash.get(hash);
    if (indexes) indexes.push(j);
    else indexesByHash.set(hash, [j]);
    markersLeft.set(hash, (markersLeft.get(hash) ?? 0) + 1);
  }
  const turnsLeft = new Map<string, number>();
  for (const entry of run) turnsLeft.set(entry.hash, (turnsLeft.get(entry.hash) ?? 0) + 1);
  const slack = (hash: string): number => (markersLeft.get(hash) ?? 0) - (turnsLeft.get(hash) ?? 0);

  // Markers [next, reach) may all be skipped; known[reach] may not.
  let next = lo;
  let reach = lo;
  const skippable = new Map<string, number>();
  const extendReach = (): void => {
    while (reach < hi) {
      const { hash } = known[reach];
      const count = (skippable.get(hash) ?? 0) + 1;
      if (count > slack(hash)) return;
      skippable.set(hash, count);
      reach++;
    }
  };
  const passMarkersBefore = (end: number): void => {
    for (; next < end; next++) {
      const { hash } = known[next];
      markersLeft.set(hash, markersLeft.get(hash)! - 1);
      if (next < reach) skippable.set(hash, skippable.get(hash)! - 1);
    }
    if (reach < next) reach = next;
  };

  return run.map((entry, r) => {
    extendReach();
    const indexes = indexesByHash.get(entry.hash);
    let pick = -1;
    if (indexes) {
      const from = lowerBound(indexes, next);
      const to = lowerBound(indexes, reach + 1);
      const target = entry.center - drifts[r];
      const at = (k: number): number => estimate[indexes[k] - lo];
      if (from === to && to < indexes.length && reach < hi) {
        const blocker = estimate[reach - lo];
        if (Math.abs(at(to) - target) < Math.abs(blocker - target)) pick = indexes[to];
      } else if (from < to) {
        // First candidate at or past the target; the one before it is the other contender.
        const above = searchCenters(from, to, (k) => at(k) >= target);
        let k = above;
        if (above > from) {
          const below = at(above - 1);
          if (above === to || target - below <= at(above) - target) {
            k = searchCenters(from, above, (candidate) => at(candidate) >= below);
          }
        }
        pick = indexes[k];
      }
    }
    turnsLeft.set(entry.hash, turnsLeft.get(entry.hash)! - 1);
    if (pick !== -1) passMarkersBefore(pick + 1);
    return pick;
  });
}

/**
 * Remembered centres of `known[lo, hi)` as estimates sorted in DOM order,
 * trusting fresher measurements over older ones. Centres from one pass are
 * in one frame; an older centre may predate content that grew or shrank
 * above it. So each centre is clamped between the fresher centres around it
 * (at least every fresher one before it, at most every fresher one after
 * it), freshest first, and a final running max sorts what a single pass left
 * out of order. Cost: markers x log(markers).
 */
function freshCenters(known: readonly Marker[], lo: number, hi: number): Float64Array {
  const n = hi - lo;
  const estimate = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (known[lo + b].measuredAt ?? 0) - (known[lo + a].measuredAt ?? 0),
  );
  // Fenwick trees over positions: highest accepted estimate up to i, lowest from i on.
  const highest = new Float64Array(n + 1).fill(-Infinity);
  const lowest = new Float64Array(n + 1).fill(Infinity);
  const highestUpTo = (i: number): number => {
    let value = -Infinity;
    for (let k = i + 1; k > 0; k -= k & -k) value = Math.max(value, highest[k]);
    return value;
  };
  const lowestFrom = (i: number): number => {
    let value = Infinity;
    for (let k = n - i; k > 0; k -= k & -k) value = Math.min(value, lowest[k]);
    return value;
  };
  const accept = (i: number): void => {
    for (let k = i + 1; k <= n; k += k & -k) highest[k] = Math.max(highest[k], estimate[i]);
    for (let k = n - i; k <= n; k += k & -k) lowest[k] = Math.min(lowest[k], estimate[i]);
  };
  for (let start = 0; start < n;) {
    const epoch = known[lo + order[start]].measuredAt ?? 0;
    let end = start;
    while (end < n && (known[lo + order[end]].measuredAt ?? 0) === epoch) end++;
    // Clamp one pass against strictly fresher ones only, then accept it whole.
    for (let k = start; k < end; k++) {
      const i = order[k];
      const own = known[lo + i].center;
      estimate[i] = Math.min(Math.max(own, highestUpTo(i - 1)), lowestFrom(i + 1));
    }
    for (let k = start; k < end; k++) accept(order[k]);
    start = end;
  }
  for (let i = 1; i < n; i++) estimate[i] = Math.max(estimate[i], estimate[i - 1]);
  return estimate;
}

/** First position in `[low, high)` where `reached` holds, for a predicate that stays true once true. */
function searchCenters(low: number, high: number, reached: (k: number) => boolean): number {
  while (low < high) {
    const mid = (low + high) >> 1;
    if (reached(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** First position in the ascending `values` holding a value at or above `min`. */
function lowerBound(values: readonly number[], min: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] < min) low = mid + 1;
    else high = mid;
  }
  return low;
}
