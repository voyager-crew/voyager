import { type StorageKey, StorageKeys } from '@/core/types/common';

import type { BackupableSettingsKey } from './settingsBackupDefaults';

export type NonSettingsBackupDisposition =
  | 'separate-file'
  | 'device-local'
  | 'local-data'
  | 'cache'
  | 'operational'
  | 'transient'
  | 'deprecated';

export interface NonSettingsBackupPolicy {
  storage: 'sync' | 'local';
  disposition: NonSettingsBackupDisposition;
  reason: string;
}

type NonSettingsStorageKey = Exclude<StorageKey, BackupableSettingsKey>;

/**
 * Every StorageKey that does not belong in the personalization settings file
 * must be classified here. The exhaustive type plus the runtime coverage test
 * make a new key fail fast until its sync/backup behavior is an explicit choice.
 */
export const NON_SETTINGS_BACKUP_POLICIES = {
  [StorageKeys.RESPONSE_NOTIFICATION_ENABLE_PENDING]: {
    storage: 'local',
    disposition: 'transient',
    reason: 'A pending notification permission choice belongs to this installation and expires.',
  },
  [StorageKeys.FOLDER_DATA]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Folder content has its own account-scoped Drive file.',
  },
  [StorageKeys.FOLDER_DATA_AISTUDIO]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'AI Studio folder content has its own Drive file.',
  },
  [StorageKeys.FOLDER_DATA_CHATGPT]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'ChatGPT folder content has its own unscoped Drive file.',
  },
  [StorageKeys.CHATGPT_FOLDER_PANEL]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Viewport coordinates and panel state should not be restored across different screens.',
  },
  [StorageKeys.CHATGPT_FOLDER_SECTION]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'ChatGPT folder section collapse and order are local UI state, as on Gemini.',
  },
  [StorageKeys.FOLDER_DATA_CLAUDE]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Claude folder content has its own unscoped Drive file.',
  },
  [StorageKeys.CLAUDE_FOLDER_PANEL]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Viewport coordinates and panel state should not be restored across different screens.',
  },
  [StorageKeys.CLAUDE_FOLDER_SECTION]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Claude folder section collapse and order are local UI state, as on ChatGPT.',
  },
  [StorageKeys.FOLDER_DATA_DEEPSEEK]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'DeepSeek folder content has its own unscoped Drive file.',
  },
  [StorageKeys.DEEPSEEK_FOLDER_PANEL]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Viewport coordinates and panel state should not be restored across different screens.',
  },
  [StorageKeys.DEEPSEEK_FOLDER_SECTION]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'DeepSeek folder section collapse and order are local UI state, as on ChatGPT.',
  },
  [StorageKeys.FOLDER_FLOATING_NUDGE_SHOWN]: {
    storage: 'sync',
    disposition: 'deprecated',
    reason: 'Reserved key with no active reader or writer.',
  },
  [StorageKeys.FOLDER_FLOATING_POS]: {
    storage: 'sync',
    disposition: 'device-local',
    reason: 'Viewport coordinates should not be restored across different screens.',
  },
  [StorageKeys.FOLDER_FLOATING_FAB_POS]: {
    storage: 'sync',
    disposition: 'device-local',
    reason: 'Viewport coordinates should not be restored across different screens.',
  },
  [StorageKeys.FOLDER_FLOATING_SIZE]: {
    storage: 'sync',
    disposition: 'device-local',
    reason: 'Viewport dimensions should not be restored across different screens.',
  },
  [StorageKeys.TIMELINE_STARRED_MESSAGES]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Starred messages have their own account-scoped Drive file.',
  },
  [StorageKeys.SAVED_LIBRARY_STARS]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Saved Library stars share the existing account-scoped starred messages Drive file.',
  },
  [StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Saved Library deletion records belong to star data, outside settings restore.',
  },
  [StorageKeys.TIMELINE_HIERARCHY]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Timeline hierarchy has its own account-scoped Drive file.',
  },
  [StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Catalog-site timeline outlines have their own per-site Drive file.',
  },
  [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Cloud authorization and opt-in are device-specific.',
  },
  [StorageKeys.HIGHLIGHT_DEVICE_ID]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Conflict-resolution device identity must remain unique per installation.',
  },
  [StorageKeys.PROMPT_ITEMS]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Prompt content has its own Drive file.',
  },
  [StorageKeys.PROMPT_SELECTED_TAGS]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Selected tags are a local view over the current device prompt set.',
  },
  [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Fetched announcement delivery state is not a user preference.',
  },
  [StorageKeys.REMOTE_ANNOUNCEMENTS_PENDING]: {
    storage: 'local',
    disposition: 'transient',
    reason: 'Pending announcement work is installation-specific.',
  },
  [StorageKeys.STORAGE_QUOTA_WARNING_LEVEL]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Quota warning state depends on this installation storage usage.',
  },
  [StorageKeys.GENERATED_UI_CAPTURE_PERMISSION_CLEANUP_DONE]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'One-time permission migration marker is installation-specific.',
  },
  [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Account routing metadata is discovered independently on each device.',
  },
  [StorageKeys.GEMS_HIDDEN]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Sidebar visibility is a per-device layout preference.',
  },
  [StorageKeys.NOTEBOOKS_HIDDEN]: {
    storage: 'local',
    disposition: 'deprecated',
    reason: 'Notebook hiding is no longer active in the current sidebar.',
  },
  [StorageKeys.FOLDERS_HIDDEN]: {
    storage: 'local',
    disposition: 'deprecated',
    reason: 'Folder hiding was replaced by the built-in collapse and Activity controls.',
  },
  [StorageKeys.FOLDERS_COLLAPSED]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Expanded folder UI state is intentionally local.',
  },
  [StorageKeys.FOLDERS_VIEW_MODE]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'The folder tree or Activity projection is a per-device layout preference.',
  },
  [StorageKeys.GV_GEMS_LIST_CACHE]: {
    storage: 'local',
    disposition: 'cache',
    reason: 'The Gems catalog is rebuilt from Gemini.',
  },
  [StorageKeys.GV_GEMS_MRU]: {
    storage: 'local',
    disposition: 'cache',
    reason: 'Recent Gems history is bounded, device-local, and rebuildable.',
  },
  [StorageKeys.GV_USAGE_CACHE]: {
    storage: 'local',
    disposition: 'cache',
    reason: 'Usage data is account-specific and frequently refreshed.',
  },
  [StorageKeys.GV_USAGE_RECIPE]: {
    storage: 'local',
    disposition: 'cache',
    reason: 'The usage refresh recipe is self-calibrated per installation.',
  },
  [StorageKeys.GV_USAGE_POS]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Viewport coordinates are device-specific.',
  },
  [StorageKeys.GV_CLAUDE_USAGE_CACHE]: {
    storage: 'local',
    disposition: 'cache',
    reason: 'Claude usage data is account-specific and frequently refreshed.',
  },
  [StorageKeys.GV_CLAUDE_USAGE_REFRESH_LOCK]: {
    storage: 'local',
    disposition: 'transient',
    reason: 'Refresh locks are valid only within one installation.',
  },
  [StorageKeys.GV_CLAUDE_USAGE_POS]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Viewport coordinates are device-specific.',
  },
  [StorageKeys.FOLDERS_ANCHOR]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Sidebar anchoring follows the layout available on each device.',
  },
  [StorageKeys.SIDEBAR_COLLAPSE_NUDGE_SHOWN]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'This legacy hint belongs to the local sidebar layout.',
  },
  [StorageKeys.WELCOME_PAGE_SHOWN]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'The welcome page opens once per browser profile install.',
  },
  [StorageKeys.TOOLBAR_PIN_HINT_DISMISSED]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'The toolbar pin state is per browser profile.',
  },
  [StorageKeys.NATIVE_HEALTH_DISMISSED]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Health notice dismissals follow the installed extension version.',
  },
  [StorageKeys.CHANGELOG_DISMISSED_VERSION]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Changelog delivery follows the installed extension version.',
  },
  [StorageKeys.CHANGELOG_NOTIFY_MODE]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Changelog notification mode is runtime delivery state.',
  },
  [StorageKeys.EDGE_FINAL_VERSION_NOTICE_FIRST_SEEN_AT]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Browser-specific migration notice state stays local.',
  },
  [StorageKeys.EDGE_FINAL_VERSION_NOTICE_SHOWN]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Browser-specific migration notice state stays local.',
  },
  [StorageKeys.EDGE_CONTINUED_SUPPORT_NOTICE_FIRST_SEEN_AT]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Browser-specific migration notice state stays local.',
  },
  [StorageKeys.EDGE_CONTINUED_SUPPORT_NOTICE_SHOWN]: {
    storage: 'local',
    disposition: 'operational',
    reason: 'Browser-specific migration notice state stays local.',
  },
  [StorageKeys.FORK_NODES]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Fork metadata has its own account-scoped Drive file.',
  },
  [StorageKeys.GV_MESSAGE_TIMESTAMPS]: {
    storage: 'local',
    disposition: 'local-data',
    reason: 'Message timestamp history is local data, not a setting.',
  },
  [StorageKeys.GV_CHATGPT_PRO_USAGE]: {
    storage: 'local',
    disposition: 'local-data',
    reason: 'ChatGPT Pro send counts are what this browser saw, kept on this device only.',
  },
  [StorageKeys.CATALOG_MESSAGE_TIMESTAMPS_PREFIX]: {
    storage: 'local',
    disposition: 'local-data',
    reason:
      'Catalog-site message send times (one key per conversation) are local data, like Gemini message timestamps.',
  },
  [StorageKeys.GV_TURN_IDENTITY_CACHE]: {
    storage: 'local',
    disposition: 'cache',
    reason:
      'Gemini response-id aliases are bounded, device-local, and rebuilt from conversation history.',
  },
  [StorageKeys.RESEARCH_PACK]: {
    storage: 'local',
    disposition: 'device-local',
    reason:
      'The research pack is a short-lived working set the user carries between chats; it is not backed up.',
  },
  [StorageKeys.PROMPT_HISTORY_ITEMS]: {
    storage: 'local',
    disposition: 'device-local',
    reason:
      'Prompt history is a device-local record of sent/edited prompts and is intentionally not backed up.',
  },
  [StorageKeys.SITE_DRAFT_PREFIX]: {
    storage: 'local',
    disposition: 'device-local',
    reason:
      "Unsent composer drafts on catalog sites stay on this device, like Gemini's gvDraft_ entries.",
  },
  [StorageKeys.GV_POPUP_SCROLL_TOP]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Popup scroll position is specific to this device and viewport.',
  },
  [StorageKeys.GV_POPUP_SETTINGS_SEARCH_QUERY]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Popup settings search query is device-local UI state.',
  },
  [StorageKeys.FOLDER_PROJECT_PENDING_FOLDER_ID]: {
    storage: 'local',
    disposition: 'transient',
    reason: 'Pending navigation state is valid only for the current browser flow.',
  },
  [StorageKeys.PLUGINS_STATE]: {
    storage: 'local',
    disposition: 'separate-file',
    reason: 'Plugin install, enable, and setting state uses its own Drive file.',
  },
  [StorageKeys.PLUGIN_MARKETPLACE_SOURCES]: {
    storage: 'local',
    disposition: 'deprecated',
    reason: 'Reserved for a future registry and currently unused.',
  },
  [StorageKeys.PLUGIN_CATALOG_CACHE]: {
    storage: 'local',
    disposition: 'deprecated',
    reason: 'Legacy whole-catalog cache of the retired marketplace source; ignored, never cleaned.',
  },
  [StorageKeys.PLUGIN_HOST_CATALOG_PREFIX]: {
    storage: 'local',
    disposition: 'cache',
    reason:
      'Per-host remote plugin catalogs are re-fetched on the next check and must not be restored.',
  },
  [StorageKeys.PLUGIN_UI_COLLAPSED]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Collapsed plugin cards are a per-device popup layout choice.',
  },
  [StorageKeys.PLUGIN_SEEN_VERSIONS]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Which plugin versions this device has already shown is popup badge state.',
  },
  [StorageKeys.PLUGIN_LOCAL_MANIFESTS]: {
    storage: 'local',
    disposition: 'local-data',
    reason:
      'User-authored plugin manifests stay on this device; the user exports them from the popup. Their enable state rides the plugin-state Drive file.',
  },
  [StorageKeys.WATERMARK_NATIVE_NOTICE_SHOWN]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'One-time notice receipt; restoring it would re-suppress the notice elsewhere.',
  },
  [StorageKeys.WATERMARK_CLEAN_IMAGE_STREAK]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Rolling observation counter rebuilt from the images seen on this device.',
  },
  [StorageKeys.BRIDGE_PAIRING]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Bridge pairing secret: the token pairs this browser profile with one local server.',
  },
  [StorageKeys.BRIDGE_POLICY_HIGH_WATER]: {
    storage: 'local',
    disposition: 'device-local',
    reason: 'Bridge policy high-water mark; restoring an older one could re-allow a revoked op.',
  },
  [StorageKeys.BRIDGE_OUTBOX]: {
    storage: 'local',
    disposition: 'device-local',
    reason: "Bridge results waiting for this device's local server; meaningless elsewhere.",
  },
  [StorageKeys.BRIDGE_PARALLEL]: {
    storage: 'local',
    disposition: 'device-local',
    reason: "Whether this device's bridge runs jobs side by side goes with its local pairing.",
  },
  [StorageKeys.BRIDGE_PARALLEL_JOBS]: {
    storage: 'local',
    disposition: 'device-local',
    reason: "How many jobs this device's bridge runs side by side goes with its local pairing.",
  },
  [StorageKeys.BRIDGE_ACCOUNT_PLANS]: {
    storage: 'local',
    disposition: 'cache',
    reason: 'The ChatGPT plan its pages last showed; the next page load observes it again.',
  },
} as const satisfies Record<NonSettingsStorageKey, NonSettingsBackupPolicy>;
