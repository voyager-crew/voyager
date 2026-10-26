import { GEMINI_FORMULA_PACKAGED } from '@/core/gemini/math/formula';

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
    root.ownerDocument.location?.hostname === 'gemini.google.com'
      ? GEMINI_FORMULA_PACKAGED['formula.quote']
      : '.math-inline, .math-block';
  for (const container of Array.from(root.querySelectorAll(containers))) {
    const dataMathEl = container.querySelector('[data-math]');
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
