import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import type { StarredMessage, StarredMessagesData } from '@/features/savedLibrary/starTypes';
import { findMatchingStarredMessages } from '@/pages/content/timeline/starredLookup';

import { TimelineHierarchy } from './TimelineHierarchy';
import { TimelineHydration } from './TimelineHydration';
import { TimelineStarText } from './TimelineStarText';
import type { TimelineStoragePolicy } from './TimelineStoragePolicy';
import { resolveStarredDisplay } from './starredResolution';
import type { TimelineMarker } from './types';

/** Conversation-scoped stars, hierarchy and mounted-text enrichment. */
export class TimelineState {
  readonly conversationId: string;
  readonly hierarchy: TimelineHierarchy;
  markers: TimelineMarker[] = [];
  readonly markerMap = new Map<string, TimelineMarker>();
  private destroyed = false;
  private readonly starText: TimelineStarText;
  private starred = new Set<string>();
  private starWrites: Promise<void> = Promise.resolve();
  private readonly starHydration = new TimelineHydration(() => this.isCurrent);
  private readonly hierarchyHydration = new TimelineHydration(() => this.isCurrent);
  private starDisplayOverride = new Map<string, boolean>();
  private starStorageIdsByMarkerId = new Map<string, string[]>();
  private onChromeStorageChanged:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)
    | null = null;
  constructor(
    private readonly onChange: () => void,
    readonly policy: TimelineStoragePolicy,
  ) {
    this.conversationId = policy.conversationId;
    this.starText = new TimelineStarText(policy, () => this.isCurrent);
    this.hierarchy = new TimelineHierarchy(
      policy,
      onChange,
      (id) => this.canEdit(id),
      this.hierarchyHydration,
    );
  }
  private get url(): string {
    return this.policy.url;
  }
  private get isCurrent(): boolean {
    return !this.destroyed && this.policy.isCurrent();
  }
  private canEdit(id: string): boolean {
    return this.policy.canEdit(this.markerMap.get(id), id);
  }
  private initPromise: Promise<void> | null = null;
  init(): Promise<void> {
    return (this.initPromise ??= this.initialize());
  }
  private async initialize(): Promise<void> {
    if (!this.isCurrent) return;
    this.listen();
    // Outline readiness is independent of an unrelated Saved Library request.
    const hierarchyRead = this.hierarchy.init();
    await Promise.all([hierarchyRead, this.readStars()]);
  }
  replaceMarkers(markers: TimelineMarker[]): void {
    this.markers = markers;
    this.markerMap.clear();
    for (const marker of markers) this.markerMap.set(marker.id, marker);
    this.recomputeStarredDisplay();
    for (const marker of markers) marker.starred = this.isMarkerStarred(marker.id);
    this.starText.mount(markers);
  }
  private listen(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      this.onChromeStorageChanged = (changes, areaName) => {
        if (areaName === 'local' && this.isCurrent) {
          const starredData = StarredMessagesService.decodeStorageChange(areaName, changes);
          if (starredData) {
            this.applySharedStarredData(starredData);
          }

          this.hierarchy.applyStorageChanges(changes);
        }
      };
      chrome.storage.onChanged.addListener(this.onChromeStorageChanged);
    }
  }
  destroy(): void {
    this.destroyed = true;
    this.starText.destroy();
    this.hierarchy.destroy();
    if (this.onChromeStorageChanged)
      chrome.storage.onChanged.removeListener(this.onChromeStorageChanged);
  }

  /**
   * Recompute which mounted turn each stored star belongs to. Cheap enough to
   * run on every star/marker change; never touches storage.
   */
  private recomputeStarredDisplay(): void {
    const { displayByMarkerId, storageIdsByMarkerId } = resolveStarredDisplay({
      markers: this.markers.flatMap((marker) => {
        const id = this.policy.resolveMountedTurnId(marker.id);
        return id ? [{ id }] : [];
      }),
      starredIds: this.starred,
      resolveCanonicalId: this.policy.resolveStoredTurnId,
    });
    this.starDisplayOverride.clear();
    this.starStorageIdsByMarkerId.clear();
    for (const marker of this.markers) {
      const canonical = this.policy.resolveMountedTurnId(marker.id);
      this.starDisplayOverride.set(
        marker.id,
        (canonical && displayByMarkerId.get(canonical)) || false,
      );
      const storageIds = canonical ? storageIdsByMarkerId.get(canonical) : undefined;
      if (storageIds) this.starStorageIdsByMarkerId.set(marker.id, storageIds);
    }
  }

  isMarkerStarred(markerId: string): boolean {
    const override = this.starDisplayOverride.get(markerId);
    if (override !== undefined) return override;
    return this.starred.has(markerId);
  }

  private getStarStorageIds(markerId: string): string[] {
    return this.starStorageIdsByMarkerId.get(markerId) ?? [markerId];
  }

  /** Recompute star ownership and repaint every marker to match. */
  refreshStars(): void {
    this.recomputeStarredDisplay();
    for (const marker of this.markers) {
      const want = this.isMarkerStarred(marker.id);
      if (marker.starred !== want) {
        marker.starred = want;
      }
    }
    this.onChange();
  }

  private applyStarredIdSet(nextSet: Set<string>): void {
    this.starred = new Set(nextSet);
    this.refreshStars();
  }

  private applySharedStarredData(data: StarredMessagesData): void {
    if (!this.conversationId) return;
    this.starHydration.snapshot(() => {
      const matched = this.matchLibrary(data);
      this.starText.accept(matched.messages);
      this.applyStarredIdSet(new Set(matched.messages.map((message) => message.turnId)));
    });
  }

  private matchLibrary(data: StarredMessagesData): {
    messages: StarredMessage[];
    sourceConversationIds: string[];
  } {
    return this.policy.stars.matchLegacyConversations
      ? findMatchingStarredMessages(data, this.conversationId, this.url)
      : {
          messages: data.messages[this.conversationId] ?? [],
          sourceConversationIds: [this.conversationId],
        };
  }
  private readStars(): Promise<void> {
    return this.starHydration.read((accept) => this.syncStarredFromService(accept));
  }
  private async syncStarredFromService(accept: (apply: () => void) => boolean): Promise<void> {
    if (!this.conversationId) {
      accept(() => {});
      return;
    }
    try {
      const data = this.policy.stars.matchLegacyConversations
        ? await StarredMessagesService.getAllStarredMessages()
        : {
            messages: {
              [this.conversationId]: await StarredMessagesService.getStarredMessagesForConversation(
                this.conversationId,
              ),
            },
          };
      if (!this.isCurrent) return;
      const matched = this.matchLibrary(data);

      let messages = matched.messages;
      const needsReconcile = matched.sourceConversationIds.some(
        (sourceConversationId) => sourceConversationId !== this.conversationId,
      );

      if (needsReconcile) {
        const reconciled = await StarredMessagesService.reconcileConversationIds(
          this.conversationId,
          matched.sourceConversationIds,
          this.url,
        );
        if (!this.isCurrent) return;
        messages = reconciled;
      }

      accept(() => {
        this.starText.accept(messages);
        this.applyStarredIdSet(new Set(messages.map((message) => message.turnId)));
      });
    } catch (error) {
      console.warn('[Timeline] Failed to sync starred messages from shared storage:', error);
    }
  }

  async toggleStar(turnId: string): Promise<void> {
    const id = String(turnId || '');
    if (!id) return;
    // A mounted `u-N` is only the current DOM-window index. Even when a cache
    // exists, it is not evidence that this node is full-conversation turn N.
    if (!this.isCurrent || !this.canEdit(id)) return;

    const marker = this.markerMap.get(id);
    // A press captures its message before an initial read can yield to a route or DOM change.
    const summary = marker?.summary;
    const text = this.starText.capture(marker); // Only an add uses it, decided after the queue.
    const conversationTitle = this.policy.getConversationTitle(this.markers);
    // Resolve from the header at the press, before hydration or queued writes can yield to another page.
    const accountRead = this.policy.stars.resolveAccount().then(
      (account) => ({ account }),
      (error: unknown) => ({ error }),
    );

    // Each press reads the Library state after the preceding write and authoritative repaint.
    const operation = this.starWrites.then(async () => {
      if (!this.isCurrent || !this.policy.canEdit(marker, id)) return;
      if (!this.starHydration.ready) await this.readStars();
      if (!this.isCurrent || !this.policy.canEdit(marker, id) || !this.starHydration.ready) return;
      this.starHydration.changed();
      const wasStarred = this.isMarkerStarred(id);
      // Removing a stable turn also clears its verified positional aliases.
      const storageIds = wasStarred ? this.getStarStorageIds(id) : [id];
      try {
        if (wasStarred) {
          await Promise.all(
            storageIds.map((storageId) =>
              StarredMessagesService.removeStarredMessage(this.conversationId, storageId),
            ),
          );
        } else {
          if (!marker) return;
          const result = await accountRead;
          if ('error' in result) throw result.error;
          const account = result.account;
          if (!this.isCurrent || !this.policy.canEdit(marker, id) || !this.starHydration.ready)
            return;
          await this.starText.add(id, summary ?? '', text, conversationTitle, account);
        }
      } catch (error) {
        if (this.isCurrent) console.warn('[Timeline] Failed to change starred message:', error);
      } finally {
        if (this.isCurrent) {
          // A delayed write reply cannot replay its old choice over a newer Library edit.
          this.starHydration.invalidate();
          await this.readStars();
        }
      }
    });
    this.starWrites = operation.catch(() => {});
    await operation;
  }

  /**
   * Resolve which mounted marker currently carries a stored star. Used by
   * `#gv-turn-<id>` deep links, whose ids come from storage and may have been
   * relocated onto a different index.
   */
  resolveMarkerIdForStorageId(storageId: string): string | null {
    for (const [markerId, ids] of this.starStorageIdsByMarkerId) {
      if (ids.includes(storageId)) return markerId;
    }
    const canonical = this.policy.resolveStoredTurnId(storageId);
    if (!canonical) return null;
    return (
      this.markers.find((marker) => this.policy.resolveMountedTurnId(marker.id) === canonical)
        ?.id ?? canonical
    );
  }

  getStoredTurnIdAliases(turnId: string): string[] {
    return this.policy.getStoredTurnIdAliases(turnId);
  }
}
