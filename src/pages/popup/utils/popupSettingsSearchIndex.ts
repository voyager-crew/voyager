import type { TranslationKey } from '@/utils/translations';

import {
  type NativePopupSectionId as PopupSectionId,
  POPUP_SECTION_SEARCH_SETTING_ID,
} from './nativeSiteCapabilities';
import type { SettingsSearchItem } from './settingsSearch';

export type PopupSettingsSearchTargetId = `${PopupSectionId}:${string}`;

export interface PopupSettingsSearchItem extends SettingsSearchItem<PopupSettingsSearchTargetId> {
  sectionId: PopupSectionId;
  settingId: string;
}

function popupSearchTarget(
  sectionId: PopupSectionId,
  settingId: string,
  keys: readonly TranslationKey[],
  aliases?: readonly string[],
): PopupSettingsSearchItem {
  return {
    id: `${sectionId}:${settingId}` as PopupSettingsSearchTargetId,
    sectionId,
    settingId,
    keys,
    aliases,
  };
}

function popupSectionSearchTarget(
  sectionId: PopupSectionId,
  keys: readonly TranslationKey[],
  aliases?: readonly string[],
): PopupSettingsSearchItem {
  return popupSearchTarget(sectionId, POPUP_SECTION_SEARCH_SETTING_ID, keys, aliases);
}

export const POPUP_SETTINGS_SEARCH_ITEMS = [
  popupSectionSearchTarget('cloudSync', ['cloudSync']),
  popupSearchTarget(
    'cloudSync',
    'controls',
    [
      'cloudSyncDescription',
      'syncUpload',
      'syncMerge',
      'syncOverwrite',
      'syncMode',
      'signInWithGoogle',
      'signOut',
      'lastSynced',
      'lastUploaded',
      'syncSuccess',
      'syncError',
    ],
    ['backup restore drive google cloud save 云端 云同步 备份 恢复'],
  ),
  popupSectionSearchTarget('folder', ['folderOptions']),
  popupSearchTarget('folder', 'enableFolderFeature', ['enableFolderFeature']),
  popupSearchTarget('folder', 'enableFolderFloatingMode', [
    'enableFolderFloatingMode',
    'enableFolderFloatingModeHint',
  ]),
  popupSearchTarget('folder', 'openFloatingFolderOnStartup', [
    'openFloatingFolderOnStartup',
    'openFloatingFolderOnStartupHint',
  ]),
  popupSearchTarget('folder', 'hideArchivedConversations', ['hideArchivedConversations']),
  popupSearchTarget('folder', 'showFolderSearch', ['showFolderSearch'], ['search 查找 搜索']),
  popupSearchTarget('folder', 'enableAccountIsolation', [
    'enableAccountIsolation',
    'enableAccountIsolationHint',
  ]),
  popupSearchTarget('folder', 'folderAsProject', [
    'folderAsProject_enable',
    'folderAsProject_description',
  ]),
  popupSearchTarget('folder', 'aiOrgCopy', ['aiOrgCopyButton', 'aiOrgCopyHint']),
  popupSectionSearchTarget('folderSpacing', ['folderSpacing']),
  popupSearchTarget(
    'folderSpacing',
    'controls',
    ['folderSpacing', 'folderSpacingCompact', 'folderSpacingSpacious'],
    ['folder gap density padding margin 间距 密度 紧凑 宽松'],
  ),
  popupSectionSearchTarget('folderTreeIndent', ['folderTreeIndent']),
  popupSearchTarget(
    'folderTreeIndent',
    'controls',
    ['folderTreeIndent', 'folderTreeIndentCompact', 'folderTreeIndentSpacious'],
    ['folder nesting tree indent hierarchy 层级 缩进 树'],
  ),
  popupSectionSearchTarget('keyboardShortcuts', ['keyboardShortcuts']),
  popupSearchTarget(
    'keyboardShortcuts',
    'controls',
    ['enableShortcuts', 'previousNode', 'nextNode', 'firstNode', 'lastNode', 'resetShortcuts'],
    ['hotkey keybinding vim navigation keyboard 快捷键 键盘 热键'],
  ),
  popupSectionSearchTarget('siteAccess', ['siteAccessTitle']),
  popupSearchTarget(
    'siteAccess',
    'controls',
    [
      'siteAccessDescription',
      'siteAccessOtherWebsites',
      'customWebsites',
      'customWebsitesPlaceholder',
      'addWebsite',
      'siteAccessRemove',
    ],
    [
      'site access permission websites custom domain revoke 网站 访问 权限 授权 自定义网站 取消授权',
    ],
  ),
  popupSectionSearchTarget(
    'promptManager',
    ['promptManagerOptions'],
    ['prompt library vault snippets templates 提示词 指令 宝库 模板'],
  ),
  popupSearchTarget('promptManager', 'hidePromptManager', [
    'hidePromptManager',
    'hidePromptManagerHint',
  ]),
  popupSearchTarget(
    'promptManager',
    'promptTriggerMascotLogo',
    ['promptTriggerMascotLogo', 'promptTriggerMascotLogoHint'],
    ['mascot kanban 看板娘 logo'],
  ),
  popupSearchTarget(
    'promptManager',
    'slashPromptEnabled',
    ['slashPromptEnabled', 'slashPromptEnabledHint'],
    ['slash autocomplete quick insert 斜杠 快速插入'],
  ),
  popupSearchTarget('promptManager', 'promptInsertOnClick', [
    'promptInsertOnClick',
    'promptInsertOnClickHint',
  ]),
  popupSearchTarget(
    'promptManager',
    'promptDataMigration',
    ['promptDataMigration', 'promptDataMigrationHint', 'pm_import', 'pm_export'],
    ['prompt import export backup migrate 提示词 导入 导出 迁移 备份'],
  ),
  // Each topic card and each listed plugin is its own target, built from what the list shows
  // (officialPluginSearch.ts).
  popupSectionSearchTarget('general', ['generalOptions']),
  popupSearchTarget(
    'general',
    'onlineUpdates',
    ['pluginsOnlineUpdates', 'pluginsOnlineUpdatesHint', 'pluginsCheckInterval', 'pluginsRefresh'],
    ['online updates page detection fix repair Gemini 在线 更新 页面识别 修复'],
  ),
  popupSearchTarget('general', 'enableTabTitleUpdate', [
    'enableTabTitleUpdate',
    'enableTabTitleUpdateHint',
  ]),
  popupSearchTarget('general', 'persistentExportToolbar', [
    'persistentExportToolbar',
    'persistentExportToolbarHint',
  ]),
  popupSearchTarget('general', 'remoteAnnouncementNotification', [
    'remoteAnnouncementNotification',
    'remoteAnnouncementNotificationHint',
    'remoteAnnouncementSystemPermissionCta',
  ]),
  popupSearchTarget(
    'general',
    'changelogBadgeMode',
    ['changelog_badge_mode', 'changelog_badge_mode_hint', 'changelog_title'],
    ['update release changelog new badge 更新 版本 更新日志 提醒'],
  ),
] as const satisfies readonly PopupSettingsSearchItem[];
