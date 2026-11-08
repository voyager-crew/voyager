const IS_DEBUG = false;

function isDebugEnabled(): boolean {
  try {
    // Enable by setting localStorage.gvFolderDebug = '1'
    return IS_DEBUG || localStorage.getItem('gvFolderDebug') === '1';
  } catch {
    // Ignore - localStorage may not be available in some contexts (e.g. incognito mode)
    return IS_DEBUG;
  }
}

/** Gemini folder manager diagnostics, silent unless `gvFolderDebug` is set. */
export function folderDebug(...args: unknown[]): void {
  // oxlint-disable-next-line no-console -- opt-in diagnostics behind gvFolderDebug, shown in production too
  if (isDebugEnabled()) console.log('[FolderManager]', ...args);
}

export function folderDebugWarn(...args: unknown[]): void {
  if (isDebugEnabled()) console.warn('[FolderManager]', ...args);
}
