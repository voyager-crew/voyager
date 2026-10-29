export type NativePopupPlatform = 'gemini' | 'aistudio';

export const POPUP_SECTION_SEARCH_SETTING_ID = '__section';

/**
 * The official plugin list's topic cards, in their default order. Each is a
 * section of its own, so it reorders, hides in a search and anchors the table
 * of contents like any other card.
 */
export const OFFICIAL_PLUGIN_TOPIC_IDS = [
  'pluginsLayout',
  'pluginsSidebar',
  'pluginsTimeline',
  'pluginsContent',
  'pluginsCharts',
  'pluginsExport',
  'pluginsInput',
  'pluginsConversations',
] as const;

export type OfficialPluginTopicId = (typeof OFFICIAL_PLUGIN_TOPIC_IDS)[number];

/** The single Plugins card the topic cards replaced; a saved order may still hold its slot. */
export const RETIRED_OFFICIAL_PLUGINS_SECTION_ID = 'officialPlugins';

export const NATIVE_POPUP_SECTION_IDS = [
  'cloudSync',
  // Above the topic cards: below them it sat about ten screens down on Gemini.
  'localPlugins',
  ...OFFICIAL_PLUGIN_TOPIC_IDS,
  'folder',
  'folderSpacing',
  'folderTreeIndent',
  'keyboardShortcuts',
  // Above Prompt Manager, where its website list used to sit.
  'siteAccess',
  'promptManager',
  'general',
] as const;

export type NativePopupSectionId = (typeof NATIVE_POPUP_SECTION_IDS)[number];

type SectionCapability = true | readonly string[];

/**
 * AI Studio intentionally exposes a smaller feature surface than Gemini.
 * Keep this as an allowlist so a newly added Gemini setting never appears on
 * AI Studio until its runtime support has been added and verified.
 */
const AI_STUDIO_CAPABILITIES = {
  cloudSync: true,
  // A topic shows only once it has a row this tab lists (usePopupSections).
  pluginsLayout: true,
  pluginsSidebar: true,
  pluginsTimeline: true,
  pluginsContent: true,
  pluginsCharts: true,
  pluginsExport: true,
  pluginsInput: true,
  pluginsConversations: true,
  localPlugins: true,
  folder: ['enableFolderFeature', 'hideArchivedConversations', 'enableAccountIsolation'],
  folderSpacing: true,
  siteAccess: true,
  promptManager: [
    'hidePromptManager',
    'promptTriggerMascotLogo',
    'slashPromptEnabled',
    'promptInsertOnClick',
    'promptDataMigration',
  ],
  general: ['remoteAnnouncementNotification', 'changelogBadgeMode', 'onlineUpdates'],
} as const satisfies Partial<Record<NativePopupSectionId, SectionCapability>>;

export function isOfficialPluginTopicId(id: string): id is OfficialPluginTopicId {
  return (OFFICIAL_PLUGIN_TOPIC_IDS as readonly string[]).includes(id);
}

export function isNativePopupSectionAvailable(
  platform: NativePopupPlatform,
  sectionId: NativePopupSectionId,
): boolean {
  if (platform === 'gemini') return true;
  return Object.prototype.hasOwnProperty.call(AI_STUDIO_CAPABILITIES, sectionId);
}

export function isNativePopupSettingAvailable(
  platform: NativePopupPlatform,
  sectionId: NativePopupSectionId,
  settingId: string,
): boolean {
  if (platform === 'gemini') return true;

  const capability: SectionCapability | undefined =
    AI_STUDIO_CAPABILITIES[sectionId as keyof typeof AI_STUDIO_CAPABILITIES];
  if (!capability) return false;
  if (settingId === POPUP_SECTION_SEARCH_SETTING_ID || capability === true) return true;
  return capability.includes(settingId);
}
