import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
} from '@/core/gemini/selectors';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/sent-chips-packaged.json';

export interface SentChipTarget {
  bubble: HTMLElement;
  lines: HTMLElement[];
  anchor: HTMLElement | null;
  toggle: Element | null;
}

function firstList(root: ParentNode, selectors: readonly string[]): HTMLElement[] {
  for (const selector of selectors) {
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (nodes.length > 0) return nodes;
  }
  return [];
}

/** Read every bubble and descendant before mounting any chip: fallback cannot mix two views. */
export function readSentChipTargets(root: ParentNode): SentChipTarget[] {
  const key = 'sentChips.bubbles';
  const bundle = getBundledGeminiSelectorView();
  const view = getGeminiSelectorView();
  const read = (selectors: readonly string[]): SentChipTarget[] =>
    firstList(root, selectors).map((bubble) => {
      const lines = firstList(bubble, packaged['sentChips.lines']);
      return {
        bubble,
        lines,
        anchor: lines[0]?.closest<HTMLElement>(packaged['sentChips.anchor']) ?? lines[0] ?? null,
        toggle: bubble.querySelector(packaged['sentChips.toggle']),
      };
    });
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc?.defaultView?.location.hostname !== 'gemini.google.com' || !view.remoteKeys.has(key))
    return read(bundle.profiles[key]);
  const bundled = read(bundle.profiles[key]);
  const native = Array.from(root.querySelectorAll<HTMLElement>('user-query')).filter(
    (bubble) =>
      !bubble.closest(
        'model-response, [role="dialog"], [data-gv-plugin], .gv-pm-panel, .gv-ph-panel, .gv-pm-fill, .gv-pm-slash-root',
      ),
  );
  const expected = bundled.length ? bundled.map(({ bubble }) => bubble) : native;
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => read(candidate.profiles[key]),
    (targets) =>
      // Missing/reordered bubbles would label only part of the conversation or hide another message.
      targets.length > 0 &&
      targets.length === expected.length &&
      targets.every(
        ({ bubble, anchor }, index) =>
          bubble === expected[index] && (!anchor || bubble.contains(anchor)),
      ),
  ).value;
}
