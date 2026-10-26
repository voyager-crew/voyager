import { getGeminiSelectorView } from '@/core/gemini/selectors';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/image-export-packaged.json';

import {
  bundledGeminiSearchImageSelector,
  collectGeminiImageHosts,
  resolveGeminiSearchImageSelector,
} from './adapter/platform/geminiImageRead';

/** Keep the source-choice prompt's original admission, adding only a verified missing card. */
export function hasExportSearchImages(
  turn: { assistantContent?: { html: string }; assistantElement?: HTMLElement },
  siteId: string,
): boolean {
  const original =
    turn.assistantContent?.html.includes('attachment-container.search-images') ||
    turn.assistantElement?.querySelector(packaged['imageExport.sourcePrompt'].join(', ')) != null;
  // Existing source choices and other sites do not depend on Gemini's page snapshot.
  if (original || siteId !== 'gemini') return original;
  const view = getGeminiSelectorView();
  if (!view.remoteKeys.has('imageExport.searchHosts')) return original;
  const element = turn.assistantElement;
  if (!element) return false;
  const root =
    element.closest(
      'model-response, .model-response, .presented-response-container, .response-container, response-container',
    ) || element;
  const bundled = bundledGeminiSearchImageSelector();
  // Existing image-container cards never gained this prompt merely by enabling online fixes.
  if (collectGeminiImageHosts(root, bundled).length > 0) return false;
  const accepted = resolveGeminiSearchImageSelector(root, view);
  return collectGeminiImageHosts(root, accepted).length > 0;
}
