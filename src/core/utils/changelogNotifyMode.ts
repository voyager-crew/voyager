/**
 * How a new release announces itself (`StorageKeys.CHANGELOG_NOTIFY_MODE`):
 * - `popup`: the changelog opens on its own after an update (the default)
 * - `badge`: the floating ball shows NEW, and clicking it opens the changelog
 * - `off`: nothing announces it; the Prompt Manager's version badge still opens it
 */
export type ChangelogNotifyMode = 'popup' | 'badge' | 'off';

/** The stored mode, with a missing or unknown value read as `popup`. */
export function parseChangelogNotifyMode(value: unknown): ChangelogNotifyMode {
  return value === 'badge' || value === 'off' ? value : 'popup';
}
