import type { TimelineHierarchyConversationData } from './hierarchyTypes';

type OutlineEntry = TimelineHierarchyConversationData | null;

/** One accepted per-turn edit, applied to whatever entry storage holds when it is written. */
export type OutlineChange = (entry: OutlineEntry) => OutlineEntry;

/** The conversation's entry as storage held it right after a successful write. */
export interface SettledOutline {
  readonly stored: OutlineEntry;
  /** Order claimed when the read-back was issued; see `claimSnapshotOrder`. */
  readonly order: number;
}

/** `published` carries a post-write snapshot; null means only the pending changes moved. */
export type OutlineListener = (published: SettledOutline | null) => void;

/**
 * Page-wide owner of accepted outline edits, keyed by storage bucket and conversation, so a
 * remounted timeline sees edits an earlier session accepted but has not yet written.
 */
class OutlineSaveQueue {
  private tail: Promise<void> = Promise.resolve();
  private snapshotOrder = 0;
  private readonly changes = new Map<string, OutlineChange[]>();
  private readonly listeners = new Map<string, Set<OutlineListener>>();

  /** The stored entry as this page will leave it once its accepted changes are written. */
  overlay(key: string, entry: OutlineEntry): OutlineEntry {
    return (this.changes.get(key) ?? []).reduce((current, change) => change(current), entry);
  }

  /**
   * Page-wide, monotonic order for outline snapshots, claimed when a read is issued or an event
   * arrives. An owner keeps only snapshots newer than the last one it took, so a slow read can
   * never replace a newer event.
   */
  claimSnapshotOrder(): number {
    this.snapshotOrder += 1;
    return this.snapshotOrder;
  }

  subscribe(key: string, listener: OutlineListener): () => void {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  /**
   * Serializes every outline write in the page. `write` re-reads storage, applies its step and
   * returns the entry read back afterwards, or null when it failed. A settled change leaves the
   * overlay as that read is published, so no view depends on catching its own storage event.
   * A `change` of null is a write that is not an edit and is never overlaid (legacy migration).
   */
  enqueue(
    key: string,
    change: OutlineChange | null,
    write: () => Promise<SettledOutline | null>,
  ): Promise<void> {
    if (change) {
      this.changes.set(key, [...(this.changes.get(key) ?? []), change]);
      this.notify(key, null);
    }
    const run = this.tail.then(async () => {
      const settled = await write();
      if (change) this.remove(key, change);
      if (settled) this.notify(key, settled);
      // A failed edit is not in storage, so the outline must stop showing it.
      else if (change) this.notify(key, null);
    });
    this.tail = run;
    return run;
  }

  private remove(key: string, change: OutlineChange): void {
    const remaining = (this.changes.get(key) ?? []).filter((queued) => queued !== change);
    if (remaining.length > 0) this.changes.set(key, remaining);
    else this.changes.delete(key);
  }

  private notify(key: string, published: SettledOutline | null): void {
    this.listeners.get(key)?.forEach((listener) => listener(published));
  }
}

export const outlineSaveQueue = new OutlineSaveQueue();
