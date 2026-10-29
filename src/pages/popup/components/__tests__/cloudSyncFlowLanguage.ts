/** The popup's language in the sync flow tests; no imports, so a `vi.mock` factory can load it. */
/** Keys pass through; templates keep their placeholders so a test reads what fills them. */
const TEMPLATES: Readonly<Record<string, string>> = {
  syncGuardCount: '{kind}: {cloud} → {local}',
  syncGuardSiteKind: '{kind} ({site})',
  syncGuardUnrecognized: '{kind}: unrecognized',
  syncSkippedMissing: 'missing: {kinds}',
  syncSkippedUnrecognized: 'unrecognized: {kinds}',
  syncReasonSiteExcluded: '{site} excluded',
  syncRestorePartial: 'Restored: {restored}. Not restored: {failed}',
  syncRestoreListSeparator: ', ',
  syncUndoKept: 'kept: {kinds}',
  syncError: 'syncError: {error}',
};

export const flowT = (key: string): string => TEMPLATES[key] ?? key;

/** `vi.mock('@/contexts/LanguageContext', async () => (await import(...)).languageMock)` */
export const languageMock = {
  useLanguage: () => ({ language: 'en', setLanguage: () => {}, t: flowT }),
};
