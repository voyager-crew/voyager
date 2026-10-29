/**
 * Global settings, onboarding, notices, popup and context sync.
 * Merged into `StorageKeys` by `./index.ts`; keep this file import-free.
 */
export const APP_STORAGE_KEYS = {
  // Global settings
  LANGUAGE: 'language',
  FORMULA_COPY_ENABLED: 'gvFormulaCopyEnabled',
  FORMULA_COPY_FORMAT: 'gvFormulaCopyFormat',
  // Legacy single-toggle key. Kept for migration: when neither
  // WATERMARK_DOWNLOAD_ENABLED nor WATERMARK_PREVIEW_ENABLED is present, this
  // value (defaulting to true) is used to derive both flags so existing users
  // keep their behavior. New writes go to the two split keys below.
  WATERMARK_REMOVER_ENABLED: 'geminiWatermarkRemoverEnabled',
  WATERMARK_DOWNLOAD_ENABLED: 'gvWatermarkDownloadEnabled',
  WATERMARK_PREVIEW_ENABLED: 'gvWatermarkPreviewEnabled',
  HIDE_PROMPT_MANAGER: 'gvHidePromptManager',
  TAB_TITLE_UPDATE_ENABLED: 'gvTabTitleUpdateEnabled',
  MERMAID_ENABLED: 'gvMermaidEnabled',
  WAVEDROM_ENABLED: 'gvWaveDromEnabled',
  ECHARTS_ENABLED: 'gvEchartsEnabled',
  // Default on (`!== false`): Gemini's long code block collapse and the LaTeX
  // rendering in user messages. Read by the native modules and by their
  // packaged official plugins alike.
  CODE_BLOCK_COLLAPSE_ENABLED: 'gvCodeBlockCollapseEnabled',
  USER_LATEX_ENABLED: 'gvUserLatexEnabled',
  QUOTE_REPLY_ENABLED: 'gvQuoteReplyEnabled',
  RESPONSE_COMPLETE_NOTIFICATION_ENABLED: 'gvResponseCompleteNotificationEnabled',
  /** Local, expiring permission intent; never part of settings sync or backups. */
  RESPONSE_NOTIFICATION_ENABLE_PENDING: 'gvResponseNotificationEnablePending',
  REMOTE_ANNOUNCEMENTS_ENABLED: 'gvRemoteAnnouncementsEnabled',
  REMOTE_ANNOUNCEMENTS_STATE: 'gvRemoteAnnouncementsState',
  REMOTE_ANNOUNCEMENTS_PENDING: 'gvRemoteAnnouncementsPending',
  STORAGE_QUOTA_WARNING_LEVEL: 'gvStorageQuotaWarningLevel',
  GENERATED_UI_CAPTURE_PERMISSION_CLEANUP_DONE: 'gvGeneratedUiCapturePermissionCleanupDone',

  // Onboarding, hints and health notices
  SIDEBAR_COLLAPSE_NUDGE_SHOWN: 'gvSidebarCollapseNudgeShown',
  // Reusable one-time feature coachmarks (spotlight + bubble + optional inline
  // toggle). A single sync key holding the array of coachmark ids the user has
  // already seen, so every coachmark shows at most once per user across devices.
  // See src/pages/content/coachmark.
  COACHMARKS_SEEN: 'gvCoachmarksSeen',
  // First-run welcome page (src/pages/welcome). Local because it records what
  // this browser profile has already been shown, not a preference.
  WELCOME_PAGE_SHOWN: 'gvWelcomePageShown',
  // Popup "pin Voyager to the toolbar" hint. Local: the toolbar is per browser
  // profile, so a dismissal on one device must not hide it on another.
  TOOLBAR_PIN_HINT_DISMISSED: 'gvToolbarPinHintDismissed',
  // Popup Gemini health notices the user dismissed, keyed by feature, anchor and extension
  // version (see src/core/gemini/nativeHealth.ts). Local: it records what this profile was shown.
  NATIVE_HEALTH_DISMISSED: 'gvNativeHealthDismissed',

  // Changelog
  CHANGELOG_DISMISSED_VERSION: 'gvChangelogDismissedVersion',
  CHANGELOG_NOTIFY_MODE: 'gvChangelogNotifyMode',
  EDGE_FINAL_VERSION_NOTICE_FIRST_SEEN_AT: 'gvEdgeFinalVersionNoticeFirstSeenAt',
  EDGE_FINAL_VERSION_NOTICE_SHOWN: 'gvEdgeFinalVersionNoticeShown',
  EDGE_CONTINUED_SUPPORT_NOTICE_FIRST_SEEN_AT: 'gvEdgeContinuedSupportNoticeFirstSeenAt',
  EDGE_CONTINUED_SUPPORT_NOTICE_SHOWN: 'gvEdgeContinuedSupportNoticeShown',
  // One-time notice announcing Gemini's own "Media watermark" switch, which
  // makes Voyager's watermark removal redundant for accounts that have it.
  WATERMARK_NATIVE_NOTICE_SHOWN: 'gvWatermarkNativeNoticeShown',
  // Consecutive Gemini images observed with no visible watermark signal. Once
  // this crosses the threshold the notice may surface on its own, independent
  // of Google's staged rollout.
  WATERMARK_CLEAN_IMAGE_STREAK: 'gvWatermarkCleanImageStreak',

  // Popup section order
  GV_POPUP_SECTION_ORDER: 'gvPopupSectionOrder',
  // Device-local vertical position for the popup's full main settings view.
  GV_POPUP_SCROLL_TOP: 'gvPopupScrollTop',
  // Device-local last query entered in the popup settings search.
  GV_POPUP_SETTINGS_SEARCH_QUERY: 'gvPopupSettingsSearchQuery',
  // Per-site panel viewport coordinates on this device; never synced or backed up.
  PANEL_POSITIONS: 'gvPanelPositions',

  // Context sync
  CONTEXT_SYNC_ENABLED: 'contextSyncEnabled',
  CONTEXT_SYNC_PORT: 'contextSyncPort',
} as const;
