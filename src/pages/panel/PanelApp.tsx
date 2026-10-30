import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useLanguage } from '@/contexts/LanguageContext';
import { isFolderPlatform } from '@/features/folder/platforms';
import type { PanelSession } from '@/features/panel/protocol';
import type { AccessSite } from '@/features/plugins/sites/siteAccessSites';
import { BUILT_IN_SITES } from '@/features/plugins/sites/siteAccessSites';
import { localeFromLanguage } from '@/utils/language';

import { FeaturesView } from './components/FeaturesView';
import { PanelToast } from './components/PanelToast';
import { ADD_WEBSITE_INPUT_ID, SitesView, siteSwitchId } from './components/SitesView';
import { SyncSheet } from './components/SyncSheet';
import { type PanelTabId, TopBar, panelTabId, panelViewId } from './components/TopBar';
import { filterPanelGroups, groupPanelRows } from './features/featureRows';
import { EscapeLayers } from './hooks/escapeLayers';
import { openFullSettings } from './hooks/panelRequests';
import { type PanelShell, createPanelShell } from './hooks/panelShell';
import { useOpeningFocus } from './hooks/useOpeningFocus';
import { usePanelCurrentTab } from './hooks/usePanelCurrentTab';
import { usePanelSearch } from './hooks/usePanelSearch';
import { usePanelShortcut } from './hooks/usePanelShortcut';
import { usePanelToast } from './hooks/usePanelToast';
import { useSiteGrant } from './hooks/useSiteGrant';
import { bundledSite, pageSite, siteByKey, switcherSites } from './sites/panelSites';
import { lastSyncedLabel } from './sync/syncCopy';
import { useSiteSyncInclusion } from './sync/useSiteSyncInclusion';
import { useSyncSheet } from './sync/useSyncSheet';
import { usePanelModel } from './usePanelModel';

const byId = (id: string) => () => document.getElementById(id);

function PanelPage({ session, shell }: { session: PanelSession; shell: PanelShell }) {
  const { t, language } = useLanguage();
  const tab = usePanelCurrentTab(session);
  const { context } = tab;

  // The page's scheme and direction come from the shell; the language is Voyager's own.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.gvScheme = context.scheme;
    root.dir = context.direction;
    root.lang = localeFromLanguage(language);
  }, [context.direction, context.scheme, language]);

  const toast = usePanelToast();
  const { show } = toast;
  // Focus inside this frame keeps the page's listener from hearing the shortcut.
  const shortcut = usePanelShortcut(shell.close);
  const search = usePanelSearch();
  const { close: closeSearch } = search;
  const [view, setView] = useState<PanelTabId>('features');
  const [viewedKey, setViewedKey] = useState<string | null>(null);
  const tabButtons = useRef<Partial<Record<PanelTabId, HTMLButtonElement | null>>>({});
  const cloudButton = useRef<HTMLButtonElement | null>(null);

  const own = useMemo(
    () => pageSite(context.pageUrl, context.siteId),
    [context.pageUrl, context.siteId],
  );
  const viewed = (viewedKey !== null && viewedKey !== own.key && siteByKey(viewedKey)) || own;
  const viewingPage = viewed.key === own.key;
  const model = usePanelModel({
    sessionId: session.sessionId,
    tab,
    viewed,
    viewingPage,
    shortcut,
    toast: show,
  });

  const failed = useCallback(
    () => show({ message: t('permissionRequestFailed'), tone: 'error' }),
    [show, t],
  );
  const includeInSync = useSiteSyncInclusion(show, t);
  const asked = useCallback(
    (site: AccessSite) => includeInSync(site, byId(siteSwitchId(site))),
    [includeInSync],
  );
  const { waiting, grant } = useSiteGrant(session.sessionId, failed, asked);
  const grantedIds = useMemo(
    () =>
      new Set(model.siteRows.filter((row) => row.access === 'granted').map((row) => row.site.id)),
    [model.siteRows],
  );
  const sites = useMemo(() => switcherSites(own, grantedIds), [grantedIds, own]);
  const sheetSites = useMemo(() => {
    const entry = (site: AccessSite) => {
      const { key, label, logo } = bundledSite(site);
      return { key, label, logo };
    };
    return {
      enabled: [
        ...BUILT_IN_SITES.map(entry),
        ...model.siteRows.filter((row) => row.access === 'granted').map((row) => entry(row.site)),
      ],
      idle: model.siteRows.filter((row) => row.access === 'none').map((row) => entry(row.site)),
    };
  }, [model.siteRows]);
  const sheetPage = useMemo(
    () => ({
      pageUrl: context.pageUrl,
      ownPlatform: isFolderPlatform(own.key) ? own.key : null,
      requestTab: tab.requestTab,
    }),
    [context.pageUrl, own.key, tab.requestTab],
  );
  const sheet = useSyncSheet({
    page: sheetPage,
    sites: sheetSites.enabled,
    idleSites: sheetSites.idle,
    toast: show,
    cloudButtonRef: cloudButton,
    language,
    t,
  });
  const groups = filterPanelGroups(groupPanelRows(model.rows, t), search.state.query);

  // The active tab takes focus as the panel opens; its ring waits for a key press.
  useOpeningFocus(useCallback(() => tabButtons.current.features, []));

  const changeView = useCallback(
    (next: PanelTabId) => {
      setView(next);
      if (next !== 'features') closeSearch();
    },
    [closeSearch],
  );
  const viewSite = useCallback(
    (key: string) => {
      setViewedKey(key);
      closeSearch();
    },
    [closeSearch],
  );
  const openSite = (site: AccessSite) => {
    viewSite(site.id);
    changeView('features');
    tabButtons.current.features?.focus({ preventScroll: true });
  };
  // 启用 on a site with cloud data: the 网站 tab, with that site's row flashed and its switch focused.
  const closeSheet = sheet.close;
  const enableSite = useCallback(
    (key: string) => {
      closeSheet();
      changeView('sites');
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-site-row="${CSS.escape(key)}"]`);
        if (!row) return;
        row.classList.remove('flash');
        void row.offsetWidth;
        row.classList.add('flash');
        row.querySelector<HTMLElement>('.sw')?.focus({ preventScroll: true });
      });
    },
    [changeView, closeSheet],
  );
  const fullSettings = useCallback(() => {
    void openFullSettings().then((opened) => {
      if (!opened) show({ message: t('pm_settings_fallback'), tone: 'error' });
    });
  }, [show, t]);

  return (
    <div className="panel" data-panel-session={session.sessionId}>
      <TopBar
        own={own}
        viewed={viewed}
        sites={sites}
        onView={viewSite}
        tab={view}
        onTab={changeView}
        tabButtons={tabButtons}
        search={search.state}
        searchInputRef={search.inputRef}
        searchButtonRef={search.buttonRef}
        cloudButtonRef={cloudButton}
        cloud={{
          open: sheet.open,
          mark: sheet.cloud,
          title:
            sheet.loaded && sheet.connected
              ? lastSyncedLabel(t, language, sheet.lastSynced)
              : t('cloudSync'),
        }}
        onCloud={sheet.toggle}
        onFullSettings={fullSettings}
        shell={shell}
        language={language}
        t={t}
      />
      <SyncSheet
        sheet={sheet}
        cloudButtonRef={cloudButton}
        onEnableSite={enableSite}
        language={language}
        t={t}
      />
      <div className="views">
        <div
          key={`${view}:${viewed.key}`}
          id={panelViewId(view)}
          role="tabpanel"
          aria-labelledby={panelTabId(view)}
          className="view in"
        >
          {view === 'features' ? (
            <FeaturesView
              groups={groups}
              previewing={viewingPage}
              shell={shell}
              emptyText={t('panelNoMatches')}
            />
          ) : (
            <SitesView
              rows={model.siteRows}
              otherWebsites={model.otherWebsites}
              waiting={waiting}
              revoking={model.revoking}
              onGrant={grant}
              onRevoke={(site) => void model.revoke(site, byId(siteSwitchId(site)))}
              onOpen={openSite}
              onRemoveWebsite={(entry) =>
                void model.removeWebsite(entry, byId(ADD_WEBSITE_INPUT_ID))
              }
              website={model.website}
              language={language}
              t={t}
            />
          )}
        </div>
      </div>
      <PanelToast
        offer={toast.offer}
        undoLabel={t('pluginToggleUndo')}
        onUndo={toast.undo}
        onHover={toast.setHovered}
        onFocusInside={toast.setFocused}
        containerRef={toast.containerRef}
      />
    </div>
  );
}

/**
 * The Voyager panel inside the page: 功能 and 网站 for the open site or any
 * site Voyager can reach, read and written through the popup's own hooks.
 * Esc closes what is open inside, then the panel.
 */
export function PanelApp({ session }: { session: PanelSession }) {
  const shell = useMemo(() => createPanelShell(session.hostOrigin), [session.hostOrigin]);
  return (
    <EscapeLayers onNothingOpen={shell.close}>
      <PanelPage session={session} shell={shell} />
    </EscapeLayers>
  );
}
