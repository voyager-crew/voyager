import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import {
  type GeminiSelectorView,
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
} from '@/core/gemini/selectors';
import { GEMINI_EXPORT_OVERLAY_PROFILE_KEYS } from '@/core/gemini/selectors/menuKeys';
import { getPageSelectorSiteId } from '@/core/selectors';

import type { ConversationAnchors } from './exportOverlayUi';
import { exportLayoutData } from './toolbarTargets';

type Surface = 'canvas' | 'composer';
interface AlignmentRead {
  readonly target: HTMLElement | null;
  readonly surface: Surface;
  readonly candidates: readonly HTMLElement[];
}

/** Both priority levels belong to one read; a rejected canvas cannot retain a remote composer. */
export function resolveExportAlignmentTarget(
  anchors: ConversationAnchors,
  pick: (selectors: readonly string[], surface: Surface) => HTMLElement | null,
): HTMLElement | null {
  const siteId = getPageSelectorSiteId();
  if (siteId !== 'gemini') {
    const layout = exportLayoutData();
    // Preserve the original ordered alignment probes; a scrollContainer is not the same anchor.
    return pick(layout.alignmentCanvas, 'canvas') ?? pick(layout.alignmentComposer, 'composer');
  }
  const view = getGeminiSelectorView();
  const bundled = getBundledGeminiSelectorView();
  const online = GEMINI_EXPORT_OVERLAY_PROFILE_KEYS.some((key) => view.remoteKeys.has(key));
  const read = (candidate: GeminiSelectorView): AlignmentRead => {
    for (const surface of ['canvas', 'composer'] as const) {
      const selectors = candidate.profiles[`exportOverlay.${surface}`];
      const target = pick(selectors, surface);
      if (target)
        return {
          target,
          surface,
          // Candidate completeness is only an online guard; the picker already scanned when OFF.
          candidates: online
            ? Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))
            : [],
        };
    }
    return { target: null, surface: 'composer', candidates: [] };
  };
  if (!online) {
    return read(bundled).target;
  }
  return resolveGeminiSelectorOperationInView(view, read, (result) => {
    if (!result.target) return false;
    const reference = read(bundled);
    if (reference.target) {
      // A narrowed list must not silently choose a different visible alignment target.
      return (
        result.surface === reference.surface &&
        result.target === reference.target &&
        result.candidates.length === reference.candidates.length &&
        result.candidates.every((node, index) => node === reference.candidates[index])
      );
    }
    if (result.surface === 'canvas') {
      const root = anchors.conversationRoot();
      const topUser = anchors.topUserElement();
      return (
        result.candidates.length === 1 &&
        result.target === root &&
        root !== document.body &&
        root !== document.documentElement &&
        topUser !== null &&
        root.contains(topUser)
      );
    }
    const inputs = findOwnedGeminiMainInputs(document);
    return result.candidates.length === 1 && inputs.length === 1 && result.target === inputs[0];
  }).value.target;
}
