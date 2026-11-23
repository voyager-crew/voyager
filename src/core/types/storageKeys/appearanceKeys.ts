/**
 * Chat and sidebar layout, Gems, usage widgets and visual effects.
 * Merged into `StorageKeys` by `./index.ts`; keep this file import-free.
 */
export const APPEARANCE_STORAGE_KEYS = {
  // UI customization
  CHAT_WIDTH: 'geminiChatWidth',
  CHAT_WIDTH_ENABLED: 'gvChatWidthEnabled',
  CHAT_FONT_SIZE: 'gvChatFontSize',
  CHAT_FONT_SIZE_ENABLED: 'gvChatFontSizeEnabled',
  CHAT_LINE_HEIGHT: 'gvChatLineHeight',
  CHAT_LINE_HEIGHT_ENABLED: 'gvChatLineHeightEnabled',
  CHAT_PARAGRAPH_SPACING: 'gvChatParagraphSpacing',
  EDIT_INPUT_WIDTH: 'geminiEditInputWidth',
  EDIT_INPUT_WIDTH_ENABLED: 'gvEditInputWidthEnabled',
  SIDEBAR_WIDTH: 'geminiSidebarWidth',
  SIDEBAR_WIDTH_ENABLED: 'gvSidebarWidthEnabled',
  AISTUDIO_SIDEBAR_WIDTH: 'gvAIStudioSidebarWidth',
  AISTUDIO_SIDEBAR_WIDTH_ENABLED: 'gvAIStudioSidebarWidthEnabled',

  // Sidebar behavior
  GV_SIDEBAR_AUTO_HIDE: 'gvSidebarAutoHide',
  GV_SIDEBAR_FULL_HIDE: 'gvSidebarFullHide',
  GEMS_HIDDEN: 'gvGemsHidden',
  NOTEBOOKS_HIDDEN: 'gvNotebooksHidden',

  // Default-on master switch for the Gems list, scraping and pin controls.
  GV_GEMS_SIDEBAR_ENABLED: 'gvGemsSidebarEnabled',
  // Recent Gems count (0–10, default 3). Zero hides the list; it does not stop
  // the module. Cached gems live in `GV_GEMS_LIST_CACHE`.
  GV_GEMS_SIDEBAR_COUNT: 'gvGemsSidebarCount',
  // Local cache of the Gems list scraped from /gems/view. Stored as
  // { items: GemMetadata[]; cachedAt: number }. Falls into local (not sync)
  // because gem rosters can be sizeable + sync quota is precious.
  GV_GEMS_LIST_CACHE: 'gvGemsListCache',
  // Most-recently-used gems, newest first. Stored as
  // { entries: Array<GemMetadata & { lastUsedAt: number }> }. Captured when the
  // user opens a `/gem/<id>` page (custom OR premade), so the sidebar ranks gems
  // by recent use rather than by the static management-page order. Local for the
  // same quota reason as the list cache.
  GV_GEMS_MRU: 'gvGemsMru',
  // Ordered list of gem ids the user pinned from Gemini's Gems list. Pinned
  // gems always render first in the sidebar (in this order) and are never
  // trimmed by GV_GEMS_SIDEBAR_COUNT; remaining slots fill with recently-used gems.
  // Empty array (default) preserves the pure MRU behavior. Stored as string[]
  // in chrome.storage.sync — ids only, so it stays tiny; names/icons resolve
  // from the local cache/MRU on each device.
  GV_GEMS_PINNED: 'gvGemsPinned',
  // Usage status-line. Enables the slim daily/weekly usage pill near the
  // composer. Synced so the toggle follows the user across devices. Default off
  // (opt-in) since it injects persistent UI.
  USAGE_STATUS_ENABLED: 'gvUsageStatusEnabled',
  // Local cache of the usage limits scraped from /usage. Stored as a
  // UsageSnapshot envelope ({ daily, weekly, tier, accountKey, updatedAt }).
  // Local (not sync) because it changes constantly and is per-account, not a
  // preference.
  GV_USAGE_CACHE: 'gvUsageCache',
  // Self-calibrated "recipe" for silently refreshing usage off the /usage page:
  // { rpcid, args } of the batchexecute call that carries the usage metrics,
  // captured by the document_start observer and DOM-verified on /usage. Replayed
  // from any Gemini page to refresh the snapshot without navigating.
  GV_USAGE_RECIPE: 'gvUsageRecipe',
  // User-dragged position of the usage mini-bar ({ x, y } viewport px). Absent =
  // default bottom-right. Local since it's a per-device UI placement.
  GV_USAGE_POS: 'gvUsagePos',
  // true = the usage mini-bar shows what is left instead of what is used.
  // Absent/false = used (the default). Toggled by clicking a bar's percent.
  GV_USAGE_SHOW_REMAINING: 'gvUsageShowRemaining',
  // Local cache scraped from Claude's official settings usage page. Stored as
  // { metrics: Array<{ label, percent, resetLabel }>, plan, lastUpdatedLabel, updatedAt }.
  GV_CLAUDE_USAGE_CACHE: 'gvClaudeUsageCache',
  // Short-lived local lock so multiple Claude tabs share one usage refresh cadence.
  GV_CLAUDE_USAGE_REFRESH_LOCK: 'gvClaudeUsageRefreshLock',
  // User-dragged position of the Claude usage mini-bar ({ x, y } viewport px).
  GV_CLAUDE_USAGE_POS: 'gvClaudeUsagePos',
  // ChatGPT Pro sends this browser saw (chrome.storage.local, never synced or backed up).
  // { version: 1, sends: Array<{ at, key }> (last 45 days), limit, resetsAt } — see
  // src/features/plugins/builtin/chatgptProUsage/usageStore.ts.
  GV_CHATGPT_PRO_USAGE: 'gvChatGptProUsage',

  // Hide Gemini's blue radial-gradient halo behind the input box
  // (chat-window::before + .nl-canvas blobs). Default false (halo visible).
  INPUT_HALO_HIDDEN: 'gvInputHaloHidden',

  // Snow effect (legacy, kept for backward compat migration)
  GV_SNOW_EFFECT: 'gvSnowEffect',

  // Visual effect (replaces GV_SNOW_EFFECT): 'off' | 'snow' | 'sakura'
  GV_VISUAL_EFFECT: 'gvVisualEffect',
} as const;
