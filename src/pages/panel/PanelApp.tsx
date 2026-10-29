import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useLanguage } from '@/contexts/LanguageContext';
import type { PanelSession } from '@/features/panel/protocol';
import type { AccessSite } from '@/pages/popup/utils/siteAccessSites';
import { localeFromLanguage } from '@/utils/language';

import { FeaturesView } from './components/FeaturesView';
import { PanelToast } from './components/PanelToast';
import { ADD_WEBSITE_INPUT_ID, SitesView, siteSwitchId } from './components/SitesView';
import { SyncSheetSlot } from './components/SyncSheetSlot';
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
import { pageSite, siteByKey, switcherSites } from './sites/panelSites';
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
  const { waiting, grant } = useSiteGrant(session.sessionId, failed);
  const granted = useMemo(
    () =>
      new Set(model.siteRows.filter((row) => row.access === 'granted').map((row) => row.site.id)),
    [model.siteRows],
  );
  const sites = useMemo(() => switcherSites(own, granted), [granted, own]);
  const groups = filterPanelGroups(groupPanelRows(model.rows, t), search.state.query);

  // The active tab takes focus as the panel opens, with a ring only after a keyboard open.
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
        onFullSettings={fullSettings}
        shell={shell}
        language={language}
        t={t}
      />
      <SyncSheetSlot cloudButtonRef={cloudButton} />
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
