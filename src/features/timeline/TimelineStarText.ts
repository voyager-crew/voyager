import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import { getBackfillStarText } from '@/features/savedLibrary/starText';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import type { TimelineStoragePolicy } from './TimelineStoragePolicy';
import type { TimelineMarker } from './types';
import { userTurnText } from './userTurnText';

export class TimelineStarText {
  private markers: readonly TimelineMarker[] = [];
  private messages: readonly StarredMessage[] = [];
  private revision = 0;
  /** Star instances whose turn text did not match, so recalculation does not re-read styles. */
  private readonly attempts = new Map<string, { element: HTMLElement; inputs: string }>();
  private pending = false;
  private stopped = false;
  private readonly route = location.href.split('#')[0];

  constructor(
    private readonly policy: TimelineStoragePolicy,
    private readonly isCurrent: () => boolean,
  ) {}

  mount(markers: readonly TimelineMarker[]): void {
    this.markers = markers;
    this.revision += 1;
    this.backfill();
  }

  accept(messages: readonly StarredMessage[]): void {
    this.messages = messages;
    this.revision += 1;
    this.backfill();
  }

  /** Reads styles of one turn; collection never does, so capture happens only at a star press. */
  capture(marker: TimelineMarker | undefined): string | undefined {
    return marker?.element.isConnected ? userTurnText(marker.element, this.policy.url) : undefined;
  }

  private get current(): boolean {
    // Gemini delays teardown during navigation; a connected old node cannot authorize new writes.
    return !this.stopped && this.isCurrent() && location.href.split('#')[0] === this.route;
  }

  async add(
    turnId: string,
    content: string,
    text: string | undefined,
    conversationTitle: string,
    account: string | undefined,
  ): Promise<void> {
    await StarredMessagesService.addStarredMessage({
      turnId,
      content,
      ...(text !== undefined ? { text } : {}),
      conversationId: this.policy.conversationId,
      conversationUrl: this.policy.url,
      conversationTitle,
      starredAt: Date.now(),
      ...(account ? { account } : {}),
    });
  }

  destroy(): void {
    this.stopped = true;
    this.markers = [];
    this.messages = [];
    this.attempts.clear();
  }

  private backfill(): void {
    if (this.pending || !this.current) return;
    const entries = this.messages.flatMap((message) => {
      // Only a star still missing its text needs the styled read of its turn.
      if (message.text !== undefined) return [];
      const canonical = this.policy.resolveStoredTurnId(message.turnId);
      if (!canonical) return [];
      // A shared canonical id only says two turns look alike; text belongs to the stored occurrence or its verified alias.
      const marker = this.markers.find(
        (item) =>
          item.element.isConnected &&
          this.policy.canEdit(item, item.id) &&
          this.policy.resolveMountedTurnId(item.id) === canonical &&
          (item.id === message.turnId ||
            this.policy.getStoredTurnIdAliases(item.id).includes(message.turnId)),
      );
      if (!marker) return [];
      // A newer or re-previewed star is a different decision input and must retry.
      const inputs = JSON.stringify([message.content, message.starredAt, marker.element.outerHTML]);
      const attempt = this.attempts.get(message.turnId);
      if (attempt?.element === marker.element && attempt.inputs === inputs) return [];
      const text = getBackfillStarText(message, userTurnText(marker.element, this.policy.url));
      if (text === undefined) {
        this.attempts.set(message.turnId, { element: marker.element, inputs });
        return [];
      }
      return [{ turnId: message.turnId, text }];
    });
    if (!entries.length) return;
    const revision = this.revision;
    this.pending = true;
    void StarredMessagesService.backfillStarredTexts(this.policy.conversationId, entries)
      .catch((error: unknown) => {
        if (this.current) console.warn('[Timeline] Failed to backfill starred text:', error);
      })
      .finally(() => {
        this.pending = false;
        if (revision !== this.revision) this.backfill();
      });
  }
}
