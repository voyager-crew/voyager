import { getSiteSelectorView } from '@/core/selectors';
import { resolvePlacementListOperation } from '@/core/selectors/placement';

import { inputSiteId, packagedInputSelectors } from './siteInputData';

/** The page's floating action button, which Prompt Manager's trigger sits beside. */
export const PROMPT_FAB_LOCATOR_KEY = 'input.fab';

/** Input placement never changes the editor used by typing, focus or send actions. */
export function readInputPlacement<T extends Element | readonly Element[] | null>(
  key: string,
  read: (selector: string) => T,
  doc: Document = document,
  mount = true,
): T {
  return readInputPlacementList(key, (list) => read(list.join(',')), doc, mount);
}

export function readInputPlacementList<T extends Element | readonly Element[] | null>(
  key: string,
  read: (list: readonly string[]) => T,
  doc: Document = document,
  mount = true,
): T {
  const fallback = packagedInputSelectors(key, doc);
  const site = inputSiteId(doc);
  return site
    ? resolvePlacementListOperation(getSiteSelectorView(site), key, read, { fallback, mount })
    : read(fallback);
}
