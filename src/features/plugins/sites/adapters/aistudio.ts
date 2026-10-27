import { requireBundledSiteAdapter } from '../../catalog/sites';
import type { SiteAdapter } from '../../types';

/**
 * Packaged AI Studio defaults; guarded page-locator fixes use the shared catalog.
 * Theme and identity stay packaged. AI Studio owns its theme on <body>.
 * Edit the JSON, not this shell.
 */
export const aistudioAdapter: SiteAdapter = requireBundledSiteAdapter('aistudio');
