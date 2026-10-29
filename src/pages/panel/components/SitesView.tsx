import React from 'react';

import { ChevronRight, Plus, X } from 'lucide-react';

import { type AccessSite, BUILT_IN_SITES } from '@/features/plugins/sites/siteAccessSites';
import type { CatalogSiteRow } from '@/pages/popup/hooks/useSiteAccess';
import type { AppLanguage } from '@/utils/language';
import type { TranslationKey } from '@/utils/translations';

import { featuresOnLabel, fillPlaceholders } from '../panelText';
import { bundledSite, websiteLogo } from '../sites/panelSites';
import { PanelSwitch } from './PanelSwitch';
import { SiteTile } from './SiteMark';

const WEBSITE_PLACEHOLDER = 'example.com';

export interface SitesViewProps {
  readonly rows: readonly CatalogSiteRow[];
  readonly otherWebsites: readonly string[];
  /** The site whose browser prompt is up. */
  readonly waiting: string | null;
  readonly revoking: string | null;
  readonly onGrant: (site: AccessSite) => void;
  readonly onRevoke: (site: AccessSite) => void;
  readonly onOpen: (site: AccessSite) => void;
  readonly onRemoveWebsite: (website: string) => void;
  readonly website: {
    readonly value: string;
    readonly change: (value: string) => void;
    readonly add: () => void;
  };
  readonly language: AppLanguage;
  readonly t: (key: TranslationKey) => string;
}

/** Where focus returns once a site's access is removed (its switch stays) or a website is. */
export const siteSwitchId = (site: AccessSite) => `panel-site-switch-${site.id}`;
export const ADD_WEBSITE_INPUT_ID = 'panel-add-website';

function SiteRow({
  site,
  sub,
  control,
  onOpen,
}: {
  site: AccessSite;
  sub: React.ReactNode;
  control?: React.ReactNode;
  onOpen?: () => void;
}) {
  const { logo, host } = bundledSite(site);
  const label = (
    <>
      <span className="rn" title={site.label}>
        {site.label}
      </span>
      <span className="sub">{sub}</span>
    </>
  );
  return (
    <div className={onOpen ? 'row nav' : 'row'} data-site-row={site.id}>
      <SiteTile logo={logo} host={host} />
      {onOpen ? (
        // Its hit area stretches over the whole row; the switch sits above it.
        <button type="button" className="rs" onClick={onOpen}>
          {label}
        </button>
      ) : (
        <span className="rs">{label}</span>
      )}
      {control}
      <span className="go" aria-hidden="true">
        {onOpen && <ChevronRight size={16} strokeWidth={2} />}
      </span>
    </div>
  );
}

/** The 网站 tab: supported sites with their access, and the websites Prompt Manager covers. */
export function SitesView({
  rows,
  otherWebsites,
  waiting,
  revoking,
  onGrant,
  onRevoke,
  onOpen,
  onRemoveWebsite,
  website,
  language,
  t,
}: SitesViewProps) {
  return (
    <div className="sites">
      <div className="grp">
        <div className="gl rv" style={{ '--d': 0 } as React.CSSProperties}>
          {t('panelSupportedSites')}
        </div>
        <div className="card rv" style={{ '--d': 1 } as React.CSSProperties}>
          {BUILT_IN_SITES.map((site) => (
            <SiteRow
              key={site.id}
              site={site}
              sub={
                <>
                  <span className="dot ok" />
                  {t('siteAccessBuiltIn')}
                </>
              }
              onOpen={() => onOpen(site)}
            />
          ))}
          {rows.map(({ site, access, features }) => {
            const isWaiting = waiting === site.id;
            const granted = access === 'granted';
            const sub = isWaiting ? (
              <>
                <span className="dot wait" />
                {t('panelWaitingForBrowser')}
              </>
            ) : granted ? (
              <>
                <span className="dot ok" />
                {featuresOnLabel(language, features.length)}
              </>
            ) : access === 'none' ? (
              <>
                <span className="dot" />
                {t('panelNotEnabled')}
              </>
            ) : null;
            return (
              <SiteRow
                key={site.id}
                site={site}
                sub={sub}
                onOpen={granted && !isWaiting ? () => onOpen(site) : undefined}
                control={
                  <PanelSwitch
                    id={siteSwitchId(site)}
                    checked={granted || isWaiting}
                    waiting={isWaiting}
                    disabled={access === 'unknown' || isWaiting || revoking === site.id}
                    label={fillPlaceholders(t('panelAllowAccess'), { site: site.label })}
                    onToggle={(next) => (next ? onGrant(site) : onRevoke(site))}
                  />
                }
              />
            );
          })}
        </div>
      </div>
      <div className="grp">
        <div className="gl rv" style={{ '--d': 2 } as React.CSSProperties}>
          {fillPlaceholders(t('panelOtherWebsitesGroup'), {
            websites: t('siteAccessOtherWebsites'),
          })}
        </div>
        <div className="card rv" style={{ '--d': 3 } as React.CSSProperties}>
          {otherWebsites.map((entry) => (
            <div key={entry} className="row" data-website={entry}>
              <SiteTile logo={websiteLogo(entry)} host={entry} />
              <span className="rn" title={entry}>
                {entry}
              </span>
              <button
                type="button"
                className="ib x"
                aria-label={fillPlaceholders(t('panelRemoveWebsite'), { site: entry })}
                onClick={() => onRemoveWebsite(entry)}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
          <form
            className="add"
            onSubmit={(event) => {
              event.preventDefault();
              website.add();
            }}
          >
            <input
              id={ADD_WEBSITE_INPUT_ID}
              value={website.value}
              placeholder={WEBSITE_PLACEHOLDER}
              aria-label={t('addWebsite')}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => website.change(event.target.value)}
            />
            <button type="submit" className="ib" aria-label={t('addWebsite')}>
              <Plus size={17} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
