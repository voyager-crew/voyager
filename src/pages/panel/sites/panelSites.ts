import { PLATFORM_LOGOS, type PlatformLogo } from '@/core/icons/platformLogos';
import { customWebsitesIncludeHost, normalizeCustomWebsite } from '@/core/utils/customWebsites';
import { DEFAULT_ADAPTERS, SiteRegistry } from '@/features/plugins/sites/registry';
import {
  type AccessSite,
  BUILT_IN_SITES,
  CATALOG_SITES,
} from '@/features/plugins/sites/siteAccessSites';

/** A site the 功能 tab can show: a bundled site, or the open page's own website. */
export interface PanelSite {
  /** The site id, or the page host for a website no bundled site claims. */
  readonly key: string;
  readonly label: string;
  /** The URL the rows are read for: the page itself, or the site's first host. */
  readonly url: string;
  readonly host: string;
  readonly logo: PlatformLogo | null;
  readonly access: AccessSite | null;
}

const LOGOS: Readonly<Record<string, PlatformLogo>> = PLATFORM_LOGOS;

/** Added websites with a bundled mark; every other website gets a letter tile. */
const WEBSITE_LOGOS: readonly (readonly [string, PlatformLogo])[] = [
  ['qwen.ai', PLATFORM_LOGOS.qwen],
  ['notebooklm.google.com', PLATFORM_LOGOS.notebooklm],
  ['midjourney.com', PLATFORM_LOGOS.midjourney],
];

export function websiteLogo(host: string): PlatformLogo | null {
  return WEBSITE_LOGOS.find(([domain]) => customWebsitesIncludeHost([domain], host))?.[1] ?? null;
}

/** The letter tile's hue, hashed from the host so a website keeps its colour. */
export function letterTileHue(host: string): number {
  return [...host].reduce((hue, char) => (hue * 31 + char.charCodeAt(0)) % 360, 7);
}

/**
 * The page the rows of a site are read for when it is not the open page: its
 * first match pattern, as Prompt Manager's coverage binding reads it. Gemini
 * and AI Studio list no access hosts (the manifest already reaches them).
 */
function siteHome(site: AccessSite): string {
  const match = DEFAULT_ADAPTERS.find((adapter) => adapter.id === site.id)?.matches[0];
  return match?.replace(/\*$/, '') ?? `https://${site.hosts[0] ?? site.id}/`;
}

export function bundledSite(site: AccessSite, url: string = siteHome(site)): PanelSite {
  let host = site.hosts[0] ?? site.id;
  try {
    host = new URL(url).host;
  } catch {
    // Site data always declares an https pattern; keep the access host otherwise.
  }
  return { key: site.id, label: site.label, url, host, logo: LOGOS[site.id] ?? null, access: site };
}

const ALL_SITES: readonly AccessSite[] = [...BUILT_IN_SITES, ...CATALOG_SITES];

/** A bundled site by id: the one picked in the switcher or opened from the 网站 tab. */
export function siteByKey(key: string): PanelSite | null {
  const site = ALL_SITES.find((candidate) => candidate.id === key);
  return site ? bundledSite(site) : null;
}

/** The page's own entry in the site menu, read from the shell's site id or the page URL. */
export function pageSite(pageUrl: string, siteId: string | null): PanelSite {
  const adapterId = siteId ?? SiteRegistry.createDefault().resolveByUrl(pageUrl)?.id;
  const site = ALL_SITES.find((candidate) => candidate.id === adapterId);
  if (site) return bundledSite(site, pageUrl);
  let host = '';
  try {
    host = new URL(pageUrl).host;
  } catch {
    // The shell only opens on http(s) pages; keep an empty host otherwise.
  }
  const entry = normalizeCustomWebsite(host) ?? host;
  return {
    key: entry,
    label: entry,
    url: pageUrl,
    host: entry,
    logo: websiteLogo(entry),
    access: null,
  };
}

/** Gemini and AI Studio, then the supported sites Voyager can reach, keeping the page's own. */
export function switcherSites(own: PanelSite, granted: ReadonlySet<string>): PanelSite[] {
  const sites = [
    ...BUILT_IN_SITES,
    ...CATALOG_SITES.filter((site) => granted.has(site.id) || site.id === own.key),
  ].map((site) => (site.id === own.key ? own : bundledSite(site)));
  return own.access ? sites : [...sites, own];
}
