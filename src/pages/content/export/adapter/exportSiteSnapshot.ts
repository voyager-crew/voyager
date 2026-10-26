import { withPageSemanticSelectors } from '@/core/selectors';
import type { SiteAdapter } from '@/features/plugins/types';

/** Export roles, roots and serialization share the page claim, never a later cached adapter. */
export function exportSiteSnapshot(site: SiteAdapter): SiteAdapter {
  return withPageSemanticSelectors(site, [
    'userTurn',
    'assistantTurn',
    'thinkingBlock',
    'scrollContainer',
    'codeBlock',
  ]);
}
