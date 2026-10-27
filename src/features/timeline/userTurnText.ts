import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';

import { timelineSiteData } from './siteTextData';
import {
  isCompleteUserText,
  ownsTimelineUserText,
  USER_TEXT_ATTACHMENT_PREVIEW,
} from './userTextProof';
const EXCLUDED_SELECTOR =
  'button, [role="button"], script, style, template, model-response, [data-message-author-role="assistant"], [data-conversation-role="assistant"]';
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'BLOCKQUOTE',
  'DIV',
  'DL',
  'DT',
  'DD',
  'FIGCAPTION',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
]);

const HIGHLIGHT_MARK_SELECTOR = 'mark.gv-highlight-mark';
const LATEX_ATTRIBUTE = 'data-user-latex-original';

function injected(element: Element): boolean {
  // Voyager highlight wrappers carry the user's authored text, not injected UI.
  if (element.matches(HIGHLIGHT_MARK_SELECTOR)) return false;
  return (
    element.matches(EXCLUDED_SELECTOR) ||
    Array.from(element.classList).some(
      (name) =>
        name.startsWith('gv-') ||
        name.includes('visually-hidden') ||
        name === 'sr-only' ||
        name === 'screen-reader-only',
    )
  );
}

/**
 * Full user prompt as plain text, read from the connected original so host CSS decides what is hidden.
 * Reads computed styles for the whole turn: call it only when a star needs text, never per collect.
 */
export function userTurnText(element: HTMLElement, url?: string): string {
  const userContentSelector = timelineSiteData(element.ownerDocument, url)['timeline.userText'];
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (node: Element): CSSStyleDeclaration => {
    let value = styles.get(node);
    if (!value) {
      value = getComputedStyle(node);
      styles.set(node, value);
    }
    return value;
  };
  const excluded = (node: Element): boolean =>
    injected(node) ||
    node.hasAttribute('hidden') ||
    node.getAttribute('aria-hidden') === 'true' ||
    style(node).display === 'none';
  const invisible = (node: Element): boolean => style(node).visibility === 'hidden';

  if (excluded(element)) return '';
  const reachable = (node: Element): boolean => {
    for (let current: Element | null = node; current && current !== element;) {
      if (excluded(current)) return false;
      current = current.parentElement;
    }
    return true;
  };
  const bundledMatch = element.matches(userContentSelector)
    ? element
    : Array.from(element.querySelectorAll(userContentSelector)).find(reachable);
  const bundledContent = bundledMatch ?? element;

  const extract = (content: Element, excludeAttachments = false): string => {
    let text = '';
    let syntheticNewline = false;
    const append = (value: string): void => {
      text += value;
      if (value) syntheticNewline = false;
    };
    const newline = () => {
      if (text && !text.endsWith('\n')) {
        text += '\n';
        syntheticNewline = true;
      }
    };
    const visit = (node: Node, root = false): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || !invisible(parent)) append((node.nodeValue ?? '').replace(/\r\n?/g, '\n'));
        return;
      }
      if (
        !(node instanceof Element) ||
        (!root && excluded(node)) ||
        (excludeAttachments && node.matches(USER_TEXT_ATTACHMENT_PREVIEW))
      )
        return;
      if (node.tagName === 'BR') {
        if (!invisible(node)) append('\n');
        return;
      }
      const block = BLOCK_TAGS.has(node.tagName);
      if (block) newline();
      const latex = node.getAttribute(LATEX_ATTRIBUTE);
      // The rendered formula's own visibility decides whether its source belongs to the prompt.
      if (latex === null) node.childNodes.forEach((child) => visit(child));
      else if (!invisible(node)) append(latex.replace(/\r\n?/g, '\n'));
      if (block) newline();
    };
    visit(content, true);
    return syntheticNewline ? text.slice(0, -1) : text;
  };
  const site = getPageSelectorSiteId(element.ownerDocument);
  const view = site ? getSiteSelectorView(site) : null;
  let sameSite = true;
  if (url) {
    try {
      sameSite = new URL(url).hostname === element.ownerDocument.location.hostname;
    } catch {
      sameSite = false;
    }
  }
  if (sameSite && site && view?.remoteKeys.has('timeline.userText')) {
    try {
      const selector = view.profiles['timeline.userText'].join(',');
      const candidate = element.matches(selector)
        ? element
        : Array.from(element.querySelectorAll(selector)).find(reachable);
      if (
        candidate instanceof HTMLElement &&
        reachable(candidate) &&
        !excluded(candidate) &&
        ownsTimelineUserText(candidate, site)
      ) {
        const value = extract(candidate, true);
        // Attachments precede Gemini's body; only the complete authored text can prove a repair.
        if (isCompleteUserText(value, extract(bundledContent, true))) return value;
      }
    } catch {
      // Keep the original text preference if this operation cannot prove complete prompt text.
    }
  }
  return extract(bundledContent);
}
