import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import { resolvePlacementOperation } from '@/core/selectors/placement';
import { locatorSiteForHost } from '@/core/selectors/sites';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/sent-chips-packaged.json';
import { isCompleteUserText } from '@/features/timeline/userTextProof';

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
  const doc = root instanceof Document ? root : root.ownerDocument;
  const view =
    locatorSiteForHost(doc?.defaultView?.location.hostname ?? '') === 'gemini'
      ? getGeminiSelectorView()
      : bundle;
  const read = (
    selectors: readonly string[],
    selected: GeminiSelectorView = view,
  ): SentChipTarget[] =>
    firstList(root, selectors).map((bubble) => {
      const bundledLines = firstList(bubble, packaged['sentChips.lines']);
      let lines = bundledLines;
      if (selected.remoteKeys.has('sentChips.lines')) {
        const remote = firstList(bubble, selected.profiles['sentChips.lines']);
        const text = remote.map((node) => node.textContent ?? '').join(' ');
        const reference = bundledLines.length
          ? bundledLines.map((node) => node.textContent ?? '').join(' ')
          : (bubble.textContent ?? '');
        // Partial lines and filenames must not label a different saved prompt as the sent text.
        if (
          remote.length &&
          isCompleteUserText(text, reference, bundledLines.length > 0) &&
          remote.every(
            (node) =>
              !node.closest('model-response, [contenteditable="true"], input, textarea, button'),
          )
        )
          lines = remote;
      }
      return {
        bubble,
        lines,
        anchor:
          resolvePlacementOperation(
            selected,
            'sentChips.anchor',
            (selector) =>
              lines[0]?.closest<HTMLElement>(selector) ??
              (selector === packaged['sentChips.anchor']
                ? null
                : bubble.querySelector<HTMLElement>(selector)),
          ) ??
          lines[0] ??
          null,
        toggle: bubble.querySelector(packaged['sentChips.toggle']),
      };
    });
  if (!view.remoteKeys.has(key)) return read(bundle.profiles[key]);
  const bundled = read(bundle.profiles[key], bundle);
  const native = Array.from(root.querySelectorAll<HTMLElement>('user-query')).filter(
    (bubble) =>
      !bubble.closest(
        'model-response, [role="dialog"], [data-gv-plugin], .gv-pm-panel, .gv-ph-panel, .gv-pm-fill, .gv-pm-slash-root',
      ),
  );
  const expected = bundled.length ? bundled.map(({ bubble }) => bubble) : native;
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => read(candidate.profiles[key], candidate),
    (targets) =>
      // Missing/reordered bubbles would label only part of the conversation or hide another message.
      targets.length > 0 &&
      targets.length === expected.length &&
      targets.every(({ bubble }, index) => bubble === expected[index]),
  ).value;
}
