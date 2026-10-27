import { resolveGeminiCodeHosts } from '@/core/gemini/code/hosts';
import { getGeminiSelectorView } from '@/core/gemini/selectors';

import type { SiteAdapter } from '../types';

/** Null leaves the caller's existing packaged or other-site query untouched. */
export function resolveSemanticElements(
  doc: Document,
  adapter: SiteAdapter | null,
  key: string,
): readonly Element[] | null {
  // Custom adapter targets must agree with collapse, diagrams and Site Check.
  if (
    adapter?.id !== 'gemini' ||
    key !== 'codeBlock' ||
    adapter.selectors.codeBlock !== 'code-block'
  )
    return null;
  const view = getGeminiSelectorView();
  if (!view.remoteKeys.has('code.host')) return null;
  return resolveGeminiCodeHosts(doc, view).value;
}
