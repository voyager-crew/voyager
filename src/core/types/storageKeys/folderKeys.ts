/**
 * Folder data, folder panel preferences and account isolation.
 * Merged into `StorageKeys` by `./index.ts`; keep this file import-free.
 */
export const FOLDER_STORAGE_KEYS = {
  // Folder system
  FOLDER_DATA: 'gvFolderData',
  FOLDER_DATA_AISTUDIO: 'gvFolderDataAIStudio',
  // ChatGPT folders plugin: its own bucket, never a Gemini or AI Studio key.
  FOLDER_DATA_CHATGPT: 'gvFolderDataChatGPT',
  // ChatGPT folder panel geometry and open state on this device.
  CHATGPT_FOLDER_PANEL: 'gvChatGptFolderPanel',
  // The ChatGPT sidebar folder section's collapse and conversation order on this device.
  CHATGPT_FOLDER_SECTION: 'gvChatGptFolderSection',
  // Claude and DeepSeek folders plugins: each its own bucket, panel and section state, as ChatGPT's.
  FOLDER_DATA_CLAUDE: 'gvFolderDataClaude',
  CLAUDE_FOLDER_PANEL: 'gvClaudeFolderPanel',
  CLAUDE_FOLDER_SECTION: 'gvClaudeFolderSection',
  FOLDER_DATA_DEEPSEEK: 'gvFolderDataDeepSeek',
  DEEPSEEK_FOLDER_PANEL: 'gvDeepSeekFolderPanel',
  DEEPSEEK_FOLDER_SECTION: 'gvDeepSeekFolderSection',
  FOLDER_ENABLED: 'geminiFolderEnabled',
  BATCH_DELETE_ENABLED: 'gvBatchDeleteEnabled',
  FOLDER_HIDE_ARCHIVED_CONVERSATIONS: 'geminiFolderHideArchivedConversations',
  FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN: 'geminiFolderHideArchivedNudgeShown',
  FOLDER_SEARCH_ENABLED: 'gvFolderSearchEnabled',
  FOLDER_FLOATING_MODE_ENABLED: 'geminiFolderFloatingModeEnabled',
  FOLDER_FLOATING_OPEN_ON_START: 'geminiFolderFloatingOpenOnStart',
  FOLDER_FLOATING_NUDGE_SHOWN: 'geminiFolderFloatingNudgeShown',
  FOLDER_FLOATING_POS: 'geminiFolderFloatingPos',
  FOLDER_FLOATING_FAB_POS: 'geminiFolderFloatingFabPos',
  FOLDER_FLOATING_SIZE: 'geminiFolderFloatingSize',
  // Global conversation ordering preference for folder views. Manual keeps
  // persisted sortIndex authoritative; recent uses lastOpenedAt/addedAt.
  FOLDER_CONVERSATION_SORT_MODE: 'gvFolderConversationSortMode',
  // Global: whether an open folder lists its subfolders before ('first', the
  // default) or after ('last') its own conversations.
  FOLDER_SUBFOLDER_PLACEMENT: 'gvFolderSubfolderPlacement',
  // AI Studio variants — intentionally separate from the Gemini keys so toggling the
  // behaviour on one platform does not surprise users on the other.
  FOLDER_HIDE_ARCHIVED_CONVERSATIONS_AISTUDIO: 'aistudioFolderHideArchivedConversations',
  FOLDER_HIDE_ARCHIVED_NUDGE_SHOWN_AISTUDIO: 'aistudioFolderHideArchivedNudgeShown',

  // Folder filtering
  GV_FOLDER_FILTER_USER_ONLY: 'gvFolderFilterUserOnly',
  GV_ACCOUNT_ISOLATION_ENABLED: 'gvAccountIsolationEnabled',
  GV_ACCOUNT_ISOLATION_ENABLED_GEMINI: 'gvAccountIsolationEnabledGemini',
  GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO: 'gvAccountIsolationEnabledAIStudio',
  GV_ACCOUNT_PROFILE_MAP: 'gvAccountProfileMap',

  // Sidebar behavior: the folder section
  FOLDERS_HIDDEN: 'gvFoldersHidden',
  FOLDERS_COLLAPSED: 'gvFoldersCollapsed',
  // Device-local projection for the Gemini folder panel. `folders` preserves
  // the tree; `activity` groups filed conversations by their latest real turn.
  FOLDERS_VIEW_MODE: 'gvFoldersViewMode',

  // 'above-recents' (default) anchors the folder panel just above the Recents
  // expandable-section; 'above-notebooks' anchors it above the Notebooks
  // section instead. Persisted in chrome.storage.local since it's a UI-only
  // preference and changes feel best when they take effect immediately.
  FOLDERS_ANCHOR: 'gvFoldersAnchor',

  // Folder spacing
  GV_FOLDER_SPACING: 'gvFolderSpacing',
  GV_AISTUDIO_FOLDER_SPACING: 'gvAIStudioFolderSpacing',
  GV_FOLDER_TREE_INDENT: 'gvFolderTreeIndent',

  // Folder item font size (px). Range 12-18, default 13 to match Gemini's
  // native sidebar item text size after the May 2026 redesign.
  GV_FOLDER_ITEM_FONT_SIZE: 'gvFolderItemFontSize',

  // Folder as Project
  FOLDER_PROJECT_ENABLED: 'gvFolderProjectEnabled',
  FOLDER_PROJECT_PENDING_FOLDER_ID: 'gvFolderProjectPendingFolderId',
} as const;
