/**
 * Locator names only; query order, row identity and actions remain packaged. A locator whose
 * result must equal the packaged one cannot gain from a fix, so it lives in `sidebar-packaged.json`.
 */
export const GEMINI_SIDEBAR_PROFILE_KEYS = [
  'sidebar.overflow',
  'sidebar.notebooks',
  'sidebar.recents',
  'sidebar.allConversations',
  'sidebar.history',
  'sidebar.section',
  'sidebar.row',
  'sidebar.rowContainer',
  'sidebar.openHost',
  'sidebar.host',
  'sidebar.visibilityHost',
  'sidebar.links',
  'sidebar.conversationLinks',
  'sidebar.title',
  'sidebar.titleFallback',
  'sidebar.scroller',
  'sidebar.interactionButton',
  'sidebar.forkRoots',
] as const;

export type GeminiSidebarProfileKey = (typeof GEMINI_SIDEBAR_PROFILE_KEYS)[number];
