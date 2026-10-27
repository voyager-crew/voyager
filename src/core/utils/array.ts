/**
 * Array utilities
 */

/** Compare an ordered collection by identity, including its length. */
export function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Filter array to only top-level elements (remove nested duplicates)
 */
export function filterTopLevel<T extends Element>(elements: T[]): T[] {
  const result: T[] = [];

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    let isDescendant = false;

    for (let j = 0; j < elements.length; j++) {
      if (i === j) continue;

      const other = elements[j];
      if (other.contains(element)) {
        isDescendant = true;
        break;
      }
    }

    if (!isDescendant) {
      result.push(element);
    }
  }

  return result;
}

/**
 * Deduplicate array by key function
 */
export function deduplicateBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = keyFn(item);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Binary search for lower bound
 */
export function lowerBound(arr: number[], target: number): number {
  let left = 0;
  let right = arr.length;

  while (left < right) {
    const mid = (left + right) >> 1;

    if (arr[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left;
}

/**
 * Binary search for upper bound
 */
export function upperBound(arr: number[], target: number): number {
  let left = 0;
  let right = arr.length;

  while (left < right) {
    const mid = (left + right) >> 1;

    if (arr[mid] <= target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  return left - 1;
}

/**
 * Chunk array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

/**
 * Sort folders with pinned folders first, then by name using localized collation
 */
export function sortFolders<T extends { name: string; pinned?: boolean }>(folders: T[]): T[] {
  return [...folders].sort((a, b) => {
    // Pinned folders always come first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    // Within the same pinned state, sort by name using localized comparison
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}
