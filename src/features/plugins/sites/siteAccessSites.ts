import {
  customWebsiteOriginPatterns,
  customWebsitesIncludeHost,
  normalizeCustomWebsite,
} from '@/core/utils/customWebsites';
import {
  partitionPluginOriginPatterns,
  pluginsToOriginPatterns,
} from '@/features/plugins/runtime/siteRegistration';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { DEFAULT_ADAPTERS, NATIVE_SITE_IDS, SiteRegistry } from '@/features/plugins/sites/registry';
import { promptCoverageBindingForUrl } from '@/features/plugins/storage/promptCoverageBinding';
import type { PluginManifest, SiteAdapter } from '@/features/plugins/types';

/** A site the site access card lists, read from its bundled site data. */
export interface AccessSite {
  readonly id: string;
  readonly label: string;
  readonly brandColor?: string;
  /** The hosts its pages live on, in site-data order (`chatgpt.com`, then `chat.openai.com`). */
  readonly hosts: readonly string[];
  /** The grant a plugin on each host asks for; holding any of them is access to the site. */
  readonly origins: readonly string[];
  /** Frames the site embeds (Claude's artifacts); only the plugins that need them ask for these. */
  readonly companionOrigins: readonly string[];
}

function patternHost(pattern: string): string | null {
  return /^(?:https?|\*):\/\/([^/]+)\//i.exec(pattern)?.[1]?.toLowerCase() ?? null;
}

function toAccessSite(adapter: SiteAdapter): AccessSite {
  // The same origins a plugin on the site asks for, so a grant made by either serves both.
  const declared = [
    ...new Set(adapter.matches.flatMap((match) => pluginsToOriginPatterns([{ matches: [match] }]))),
  ];
  const { topFrameOrigins, embeddedFrameOrigins } = partitionPluginOriginPatterns(declared);
  return {
    id: adapter.id,
    label: adapter.label,
    brandColor: adapter.brandColor,
    hosts: topFrameOrigins
      .map(patternHost)
      .filter((host): host is string => !!host && !host.includes('*')),
    origins: topFrameOrigins,
    companionOrigins: embeddedFrameOrigins,
  };
}

/** Gemini and AI Studio: the manifest injects Voyager there, so access is never asked for. */
export const BUILT_IN_SITES: readonly AccessSite[] = DEFAULT_ADAPTERS.filter((adapter) =>
  NATIVE_SITE_IDS.has(adapter.id),
).map(toAccessSite);

/** The supported catalog sites, in the registry's order. */
export const CATALOG_SITES: readonly AccessSite[] = DEFAULT_ADAPTERS.filter(
  (adapter) => !NATIVE_SITE_IDS.has(adapter.id),
).map(toAccessSite);

/**
 * The catalog site a stored Prompt Manager entry belongs to: the one whose page
 * host it covers, as the page decides it (`deepseek.com` covers
 * `chat.deepseek.com`). Every other entry is an "other website", including one
 * that only shares a site's domain (`console.claude.ai`, `claude.ai:8443`).
 */
export function catalogSiteForEntry(entry: string): AccessSite | undefined {
  return CATALOG_SITES.find((site) =>
    site.hosts.some((host) => customWebsitesIncludeHost([entry], host)),
  );
}

/**
 * The open page's entry when it is an other website: an http(s) page that no
 * bundled site claims (Gemini, AI Studio and the supported sites have rows of
 * their own), so the card can offer it in one click. Null for any other page.
 */
export function otherWebsiteForUrl(url: string): string | null {
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return null;
  }
  if (page.protocol !== 'http:' && page.protocol !== 'https:') return null;
  if (SiteRegistry.createDefault().resolveByUrl(url)) return null;
  const entry = normalizeCustomWebsite(page.host);
  return entry && !catalogSiteForEntry(entry) ? entry : null;
}

export function catalogSiteForUrl(url: string): AccessSite | undefined {
  const adapter = SiteRegistry.createDefault().resolveByUrl(url);
  return adapter ? CATALOG_SITES.find((site) => site.id === adapter.id) : undefined;
}

/** Whether Prompt Manager runs on any of the site's hosts, the way the page decides it. */
export function siteCoverageOn(entries: readonly string[], site: AccessSite): boolean {
  return site.hosts.some((host) => customWebsitesIncludeHost(entries, host));
}

export function siteCoverageEntries(entries: readonly string[], site: AccessSite): string[] {
  return entries.filter((entry) => catalogSiteForEntry(entry)?.id === site.id);
}

export function otherWebsiteEntries(entries: readonly string[]): string[] {
  return entries.filter((entry) => !catalogSiteForEntry(entry));
}

/**
 * The supported pages where a stored entry runs Prompt Manager's catalog plugin
 * (`deepseek.com` covers `chat.deepseek.com`). The background registers that
 * plugin on such a page whenever the browser has granted the page itself.
 */
export function promptManagerHostsCoveredBy(entry: string): string[] {
  return CATALOG_SITES.flatMap((site) => site.hosts).filter(
    (host) =>
      promptCoverageBindingForUrl(`https://${host}/`) !== null &&
      customWebsitesIncludeHost([entry], host),
  );
}

/**
 * Whether a granted pattern covers `wanted`, with the browser's meaning of a
 * grant: `*.x` covers x itself and every subdomain, a `*` scheme both schemes,
 * a `*` host or `<all_urls>` everything.
 */
export function grantCovers(grant: string, wanted: string): boolean {
  if (grant === '<all_urls>') return true;
  const parse = (pattern: string) => /^(\*|https?):\/\/([^/]+)\//i.exec(pattern);
  const [have, want] = [parse(grant), parse(wanted)];
  if (!have || !want) return grant === wanted;
  if (have[1] !== '*' && have[1].toLowerCase() !== want[1].toLowerCase()) return false;
  const [grantHost, wantedHost] = [have[2].toLowerCase(), want[2].toLowerCase()];
  if (grantHost === '*' || grantHost === wantedHost) return true;
  if (!grantHost.startsWith('*.')) return false;
  const domain = grantHost.slice(2);
  const host = wantedHost.replace(/^\*\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * The grants Voyager still relies on once a site's own entries are gone: what
 * the remaining entries ask for, and what the plugins that are on elsewhere do.
 */
export function originsStillNeeded(
  site: AccessSite,
  remainingEntries: readonly string[],
  enabledPlugins: readonly Pick<PluginManifest, 'matches'>[],
): string[] {
  const elsewhere = enabledPlugins.filter(
    (plugin) => !site.hosts.some((host) => matchesAnyPattern(`https://${host}/`, plugin.matches)),
  );
  return [
    ...remainingEntries.flatMap((entry) => customWebsiteOriginPatterns(entry) ?? []),
    ...pluginsToOriginPatterns(elsewhere),
  ];
}

/**
 * Whether a granted pattern reaches one of the site's hosts, with the
 * browser's meaning of `*.` (the bare domain included). A grant for every host
 * (`<all_urls>` or a bare `*` host) serves all sites and is never the site's to remove.
 */
function grantReachesSite(pattern: string, site: AccessSite): boolean {
  if (site.companionOrigins.includes(pattern)) return true;
  const host = patternHost(pattern);
  if (!host || host === '*') return false;
  const wildcard = host.startsWith('*.');
  const bare = wildcard ? host.slice(2) : host;
  if (!bare.includes('.')) return false;
  return site.hosts.some(
    (siteHost) =>
      siteHost === bare ||
      bare.endsWith(`.${siteHost}`) ||
      (wildcard && siteHost.endsWith(`.${bare}`)),
  );
}

/**
 * The origins to remove when access to the site is revoked: every grant that
 * reaches it, whether a plugin, Prompt Manager or the browser's own site menu
 * made it, except one that something else still needs (`stillNeeded`): an
 * `*.openai.com` grant that `platform.openai.com` also runs on stays. Without
 * the browser's list, the grants Voyager itself asks for.
 */
export function siteGrantsToRemove(
  site: AccessSite,
  granted: readonly string[] | null,
  entries: readonly string[],
  stillNeeded: readonly string[],
): string[] {
  const reaching = granted
    ? granted.filter((pattern) => grantReachesSite(pattern, site))
    : [
        ...new Set([
          ...site.origins,
          ...site.companionOrigins,
          ...entries.flatMap((entry) => customWebsiteOriginPatterns(entry) ?? []),
        ]),
      ];
  return reaching.filter((grant) => !stillNeeded.some((pattern) => grantCovers(grant, pattern)));
}
