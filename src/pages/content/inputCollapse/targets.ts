import { findOwnedGeminiMainInputs } from '@/core/gemini/composer/ownedInput';
import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
} from '@/core/gemini/selectors';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/input-collapse-packaged.json';

/** The original visual-island walk, shared only by pure reads. */
export function inputContainerFrom(textarea: Element): HTMLElement | null {
  let current = textarea.parentElement;
  let bestCandidate: HTMLElement | null = null;
  for (let i = 0; i < 8; i++) {
    if (!current) break;
    const style = window.getComputedStyle(current);
    const hasBackground =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
    if (hasBackground) bestCandidate = current;
    if (
      current.tagName === 'MAIN' ||
      current.tagName === 'BODY' ||
      current.classList.contains('content-wrapper')
    )
      break;
    current = current.parentElement;
  }
  return bestCandidate || textarea.parentElement?.parentElement || textarea.parentElement;
}

function resolveInputCollapseTargets(doc: Document): {
  wrappers: HTMLElement[];
  container: HTMLElement | null;
  nativeEditor: HTMLElement | null;
} {
  const key = 'inputCollapse.wrapper';
  const bundle = getBundledGeminiSelectorView();
  const view = getGeminiSelectorView();
  const read = (selectors: readonly string[]) => {
    const wrappers = Array.from(doc.querySelectorAll<HTMLElement>(selectors.join(', ')));
    return {
      wrappers,
      container: wrappers[0] ? inputContainerFrom(wrappers[0]) : null,
      nativeEditor: null,
    };
  };
  if (doc.defaultView?.location.hostname !== 'gemini.google.com' || !view.remoteKeys.has(key))
    return read(bundle.profiles[key]);
  const bundled = read(bundle.profiles[key]);
  const inputs = bundled.wrappers.length ? [] : findOwnedGeminiMainInputs(doc);
  const accepted = resolveGeminiSelectorOperationInView(
    view,
    (candidate) => read(candidate.profiles[key]),
    ({ wrappers, container }) => {
      // A partial list or a different visual island must never hide the wrong draft.
      if (bundled.wrappers.length)
        return (
          container === bundled.container &&
          wrappers.length === bundled.wrappers.length &&
          wrappers.every((wrapper, index) => wrapper === bundled.wrappers[index])
        );
      return (
        wrappers.length === 1 &&
        inputs.length === 1 &&
        wrappers[0].contains(inputs[0]) &&
        container !== doc.body &&
        container !== doc.documentElement &&
        container?.tagName !== 'MAIN' &&
        container === inputContainerFrom(inputs[0])
      );
    },
  );
  return {
    ...accepted.value,
    nativeEditor:
      accepted.view.remoteKeys.has(key) && !bundled.wrappers.length ? (inputs[0] ?? null) : null,
  };
}

export function resolveInputCollapseContainer(doc: Document): HTMLElement | null {
  return resolveInputCollapseTargets(doc).container;
}

/** Focus and empty-state protocols stay packaged: remote aliases could only confirm them. */
function readCollapseElement(
  root: HTMLElement,
  key: 'inputCollapse.emptyInputs' | 'inputCollapse.focus',
): { element: Element | null; native: boolean } {
  if (
    root.ownerDocument.defaultView?.location.hostname === 'gemini.google.com' &&
    getGeminiSelectorView().remoteKeys.has('inputCollapse.wrapper')
  ) {
    const accepted = resolveInputCollapseTargets(root.ownerDocument);
    // A renamed wrapper must keep its draft text when its editor uses a different input protocol.
    if (accepted.container === root) {
      if (accepted.nativeEditor) return { element: accepted.nativeEditor, native: true };
      if (key === 'inputCollapse.emptyInputs' && accepted.wrappers[0])
        return { element: accepted.wrappers[0], native: false };
    }
  }
  for (const selector of packaged[key]) {
    const element = root.querySelector(selector);
    if (element) return { element, native: false };
  }
  return { element: null, native: false };
}

export function findCollapseElement(
  root: HTMLElement,
  key: 'inputCollapse.emptyInputs' | 'inputCollapse.focus',
): Element | null {
  return readCollapseElement(root, key).element;
}

export function readCollapseInput(root: HTMLElement): { element: Element | null; text: string } {
  const { element, native } = readCollapseElement(root, 'inputCollapse.emptyInputs');
  return {
    element,
    text:
      native && element instanceof HTMLTextAreaElement
        ? element.value
        : (element?.textContent ?? ''),
  };
}

export function isPackagedInputRelated(element: HTMLElement): boolean {
  const selector = packaged['inputCollapse.related'].join(', ');
  return element.matches(selector) || Boolean(element.closest(selector));
}
