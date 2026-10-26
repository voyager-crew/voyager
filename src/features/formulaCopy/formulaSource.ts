import {
  GEMINI_FORMULA_PACKAGED,
  GEMINI_FORMULA_CONTAINER_SELECTOR,
} from '@/core/gemini/math/formula';

/**
 * Find the nearest math element in the DOM tree
 * Supports both Gemini (data-math attribute) and AI Studio (ms-katex container)
 */
export function findMathElement(target: Element): HTMLElement | null {
  // 1. Try Gemini's data-math attribute (direct)
  const direct = target.closest('[data-math]');
  if (direct instanceof HTMLElement) {
    return direct;
  }

  // 2. Try Gemini's .math-inline, .math-block containers
  const containerSelector =
    target.ownerDocument.location?.hostname === 'gemini.google.com'
      ? GEMINI_FORMULA_CONTAINER_SELECTOR
      : '.math-inline, .math-block';
  const geminiContainer = target.closest(containerSelector);
  if (geminiContainer instanceof HTMLElement) {
    return findDataMathInSubtree(geminiContainer);
  }

  // 3. Try AI Studio's ms-katex container
  const aiStudioContainer = target.closest('ms-katex');
  if (aiStudioContainer instanceof HTMLElement) {
    return aiStudioContainer;
  }

  // 4. Generic KaTeX (AI Studio, ChatGPT, Claude) — clicked inside .katex
  const katexElement = target.closest('.katex');
  if (katexElement instanceof HTMLElement) {
    // AI Studio wraps .katex in an <ms-katex> container; prefer it when present.
    const parentMsKatex = katexElement.closest('ms-katex');
    if (parentMsKatex instanceof HTMLElement) {
      return parentMsKatex;
    }
    // ChatGPT / Claude: a block formula is wrapped in .katex-display. Return the
    // wrapper so isDisplayMode() can detect it; inline math returns the .katex.
    const displayWrapper = katexElement.closest('.katex-display');
    return displayWrapper instanceof HTMLElement ? displayWrapper : katexElement;
  }

  // 5. ChatGPT / Claude: clicked on the .katex-display padding around a block
  //    formula (outside the inner .katex).
  const displayContainer = target.closest('.katex-display');
  if (displayContainer instanceof HTMLElement) {
    return displayContainer;
  }

  return null;
}

/**
 * Search for data-math attribute in element subtree
 */
function findDataMathInSubtree(root: HTMLElement): HTMLElement | null {
  const direct = root.querySelector('[data-math]');
  return direct instanceof HTMLElement ? direct : null;
}

/**
 * Extract LaTeX source from a math element
 * Supports both Gemini (data-math attribute) and AI Studio (annotation element)
 */
export function extractLatexSource(element: HTMLElement): string | null {
  // 1. Try Gemini's data-math attribute
  const dataMath = element.getAttribute('data-math');
  if (dataMath) {
    return dataMath;
  }

  // 2. ChatGPT's client-side KaTeX layout omits the MathML annotation and
  // keeps the original TeX on the semantic wrapper around .katex-display.
  const dataMathSource = element.closest('[data-math-source]')?.getAttribute('data-math-source');
  if (dataMathSource?.trim()) {
    return dataMathSource.trim();
  }

  // 3. Try AI Studio's annotation element with encoding="application/x-tex"
  const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation?.textContent) {
    return annotation.textContent.trim();
  }

  // 4. Fallback: try any annotation element
  const anyAnnotation = element.querySelector('annotation');
  if (anyAnnotation?.textContent) {
    return anyAnnotation.textContent.trim();
  }

  return null;
}

/**
 * Check if formula is in display mode (block formula)
 * Supports both Gemini (.math-block class) and AI Studio (math display="block" attribute)
 */
export function isDisplayMode(element: HTMLElement): boolean {
  // 1. Gemini: check for a block/display container
  const display =
    element.ownerDocument.location?.hostname === 'gemini.google.com'
      ? GEMINI_FORMULA_PACKAGED['formula.display']
      : '.math-block, .math-display';
  if (element.closest(display) !== null) {
    return true;
  }

  // 2. ChatGPT / Claude: block KaTeX uses a .katex-display wrapper. Current
  // ChatGPT markup no longer includes the MathML node checked below.
  if (element.closest('.katex-display') !== null) {
    return true;
  }

  // 3. AI Studio: check for math element with display="block" attribute
  const mathElement = element.querySelector('math[display="block"]');
  if (mathElement) {
    return true;
  }

  // 4. AI Studio: check if ms-katex container has block-like styling
  // (display formulas are typically block-level in AI Studio)
  if (element.tagName.toLowerCase() === 'ms-katex') {
    const style = window.getComputedStyle(element);
    if (style.display === 'block' || style.display === 'flex') {
      return true;
    }
  }

  return false;
}
