import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import {
  type GeminiSelectorOperation,
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
} from '@/core/gemini/selectors';
import { isEditable } from '@/core/services/composer/find';

type PromptInputKey = 'promptHistory.candidates' | 'slash.candidates';

/** Each owner keeps its own profile and query ordering, while proving the entire candidate set. */
export function resolvePromptInputOperation(
  key: PromptInputKey,
  read: (selectors: readonly string[]) => HTMLElement | null,
  doc = document,
): GeminiSelectorOperation<HTMLElement | null> {
  const bundle = getBundledGeminiSelectorView();
  const view = getGeminiSelectorView();
  if (doc.defaultView?.location.hostname !== 'gemini.google.com' || !view.remoteKeys.has(key)) {
    return { value: read(bundle.profiles[key]), view: bundle };
  }
  const candidates = (selectors: readonly string[]): HTMLElement[] => [
    ...new Set(
      selectors.flatMap((selector) =>
        Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isEditable),
      ),
    ),
  ];
  const bundled = candidates(bundle.profiles[key]);
  const bundledResult = read(bundle.profiles[key]);
  const accepted = resolveGeminiSelectorOperationInView(
    view,
    (candidate) => ({
      elements: candidates(candidate.profiles[key]),
      value: read(candidate.profiles[key]),
    }),
    ({ elements, value }) => {
      // A partial/reordered list can redirect capture or expansion into another mounted editor.
      if (bundled.length > 0)
        return (
          value === bundledResult &&
          elements.length === bundled.length &&
          elements.every((element, index) => element === bundled[index])
        );
      const native = findOwnedGeminiMainInputs(doc);
      return (
        elements.length === 1 &&
        native.length === 1 &&
        elements[0] === native[0] &&
        value === native[0]
      );
    },
  );
  return { value: accepted.value.value, view: accepted.view };
}

/** Owners that only need the accepted element retain the narrow read API. */
export function resolvePromptInputRead(
  key: PromptInputKey,
  read: (selectors: readonly string[]) => HTMLElement | null,
  doc = document,
): HTMLElement | null {
  return resolvePromptInputOperation(key, read, doc).value;
}
