import { useCallback, useEffect, useMemo } from 'react';

import { CircleDot } from 'lucide-react';

import { useLanguage } from '@/contexts/LanguageContext';
import { getVoyagerBuildTarget, isSafari } from '@/core/utils/browser';
import type { PanelSessionId } from '@/features/panel/protocol';
import { compatibleSettingWrite } from '@/features/plugins/runtime/resolvePluginSettings';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { usePluginAccess } from '@/pages/popup/components/usePluginAccess';
import { usePluginPreferences } from '@/pages/popup/components/usePluginPreferences';
import type { CurrentTab } from '@/pages/popup/hooks/currentTab';
import { COVERAGE_REFUSAL_MESSAGES } from '@/pages/popup/hooks/useCustomWebsites';
import { usePopupPlugins } from '@/pages/popup/hooks/usePopupPlugins';
import {
  PROMPT_MANAGER_STORAGE_DEFAULTS,
  usePromptManagerSettings,
} from '@/pages/popup/hooks/usePromptManagerSettings';
import { PROMPT_SWITCH_ID } from '@/pages/popup/hooks/usePromptSwitch';
import { useSiteAccess } from '@/pages/popup/hooks/useSiteAccess';
import { useSitePluginRuns } from '@/pages/popup/hooks/useSitePluginRuns';
import type { UndoOffer, WithdrawUndoOffer } from '@/pages/popup/hooks/useUndoToast';
import { useOfficialPluginList } from '@/pages/popup/officialPlugins/useOfficialPluginList';
import { writePopupSyncStorage } from '@/pages/popup/utils/popupStorage';
import { isPluginPopupSite } from '@/pages/popup/utils/siteMode';
import {
  canUseVisualEffects,
  withVisualEffectsManifest,
} from '@/pages/popup/utils/visualEffectsAvailability';
import { type TranslationKey, getLoadedTranslations } from '@/utils/translations';

import {
  type PanelRow,
  type RowTexts,
  catalogPanelRow,
  officialPanelRow,
} from './features/featureRows';
import { openSiteAccessFallback } from './hooks/panelRequests';
import type { PanelSite } from './sites/panelSites';

const OFFICIAL_IDS: ReadonlySet<string> = new Set(Object.values(OFFICIAL_PLUGIN_IDS));
export const FLOATING_BUTTON_ROW_ID = 'voyager.panel.floating-button';

/** The panel's page context comes from the shell; there is no tab to re-read after a grant. */
const settled = async (): Promise<void> => {};

function siteDomain(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Shows a refusal once each time it newly appears (`toast` keeps its identity). */
function useRefusalToast(
  message: string | null,
  toast: (offer: UndoOffer) => WithdrawUndoOffer,
): void {
  useEffect(() => {
    if (message) toast({ message, tone: 'error' });
  }, [message, toast]);
}

export interface PanelModelInputs {
  /** The redeemed session, for asking the background to open the popup where this frame can't ask. */
  readonly sessionId: PanelSessionId;
  readonly tab: CurrentTab;
  /** The site the 功能 tab shows. */
  readonly viewed: PanelSite;
  /** Whether that site is the page itself, so sliders preview and statuses come from the page. */
  readonly viewingPage: boolean;
  readonly shortcut: string;
  readonly toast: (offer: UndoOffer) => WithdrawUndoOffer;
}

/**
 * Everything the panel shows, read and written through the popup's own hooks:
 * the same plugin list, switches, legacy bindings, coverage and site access,
 * for the site being viewed.
 */
export function usePanelModel({
  sessionId,
  tab,
  viewed,
  viewingPage,
  shortcut,
  toast,
}: PanelModelInputs) {
  const { t, language } = useLanguage();
  const viewedTab = useMemo<CurrentTab>(
    () => ({
      activeUrl: viewed.url,
      activeTabContextLoaded: true,
      requestTab: viewingPage ? tab.requestTab : null,
    }),
    [tab.requestTab, viewed.url, viewingPage],
  );
  const plugins = usePopupPlugins(viewedTab);
  const isSafariBrowser = getVoyagerBuildTarget() === 'safari' || isSafari();
  const officialManifests = useMemo(
    () => withVisualEffectsManifest(plugins.siteScopedManifests, plugins.pluginManifests),
    [plugins.siteScopedManifests, plugins.pluginManifests],
  );
  const official = useOfficialPluginList({
    manifests: officialManifests,
    pluginState: plugins.pluginState,
    legacy: plugins.legacySettings,
    legacyLoaded: plugins.legacySettingsLoaded,
    context: { isSafariBrowser },
    formFactor: plugins.formFactor,
  });
  const preferences = usePluginPreferences();
  // Adding a website, or an undo that asks again, goes to the popup where this frame can't ask.
  const askElsewhere = useCallback(() => openSiteAccessFallback(sessionId), [sessionId]);
  const promptManager = usePromptManagerSettings({
    t,
    pluginManifests: plugins.pluginManifests,
    refreshActiveTabContext: settled,
    writeSyncStorage: writePopupSyncStorage,
    askElsewhere,
  });
  // One startup read, as the popup hydrates its Prompt Manager settings; the list then follows storage.
  const { hydrateFromStorage } = promptManager;
  useEffect(() => {
    try {
      chrome.storage?.sync?.get({ ...PROMPT_MANAGER_STORAGE_DEFAULTS }, (result) =>
        hydrateFromStorage(result ?? {}),
      );
    } catch {
      // Keep the defaults when the extension storage context is unavailable.
    }
  }, [hydrateFromStorage]);
  const siteAccess = useSiteAccess({
    activeUrl: viewed.url,
    coverage: promptManager,
    plugins,
    language,
    t,
    onUndoOffer: toast,
  });
  const { promptSwitch } = siteAccess;
  const catalog = useMemo(
    () => plugins.siteScopedManifests.filter((plugin) => !OFFICIAL_IDS.has(plugin.id)),
    [plugins.siteScopedManifests],
  );
  // Prompt Manager's row is its coverage entry, which needs no grant repair of its own.
  const accessManifests = useMemo(
    () => catalog.filter((plugin) => plugin.id !== promptSwitch?.pluginId),
    [catalog, promptSwitch?.pluginId],
  );
  const access = usePluginAccess(
    accessManifests,
    viewed.url,
    preferences.enabledMap,
    preferences.mirrorEnabled,
  );
  const sitePluginRuns = useSitePluginRuns({
    activeUrl: viewed.url,
    manifests: plugins.siteScopedManifests,
    pluginState: plugins.pluginState,
  });
  const isPluginSite = isPluginPopupSite(viewed.url, plugins.siteScopedManifests);
  const effectsAvailable = canUseVisualEffects({
    isPluginSite,
    activeSiteDomain: siteDomain(viewed.url),
    customWebsites: promptManager.customWebsites,
    sitePluginRuns,
    pageRunsEffect: plugins.pluginStatuses.some(
      (status) => status.id === OFFICIAL_PLUGIN_IDS.visualEffects,
    ),
  });

  useRefusalToast(access.deniedId && t('pluginPermissionDenied'), toast);
  useRefusalToast(access.unsupportedId && t('pluginUnsupportedPlatform'), toast);
  useRefusalToast(access.enableRefusal && t(access.enableRefusal.key), toast);
  useRefusalToast(promptManager.websiteError || null, toast);

  const english = useCallback((key: TranslationKey) => getLoadedTranslations('en')[key] ?? key, []);
  const texts: RowTexts = { language, t, english };
  const statusById = new Map(plugins.pluginStatuses.map((status) => [status.id, status]));
  const floatingName = t('panelFloatingButton');
  const rows: PanelRow[] = [
    {
      id: FLOATING_BUTTON_ROW_ID,
      group: 'entry',
      name: floatingName,
      search: [floatingName, english('panelFloatingButton')].map((text) => text.toLowerCase()),
      icon: CircleDot,
      enabled: !promptManager.values.hidePromptManager,
      note: null,
      locked: false,
      toggle: (next) => promptManager.onChange({ hidePromptManager: !next }),
      keyCap: { label: shortcut, hint: t('panelShortcutHint') },
    },
  ];
  if (official.available) {
    for (const row of official.rows) {
      if (row.manifest.id === OFFICIAL_PLUGIN_IDS.visualEffects && !effectsAvailable) continue;
      const panelRow = officialPanelRow(row, texts, official);
      if (panelRow) rows.push(panelRow);
    }
  }
  const promptPlugin = catalog.find((plugin) => plugin.id === promptSwitch?.pluginId);
  for (const plugin of promptPlugin ? [promptPlugin, ...accessManifests] : catalog) {
    const prompt = plugin === promptPlugin ? promptSwitch : null;
    const row = catalogPanelRow(plugin, {
      texts,
      enabled: prompt ? prompt.enabled : preferences.enabledMap[plugin.id] === true,
      stored: preferences.settingsMap[plugin.id],
      status: statusById.get(plugin.id),
      siteLabel: viewed.label,
      toggle: prompt
        ? (next) =>
            void prompt.setEnabled(next).then((refusal) => {
              if (refusal) toast({ message: t(COVERAGE_REFUSAL_MESSAGES[refusal]), tone: 'error' });
            })
        : (next) => void access.handleToggle(plugin, next),
      save: (key, value) =>
        preferences.handleImmediateSettings(
          plugin.id,
          compatibleSettingWrite(plugin, { key, value }).stored,
        ),
    });
    // The popup's undo for Prompt Manager hands focus back to the switch with this id.
    rows.push(prompt ? { ...row, switchId: PROMPT_SWITCH_ID } : row);
  }

  return {
    rows,
    siteRows: siteAccess.rows,
    otherWebsites: siteAccess.otherWebsites,
    revoking: siteAccess.revoking,
    revoke: siteAccess.revoke,
    removeWebsite: siteAccess.removeWebsite,
    website: {
      value: promptManager.newWebsiteInput,
      change: promptManager.onWebsiteInputChange,
      add: () => void promptManager.handleAddWebsite(),
    },
  };
}
