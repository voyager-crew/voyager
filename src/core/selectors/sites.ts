import aistudio from '../../features/plugins/catalog/sites/aistudio/site.json';
import chatgpt from '../../features/plugins/catalog/sites/chatgpt/site.json';
import claude from '../../features/plugins/catalog/sites/claude/site.json';
import deepseek from '../../features/plugins/catalog/sites/deepseek/site.json';
import gemini from '../../features/plugins/catalog/sites/gemini/site.json';
import kimi from '../../features/plugins/catalog/sites/kimi/site.json';

interface BundledLocatorSite {
  readonly id: string;
  readonly matches: readonly string[];
  readonly selectors: Readonly<Record<string, string>>;
}

/** The host boundary is packaged; catalog data can never add a website. */
export const BUNDLED_LOCATOR_SITES: readonly BundledLocatorSite[] = [
  gemini,
  aistudio,
  chatgpt,
  claude,
  deepseek,
  kimi,
];

const LOCATOR_SITE_BY_HOST: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    BUNDLED_LOCATOR_SITES.flatMap((site) =>
      site.matches.flatMap((pattern) => {
        const match = /^https:\/\/([a-z0-9.-]+)\/\*$/.exec(pattern);
        return match ? [[match[1], site.id]] : [];
      }),
    ),
  ),
);

export function locatorSiteForHost(host: string): string | null {
  return Object.hasOwn(LOCATOR_SITE_BY_HOST, host) ? LOCATOR_SITE_BY_HOST[host] : null;
}

export function bundledSemanticProfiles(
  siteId: string,
): Readonly<Record<string, readonly string[]>> {
  const selectors = BUNDLED_LOCATOR_SITES.find((site) => site.id === siteId)?.selectors ?? {};
  return Object.freeze(
    Object.fromEntries(
      Object.entries(selectors).map(([key, selector]) => [key, Object.freeze([selector])]),
    ),
  );
}

export type SiteSelectorId = 'gemini' | 'aistudio' | 'chatgpt' | 'claude' | 'deepseek' | 'kimi';

export function getPageSelectorSiteId(doc: Document = document): SiteSelectorId | null {
  try {
    const url = new URL(doc.location.href);
    return url.protocol === 'https:' && !url.port
      ? (locatorSiteForHost(url.hostname) as SiteSelectorId | null)
      : null;
  } catch {
    return null;
  }
}
