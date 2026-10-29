import browser from 'webextension-polyfill';

import { logger } from '@/core/services/LoggerService';

/** The grant a page's own origin needs: `https://claude.ai/*` for any page there. */
export function pageOrigin(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? `${protocol}//${hostname}/*` : null;
  } catch {
    return null;
  }
}

/** Whether the origin is granted; an unanswerable check counts as not, so access is asked for. */
export async function holdsOrigin(origin: string): Promise<boolean> {
  try {
    return (await browser.permissions?.contains?.({ origins: [origin] })) === true;
  } catch {
    return false;
  }
}

/** Whether any of the origins is granted. An unanswerable check counts as granted, as elsewhere. */
export async function holdsAny(origins: readonly string[]): Promise<boolean> {
  if (!browser.permissions?.contains) return true;
  for (const origin of origins) {
    try {
      if (await browser.permissions.contains({ origins: [origin] })) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** Whether a page on the stored entry's host is still granted, on either scheme. */
export async function entryHostAllowed(entry: string): Promise<boolean> {
  const host = entry.replace(/:\d+$/, '');
  return (await holdsOrigin(`https://${host}/*`)) || holdsOrigin(`http://${host}/*`);
}

/** The patterns the browser lists as granted, or null where it cannot say. */
export async function listGrants(): Promise<string[] | null> {
  try {
    const all = await Promise.resolve().then(() => browser.permissions.getAll());
    return all.origins ?? [];
  } catch {
    return null;
  }
}

/** Removes the grants; false when the browser refused or failed, so nothing claims success. */
export async function removeGrants(origins: readonly string[]): Promise<boolean> {
  try {
    return (await browser.permissions.remove({ origins: [...origins] })) !== false;
  } catch (error) {
    logger.warn('Could not remove site access', {
      origins: origins.join(' '),
      error: String(error),
    });
    return false;
  }
}

/** The manifest's own hosts: never optional, so never removed. */
export function requiredHostPermissions(): ReadonlySet<string> {
  try {
    return new Set(browser.runtime.getManifest().host_permissions ?? []);
  } catch {
    return new Set();
  }
}
