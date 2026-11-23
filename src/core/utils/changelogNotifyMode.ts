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

/** What a page does about the running release when it loads. */
export type ReleaseAnnouncement = 'popup' | 'badge' | 'none';

export interface ReleaseAnnouncementInput {
  /** The stored notify mode, unparsed. */
  readonly mode: unknown;
  /**
   * The last release whose notes were read (`CHANGELOG_DISMISSED_VERSION`).
   * Missing means a first install. An empty string is an update: older
   * popups wrote it on choosing badge mode, to mean "announce this one".
   */
  readonly readVersion: string | null | undefined;
  readonly currentVersion: string;
  /** A release every person must see, whatever they chose. */
  readonly forcePopup: boolean;
  /**
   * Whether a release since `readVersion` has a note. A release without one is
   * a silent patch: it announces nothing, and its notes wait for the next one.
   */
  readonly hasUnreadNotes: boolean;
}

/** The one rule for announcing a release; every caller asks it instead of reading the mode. */
export function releaseAnnouncement(input: ReleaseAnnouncementInput): ReleaseAnnouncement {
  const { readVersion, currentVersion } = input;
  if (readVersion == null || readVersion === currentVersion) return 'none';
  if (!input.hasUnreadNotes) return 'none';
  if (input.forcePopup) return 'popup';
  const mode = parseChangelogNotifyMode(input.mode);
  return mode === 'off' ? 'none' : mode;
}
