import { GEMINI_FORMULA_PACKAGED } from '@/core/gemini/math/formula';
import { nativeStartPointSiteForHost } from '@/features/plugins/sites/hostPolicy';

/** Prefix each selected line, including blank lines, for a Markdown quote. */
export function formatQuotedText(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/** Replace Gemini math in a detached selection clone, leaving the host untouched. */
export function replaceMathWithLatex(root: DocumentFragment): void {
  const containers =
    nativeStartPointSiteForHost(root.ownerDocument.location?.hostname ?? '') === 'gemini'
      ? GEMINI_FORMULA_PACKAGED['formula.quote']
      : '.math-inline, .math-block';
  for (const container of Array.from(root.querySelectorAll(containers))) {
    // Gemini now puts data-math on the block container itself, not only on a child.
    const dataMathEl = container.matches('[data-math]')
      ? container
      : container.querySelector('[data-math]');
    const latex = dataMathEl?.getAttribute('data-math');
    if (latex) {
      const isBlock = container.classList.contains('math-block');
      container.replaceWith(
        root.ownerDocument.createTextNode(isBlock ? `$$${latex}$$` : `$${latex}$`),
      );
    }
  }
  for (const el of Array.from(root.querySelectorAll('[data-math]'))) {
    const latex = el.getAttribute('data-math');
    if (latex) el.replaceWith(root.ownerDocument.createTextNode(`$${latex}$`));
  }
}
