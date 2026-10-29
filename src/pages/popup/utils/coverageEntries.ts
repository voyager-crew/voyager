/** A coverage entry and where it stood in the list, so an undo can put it back in place. */
export interface PlacedEntry {
  readonly entry: string;
  readonly index: number;
}

/** The entries of `before` that `after` no longer holds, at their positions in `before`. */
export function removedEntries(before: readonly string[], after: readonly string[]): PlacedEntry[] {
  const kept = new Set(after);
  return before.flatMap((entry, index) => (kept.has(entry) ? [] : [{ entry, index }]));
}

/** `list` without `entries`, and each entry it removed at its position. */
export function withoutEntries(
  list: readonly string[],
  entries: readonly string[],
): { next: string[]; removed: PlacedEntry[] } {
  const dropped = new Set(entries);
  return {
    next: list.filter((entry) => !dropped.has(entry)),
    removed: list.flatMap((entry, index) => (dropped.has(entry) ? [{ entry, index }] : [])),
  };
}

/**
 * Puts removed entries back at their old positions, earliest first, so the
 * list reads as it did before; an entry that is already back stays where it is.
 */
export function withEntriesRestored(
  list: readonly string[],
  removed: readonly PlacedEntry[],
): string[] {
  const next = [...list];
  for (const { entry, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (!next.includes(entry)) next.splice(Math.min(index, next.length), 0, entry);
  }
  return next;
}
