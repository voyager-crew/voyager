import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';
import { resolvePlacementListOperation } from '@/core/selectors/placement';

import type { ConversationAnchors } from './exportOverlayUi';
import { bundledExportLayoutData } from './toolbarTargets';

type Surface = 'canvas' | 'composer';

/** Alignment is geometry only: a catalog target cannot select exported content. */
export function resolveExportAlignmentTarget(
  _anchors: ConversationAnchors,
  pick: (selectors: readonly string[], surface: Surface) => HTMLElement | null,
): HTMLElement | null {
  const siteId = getPageSelectorSiteId();
  const layout = bundledExportLayoutData();
  if (!siteId)
    return pick(layout.alignmentCanvas, 'canvas') ?? pick(layout.alignmentComposer, 'composer');
  const view = siteId === 'gemini' ? getGeminiSelectorView() : getSiteSelectorView(siteId);
  for (const surface of ['canvas', 'composer'] as const) {
    const layoutKey =
      surface === 'canvas' ? 'exportLayout.alignmentCanvas' : 'exportLayout.alignmentComposer';
    const key =
      siteId === 'gemini' && !view.remoteKeys.has(layoutKey)
        ? `exportOverlay.${surface}`
        : layoutKey;
    const target = resolvePlacementListOperation(
      view,
      key,
      (selectors) => pick(selectors, surface),
      { mount: false },
    );
    if (target) return target;
  }
  return null;
}
