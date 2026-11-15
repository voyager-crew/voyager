import { replaceMathWithLatex } from '@/core/utils/quotedText';

import { extractLatexSource, isDisplayMode } from './formulaSource';

const BLOCK = /^(P|DIV|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6]|TR)$/;

function selectedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node instanceof Element) {
    if (node.matches('script, style, [hidden], [aria-hidden="true"]')) return '';
    if (
      node.matches('p, div') &&
      node.childNodes.length === 1 &&
      node.firstChild instanceof Element &&
      node.firstChild.tagName === 'BR'
    )
      return '';
    if (node.tagName === 'BR') return '\n';
  }
  return Array.from(node.childNodes)
    .map((child, index, children) => {
      const isBlock = (candidate: Node) =>
        candidate instanceof Element && BLOCK.test(candidate.tagName);
      const separator = index > 0 && (isBlock(child) || isBlock(children[index - 1])) ? '\n' : '';
      return separator + selectedText(child);
    })
    .join('');
}

/**
 * Read only a clone: rendered math has duplicate visual/MathML text, but one TeX source.
 * Quote reply and selection copy share this reading.
 */
export function extractQuoteText(range: Range): string {
  const root = range.commonAncestorContainer;
  if (
    root instanceof HTMLElement &&
    root.matches('.katex-display, .katex, ms-katex, [data-math-source]') &&
    range.startContainer === root &&
    range.startOffset === 0 &&
    range.endContainer === root &&
    range.endOffset === root.childNodes.length
  ) {
    // cloneContents omits its root, including the source wrapper of a math-only selection.
    const latex = extractLatexSource(root);
    if (latex) return isDisplayMode(root) ? `$$${latex}$$` : `$${latex}$`;
  }
  const fragment = range.cloneContents();
  replaceMathWithLatex(fragment);
  for (const math of Array.from(
    fragment.querySelectorAll<HTMLElement>('.katex-display, .katex, ms-katex'),
  )) {
    if (!fragment.contains(math)) continue;
    const latex = extractLatexSource(math);
    if (!latex) continue;
    const block =
      math.matches('.katex-display') || math.querySelector('math[display="block"]') !== null;
    math.replaceWith(fragment.ownerDocument.createTextNode(block ? `$$${latex}$$` : `$${latex}$`));
  }
  return selectedText(fragment).trim();
}
