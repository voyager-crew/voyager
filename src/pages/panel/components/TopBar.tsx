import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChevronDown, Cloud, EyeOff, Search, SquareArrowOutUpRight } from 'lucide-react';
import browser from 'webextension-polyfill';

import { PANEL_SHELL_MESSAGE } from '@/features/panel/protocol';
import type { TranslationKey } from '@/utils/translations';

import type { PanelShell } from '../hooks/panelShell';
import { fillPlaceholders } from '../panelText';
import { type PanelSite, letterTileHue } from '../sites/panelSites';
import { PanelMenu } from './PanelMenu';
import { SiteLogo } from './SiteMark';

export type PanelTabId = 'features' | 'sites';
export const PANEL_TABS: readonly PanelTabId[] = ['features', 'sites'];
const TAB_LABELS: Readonly<Record<PanelTabId, TranslationKey>> = {
  features: 'panelTabFeatures',
  sites: 'panelTabSites',
};
const MASCOT = 'mascot-logo.png';

export const panelTabId = (tab: PanelTabId) => `panel-tab-${tab}`;
export const panelViewId = (tab: PanelTabId) => `panel-view-${tab}`;

function SiteGlyph({ site, size }: { site: PanelSite; size: number }) {
  if (site.logo) return <SiteLogo logo={site.logo} size={size} />;
  return (
    <span
      className="mini"
      aria-hidden="true"
      style={{ '--h': letterTileHue(site.host) } as React.CSSProperties}
    >
      {site.host.charAt(0).toUpperCase()}
    </span>
  );
}

export interface PanelSearchState {
  readonly open: boolean;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly toggle: () => void;
}

export interface TopBarProps {
  readonly own: PanelSite;
  readonly viewed: PanelSite;
  readonly sites: readonly PanelSite[];
  readonly onView: (key: string) => void;
  readonly tab: PanelTabId;
  readonly onTab: (tab: PanelTabId) => void;
  readonly tabButtons: React.RefObject<Partial<Record<PanelTabId, HTMLButtonElement | null>>>;
  readonly search: PanelSearchState;
  readonly searchInputRef: React.RefObject<HTMLInputElement | null>;
  readonly searchButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly cloudButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly onFullSettings: () => void;
  readonly shell: PanelShell;
  readonly language: string;
  readonly t: (key: TranslationKey) => string;
}

/** Moves the panel by screen-coordinate deltas from the press; double-click recenters it. */
function useDrag(shell: PanelShell) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fromControl = (target: EventTarget) =>
    target instanceof Element && target.closest('button, input') !== null;
  const delta = (event: React.PointerEvent) => ({
    deltaX: event.screenX - (start.current?.x ?? event.screenX),
    deltaY: event.screenY - (start.current?.y ?? event.screenY),
  });
  const end = (event: React.PointerEvent<HTMLElement>) => {
    if (start.current?.id !== event.pointerId) return;
    shell.post({ kind: PANEL_SHELL_MESSAGE.dragEnd, ...delta(event) });
    start.current = null;
    setDragging(false);
  };
  return {
    dragging,
    handlers: {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0 || fromControl(event.target)) return;
        start.current = { x: event.screenX, y: event.screenY, id: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
        shell.post({ kind: PANEL_SHELL_MESSAGE.dragStart, deltaX: 0, deltaY: 0 });
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (start.current?.id !== event.pointerId) return;
        shell.post({ kind: PANEL_SHELL_MESSAGE.dragMove, ...delta(event) });
      },
      onPointerUp: end,
      onPointerCancel: end,
      onDoubleClick: (event: React.MouseEvent<HTMLElement>) => {
        if (!fromControl(event.target)) shell.post({ kind: PANEL_SHELL_MESSAGE.recenter });
      },
    },
  };
}

/** The 56px top bar: brand and site switcher, the two tabs, search, cloud and full settings. */
export function TopBar({
  own,
  viewed,
  sites,
  onView,
  tab,
  onTab,
  tabButtons,
  search,
  searchInputRef,
  searchButtonRef,
  cloudButtonRef,
  onFullSettings,
  shell,
  language,
  t,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // The logo pops in when the viewed site changes, not on open.
  const [swapped, setSwapped] = useState(false);
  const openedOn = useRef(viewed.key);
  useEffect(() => {
    if (viewed.key !== openedOn.current) setSwapped(true);
  }, [viewed.key]);
  const switcher = useRef<HTMLButtonElement | null>(null);
  const segment = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<React.CSSProperties>({});
  const drag = useDrag(shell);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const away = viewed.key !== own.key;
  const switcherTitle = away
    ? fillPlaceholders(t('panelNotThisPage'), { site: viewed.label })
    : viewed.label;

  useLayoutEffect(() => {
    const measure = () => {
      const button = tabButtons.current?.[tab];
      if (button) {
        setIndicator({
          width: button.offsetWidth,
          transform: `translateX(${button.offsetLeft}px)`,
        });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (segment.current) observer.observe(segment.current);
    return () => observer.disconnect();
  }, [language, tab, tabButtons]);

  return (
    <header className={drag.dragging ? 'ph dragging' : 'ph'} {...drag.handlers}>
      <div className="brand">
        <img src={browser.runtime.getURL(MASCOT)} alt="" draggable={false} />
        <b>Voyager</b>
        <span className="sep" />
        <button
          ref={switcher}
          type="button"
          className={['siteBtn', away && 'away', swapped && 'swap'].filter(Boolean).join(' ')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={switcherTitle}
          title={switcherTitle}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="siteLogo" key={viewed.key}>
            <SiteGlyph site={viewed} size={18} />
          </span>
          {away && (
            <span className="away-mark" aria-hidden="true">
              <EyeOff size={13} strokeWidth={2} />
            </span>
          )}
          <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
      <div ref={segment} className="seg" role="tablist" aria-label={t('panelTabsLabel')}>
        <span className="ind" style={indicator} />
        {PANEL_TABS.map((id) => (
          <button
            key={id}
            ref={(element) => {
              if (tabButtons.current) tabButtons.current[id] = element;
            }}
            id={panelTabId(id)}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={panelViewId(id)}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => onTab(id)}
            onKeyDown={(event) => {
              // Two tabs: either arrow moves to the other one.
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const next = id === 'features' ? 'sites' : 'features';
              onTab(next);
              tabButtons.current?.[next]?.focus();
            }}
          >
            {t(TAB_LABELS[id])}
          </button>
        ))}
      </div>
      <div className={tab === 'features' ? 'tools' : 'tools dim'}>
        <div className={search.open ? 'search open' : 'search'}>
          <button
            ref={searchButtonRef}
            type="button"
            className="ib"
            aria-label={t('panelSearch')}
            aria-expanded={search.open}
            tabIndex={tab === 'features' ? 0 : -1}
            onClick={search.toggle}
          >
            <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <input
            ref={searchInputRef}
            type="search"
            value={search.query}
            placeholder={t('panelSearch')}
            aria-label={t('panelSearch')}
            tabIndex={search.open && tab === 'features' ? 0 : -1}
            onChange={(event) => search.setQuery(event.target.value)}
          />
        </div>
        <button
          ref={cloudButtonRef}
          type="button"
          className="ib cloud"
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-label={t('cloudSync')}
          title={t('cloudSync')}
        >
          <Cloud size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="ib"
          aria-label={t('panelFullSettings')}
          title={t('panelFullSettings')}
          onClick={onFullSettings}
        >
          <SquareArrowOutUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <PanelMenu
        open={menuOpen}
        anchor={switcher}
        align="start"
        label={t('panelTabSites')}
        items={sites.map((site) => ({
          value: site.key,
          label: site.label,
          checked: site.key === viewed.key,
          leading: (
            <span className="lg">
              <SiteGlyph site={site} size={16} />
            </span>
          ),
          trailing:
            site.key === own.key ? <span className="here">{t('panelThisPage')}</span> : undefined,
        }))}
        onPick={(key) => {
          if (key !== viewed.key) onView(key);
        }}
        onClose={closeMenu}
      />
    </header>
  );
}
