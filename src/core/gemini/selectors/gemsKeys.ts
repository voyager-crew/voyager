/** Sidebar placement is independent of the management-page catalog. */
export const GEMINI_GEMS_NAV_PROFILE_KEYS = ['gems.navEntry'] as const;

/** Gem identity, native metadata evidence and click policy remain packaged. */
export const GEMINI_GEMS_CATALOG_PROFILE_KEYS = [
  'gems.list',
  'gems.row',
  'gems.title',
  'gems.description',
  'gems.icon',
] as const;

export const GEMINI_GEMS_PROFILE_KEYS = [
  ...GEMINI_GEMS_NAV_PROFILE_KEYS,
  ...GEMINI_GEMS_CATALOG_PROFILE_KEYS,
] as const;

export type GeminiGemsProfileKey = (typeof GEMINI_GEMS_PROFILE_KEYS)[number];
