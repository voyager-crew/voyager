import { isSemanticSelectorKey } from '@/features/plugins/sites/semanticKeys';
import type { SiteAdapter } from '@/features/plugins/types';

import { guardedChatgptSemanticSelector } from './chatgptSemantics';
import { guardedComposerSemanticSelector, isComposerSemanticKey } from './composerSemantics';
import { getSiteSelectorContract } from './contracts';
import { getSiteSelectorView } from './service';
import { guardedSiteStructureSelector, isSiteStructureKey } from './siteSemantics';
import { getPageSelectorSiteId } from './sites';
import type { SiteSelectorView } from './types';

/** Migrated reads use the page claim's snapshot, even if PluginHost later reloads its adapter. */
export function pageSemanticSelector(
  adapter: Pick<SiteAdapter, 'id' | 'selectors'>,
  key: string,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): string | undefined {
  const contract = getSiteSelectorContract(adapter.id);
  // Existing catalog semantics outside this migration still belong to the resolved adapter.
  if (!contract || (isSemanticSelectorKey(key) && !contract.keys.includes(key)))
    return adapter.selectors[key];
  const view = getSiteSelectorView(adapter.id);
  return doc ? pageSemanticSelectorInView(key, view, doc) : view.profiles[key]?.join(',');
}

/** The claim is frozen by the operation owner; DOM ownership is proved at each read. */
export function pageSemanticSelectorInView(
  key: string,
  view: SiteSelectorView,
  doc: Document,
): string | undefined {
  if (isComposerSemanticKey(key) && view.siteId !== 'gemini')
    return guardedComposerSemanticSelector(key, view, doc);
  if (isSiteStructureKey(view.siteId, key)) return guardedSiteStructureSelector(key, view, doc);
  return view.siteId === 'chatgpt'
    ? guardedChatgptSemanticSelector(key, view, doc)
    : view.profiles[key]?.join(',');
}

/** Only the caller's migrated fields change; custom adapters and unrelated theme/data stay intact. */
export function withPageSemanticSelectors(
  adapter: SiteAdapter,
  keys: readonly string[],
): SiteAdapter {
  if (!getSiteSelectorContract(adapter.id)) return adapter;
  let selectors: Record<string, string> | undefined;
  for (const key of keys) {
    const value = pageSemanticSelector(adapter, key);
    if (value === adapter.selectors[key]) continue;
    selectors ??= { ...adapter.selectors };
    if (value === undefined) delete selectors[key];
    else selectors[key] = value;
  }
  return selectors ? { ...adapter, selectors } : adapter;
}

/** Native/declarative consumers resolve the same frozen profiles at each DOM read. */
export function withGuardedPageAdapter(
  adapter: SiteAdapter | null,
  doc: Document,
): SiteAdapter | null {
  if (!adapter || adapter.id === 'gemini' || getPageSelectorSiteId(doc) !== adapter.id)
    return adapter;
  const selectors: Record<string, string> = {};
  for (const key of Object.keys(adapter.selectors)) {
    Object.defineProperty(selectors, key, {
      enumerable: true,
      get: () => pageSemanticSelector(adapter, key, doc) ?? ':not(*)',
    });
  }
  return { ...adapter, selectors };
}

/** Only remote semantic operations need to re-prove ownership after mounting. */
export function hasPageSemanticFixes(
  adapter: SiteAdapter | null,
  keys: readonly string[],
  doc: Document,
): boolean {
  if (!adapter || adapter.id !== getPageSelectorSiteId(doc)) return false;
  const view = getSiteSelectorView(adapter.id);
  return keys.some((key) => view.remoteKeys.has(key));
}
