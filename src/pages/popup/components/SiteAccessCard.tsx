import type { ReactNode } from 'react';

import { PLATFORM_LOGOS, type PlatformLogo } from '@/core/icons/platformLogos';
import { isRTLLanguage } from '@/core/utils/rtl';
import type { TranslationKey } from '@/utils/translations';

import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardTitle } from '../../../components/ui/card';
import type { PromptManagerSettings } from '../hooks/usePromptManagerSettings';
import type { CatalogSiteRow, SiteAccess, SiteAccessState } from '../hooks/useSiteAccess';
import { type AccessSite, BUILT_IN_SITES } from '../utils/siteAccessSites';
import { OtherWebsitesSection } from './OtherWebsitesSection';
import { PlatformMark } from './WebsiteLogos';

const LOGOS: Readonly<Record<string, PlatformLogo>> = PLATFORM_LOGOS;

type Pill = Exclude<SiteAccessState, 'unknown'> | 'builtIn';

const PILLS: Readonly<Record<Pill, { label: TranslationKey; className: string }>> = {
  builtIn: { label: 'siteAccessBuiltIn', className: 'bg-secondary text-muted-foreground' },
  granted: { label: 'siteAccessAllowed', className: 'bg-primary/10 text-primary' },
  none: { label: 'siteAccessNotAllowed', className: 'border-border text-muted-foreground border' },
};

export interface SiteAccessCardProps {
  readonly access: Pick<
    SiteAccess,
    'rows' | 'otherWebsites' | 'pageWebsite' | 'revoking' | 'revoke' | 'removeWebsite'
  >;
  readonly coverage: Pick<
    PromptManagerSettings,
    | 'customWebsites'
    | 'newWebsiteInput'
    | 'websiteError'
    | 'onWebsiteInputChange'
    | 'handleAddWebsite'
    | 'toggleQuickWebsite'
  >;
  readonly language: string;
  readonly t: (key: TranslationKey) => string;
}

/** Feature names as the language joins a list ("A, B and C", "A、B和C"). */
function joinNames(names: readonly string[], language: string): string {
  try {
    return new Intl.ListFormat(language.replace('_', '-'), {
      style: 'long',
      type: 'conjunction',
    }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** What the row says under the site's name: the features on there, or how to start. */
function rowDetail(
  { site, access, features }: CatalogSiteRow,
  language: string,
  t: (key: TranslationKey) => string,
): string {
  if (access === 'none') return t('siteAccessOpenToStart').replace('{site}', () => site.label);
  if (features.length > 0) return joinNames(features, language);
  return access === 'granted' ? t('siteAccessNothingOn') : '';
}

function rowDomId(site: AccessSite): string {
  return `site-access-${site.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function SiteRow({
  site,
  pill,
  detail,
  action,
  t,
}: {
  site: AccessSite;
  pill: Pill | null;
  detail: string;
  action?: ReactNode;
  t: (key: TranslationKey) => string;
}) {
  const logo = Object.hasOwn(LOGOS, site.id) ? LOGOS[site.id] : undefined;
  return (
    // Focus lands on the row when its revoke button goes away under an undo offer.
    <li
      id={rowDomId(site)}
      data-site-access={site.id}
      tabIndex={-1}
      className="focus-visible:ring-ring/60 flex items-start gap-2.5 rounded-md py-2.5 outline-none focus-visible:ring-2"
    >
      <span
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
        style={{ color: site.brandColor ?? logo?.brand }}
        aria-hidden="true"
      >
        {logo && <PlatformMark logo={logo} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span id={`${rowDomId(site)}-name`} className="text-sm leading-snug font-medium">
            <bdi>{site.label}</bdi>
          </span>
          {pill && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] leading-none font-medium ${PILLS[pill].className}`}
            >
              {t(PILLS[pill].label)}
            </span>
          )}
        </div>
        {detail && (
          <p
            className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug"
            title={detail}
          >
            {detail}
          </p>
        )}
      </div>
      {action}
    </li>
  );
}

/**
 * Where Voyager runs: the built-in sites, each supported site with its access
 * and the features on there, and the other websites Prompt Manager covers.
 */
export function SiteAccessCard({ access, coverage, language, t }: SiteAccessCardProps) {
  return (
    <Card className="p-4" dir={isRTLLanguage(language) ? 'rtl' : undefined}>
      <CardTitle className="mb-4">{t('siteAccessTitle')}</CardTitle>
      <CardContent className="space-y-3 p-0">
        <p className="text-muted-foreground text-xs leading-snug">{t('siteAccessDescription')}</p>
        <ul className="border-border/60 divide-border/60 divide-y rounded-lg border px-3">
          {BUILT_IN_SITES.map((site) => (
            <SiteRow
              key={site.id}
              site={site}
              pill="builtIn"
              detail={t('siteAccessAllFeatures')}
              t={t}
            />
          ))}
          {access.rows.map((row) => {
            const { site } = row;
            return (
              <SiteRow
                key={site.id}
                site={site}
                pill={row.access === 'unknown' ? null : row.access}
                detail={rowDetail(row, language, t)}
                action={
                  row.access === 'granted' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      disabled={access.revoking === site.id}
                      aria-describedby={`${rowDomId(site)}-name`}
                      onClick={() => {
                        void access.revoke(site, () => document.getElementById(rowDomId(site)));
                      }}
                    >
                      {t('siteAccessRemove')}
                    </Button>
                  )
                }
                t={t}
              />
            );
          })}
        </ul>
        <OtherWebsitesSection
          websites={access.otherWebsites}
          pageWebsite={access.pageWebsite}
          onRemove={access.removeWebsite}
          coverage={coverage}
          t={t}
        />
      </CardContent>
    </Card>
  );
}
