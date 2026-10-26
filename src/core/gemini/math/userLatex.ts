import { sameItems } from '@/core/utils/array';
import { USER_LATEX_ORIGINAL_ATTRIBUTE, hasUserLatexRendering } from '@/core/utils/userLatexSource';

import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  type GeminiSelectorOperation,
  type GeminiSelectorView,
} from '../selectors';

const NON_MESSAGE_CONTENT =
  'button, textarea, input, code, pre, script, style, [contenteditable]:not([contenteditable="false"]), [aria-hidden="true"], .cdk-visually-hidden, user-query-file-preview';

const SOURCE_PROTOCOL =
  'math, .katex, .katex-display, .math-inline, .math-block, .math-display, [data-math], [data-math-source], [data-user-latex-original]';

function preservesLineContent(line: HTMLElement): boolean {
  // Earlier lines in this same pass already contain our output when a later KaTeX await resolves.
  if (line.hasAttribute(USER_LATEX_ORIGINAL_ATTRIBUTE) && hasUserLatexRendering(line)) return true;
  if (line.matches(SOURCE_PROTOCOL) || line.hasAttribute('role')) return false;
  return Array.from(line.querySelectorAll('*')).every((child) => {
    // Quote styling owns this decoration; the renderer saves and restores its original node.
    if (child.matches('span.gv-rendered-quote-marker')) return true;
    return (
      child.tagName === 'SPAN' &&
      !child.matches(`${SOURCE_PROTOCOL}, ${NON_MESSAGE_CONTENT}`) &&
      !child.hasAttribute('role') &&
      !Array.from(child.classList).some((name) => name.startsWith('gv-'))
    );
  });
}

/** Native paragraphs prove line boundaries independently of the online class name. */
function nativeLines(doc: Document): HTMLElement[] | null {
  const lines: HTMLElement[] = [];
  for (const host of doc.querySelectorAll('user-query')) {
    const paragraphs = Array.from(host.querySelectorAll<HTMLElement>('p')).filter(
      (line) => !line.closest(NON_MESSAGE_CONTENT),
    );
    // A repaired whole-line renderer must not flatten a code/link/math frame into plain text.
    if (!paragraphs.every(preservesLineContent)) return null;
    const paragraphSet = new Set(paragraphs);
    const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest(NON_MESSAGE_CONTENT)) continue;
      const paragraph = node.parentElement?.closest('p');
      // A fragment that omits a line or bare text must never become a complete message read.
      if (!paragraph || !paragraphSet.has(paragraph)) return null;
    }
    lines.push(...paragraphs);
  }
  return lines;
}

/** One full scan, also reused by quote styling and the post-KaTeX identity check. */
export function resolveGeminiUserLatexLines(
  doc: Document,
  view: GeminiSelectorView = getGeminiSelectorView(),
): GeminiSelectorOperation<HTMLElement[]> {
  const bundle = getBundledGeminiSelectorView();
  const read = (selected: GeminiSelectorView) =>
    Array.from(doc.querySelectorAll<HTMLElement>(selected.profiles['userLatex.lines'].join(',')));
  const bundled = read(bundle);
  if (!view.remoteKeys.has('userLatex.lines')) return { value: bundled, view: bundle };
  try {
    const candidates = read(view);
    const expected = bundled.length > 0 ? bundled : nativeLines(doc);
    if (expected && expected.length > 0 && sameItems(candidates, expected)) {
      return { value: candidates, view };
    }
  } catch {
    // Invalid or incomplete online reads never alter the bundled scan.
  }
  return { value: bundled, view: bundle };
}
