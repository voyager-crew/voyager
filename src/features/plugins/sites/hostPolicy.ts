/**
 * What the plugin system may do on the sites Voyager ships with: Gemini and
 * AI Studio. Each question has its own answer here, and the callers ask the
 * one they mean:
 *
 *   - static injection: the main content script is declared for these hosts in
 *     `manifest.json`, with matching `host_permissions`, so they never need a
 *     dynamic registration or an optional host grant;
 *   - native start points: consumer Gemini and AI Studio only. Business gets
 *     the Enterprise panel, not the native feature initialization chain;
 *   - remote catalog: all supported pages may read locator profiles through
 *     the shared channel. Native plugins, identity and theme stay packaged;
 *   - plugin theme: never. Gemini and AI Studio keep Voyager's own accent;
 *   - catalog data stores (catalog outline, send times, ...): not theirs.
 *     Voyager's native timeline owns that data here, whether or not the site
 *     is described by a bundled `site.json`;
 *   - `native` ops: only public primitives listed by entries in
 *     `featureOwners.ts`, plus `EXTRA_ALLOWED_HANDLERS`. Official-only
 *     handlers stay closed to local plugins.
 *
 * The import-time check (`manifestHostPolicyIssues`) is early feedback by
 * pattern; the runtime asks again by the page's real URL (`hostPolicyRefusal`).
 *
 * Kept free of storage keys, browser APIs and `import.meta`: the local-plugin
 * validator imports this, and the CLI bundles that chain.
 */
import type { ManifestIssue } from '../manifest/validate';
import type { PluginManifest, SiteAdapter } from '../types';
import { OFFICIAL_PLUGIN_IDS, type PackagedSiteId, pluginOwnedHandlers } from './featureOwners';
import { patternWithinAny } from './matchPattern';
import {
  FOLDERS_HANDLER,
  packagedFoldersPolicyIssues,
  refusesLocalFolders,
} from './packagedFoldersPolicy';
import {
  SHARED_TIMELINE_MATCHES,
  sharedTimelineAdmissionId,
  sharedTimelinePolicyIssues,
} from './sharedTimelinePolicy';

export interface PackagedHostPolicy {
  readonly siteId: PackagedSiteId;
  /** The site's name in author-facing messages. */
  readonly label: string;
  readonly matches: readonly string[];
  /** Lowercase hostnames covered by `matches`. */
  readonly hosts: readonly string[];
}

/** Keep in step with `manifest.json`'s first `content_scripts` entry and `host_permissions`. */
export const GEMINI_MATCHES: readonly string[] = [
  ...SHARED_TIMELINE_MATCHES,
  'https://business.gemini.google/*',
];

export const AISTUDIO_MATCHES: readonly string[] = [
  'https://aistudio.google.com/*',
  'https://aistudio.google.cn/*',
];

/** Consumer Gemini and AI Studio run the native feature initialization chain. */
export const NATIVE_START_POINT_MATCHES: readonly string[] = [
  ...SHARED_TIMELINE_MATCHES,
  ...AISTUDIO_MATCHES,
];

function hostsOf(matches: readonly string[]): readonly string[] {
  return matches.map((pattern) =>
    pattern
      .replace(/^https:\/\//, '')
      .replace(/\/.*$/, '')
      .toLowerCase(),
  );
}

export const PACKAGED_HOST_POLICIES: readonly PackagedHostPolicy[] = [
  { siteId: 'gemini', label: 'Gemini', matches: GEMINI_MATCHES, hosts: hostsOf(GEMINI_MATCHES) },
  {
    siteId: 'aistudio',
    label: 'AI Studio',
    matches: AISTUDIO_MATCHES,
    hosts: hostsOf(AISTUDIO_MATCHES),
  },
];

/** Every statically injected match pattern, in packaged policy order. */
export const PACKAGED_MATCHES: readonly string[] = PACKAGED_HOST_POLICIES.flatMap(
  (policy) => policy.matches,
);

/**
 * Primitives opened on a site although no owner entry hands them over: a new
 * capability with no native counterpart. Empty for now.
 */
export const EXTRA_ALLOWED_HANDLERS: Readonly<Record<PackagedSiteId, readonly string[]>> = {
  gemini: [],
  aistudio: [],
};

/** Reserved ids come only from the package; local imports are namespaced and remote copies dropped. */
const OFFICIAL_ONLY_HANDLERS: Readonly<Record<PackagedSiteId, Readonly<Record<string, string>>>> = {
  gemini: { conversationExport: OFFICIAL_PLUGIN_IDS.geminiExport },
  aistudio: {},
};

const POLICY_BY_HOST: ReadonlyMap<string, PackagedHostPolicy> = new Map(
  PACKAGED_HOST_POLICIES.flatMap((policy) => policy.hosts.map((host) => [host, policy] as const)),
);

const NATIVE_START_POINT_HOSTS: ReadonlySet<string> = new Set(hostsOf(NATIVE_START_POINT_MATCHES));

function isPackagedSiteId(siteId: string): siteId is PackagedSiteId {
  return PACKAGED_HOST_POLICIES.some((policy) => policy.siteId === siteId);
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function policyForHost(host: string): PackagedHostPolicy | undefined {
  return POLICY_BY_HOST.get(normalizeHost(host));
}

/** The packaged site `url` is on, judged by its actual hostname. */
export function packagedSiteForUrl(url: string): PackagedSiteId | null {
  try {
    return policyForHost(new URL(url).hostname)?.siteId ?? null;
  } catch {
    return null;
  }
}

/** The packaged sites a set of match patterns reaches (a pattern within a site's matches). */
export function packagedSitesForPatterns(patterns: readonly string[]): readonly PackagedSiteId[] {
  return PACKAGED_HOST_POLICIES.filter((policy) =>
    patterns.some((pattern) => patternWithinAny(pattern, policy.matches)),
  ).map((policy) => policy.siteId);
}

/** True for gemini.google.com, business.gemini.google, aistudio.google.com/.cn. */
export function isStaticallyInjectedHost(host: string): boolean {
  return policyForHost(host) !== undefined;
}

/** The packaged site whose native start points run on this host; Business is excluded. */
export function nativeStartPointSiteForHost(host: string): PackagedSiteId | null {
  const policy = policyForHost(host);
  return policy && NATIVE_START_POINT_HOSTS.has(normalizeHost(host)) ? policy.siteId : null;
}

function siteAllowsPluginTheme(siteId: string): boolean {
  return !isPackagedSiteId(siteId);
}

/** Whether a plugin's `theme` may apply on the page at `url`. */
export function allowsPluginTheme(url: string): boolean {
  const site = packagedSiteForUrl(url);
  return site === null || siteAllowsPluginTheme(site);
}

/** Whether a plugin's `theme` may apply anywhere a site adapter's patterns reach. */
export function allowsPluginThemeForSite(site: Pick<SiteAdapter, 'matches'>): boolean {
  return packagedSitesForPatterns(site.matches).every(siteAllowsPluginTheme);
}

/**
 * Whether the catalog's per-site data protocols (catalog outline, send times,
 * their Drive buckets) serve `siteId`. Keyed by the site id, not by whether a
 * bundled `site.json` describes the site.
 */
export function usesCatalogDataStores(siteId: string): boolean {
  return !isPackagedSiteId(siteId);
}

function allowedHandlers(site: PackagedSiteId): ReadonlySet<string> {
  return new Set([...pluginOwnedHandlers(site), ...EXTRA_ALLOWED_HANDLERS[site]]);
}

/** Whether a plugin may call the `handler` primitive on `siteId`; any site but a packaged one allows all. */
export function allowsNativeHandler(siteId: string, handler: string): boolean {
  return !isPackagedSiteId(siteId) || allowedHandlers(siteId).has(handler);
}

/** The primitives a plugin may call everywhere a site adapter's patterns reach. */
export function allowedPrimitivesForSite(
  site: Pick<SiteAdapter, 'matches'>,
): 'all' | ReadonlySet<string> {
  const packaged = packagedSitesForPatterns(site.matches);
  if (packaged.length === 0) return 'all';
  const [first, ...rest] = packaged.map(allowedHandlers);
  return new Set([...first].filter((handler) => rest.every((allowed) => allowed.has(handler))));
}

function labelOf(site: PackagedSiteId): string {
  return PACKAGED_HOST_POLICIES.find((policy) => policy.siteId === site)?.label ?? site;
}

/**
 * Import-time host policy for a manifest: every packaged site its patterns
 * reach is checked on its own, so a multi-site plugin must be legal on each.
 * At most one `theme` issue; one issue per refused `native` op per site that
 * refuses it, at that op's index in `contributes.domOps`.
 */
export function manifestHostPolicyIssues(
  manifest: Pick<PluginManifest, 'matches' | 'theme' | 'contributes'>,
): ManifestIssue[] {
  const sites = packagedSitesForPatterns(manifest.matches);
  const issues = [
    ...sharedTimelinePolicyIssues(manifest, sites.includes('gemini')),
    ...packagedFoldersPolicyIssues(manifest, sites),
  ];
  if (manifest.theme && !sites.every(siteAllowsPluginTheme)) {
    issues.push({
      path: 'theme',
      message: 'Gemini and AI Studio keep Voyager’s own accent: remove theme for these sites',
    });
  }
  (manifest.contributes.domOps ?? []).forEach((op, index) => {
    // A local `folders` op already has its own issue above.
    if (op.op !== 'native' || op.handler === FOLDERS_HANDLER) return;
    for (const site of sites) {
      if (allowsNativeHandler(site, op.handler)) continue;
      issues.push({
        path: `contributes.domOps[${index}]`,
        message: `the \`${op.handler}\` primitive is not available on ${labelOf(site)} in this Voyager version`,
      });
    }
  });
  return issues;
}

export type HostPolicyRefusal =
  | { readonly kind: 'theme' }
  | { readonly kind: 'native-op'; readonly handlers: readonly string[] };

/**
 * Why the page at `url` refuses this manifest, judged by the page's real host
 * rather than by the plugin's patterns; null when nothing is refused.
 */
export function hostPolicyRefusal(
  url: string,
  manifest: Pick<PluginManifest, 'matches' | 'theme' | 'contributes'> & { readonly id?: string },
): HostPolicyRefusal | null {
  const site = packagedSiteForUrl(url);
  if (site !== null && manifest.theme && !siteAllowsPluginTheme(site)) return { kind: 'theme' };
  const refused = new Set<string>();
  for (const op of manifest.contributes.domOps ?? []) {
    if (op.op !== 'native') continue;
    // Stored imports defer site policy, so scope and native identity are checked again on the page.
    if (
      op.handler === 'turnNavigator' &&
      (site === 'gemini' || op.params.dataBackend === 'shared') &&
      sharedTimelineAdmissionId(url, manifest) === null
    )
      refused.add(op.handler);
    if (
      site !== null &&
      !allowsNativeHandler(site, op.handler) &&
      (manifest.id === undefined || OFFICIAL_ONLY_HANDLERS[site][op.handler] !== manifest.id)
    )
      refused.add(op.handler);
    if (refusesLocalFolders(manifest.id, op.handler, site)) refused.add(op.handler);
  }
  return refused.size > 0 ? { kind: 'native-op', handlers: [...refused] } : null;
}
