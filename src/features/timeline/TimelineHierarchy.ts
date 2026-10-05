import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import { filterTimelineHierarchyByRouteScope } from '@/pages/content/timeline/hierarchyStorage';

import type { TimelineHydration } from './TimelineHydration';
import type { TimelineStoragePolicy } from './TimelineStoragePolicy';
import {
  type TimelineHierarchyConversationData,
  type TimelineHierarchyData,
  normalizeTimelineHierarchyData,
} from './hierarchyTypes';
import { type OutlineChange, type SettledOutline, outlineSaveQueue } from './outlineSaveQueue';
import { safeLocalStorageGet, safeLocalStorageSet } from './timelineLocalStorage';
import type { MarkerLevel } from './types';

type OutlineEntry = TimelineHierarchyConversationData | null;

/** The storage bucket one hydrated outline belongs to. */
interface HierarchyBucket {
  readonly key: string;
  readonly unscopedKey: string;
  /** Gemini's pre-isolation migration reads the unscoped blob behind a missing scoped one. */
  readonly adoptUnscoped: boolean;
  readonly routeUserId: string | null;
}

function keysToRead(bucket: HierarchyBucket): string[] {
  return bucket.key === bucket.unscopedKey || !bucket.adoptUnscoped
    ? [bucket.key]
    : [bucket.key, bucket.unscopedKey];
}

function readBucket(
  bucket: HierarchyBucket,
  values: Record<string, unknown>,
): TimelineHierarchyData {
  if (
    bucket.key === bucket.unscopedKey ||
    !bucket.adoptUnscoped ||
    Object.prototype.hasOwnProperty.call(values, bucket.key)
  )
    return normalizeTimelineHierarchyData(values[bucket.key]);
  return filterTimelineHierarchyByRouteScope(
    normalizeTimelineHierarchyData(values[bucket.unscopedKey]),
    bucket.routeUserId,
  );
}

function hasExtensionStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local?.get;
}

async function readConversations(bucket: HierarchyBucket) {
  const values = (await chrome.storage.local.get(keysToRead(bucket))) as Record<string, unknown>;
  return readBucket(bucket, values).conversations;
}

/**
 * Applies one step to the conversation's freshly read entry, so nothing else in the bucket moves,
 * then reads the bucket back: that read is the authoritative outline once the step has settled.
 */
async function writeChange(
  bucket: HierarchyBucket,
  conversationId: string,
  apply: OutlineChange,
): Promise<SettledOutline | null> {
  try {
    const conversations = { ...(await readConversations(bucket)) };
    const next = apply(conversations[conversationId] ?? null);
    if (next) conversations[conversationId] = next;
    else delete conversations[conversationId];
    await chrome.storage.local.set({ [bucket.key]: { conversations } });
    const order = outlineSaveQueue.claimSnapshotOrder();
    return { stored: (await readConversations(bucket))[conversationId] ?? null, order };
  } catch (error) {
    console.warn('[Timeline] Failed to persist timeline hierarchy to extension storage:', error);
    return null;
  }
}

function outlineEntry(
  levels: Record<string, MarkerLevel>,
  collapsed: string[],
  conversationUrl: string,
  updatedAt: number,
): OutlineEntry {
  if (Object.keys(levels).length === 0 && collapsed.length === 0) return null;
  return { conversationUrl, levels, collapsed, updatedAt };
}

function setLevelChange(
  turnId: string,
  aliases: readonly string[],
  level: MarkerLevel,
  url: string,
): OutlineChange {
  const updatedAt = Date.now();
  return (entry) => {
    const levels = { ...entry?.levels };
    aliases.forEach((alias) => delete levels[alias]);
    if (level !== 1) levels[turnId] = level;
    return outlineEntry(levels, entry?.collapsed ?? [], url, updatedAt);
  };
}

function setCollapsedChange(
  turnId: string,
  aliases: readonly string[],
  collapsed: boolean,
  url: string,
): OutlineChange {
  const updatedAt = Date.now();
  return (entry) => {
    const ids = (entry?.collapsed ?? []).filter((id) => !aliases.includes(id));
    if (collapsed) ids.push(turnId);
    return outlineEntry({ ...entry?.levels }, ids, url, updatedAt);
  };
}

function accountAttributesChanged(records: readonly MutationRecord[]): boolean {
  return records.some(
    (record) =>
      !!record.attributeName &&
      record.oldValue !== (record.target as Element).getAttribute(record.attributeName),
  );
}

/** Shared level/collapse state and persistence; geometry reads this owner without owning it. */
export class TimelineHierarchy {
  private destroyed = false;
  /** Latest authoritative entry: a storage read or event, never an edit. */
  private snapshot: OutlineEntry = null;
  /**
   * Where the snapshot came from. Gemini's localStorage outline stays authoritative only until
   * extension storage has held the conversation; from then on its absence is a deletion. The legacy
   * keys mirror only extension-storage outlines, so a failed migration never empties them.
   */
  private snapshotSource: 'none' | 'extension' | 'legacy' = 'none';
  /** Order of the snapshot taken last; older reads and publishes are ignored. */
  private snapshotOrder = 0;
  /** Displayed view: the snapshot with this page's accepted, unwritten changes overlaid. */
  private markerLevels = new Map<string, MarkerLevel>();
  private collapsedMarkers = new Set<string>();
  /** The resolved account's bucket; null while the account is unresolved or unknown. */
  private bucket: HierarchyBucket | null = null;
  private stopQueueListener: (() => void) | null = null;
  private accountGeneration = 0;
  private accountObserver: MutationObserver | null = null;
  constructor(
    private readonly policy: TimelineStoragePolicy,
    private readonly onChange: () => void,
    private readonly canEdit: (id: string) => boolean,
    private readonly hydration: TimelineHydration,
  ) {}
  private get conversationId(): string {
    return this.policy.conversationId;
  }
  private get url(): string {
    return this.policy.url;
  }
  private get isCurrent(): boolean {
    return (
      !this.destroyed && this.policy.isCurrent() && (this.policy.hierarchy.isCurrent?.() ?? true)
    );
  }
  private get unscopedKey(): string {
    return this.policy.hierarchy.extensionKey;
  }
  private get mirrorsLegacyKeys(): boolean {
    return this.bucket?.key === this.unscopedKey;
  }
  private get queueKey(): string | null {
    return this.bucket && this.conversationId
      ? `${this.bucket.key}\u0000${this.conversationId}`
      : null;
  }
  private bindBucket(bucket: HierarchyBucket | null): void {
    if (bucket?.key === this.bucket?.key && this.stopQueueListener) return;
    this.stopQueueListener?.();
    this.stopQueueListener = null;
    this.bucket = bucket;
    const key = this.queueKey;
    if (!key) return;
    this.stopQueueListener = outlineSaveQueue.subscribe(key, (published) => {
      if (!this.isCurrent) return;
      if (published && published.order > this.snapshotOrder)
        return this.acceptSnapshot(published.order, published.stored, 'write');
      // A retired change must leave the view even when its read-back is older than the snapshot.
      this.refresh();
      this.onChange();
    });
  }
  /** Storage events and post-write reads take the same path as the initial read. */
  private acceptSnapshot(order: number, entry: OutlineEntry, origin: 'event' | 'write'): void {
    if (order <= this.snapshotOrder) return;
    this.hydration.snapshot(() => {
      this.takeSnapshot(order, entry, null, origin);
      this.onChange();
    });
  }
  private takeSnapshot(
    order: number,
    entry: OutlineEntry,
    legacy: OutlineEntry,
    origin: 'read' | 'event' | 'write',
  ): void {
    if (order <= this.snapshotOrder) return;
    this.snapshotOrder = order;
    if (entry || origin === 'write' || this.snapshotSource === 'extension') {
      this.snapshot = entry;
      this.snapshotSource = 'extension';
    } else if (legacy) {
      this.snapshot = legacy;
      this.snapshotSource = 'legacy';
    } else if (this.snapshotSource !== 'legacy') {
      this.snapshot = null;
      this.snapshotSource = 'none';
    }
    this.refresh();
  }
  private refresh(): void {
    const key = this.queueKey;
    const entry = key ? outlineSaveQueue.overlay(key, this.snapshot) : null;
    this.markerLevels.clear();
    this.collapsedMarkers.clear();
    if (entry) {
      Object.entries(entry.levels).forEach(([turnId, level]) =>
        this.markerLevels.set(turnId, level),
      );
      entry.collapsed.forEach((turnId) => this.collapsedMarkers.add(turnId));
    }
    if (this.mirrorsLegacyKeys && this.snapshotSource === 'extension') this.writeLegacyMirror();
  }

  // ===== Account lifetime =====

  private observeAccount(): void {
    const attributes = this.policy.hierarchy.accountAttributes;
    if (this.accountObserver || this.destroyed || attributes.length === 0) return;
    this.accountObserver = new MutationObserver((records) => {
      if (accountAttributesChanged(records)) this.rebind();
    });
    this.accountObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [...attributes],
      attributeOldValue: true,
    });
  }
  /** Reads mutations the observer has not delivered yet, so no edit or read lands in a stale account. */
  private accountChangedSinceObserved(): boolean {
    return accountAttributesChanged(this.accountObserver?.takeRecords() ?? []);
  }
  /** The account changed: forget its outline and hydrate whichever account is current now. */
  private rebind(): void {
    if (!this.isCurrent) return;
    this.accountGeneration += 1;
    this.bindBucket(null);
    this.snapshot = null;
    this.snapshotSource = 'none';
    this.refresh();
    this.hydration.invalidate();
    this.onChange();
    void this.init();
  }
  private async resolveBucket(): Promise<HierarchyBucket | null> {
    try {
      const scope = await this.policy.hierarchy.resolveAccountScope();
      if (scope === 'unknown') return null;
      return {
        key: scope?.accountKey
          ? buildScopedStorageKey(this.unscopedKey, scope.accountKey)
          : this.unscopedKey,
        unscopedKey: this.unscopedKey,
        adoptUnscoped: this.policy.hierarchy.adoptUnscopedHierarchy,
        routeUserId: scope?.routeUserId ?? null,
      };
    } catch (error) {
      console.warn('[Timeline] Failed to resolve timeline hierarchy storage scope:', error);
      return null;
    }
  }

  // ===== Legacy Gemini localStorage =====

  private readLegacyLevels(): Record<string, MarkerLevel> {
    const levels: Record<string, MarkerLevel> = {};
    const key = this.policy.hierarchy.legacyLevelsKey;
    const raw = key ? safeLocalStorageGet(key) : null;
    if (!raw) return levels;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      Object.entries(parsed).forEach(([turnId, level]) => {
        if (level === 1 || level === 2 || level === 3) levels[turnId] = level;
      });
    } catch (error) {
      console.warn('[Timeline] Failed to parse legacy marker levels:', error);
    }
    return levels;
  }
  private readLegacyCollapsed(): string[] {
    const key = this.policy.hierarchy.legacyCollapsedKey;
    const raw = key ? safeLocalStorageGet(key) : null;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((turnId: unknown) => String(turnId)) : [];
    } catch (error) {
      console.warn('[Timeline] Failed to parse legacy collapsed markers:', error);
      return [];
    }
  }
  private readLegacyEntry(): TimelineHierarchyConversationData | null {
    if (!this.conversationId) return null;
    const levels = this.readLegacyLevels();
    const collapsed = this.readLegacyCollapsed();
    if (Object.keys(levels).length === 0 && collapsed.length === 0) return null;
    return { conversationUrl: this.url, levels, collapsed, updatedAt: Date.now() };
  }
  private writeLegacyMirror(): void {
    const { legacyLevelsKey, legacyCollapsedKey } = this.policy.hierarchy;
    if (legacyLevelsKey)
      safeLocalStorageSet(legacyLevelsKey, JSON.stringify(Object.fromEntries(this.markerLevels)));
    if (legacyCollapsedKey)
      safeLocalStorageSet(legacyCollapsedKey, JSON.stringify(Array.from(this.collapsedMarkers)));
  }

  // ===== Persistence =====

  /** Captures destination and change now; the write completes even if this timeline is torn down. */
  private enqueue(change: OutlineChange): Promise<void> {
    const bucket = this.bucket;
    const key = this.queueKey;
    if (!bucket || !key) return Promise.resolve();
    const conversationId = this.conversationId;
    return outlineSaveQueue.enqueue(key, change, () => writeChange(bucket, conversationId, change));
  }
  /** Moves a legacy outline into extension storage; a failure changes nothing and retries next mount. */
  private migrateLegacy(legacy: TimelineHierarchyConversationData): Promise<void> {
    const bucket = this.bucket;
    const key = this.queueKey;
    if (!bucket || !key) return Promise.resolve();
    const conversationId = this.conversationId;
    return outlineSaveQueue.enqueue(key, null, () =>
      writeChange(bucket, conversationId, (entry) => entry ?? legacy),
    );
  }
  private async load(
    bucket: HierarchyBucket,
    accept: (apply: () => void) => boolean,
  ): Promise<boolean> {
    if (!this.conversationId || !hasExtensionStorage()) {
      return accept(() => {
        this.snapshot = null;
        this.snapshotSource = 'none';
        this.refresh();
      });
    }
    const order = outlineSaveQueue.claimSnapshotOrder();
    const values = (await chrome.storage.local.get(keysToRead(bucket))) as Record<string, unknown>;
    if (!this.isCurrent) return false;
    if (this.accountChangedSinceObserved()) {
      this.rebind();
      return false;
    }
    const stored = readBucket(bucket, values).conversations[this.conversationId] ?? null;
    const legacy = stored ? null : this.readLegacyEntry();
    const accepted = accept(() => this.takeSnapshot(order, stored, legacy, 'read'));
    if (accepted && legacy) await this.migrateLegacy(legacy);
    return accepted;
  }

  // ===== Edits =====

  private edit(turnId: string, change: (aliases: string[]) => OutlineChange): void | Promise<void> {
    if (!this.isCurrent || !this.canEdit(turnId)) return;
    if (this.accountChangedSinceObserved()) return this.rebind();
    return this.hydration.edit(
      () => this.init(),
      () => {
        const aliases = this.policy.getStoredTurnIdAliases(turnId);
        if (!this.isCurrent || !this.canEdit(turnId) || !this.bucket || aliases.length === 0)
          return;
        if (this.accountChangedSinceObserved()) return this.rebind();
        // Enqueueing notifies this owner, which overlays the change and re-renders.
        void this.enqueue(change(aliases));
      },
    );
  }
  isMarkerCollapsed(turnId: string): boolean {
    return this.policy
      .getStoredTurnIdAliases(turnId)
      .some((alias) => this.collapsedMarkers.has(alias));
  }
  toggleCollapse(turnId: string): void | Promise<void> {
    return this.edit(turnId, (aliases) =>
      setCollapsedChange(turnId, aliases, !this.isMarkerCollapsed(turnId), this.url),
    );
  }
  getMarkerLevel(turnId: string): MarkerLevel {
    for (const alias of this.policy.getStoredTurnIdAliases(turnId)) {
      const level = this.markerLevels.get(alias);
      if (level) return level;
    }
    return 1;
  }
  setMarkerLevel(turnId: string, level: MarkerLevel): void | Promise<void> {
    // Converge verified legacy aliases only after a complete outline is available.
    return this.edit(turnId, (aliases) => setLevelChange(turnId, aliases, level, this.url));
  }

  // ===== Lifecycle =====

  init(): Promise<void> {
    this.observeAccount();
    return this.hydration.read(async (accept) => {
      const generation = this.accountGeneration;
      const bucket = await this.resolveBucket();
      // An account change during resolution belongs to the newer read that rebind started.
      if (generation !== this.accountGeneration || !this.isCurrent) return;
      if (this.accountChangedSinceObserved()) return this.rebind();
      this.bindBucket(bucket);
      if (!bucket || this.hydration.ready) return;
      try {
        if (await this.load(bucket, accept)) this.onChange();
      } catch (error) {
        console.warn('[Timeline] Failed to load timeline hierarchy from extension storage:', error);
      }
    });
  }
  /** Stops listening and editing; saves already accepted still finish. */
  destroy(): void {
    this.destroyed = true;
    this.accountObserver?.disconnect();
    this.accountObserver = null;
    this.stopQueueListener?.();
    this.stopQueueListener = null;
  }
  applyStorageChanges(changes: Record<string, chrome.storage.StorageChange>): void {
    if (!this.isCurrent || !this.bucket || !this.queueKey) return;
    const order = outlineSaveQueue.claimSnapshotOrder();
    const bucket = this.bucket;
    const change = changes[bucket.key];
    if (!change) return;
    const value: unknown = change.newValue;
    // Unresolved scope or partial data is not evidence that the complete outline was read.
    if (value != null && !isCompleteHierarchySnapshot(value)) return;
    this.acceptSnapshot(
      order,
      readBucket(bucket, { [bucket.key]: value }).conversations[this.conversationId] ?? null,
      'event',
    );
  }
}

function isCompleteOutline(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const { levels, collapsed } = value as { levels?: unknown; collapsed?: unknown };
  return (
    !!levels &&
    typeof levels === 'object' &&
    !Array.isArray(levels) &&
    Object.values(levels).every((level) => level === 1 || level === 2 || level === 3) &&
    Array.isArray(collapsed) &&
    collapsed.every((id) => typeof id === 'string')
  );
}

function isCompleteHierarchySnapshot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('conversations' in value)) return false;
  const conversations = value.conversations;
  return (
    !!conversations &&
    typeof conversations === 'object' &&
    !Array.isArray(conversations) &&
    Object.values(conversations).every(isCompleteOutline)
  );
}
