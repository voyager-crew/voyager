/**
 * Markers for every user turn of a conversation whose history was read
 * (`historyLoader`), joined with the turns mounted now (#1112).
 *
 * A turn's id is the same `c-<hash>` the DOM-only merge (`turnMerge`) gives
 * it, so stars and outline levels saved under mounted ids keep matching. The
 * hash is of the bubble's text once the turn has been seen mounted, and of the
 * original history text until then (the two are equal for a plain prompt). Repeats of
 * one text are numbered `~2`, `~3` in conversation order.
 *
 * A mounted turn joins its history entry by the key attribute it carries, or,
 * without a known key, by a text only one entry has. One the history lacks (a
 * prompt sent after the read, a later reply) is kept after the mounted turn
 * before it, so it stays listed after the host unmounts it; the caller asks
 * for a fresh read. Unmounted turns stand on a detached placeholder element,
 * which never passes a star or outline edit's page-evidence check.
 */
import { hashString } from '@/core/utils/hash';

import type { HistoryTurn } from './historyLoader';
import { type Marker, type MountedTurn, TURN_ID_ATTR, TurnIds, mountedHash } from './turnMerge';

interface SeenTurn {
  element: HTMLElement;
  hash: string;
  summary: string;
  center: number;
  measuredAt?: number;
}

type Anchor =
  | { readonly kind: 'after'; readonly key: string }
  | { readonly kind: 'before'; readonly key: string }
  | { readonly kind: 'end' };

interface ExtraTurn extends SeenTurn {
  reply?: true;
  anchor: Anchor;
}

export interface HistoryComposition {
  readonly markers: Marker[];
  /** The id each listed history turn has now, by key. */
  readonly keyById: ReadonlyMap<string, string>;
  /** A mounted prompt carries a key the history lacks: a fresh read would list it. */
  readonly unknownKey: boolean;
}

/** The key on the turn or its nearest ancestor, from the first attribute present. */
export function readTurnKey(element: Element, attributes: readonly string[]): string | null {
  for (const attribute of attributes) {
    const value = element.closest(`[${attribute}]`)?.getAttribute(attribute)?.trim();
    if (value) return value;
  }
  return null;
}

/** Route-lifetime memory of what was seen mounted; one per turn source. */
export class HistoryMerge {
  private readonly seen = new Map<string, SeenTurn>();
  private readonly placeholders = new Map<string, HTMLElement>();
  private extras: ExtraTurn[] = [];

  constructor(private readonly keyAttributes: readonly string[]) {}

  compose(
    history: readonly HistoryTurn[],
    mounted: readonly MountedTurn[],
    centerOf: (element: HTMLElement) => number,
  ): HistoryComposition {
    const keys = new Set(history.map((turn) => turn.key));
    const keyByText = new Map<string, string | null>();
    for (const turn of history) {
      const hash = hashString(turn.summary);
      keyByText.set(hash, keyByText.has(hash) ? null : turn.key);
    }
    let unknownKey = false;
    const joined: (string | null)[] = mounted.map((turn) => {
      if (turn.reply) return null;
      const key = readTurnKey(turn.element, this.keyAttributes);
      if (key && keys.has(key)) return key;
      if (key) unknownKey = true;
      // Without a key the site still names, a text only one entry has joins it.
      return key ? null : (keyByText.get(mountedHash(turn)) ?? null);
    });

    mounted.forEach((turn, index) => {
      const key = joined[index];
      const center = centerOf(turn.element);
      if (key) {
        this.seen.set(key, {
          element: turn.element,
          hash: mountedHash(turn),
          summary: turn.summary,
          center,
        });
        this.extras = this.extras.filter((extra) => extra.element !== turn.element);
        return;
      }
      const anchor = this.anchorOf(joined, index);
      const hash = mountedHash(turn);
      const existing = this.extras.find(
        (extra) =>
          extra.element === turn.element ||
          (!extra.element.isConnected && extra.hash === hash && sameAnchor(extra.anchor, anchor)),
      );
      if (existing) {
        Object.assign(existing, {
          element: turn.element,
          hash,
          summary: turn.summary,
          center,
          anchor,
        });
      } else {
        this.extras.push({
          element: turn.element,
          hash,
          summary: turn.summary,
          center,
          anchor,
          ...(turn.reply ? { reply: true as const } : {}),
        });
      }
    });
    // A prompt the history has caught up with is listed by its entry now.
    const listed = new Set(
      history.map(
        (turn) => this.seen.get(turn.key)?.hash ?? turn.sourceHash ?? hashString(turn.summary),
      ),
    );
    this.extras = this.extras.filter(
      (extra) => extra.reply || extra.element.isConnected || !listed.has(extra.hash),
    );

    const ids = new TurnIds();
    const keyById = new Map<string, string>();
    const markers: Marker[] = [];
    const push = (turn: SeenTurn, reply?: true): string => {
      const id = ids.claim(turn.hash);
      if (turn.element.isConnected) turn.element.setAttribute(TURN_ID_ATTR, id);
      markers.push({
        id,
        hash: turn.hash,
        summary: turn.summary,
        starred: false,
        element: turn.element,
        center: turn.center,
        ...(turn.measuredAt !== undefined ? { measuredAt: turn.measuredAt } : {}),
        dotElement: null,
        ...(reply ? { reply } : {}),
      });
      return id;
    };
    const pushExtras = (matches: (anchor: Anchor) => boolean): void => {
      for (const extra of this.extras) if (matches(extra.anchor)) push(extra, extra.reply);
    };
    for (const turn of history) {
      pushExtras((anchor) => anchor.kind === 'before' && anchor.key === turn.key);
      const id = push(this.seen.get(turn.key) ?? this.unseen(turn));
      keyById.set(id, turn.key);
      pushExtras((anchor) => anchor.kind === 'after' && anchor.key === turn.key);
    }
    pushExtras((anchor) => anchor.kind === 'end' || !keys.has(anchor.key));
    return { markers, keyById, unknownKey };
  }

  /** Carry the navigator's measured frame back, as the DOM-only merge does. */
  remember(
    markers: readonly { element: HTMLElement; center?: number; measuredAt?: number }[],
  ): void {
    const byElement = new Map(markers.map((marker) => [marker.element, marker]));
    for (const turn of [...this.seen.values(), ...this.extras]) {
      const marker = byElement.get(turn.element);
      if (marker?.center === undefined) continue;
      turn.center = marker.center;
      if (marker.measuredAt !== undefined) turn.measuredAt = marker.measuredAt;
    }
  }

  private unseen(turn: HistoryTurn): SeenTurn {
    let element = this.placeholders.get(turn.key);
    if (!element) {
      element = document.createElement('div');
      this.placeholders.set(turn.key, element);
    }
    return {
      element,
      hash: turn.sourceHash ?? hashString(turn.summary),
      summary: turn.summary,
      center: 0,
    };
  }

  private anchorOf(joined: readonly (string | null)[], index: number): Anchor {
    for (let i = index - 1; i >= 0; i--) {
      const key = joined[i];
      if (key) return { kind: 'after', key };
    }
    for (let i = index + 1; i < joined.length; i++) {
      const key = joined[i];
      if (key) return { kind: 'before', key };
    }
    return { kind: 'end' };
  }
}

function sameAnchor(a: Anchor, b: Anchor): boolean {
  return a.kind === b.kind && (a.kind === 'end' || (b.kind !== 'end' && a.key === b.key));
}
