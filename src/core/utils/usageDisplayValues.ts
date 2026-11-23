/** What Gemini's usage bars count, stored in `StorageKeys.USAGE_STATUS_DISPLAY`. */
export type UsageDisplay = 'used' | 'remaining';

/** Anything but `'remaining'`, a missing key included, reads as the default `'used'`. */
export function resolveUsageDisplay(stored: unknown): UsageDisplay {
  return stored === 'remaining' ? 'remaining' : 'used';
}
