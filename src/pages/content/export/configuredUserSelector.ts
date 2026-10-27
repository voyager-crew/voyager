/** Existing per-origin export overrides; shared by native and unknown-host baseline reads. */
export function readConfiguredExportUserSelector(allowAuto = true): string {
  try {
    return (
      localStorage.getItem('geminiTimelineUserTurnSelector') ||
      // Auto belongs to bundled discovery. It cannot add stale nodes to an online profile.
      (allowAuto ? localStorage.getItem('geminiTimelineUserTurnSelectorAuto') : '') ||
      ''
    );
  } catch {
    return '';
  }
}
