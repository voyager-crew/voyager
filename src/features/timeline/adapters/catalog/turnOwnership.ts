/**
 * Which conversation each turn on screen belongs to, for star writes.
 *
 * A turn belongs to the conversation the URL named when the turn entered the
 * page: a MutationObserver stamps every inserted node with the URL's id at
 * that moment, before any debounced refresh, and a turn takes the latest
 * stamp on itself or its ancestors. This is
 * proof only on hosts that change the URL before they render the next
 * conversation, which ChatGPT, Claude and DeepSeek were measured to do: a
 * host that renders B while the URL still names A gives B's turns to A.
 *
 * Nothing else grants ownership. Further rules only withhold it (the turn is
 * then unattributed and cannot be starred):
 *   - A new chat's turns (no id in the URL) are never starrable, not even
 *     under the id the chat later gets.
 *   - A turn inserted while another conversation's turn, or an unattributed
 *     one, is still on screen (connected and not under a hidden ancestor).
 *   - Before the route showed its own turns, new elements whose texts all
 *     appeared under the previous conversation (its thread remounting).
 * A turn keeps the owner it was first seen with, remembered per element in a
 * WeakMap.
 */

import { type MountedTurn, mountedHash } from './turnMerge';
import { renderedCheck } from './turnVisibility';

/** A turn on screen and its text hash. */
export interface ObservedTurn {
  readonly element: Element;
  readonly hash: string;
}

const UNATTRIBUTED = Symbol('unattributed');
export type TurnOwner = string | null | typeof UNATTRIBUTED;

interface Insertion {
  readonly seq: number;
  readonly owner: TurnOwner;
}

export class TurnOwnership {
  private readonly byElement = new WeakMap<Element, TurnOwner>();
  private readonly insertions = new WeakMap<Node, Insertion>();
  private seq = 0;
  /** Owner of turns already on the page when recording began. */
  private initialOwner: TurnOwner = UNATTRIBUTED;
  /** Star id of the route the last refresh saw; undefined before the first. */
  private routeId: string | null | undefined;
  /** That route has shown a turn it owns. */
  private routeShown = false;
  private previousRouteId: string | null = null;
  private routeHashes = new Set<string>();
  private previousRouteHashes = new Set<string>();
  /** The turns the last refresh saw. */
  private tracked: readonly ObservedTurn[] = [];

  constructor(private readonly currentId: () => string | null) {}

  /** Whether a turn may be starred under `conversationId`. */
  allows(element: Element, conversationId: string): boolean {
    return this.byElement.get(element) === conversationId;
  }

  /** Turns on the page now belong to the URL now; call before recording insertions. */
  begin(): void {
    this.initialOwner = this.currentId();
  }

  /** Stamp nodes that just entered the page with the conversation the URL names now. */
  recordInsertions(nodes: readonly Node[]): void {
    const elements = nodes.filter((node) => node.nodeType === Node.ELEMENT_NODE);
    if (!elements.length) return;
    const insertion: Insertion = { seq: ++this.seq, owner: this.insertionOwner() };
    for (const element of elements) this.insertions.set(element, insertion);
  }

  enterRoute(conversationId: string | null): void {
    if (this.routeId !== undefined) {
      this.previousRouteId = this.routeId;
      this.previousRouteHashes = this.routeHashes;
    }
    this.routeId = conversationId;
    this.routeHashes = new Set();
    this.routeShown = false;
  }

  observe(turns: readonly ObservedTurn[]): void {
    const current = this.routeId ?? null;
    const fresh = turns.filter((turn) => !this.byElement.has(turn.element));
    const replayed =
      !this.routeShown &&
      this.previousRouteId !== null &&
      fresh.length > 0 &&
      fresh.every((turn) => this.previousRouteHashes.has(turn.hash));
    for (const turn of fresh) {
      const owner = this.insertedUnder(turn.element);
      this.byElement.set(turn.element, replayed && owner === current ? UNATTRIBUTED : owner);
    }
    if (current !== null && turns.some((turn) => this.byElement.get(turn.element) === current)) {
      this.routeShown = true;
    }
    for (const turn of turns) this.routeHashes.add(turn.hash);
    this.tracked = turns;
  }

  /** Owner for nodes inserted now. */
  private insertionOwner(): TurnOwner {
    const current = this.currentId();
    const isRendered = renderedCheck();
    for (const turn of this.tracked) {
      // A thread the host hid (ChatGPT keeps earlier ones as display: none) is off screen.
      if (!isRendered(turn.element)) continue;
      const owner = this.byElement.get(turn.element);
      if (owner !== current && owner !== null && owner !== undefined) return UNATTRIBUTED;
    }
    return current;
  }

  /** The owner stamped by the latest insertion that brought `element` into the page. */
  private insertedUnder(element: Node): TurnOwner {
    let latest: Insertion | undefined;
    for (let node: Node | null = element; node; node = node.parentNode) {
      const insertion = this.insertions.get(node);
      if (insertion && (!latest || insertion.seq > latest.seq)) latest = insertion;
    }
    return latest ? latest.owner : this.initialOwner;
  }
}

export function mountedOwnershipTurns(mounted: readonly MountedTurn[]): ObservedTurn[] {
  return mounted.map((turn) => ({ element: turn.element, hash: mountedHash(turn) }));
}
