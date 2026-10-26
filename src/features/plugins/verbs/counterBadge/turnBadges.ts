/**
 * Reply badges: one badge as the last child of each assistant turn, counting
 * the reply's visible text without Voyager's own controls.
 *
 * Streaming replies change many times a second, so a turn is only marked
 * dirty by mutations inside it and recounted once the page has been quiet for
 * a moment. The badge's own insertions are ignored, so placing it never
 * schedules another pass.
 */
import { onCachedLanguageChange } from '@/utils/i18n';

import { copyableText } from '../copyButton/text';
import { counterLabel, createBadge, isCounterBadge, setBadgeLabel } from './badge';
import { type CounterMetric, countText } from './count';

export interface TurnBadgesOptions {
  readonly doc: Document;
  readonly turn: string;
  readonly metric: CounterMetric;
  readonly resolveTurn?: () => string;
}

/** Long enough that a streaming reply is recounted after it settles, not per token. */
export const TURN_SETTLE_MS = 400;

interface TurnBadge {
  readonly badge: HTMLElement;
  count: number;
}

export function startTurnBadges(options: TurnBadgesOptions): () => void {
  const { doc, turn: selector, metric } = options;
  const badges = new Map<HTMLElement, TurnBadge>();
  const dirty = new Set<HTMLElement>();
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const render = (entry: TurnBadge): void =>
    setBadgeLabel(entry.badge, counterLabel(metric, entry.count));

  const outermostTurns = (selector: string): HTMLElement[] =>
    // An adapter selector can match a reply and a wrapper of it; only the outer one gets a badge.
    Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => !element.parentElement?.closest(selector),
    );

  const scan = (): void => {
    const turns = outermostTurns(options.resolveTurn?.() ?? selector);
    for (const [element, entry] of Array.from(badges)) {
      // A connected turn can become a dialog preview after the remote alias was accepted.
      if (element.isConnected && (!options.resolveTurn || turns.includes(element))) continue;
      entry.badge.remove();
      badges.delete(element);
    }
    for (const element of turns) {
      let entry = badges.get(element);
      if (!entry) {
        entry = { badge: createBadge(doc, 'turn'), count: 0 };
        badges.set(element, entry);
        dirty.add(element);
      }
      // A reply that streamed more nodes after the badge gets it moved back to its end.
      if (element.lastChild !== entry.badge) element.append(entry.badge);
      if (dirty.has(element)) {
        entry.count = countText(copyableText(element), metric);
        render(entry);
      }
    }
    dirty.clear();
  };

  const turnOf = (node: Node, selector: string): HTMLElement | null => {
    const element = node instanceof Element ? node : node.parentElement;
    let owner = element?.closest<HTMLElement>(selector) ?? null;
    for (
      let outer = owner;
      outer;
      outer = outer.parentElement?.closest<HTMLElement>(selector) ?? null
    )
      owner = outer;
    return owner;
  };

  const isOwnRecord = (record: MutationRecord): boolean =>
    record.type === 'childList' &&
    Array.from(record.addedNodes).every(isCounterBadge) &&
    Array.from(record.removedNodes).every(isCounterBadge);

  const observer = new MutationObserver((records) => {
    const changes = records.filter((record) => !isOwnRecord(record));
    if (!changes.length) return;
    const current = options.resolveTurn?.() ?? selector;
    for (const record of changes) {
      const owner = turnOf(record.target, current);
      if (owner) dirty.add(owner);
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(scan, TURN_SETTLE_MS);
  });

  observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
  const stopFollowingLanguage = onCachedLanguageChange(() => {
    if (options.resolveTurn) scan();
    badges.forEach(render);
  });
  scan();

  return () => {
    observer.disconnect();
    clearTimeout(settleTimer);
    stopFollowingLanguage();
    badges.forEach((entry) => entry.badge.remove());
    badges.clear();
    dirty.clear();
  };
}
