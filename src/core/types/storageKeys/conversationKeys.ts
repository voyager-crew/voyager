/**
 * Timeline, highlights, fork, research pack, export and message timestamps.
 * Merged into `StorageKeys` by `./index.ts`; keep this file import-free.
 */
export const CONVERSATION_STORAGE_KEYS = {
  // Timeline
  // Gemini's rail only: message timestamps keep their own opt-in switch.
  GV_TIMELINE_ENABLED: 'gvTimelineEnabled',
  TIMELINE_SCROLL_MODE: 'geminiTimelineScrollMode',
  TIMELINE_STYLE: 'geminiTimelineStyle',
  TIMELINE_HIDE_CONTAINER: 'geminiTimelineHideContainer',
  TIMELINE_BAR_WIDTH: 'geminiTimelineBarWidth',
  TIMELINE_DRAGGABLE: 'geminiTimelineDraggable',
  TIMELINE_POSITION: 'geminiTimelinePosition',
  TIMELINE_PREVIEW_PINNED: 'geminiTimelinePreviewPinned',
  TIMELINE_MARKER_LEVEL: 'geminiTimelineMarkerLevel',
  TIMELINE_STARRED_MESSAGES: 'geminiTimelineStarredMessages',
  SAVED_LIBRARY_STARS: 'gvSavedLibraryStars',
  SAVED_LIBRARY_STAR_TOMBSTONES: 'gvSavedLibraryStarTombstones',
  TIMELINE_HIERARCHY: 'geminiTimelineHierarchy',
  /** Catalog-site (ChatGPT, Claude, DeepSeek) outlines: one `<prefix><siteId>` blob per site. */
  CATALOG_TIMELINE_HIERARCHY_PREFIX: 'gvCatalogTimelineHierarchy:',
  TIMELINE_SHORTCUTS: 'geminiTimelineShortcuts',
  HIGHLIGHT_CLOUD_SYNC_ENABLED: 'gvHighlightCloudSyncEnabled',
  HIGHLIGHT_DEVICE_ID: 'gvAnnotationDeviceId',
  HIGHLIGHT_ENABLED: 'gvHighlightEnabled',
  HIGHLIGHT_DEFAULT_COLOR: 'gvHighlightDefaultColor',
  HIGHLIGHT_COLOR_PALETTE: 'gvHighlightColorPalette',
  HIGHLIGHT_TIMELINE_MARKERS_ENABLED: 'gvHighlightTimelineMarkersEnabled',

  // Fork nodes
  FORK_NODES: 'gvForkNodes',
  FORK_ENABLED: 'gvForkEnabled',

  // Research Pack: the toggle syncs; the pack itself is device-local
  // (chrome.storage.local), scoped per account only under account isolation.
  RESEARCH_PACK_ENABLED: 'gvResearchPackEnabled',
  RESEARCH_PACK: 'gvResearchPack',

  // Default on: Markdown repair predates its sync switch.
  MARKDOWN_FIX_ENABLED: 'gvMarkdownFixEnabled',

  // Export
  // Default on: Canvas copy predates its sync switch.
  CANVAS_COPY_ENABLED: 'gvCanvasCopyEnabled',
  // Default on: controls only the Deep Research export menu entries.
  DEEP_RESEARCH_EXPORT_ENABLED: 'gvDeepResearchExportEnabled',
  // Default on: Gemini's conversation export predates its sync switch.
  GEMINI_EXPORT_ENABLED: 'gvGeminiExportEnabled',
  EXPORT_IMAGE_WIDTH: 'gvExportImageWidth',
  EXPORT_SPEAKER_LABELS: 'gvExportSpeakerLabels',
  // Fallback top-right export toolbar shown when Gemini's logo (the normal
  // inline injection point) is absent. Defaults to true. When false, the
  // toolbar is suppressed even if the logo is missing — users keep the menu
  // injections (顶栏 ⋮ / per-response ⋮) as their only export entry.
  PERSISTENT_EXPORT_TOOLBAR_ENABLED: 'gvPersistentExportToolbarEnabled',
  // Where the user dragged that toolbar, per site: `{ [siteId]: { right, top } }`
  // in px from the viewport's right edge and top. chrome.storage.local only: a
  // spot belongs to this device's screen. A missing site uses the default dock.
  PERSISTENT_EXPORT_TOOLBAR_POSITION: 'gvPersistentExportToolbarPosition',

  // AI Studio master toggle
  GV_AISTUDIO_ENABLED: 'gvAIStudioEnabled',

  // Message timestamps
  GV_SHOW_MESSAGE_TIMESTAMPS: 'gvShowMessageTimestamps',
  GV_MESSAGE_TIMESTAMPS: 'gvMessageTimestamps',
  /**
   * Catalog-site (ChatGPT, …) send times, apart from Gemini's blob above:
   * `<prefix><site>:conv:<id>` per conversation, plus a `<prefix><site>:index` list per site.
   */
  CATALOG_MESSAGE_TIMESTAMPS_PREFIX: 'gvMessageTimestamps:',
  // Local-only cache of Gemini's complete ordered response-id list per
  // conversation. It lets legacy positional turn ids resolve safely after a
  // full reload without persisting message text or response bodies.
  GV_TURN_IDENTITY_CACHE: 'gvTurnIdentityCache',
} as const;
