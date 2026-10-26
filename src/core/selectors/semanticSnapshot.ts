import type { SiteAdapter } from '@/features/plugins/types';

import { getSiteSelectorContract } from './contracts';
import { getSiteSelectorView } from './service';

/** Migrated reads use the page claim's snapshot, even if PluginHost later reloads its adapter. */
export function pageSemanticSelector(
  adapter: Pick<SiteAdapter, 'id' | 'selectors'>,
  key: string,
): string | undefined {
  if (!getSiteSelectorContract(adapter.id)) return adapter.selectors[key];
  return getSiteSelectorView(adapter.id).profiles[key]?.join(',');
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
