import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/composer-draft-packaged.json';

import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorOperation,
  type GeminiSelectorView,
} from '../selectors';
import { findNativeMainInputs } from './native';

/** Preserve candidate priority and the old visibility check, including its early return. */
function findBundledInput(doc: Document): HTMLElement | null {
  for (const selector of getBundledGeminiSelectorView().profiles['composer.draftCandidates']) {
    for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
      if (
        !element.closest(packaged['composer.draftEditExclusion']) &&
        element.getBoundingClientRect().height > 0
      )
        return element;
    }
  }
  return null;
}

function readCandidates(doc: Document, view: GeminiSelectorView): HTMLElement[] {
  const candidates = new Set<HTMLElement>();
  for (const selector of view.profiles['composer.draftCandidates']) {
    for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
      if (
        !element.closest(packaged['composer.draftEditExclusion']) &&
        element.getBoundingClientRect().height > 0
      )
        candidates.add(element);
    }
  }
  return Array.from(candidates);
}

/** A draft read and its subsequent write must name the same independently proven main field. */
export function resolveGeminiDraftInput(
  doc: Document,
  view: GeminiSelectorView = getGeminiSelectorView(),
): GeminiSelectorOperation<HTMLElement | null> {
  const bundle = getBundledGeminiSelectorView();
  if (!view.remoteKeys.has('composer.draftCandidates'))
    return { value: findBundledInput(doc), view };
  const bundled = readCandidates(doc, bundle);
  const operation = resolveGeminiSelectorOperationInView(
    view,
    (candidate) => readCandidates(doc, candidate),
    (remote) => {
      // A partial/reordered profile must not save a different mounted composer's text.
      if (bundled.length)
        return (
          remote.length === bundled.length &&
          remote.every((element, index) => element === bundled[index])
        );
      // With no bundled hit, the native owner must independently prove one editable main field.
      const native = findNativeMainInputs(doc);
      return remote.length === 1 && native.length === 1 && remote[0] === native[0];
    },
  );
  return { value: operation.value[0] ?? null, view: operation.view };
}

export function findGeminiDraftInput(doc: Document): HTMLElement | null {
  return resolveGeminiDraftInput(doc).value;
}
