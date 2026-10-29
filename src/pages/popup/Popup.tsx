import { type ReactNode, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { StorageKeys } from '@/core/types/common';
import {
  getVoyagerBuildTarget,
  isSafari,
  supportsExtensionNotifications,
} from '@/core/utils/browser';
import { isRTLLanguage } from '@/core/utils/rtl';
import { getFolderPlatformForHost } from '@/features/folder/platforms';
import { CHATGPT_EXPORT_PLUGIN_ID } from '@/features/plugins/builtin/chatgptExport/openMessage';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';

import { AiStudioEnableCard } from './components/AiStudioEnableCard';
import { CatalogTimelineOptions } from './components/CatalogTimelineOptions';
import { CloudSyncSettings } from './components/CloudSyncSettings';
import { DiagnosticsExportCard } from './components/DiagnosticsExportCard';
import { FolderSettingsCard } from './components/FolderSettingsCard';
import { KeyboardShortcutSettings } from './components/KeyboardShortcutSettings';
import { NativeHealthNotice } from './components/NativeHealthNotice';
import { NativeLocalPluginsSection } from './components/NativeLocalPluginsSection';
import { PluginSiteSettings } from './components/PluginSiteSettings';
import { PopupFooter } from './components/PopupFooter';
import { PopupGeneralSettings } from './components/PopupGeneralSettings';
import { PopupHeader } from './components/PopupHeader';
import { PopupLayoutSettings } from './components/PopupLayoutSettings';
import { PopupSearchBox } from './components/PopupSearchBox';
import { PopupSection } from './components/PopupSection';
import { PopupToc } from './components/PopupToc';
import { PopupUpdateBanner } from './components/PopupUpdateBanner';
import { PromptManagerSettingsCard } from './components/PromptManagerSettingsCard';
import { SiteAccessCard } from './components/SiteAccessCard';
import { StarredHistory } from './components/StarredHistory';
import { StorageManager } from './components/StorageManager';
import { StorageQuotaCard } from './components/StorageQuotaCard';
import { ToolbarPinHint } from './components/ToolbarPinHint';
import { UndoToast } from './components/UndoToast';
import { useActivePopupTab } from './hooks/useActivePopupTab';
import {
  catalogTimelineSettingKeys,
  useCatalogTimelineSettings,
} from './hooks/useCatalogTimelineSettings';
import { useFolderPopupSettings } from './hooks/useFolderPopupSettings';
import { useFolderStructureCopy } from './hooks/useFolderStructureCopy';
import { useGeneralPopupSettings } from './hooks/useGeneralPopupSettings';
import { useNativeHealth } from './hooks/useNativeHealth';
import { usePopupBrandTheme } from './hooks/usePopupBrandTheme';
import { usePopupLayoutSettings } from './hooks/usePopupLayoutSettings';
import { usePopupPlugins } from './hooks/usePopupPlugins';
import { usePopupReleaseInfo } from './hooks/usePopupReleaseInfo';
import { usePopupScrollRestoration } from './hooks/usePopupScrollRestoration';
import {
  type PopupSectionId,
  type PopupSectionOptions,
  usePopupSections,
} from './hooks/usePopupSections';
import { usePopupSettingsHydration } from './hooks/usePopupSettingsHydration';
import { usePromptDataTransfer } from './hooks/usePromptDataTransfer';
import { usePromptManagerSettings } from './hooks/usePromptManagerSettings';
import { useSiteAccess } from './hooks/useSiteAccess';
import { useSitePluginRuns } from './hooks/useSitePluginRuns';
import { useUndoToast } from './hooks/useUndoToast';
import { OfficialPluginCards } from './officialPlugins/OfficialPluginCards';
import { PluginSiteOfficialRows } from './officialPlugins/PluginSiteOfficialRows';
import { useContextSyncRequest } from './officialPlugins/useContextSyncRequest';
import { useOfficialPluginList } from './officialPlugins/useOfficialPluginList';
import { writePopupSyncStorage } from './utils/popupStorage';
import { isPluginPopupSite } from './utils/siteMode';
import { canUseVisualEffects, withVisualEffectsManifest } from './utils/visualEffectsAvailability';

interface PopupProps {
  sourceTabId?: number;
}

export default function Popup({ sourceTabId }: PopupProps = {}) {
  const { t, language } = useLanguage();
  const [showStarredHistory, setShowStarredHistory] = useState(false);
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [aiStudioEnabled, setAiStudioEnabled] = useState(true);
  const tab = useActivePopupTab(sourceTabId);
  const plugins = usePopupPlugins(tab);
  const officialManifests = useMemo(
    () => withVisualEffectsManifest(plugins.siteScopedManifests, plugins.pluginManifests),
    [plugins.siteScopedManifests, plugins.pluginManifests],
  );
  const nativeHealth = useNativeHealth(tab.activeTabId, tab.activeUrl);
  const isAIStudio = tab.activeAccountPlatform === 'aistudio';
  const isSafariBrowser = getVoyagerBuildTarget() === 'safari' || isSafari();
  const officialPlugins = useOfficialPluginList({
    manifests: officialManifests,
    pluginState: plugins.pluginState,
    legacy: plugins.legacySettings,
    legacyLoaded: plugins.legacySettingsLoaded,
    context: { isSafariBrowser },
    formFactor: plugins.formFactor,
  });
  const canUseSystemNotifications = supportsExtensionNotifications();
  const currentPlatformLabel = isAIStudio ? t('platformAIStudio') : t('platformGemini');
  const isPluginSite = isPluginPopupSite(tab.activeUrl, plugins.siteScopedManifests);
  const activeSiteDomain = useMemo(() => {
    try {
      return new URL(tab.activeUrl).host.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  }, [tab.activeUrl]);
  const theme = usePopupBrandTheme({
    activeUrl: tab.activeUrl,
    pluginManifests: plugins.pluginManifests,
    pluginSiteOverride: plugins.pluginSiteOverride,
  });
  const release = usePopupReleaseInfo(isSafariBrowser);

  // These owners remain mounted while search hides cards or an auxiliary view opens.
  // A catalog rail runs on its timeline plugin's settings and its own placement keys, so the
  // options under its plugin row edit those on such a site instead of Gemini's.
  const catalogTimeline = useCatalogTimelineSettings({
    activeUrl: tab.activeUrl,
    siteOverride: plugins.pluginSiteOverride,
    manifests: plugins.siteScopedManifests,
    pluginState: plugins.pluginState,
    writeSyncStorage: writePopupSyncStorage,
    // Every timeline shares Gemini's message-times switch, which is its own Plugins row there.
    messageTimestamps: {
      enabled: officialPlugins.panelValues[StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS] === true,
      set: (enabled) =>
        officialPlugins.setEnabled(OFFICIAL_PLUGIN_IDS.geminiMessageTimestamps, enabled),
    },
  });
  const folder = useFolderPopupSettings({
    activeAccountPlatform: tab.activeAccountPlatform,
    writeSyncStorage: writePopupSyncStorage,
  });
  const general = useGeneralPopupSettings({
    writeSyncStorage: writePopupSyncStorage,
    isSafariBrowser,
    canUseSystemNotifications,
    storedResponseNotification: plugins.legacySettingsLoaded
      ? plugins.legacySettings[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED] === true
      : undefined,
  });
  const layout = usePopupLayoutSettings({ isAIStudio });
  const promptManager = usePromptManagerSettings({
    t,
    pluginManifests: plugins.pluginManifests,
    refreshActiveTabContext: tab.refreshActiveTabContext,
    writeSyncStorage: writePopupSyncStorage,
  });
  const promptTransfer = usePromptDataTransfer(t);
  const folderStructureCopy = useFolderStructureCopy(language, sourceTabId);
  // Above every early return and section: a sync in flight outlives its card.
  const contextSync = useContextSyncRequest(sourceTabId);
  // The effect runs only where Voyager's content script does: on a plugin site, once Prompt
  // Manager or a matching plugin has been enabled there. Until then its row is left out.
  const sitePluginRuns = useSitePluginRuns({
    activeUrl: tab.activeUrl,
    manifests: plugins.siteScopedManifests,
    pluginState: plugins.pluginState,
  });
  const visualEffectsAvailable = canUseVisualEffects({
    isPluginSite,
    activeSiteDomain,
    customWebsites: promptManager.customWebsites,
    sitePluginRuns,
    pageRunsEffect: plugins.pluginStatuses.some(
      (status) => status.id === OFFICIAL_PLUGIN_IDS.visualEffects,
    ),
  });
  const sections = usePopupSections({
    // Plugin sites hide native sections through `isPluginSite`; keep the full allowlist for the
    // sections they still show (Cloud Sync, shortcuts) instead of treating them as AI Studio.
    nativePopupPlatform: tab.activeAccountPlatform ?? 'gemini',
    isPluginSite,
    officialPluginTopics: officialPlugins.topics,
    officialPluginSearchItems: officialPlugins.searchItems,
    t,
    writeSyncStorage: writePopupSyncStorage,
  });
  usePopupSettingsHydration({
    folder: folder.hydrateFromStorage,
    general: general.hydrateFromStorage,
    promptManager: promptManager.hydrateFromStorage,
    sections: sections.hydrateFromStorage,
    aiStudio: setAiStudioEnabled,
  });
  usePopupScrollRestoration({
    activeTabContextLoaded: tab.activeTabContextLoaded,
    hasSettingsSearch: sections.hasSettingsSearch,
    isPluginSite,
    showStarredHistory,
    showStorageManager,
  });
  const undoToast = useUndoToast();
  const siteAccess = useSiteAccess({
    activeUrl: tab.activeUrl,
    coverage: promptManager,
    plugins,
    language,
    t,
    onUndoOffer: undoToast.show,
  });
  const rtl = isRTLLanguage(language) ? 'rtl' : undefined;
  const wrapSection = (id: PopupSectionId, content: ReactNode, options?: PopupSectionOptions) => (
    <PopupSection key={id} {...sections.getSectionProps(id, options)}>
      {content}
    </PopupSection>
  );
  // A plugin site's rail is a row of its plugin list; its options open under that row.
  const timelineRail =
    isPluginSite && catalogTimeline
      ? {
          pluginId: catalogTimeline.pluginId,
          settingKeys: catalogTimelineSettingKeys(catalogTimeline),
          render: (ownedSettingKeys: readonly string[], name: string, enabled: boolean) => (
            <CatalogTimelineOptions
              timeline={catalogTimeline}
              ownedSettingKeys={ownedSettingKeys}
              name={name}
              railEnabled={enabled}
              onViewStarredHistory={() => setShowStarredHistory(true)}
              language={language}
              t={t}
            />
          ),
        }
      : undefined;
  // Official rows whose manifest covers a plugin site (Visual effects), beside its plugins.
  const pluginSiteOfficialRows =
    isPluginSite && officialPlugins.available
      ? officialPlugins.rows.filter(
          (row) => row.manifest.id !== OFFICIAL_PLUGIN_IDS.visualEffects || visualEffectsAvailable,
        )
      : [];
  if (showStarredHistory)
    return (
      <StarredHistory sourceTabId={sourceTabId} onClose={() => setShowStarredHistory(false)} />
    );
  if (showStorageManager)
    return (
      <div style={theme.style}>
        <StorageManager
          onClose={() => setShowStorageManager(false)}
          onManageHighlights={() => {
            setShowStorageManager(false);
            setShowStarredHistory(true);
          }}
        />
      </div>
    );
  return (
    <div className="bg-background text-foreground w-[360px]" style={theme.style}>
      <PopupHeader themePicker={theme.picker} t={t}>
        {!isPluginSite && (
          <>
            <PopupSearchBox
              query={sections.settingsSearchQuery}
              onChange={sections.updateSettingsSearchQuery}
              dir={rtl}
              t={t}
            />
            {!sections.hasSettingsSearch && (
              <PopupToc sections={sections.displayedSections} dir={rtl} t={t} />
            )}
          </>
        )}
      </PopupHeader>
      <div className="flex flex-col gap-4 p-5">
        {/* First under the header, above the update banner (order -2, earlier in DOM). */}
        <ToolbarPinHint style={{ order: -2 }} />
        {!isPluginSite && sections.hasSettingsSearch && !sections.hasVisibleSearchResults && (
          <Card style={{ order: -2.5 }} className="p-4 text-center" role="status">
            <p className="text-muted-foreground text-sm">{t('popupSettingsSearchNoResults')}</p>
          </Card>
        )}
        <NativeHealthNotice
          style={{ order: -2 }}
          entries={nativeHealth.visibleEntries}
          language={language}
          onDismiss={nativeHealth.dismiss}
          t={t}
        />
        <PopupUpdateBanner release={release} isSafariBrowser={isSafariBrowser} t={t} />
        {!isPluginSite && (
          <div style={{ order: sections.getSectionProps('cloudSync').order + 1 }}>
            <StorageQuotaCard onManage={() => setShowStorageManager(true)} />
          </div>
        )}
        {/* AI Studio master toggle - only shown when on AI Studio */}
        {isAIStudio && (
          <AiStudioEnableCard
            style={{ order: -1 }}
            checked={aiStudioEnabled}
            onChange={(checked) => {
              setAiStudioEnabled(checked);
              void writePopupSyncStorage({ [StorageKeys.GV_AISTUDIO_ENABLED]: checked });
            }}
            t={t}
          />
        )}
        {/* Cloud Sync */}
        {wrapSection('cloudSync', <CloudSyncSettings sourceTabId={sourceTabId} />, {
          allowPluginSite: getFolderPlatformForHost(activeSiteDomain) !== null,
          // Same top-level slot as on Gemini, ahead of the site's prompt and plugin cards.
          pluginSiteOrder: -2,
        })}
        {isPluginSite && (
          <PluginSiteSettings
            promptSwitch={siteAccess.promptSwitch}
            promptDataTransfer={promptTransfer}
            plugins={{
              manifests: plugins.siteScopedManifests,
              loading: plugins.pluginsLoading,
              onRefresh: plugins.refresh,
              refreshing: plugins.pluginsRefreshing,
              activeUrl: tab.activeUrl,
              sourceIds: plugins.pluginSourceIds,
              blockedUpdates: plugins.pluginBlockedUpdates,
              catalogHost: plugins.pluginCatalogHost,
              statuses: plugins.pluginStatuses,
              timelineRail,
              officialRows: (
                <PluginSiteOfficialRows
                  rows={pluginSiteOfficialRows}
                  statuses={plugins.pluginStatuses}
                  nameSources={plugins.siteScopedManifests}
                  onToggle={officialPlugins.setEnabled}
                  onSettingsChange={officialPlugins.setSettings}
                  panelIo={{
                    values: officialPlugins.panelValues,
                    write: officialPlugins.writePanel,
                  }}
                  language={language}
                  t={t}
                />
              ),
            }}
            exportEntry={{
              enabled: isPluginEnabled(plugins.pluginState, CHATGPT_EXPORT_PLUGIN_ID),
              activeTabId: tab.activeTabId,
              // The options page embeds this view in a tab of its own; only the
              // toolbar popup should get out of the way of the opened dialog.
              onOpened: sourceTabId === undefined ? () => window.close() : undefined,
            }}
            t={t}
          />
        )}
        {/* Folder Options */}
        {wrapSection(
          'folder',
          <FolderSettingsCard
            values={folder.values}
            onChange={folder.onChange}
            accountIsolation={{
              enabled: folder.accountIsolationEnabled,
              platformLabel: currentPlatformLabel,
              onChange: folder.onAccountIsolationChange,
            }}
            aiStructureCopy={folderStructureCopy}
            isVisible={(settingId) => sections.shouldShowSetting('folder', settingId)}
            t={t}
          />,
        )}
        <PopupLayoutSettings settings={layout} t={t} wrapSection={wrapSection} />
        {/* Keyboard Shortcuts: global, so catalog timeline rails listen to them too. */}
        {wrapSection('keyboardShortcuts', <KeyboardShortcutSettings />, {
          allowPluginSite: catalogTimeline !== null,
        })}

        {/* Every site's access, also below a plugin site's own features. */}
        {wrapSection(
          'siteAccess',
          <SiteAccessCard access={siteAccess} coverage={promptManager} language={language} t={t} />,
          { allowPluginSite: true },
        )}
        {wrapSection(
          'promptManager',
          <PromptManagerSettingsCard
            settings={promptManager}
            transfer={promptTransfer}
            isVisible={(id) => sections.shouldShowSetting('promptManager', id)}
            t={t}
          />,
        )}
        {/* General Options */}
        {wrapSection(
          'general',
          <PopupGeneralSettings
            settings={general}
            catalogHost={tab.activeTabContextLoaded ? plugins.pluginCatalogHost : undefined}
            refreshing={plugins.pluginsRefreshing}
            onRefresh={plugins.refresh}
            canUseSystemNotifications={canUseSystemNotifications}
            isVisible={(settingId) => sections.shouldShowSetting('general', settingId)}
            t={t}
          />,
        )}

        {/* Official plugins on Gemini / AI Studio: one switch per feature, in topic cards. */}
        <OfficialPluginCards
          rows={officialPlugins.rows}
          statuses={plugins.pluginStatuses}
          nameSources={plugins.siteScopedManifests}
          isVisible={(topic, pluginId) => sections.shouldShowSetting(topic, pluginId)}
          onToggle={officialPlugins.setEnabled}
          onFlip={officialPlugins.flipEnabled}
          onSettingsChange={officialPlugins.setSettings}
          controls={{ responseNotification: general.responseNotification }}
          panelIo={{
            values: officialPlugins.panelValues,
            write: officialPlugins.writePanel,
            contextSync,
            openStarredHistory: () => setShowStarredHistory(true),
          }}
          onUndoOffer={undoToast.show}
          wrapSection={wrapSection}
          language={language}
          t={t}
        />
        {/* Gemini / AI Studio have no plugin page; local plugins get one section here. */}
        {wrapSection(
          'localPlugins',
          <NativeLocalPluginsSection
            plugins={{
              manifests: plugins.siteScopedManifests,
              loading: plugins.pluginsLoading,
              activeUrl: tab.activeUrl,
              sourceIds: plugins.pluginSourceIds,
              blockedUpdates: plugins.pluginBlockedUpdates,
              statuses: plugins.pluginStatuses,
            }}
            t={t}
          />,
        )}
      </div>

      <PopupFooter
        extVersion={release.extVersion}
        releaseUrl={release.releaseUrl}
        language={language}
        t={t}
      >
        <DiagnosticsExportCard
          activeUrl={tab.activeUrl}
          loading={plugins.pluginsLoading || !plugins.pluginStateLoaded}
          nativeHealth={nativeHealth.entries}
          plugins={plugins.diagnosticPlugins}
        />
      </PopupFooter>
      <UndoToast
        offer={undoToast.offer}
        undoLabel={t('pluginToggleUndo')}
        onUndo={undoToast.undo}
        onHover={undoToast.setHovered}
        onFocusInside={undoToast.setFocused}
        containerRef={undoToast.containerRef}
        dir={rtl}
      />
    </div>
  );
}
