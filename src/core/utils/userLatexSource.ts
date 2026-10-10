/** Set by the user-LaTeX renderer on an element it rendered; holds the text it replaced. */
export const USER_LATEX_ORIGINAL_ATTRIBUTE = 'data-user-latex-original';

/**
 * `node.textContent` as the user typed it: each rendered formula reads back as
 * its LaTeX source, so hashes and comparisons see one text before and after
 * rendering.
 */
export function textWithLatexSource(node: Node): string {
  if (!(node instanceof Element)) return node.textContent ?? '';
  const original = node.getAttribute(USER_LATEX_ORIGINAL_ATTRIBUTE);
  if (original !== null) return original;
  if (!node.querySelector(`[${USER_LATEX_ORIGINAL_ATTRIBUTE}]`)) return node.textContent ?? '';
  let text = '';
  node.childNodes.forEach((child) => {
    // Element textContent leaves out comments and processing instructions.
    if (child.nodeType === Node.COMMENT_NODE) return;
    if (child.nodeType === Node.PROCESSING_INSTRUCTION_NODE) return;
    text += textWithLatexSource(child);
  });
  return text;
}
