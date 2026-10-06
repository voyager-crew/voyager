/**
 * Hash utilities
 * Centralized hash functions (was duplicated in 3 files)
 */

/**
 * FNV-1a hash algorithm
 * Fast, good distribution for short strings
 */
export function hashString(input: string): string {
  let h = 2166136261 >>> 0;

  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (h >>> 0).toString(36);
}

/**
 * 53-bit hash (cyrb53), base36: at most 11 characters. For keys where a 32-bit
 * hash collides too often, such as thousands of UUIDs compared within one set.
 */
export function hashString53(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Generate unique ID with timestamp and random component
 */
export function generateUniqueId(prefix = ''): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 11);

  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Hash object to stable string
 */
export function hashObject(obj: Record<string, unknown>): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  return hashString(str);
}
