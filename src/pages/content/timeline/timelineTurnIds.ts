import { hashString } from '@/core/utils/hash';
import type { TimelineMarker } from '@/features/timeline/types';

import { makeStableTurnId } from '../fork/turnId';

export interface TimelineTurnIdentity {
  readonly element: HTMLElement;
  readonly serverId: string | null;
  readonly existingId: string;
  readonly summary: string;
}

export interface TimelineIdentitySnapshot {
  readonly turnIdByIndex: ReadonlyMap<number, string>;
  readonly previousMarkers: readonly Pick<TimelineMarker, 'id' | 'element'>[];
}

export interface TimelineTurnIdAssignment {
  readonly element: HTMLElement;
  readonly index: number;
  readonly id: string;
  readonly writeDom: boolean;
}

/** The existing timeline allocation rules, projected without mutating a node or its owner. */
export function planTimelineTurnIds(
  turns: readonly TimelineTurnIdentity[],
  snapshot: TimelineIdentitySnapshot,
): TimelineTurnIdAssignment[] {
  const owners = new Map<string, HTMLElement[]>();
  turns.forEach(({ element, existingId }) => {
    if (!existingId) return;
    const existing = owners.get(existingId);
    if (existing) existing.push(element);
    else owners.set(existingId, [element]);
  });

  const previousOwners = new Map<string, Set<HTMLElement>>();
  snapshot.previousMarkers.forEach(({ id, element }) => {
    const existing = previousOwners.get(id);
    if (existing) existing.add(element);
    else previousOwners.set(id, new Set([element]));
  });
  const usedIds = new Set<string>();

  const shouldKeepExisting = (id: string, element: HTMLElement): boolean => {
    if (usedIds.has(id)) return false;
    const currentOwners = owners.get(id) ?? [];
    if (currentOwners.length <= 1) return true;
    const previous = previousOwners.get(id);
    if (!previous || previous.size === 0) return currentOwners[0] === element;
    if (previous.has(element)) return true;
    return !currentOwners.some((owner) => owner !== element && previous.has(owner));
  };

  const allocate = ({ summary }: TimelineTurnIdentity, index: number): string => {
    const basis = summary || `user-${index}`;
    const candidates = [
      snapshot.turnIdByIndex.get(index) || '',
      makeStableTurnId(index),
      `u-${index}-${hashString(basis)}`,
    ];
    for (const candidate of candidates) {
      if (!candidate || usedIds.has(candidate) || owners.has(candidate)) continue;
      return candidate;
    }
    const base = `u-${index}-${hashString(`${basis}|dedupe`)}`;
    let suffix = 0;
    let candidate = base;
    while (usedIds.has(candidate) || owners.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  };

  return turns.map((turn, index) => {
    const { element, serverId, existingId } = turn;
    let id: string;
    let writeDom: boolean;
    if (serverId && !usedIds.has(serverId)) {
      id = serverId;
      writeDom = true;
    } else if (existingId && shouldKeepExisting(existingId, element)) {
      id = existingId;
      writeDom = false;
    } else {
      id = allocate(turn, index);
      writeDom = true;
    }
    usedIds.add(id);
    return { element, index, id, writeDom };
  });
}
