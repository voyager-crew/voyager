import browser from 'webextension-polyfill';

import { customWebsiteOriginPatterns } from '@/core/utils/customWebsites';

import { listGrants } from './sitePermissions';

/** The grant patterns an added website asks for, or null when it is not a valid website. */
export function originPatternsForDomain(domain: string): string[] | null {
  try {
    return customWebsiteOriginPatterns(domain);
  } catch {
    return null;
  }
}

/** The patterns of `origins` the browser holds as such, so an undo asks for exactly those again. */
export async function heldPatterns(origins: readonly string[]): Promise<string[]> {
  const listed = await listGrants();
  if (listed) return origins.filter((origin) => listed.includes(origin));
  const held = await Promise.all(
    origins.map(async (origin) => {
      try {
        return await browser.permissions.contains({ origins: [origin] });
      } catch {
        return true;
      }
    }),
  );
  return origins.filter((_, index) => held[index]);
}
