import { locatorSiteForHost } from '@/core/selectors/sites';
import { findComposer, isEditable, type FindComposerOptions } from '@/core/services/composer/find';

import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '../selectors';
import { findNativeMainInputs } from './native';

/** Preserve the legacy first-visible-candidate order and hidden fallback. */
export function readChatInput(
  selectors: readonly string[],
  options: FindComposerOptions = {},
): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const selector of selectors) {
    const visible = findComposer(selector, { doc: options.doc });
    if (visible) return visible;
    fallback ??= findComposer(selector, { doc: options.doc, requireVisible: false });
  }
  return options.requireVisible === false ? fallback : null;
}

function candidates(doc: Document, selectors: readonly string[]): HTMLElement[] {
  return [
    ...new Set(
      selectors.flatMap((selector) =>
        Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isEditable),
      ),
    ),
  ];
}

/** Read a whole candidate operation before an owner inserts text or attaches a listener. */
export function resolveGeminiInput(
  options: FindComposerOptions,
  read: (selectors: readonly string[]) => HTMLElement | null,
  view: GeminiSelectorView = getGeminiSelectorView(),
  readBundled?: () => HTMLElement | null,
): HTMLElement | null {
  const key = 'composer.candidates';
  const bundle = getBundledGeminiSelectorView();
  const doc = options.doc ?? document;
  if (
    !view.remoteKeys.has(key) ||
    locatorSiteForHost(doc.defaultView?.location.hostname ?? '') !== 'gemini'
  )
    return readBundled ? readBundled() : read(bundle.profiles[key]);
  const bundled = candidates(doc, bundle.profiles[key]);
  return resolveGeminiSelectorOperationInView(
    view,
    (candidate) => ({
      elements: candidates(doc, candidate.profiles[key]),
      field:
        !candidate.remoteKeys.has(key) && readBundled
          ? readBundled()
          : read(candidate.profiles[key]),
    }),
    ({ elements }) => {
      // A partial or reordered candidate list must not select another mounted draft.
      if (bundled.length > 0)
        return (
          elements.length === bundled.length &&
          elements.every((element, index) => element === bundled[index])
        );
      const native = findNativeMainInputs(doc);
      // Renamed markup needs one independently owned editor, never an old turn or dialog input.
      return elements.length === 1 && native.length === 1 && elements[0] === native[0];
    },
  ).value.field;
}

export function findGeminiChatInput(options: FindComposerOptions = {}): HTMLElement | null {
  return resolveGeminiInput(options, (selectors) => readChatInput(selectors, options));
}
