/**
 * A repaired body may change its wrapper, never its originating message or content.
 * The caller supplies only packaged exclusions; the remote file cannot hide evidence.
 */
export function preservesCompleteContent(
  candidate: Element,
  owner: Element,
  skip: (element: Element) => boolean = () => false,
): boolean {
  if (
    !owner.contains(candidate) ||
    (candidate !== owner && owner.shadowRoot !== null) ||
    candidate.closest(
      'button, [role="button"], [contenteditable="true"], [data-gv-component], [data-gv-layer]',
    )
  )
    return false;
  for (let node: Element | null = candidate; node; node = node.parentElement) {
    if (skip(node)) return false;
    if (node === owner) break;
    // Starting the walk inside a link, paragraph, list or code frame loses its serialization.
    if (
      node.matches(
        'p, a, strong, em, b, i, pre, code, blockquote, ul, ol, li, table, thead, tbody, tr, td, th, h1, h2, h3, h4, h5, h6, figure, img, svg, canvas, math, [data-math-source], [data-math], [data-user-latex-original], .katex, .katex-display',
      )
    )
      return false;
  }
  const walker = owner.ownerDocument.createTreeWalker(
    owner,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    (node) => {
      if (
        node instanceof Element &&
        (node.matches('script, style, noscript, template, [data-gv-component], [data-gv-layer]') ||
          (node.matches('button') && !node.querySelector('img')) ||
          skip(node))
      )
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  );
  let hasContent = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const meaningful =
      node.nodeType === Node.TEXT_NODE
        ? !!node.textContent?.trim()
        : node instanceof Element &&
          // A shadow host can carry code or images invisible to this light-DOM walker.
          (node.shadowRoot !== null ||
            node.matches(
              'img, svg, canvas, pre, table, math, [data-math-source], [data-math], [data-user-latex-original], .katex, .katex-display',
            ));
    if (!meaningful) continue;
    hasContent = true;
    // Equal text is insufficient: a duplicate body can belong to a different message.
    if (!candidate.contains(node)) return false;
  }
  return hasContent;
}
