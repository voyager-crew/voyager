/** Set by the user-LaTeX renderer on an element it rendered; holds the text it replaced. */
export const USER_LATEX_ORIGINAL_ATTRIBUTE = 'data-user-latex-original';

/** The renderer's own output, a direct child of the element it rendered. */
const RENDERED_LATEX_SELECTOR = ':scope > [class^="gv-user-latex-"]';

/**
 * Whether `element` still shows the renderer's output. Once the host repaints
 * it (React writing an edited message over the same element), its
 * {@link USER_LATEX_ORIGINAL_ATTRIBUTE} describes text that is no longer there.
 */
export function hasUserLatexRendering(element: Element): boolean {
  return element.querySelector(RENDERED_LATEX_SELECTOR) !== null;
}

/**
 * `node.textContent` as the user typed it: each rendered formula reads back as
 * its LaTeX source, so hashes and comparisons see one text before and after
 * rendering.
 */
export function textWithLatexSource(node: Node): string {
  if (!(node instanceof Element)) return node.textContent ?? '';
  const original = node.getAttribute(USER_LATEX_ORIGINAL_ATTRIBUTE);
  // Only while our rendering is there: after a host repaint the source is stale and the text is current.
  if (original !== null && hasUserLatexRendering(node)) return original;
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
