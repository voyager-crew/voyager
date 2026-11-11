import { DEFAULT_ADAPTERS, SiteRegistry } from '../sites/registry';
import type { SiteAdapter } from '../types';

/** Ceiling on the one-sentence request. */
export const MAX_PLUGIN_REQUEST_CHARS = 1000;

/** Sites a plugin may target: every plugin platform and native surface this build knows. */
export function authoringSites(): readonly SiteAdapter[] {
  return DEFAULT_ADAPTERS;
}

/** The supported site of a page URL, or null. */
export function authoringSiteForUrl(url: string | undefined): SiteAdapter | null {
  if (!url) return null;
  return SiteRegistry.createDefault().resolveByUrl(url);
}
