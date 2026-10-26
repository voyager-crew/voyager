import { isOwnedDiagramSource } from '../../features/plugins/verbs/diagramExportRegistry';
import { hasVoyagerOwner } from '../gemini/composer/ownedInput';
import { sameItems } from '../utils/array';
import { getBundledSiteSelectorView } from './bundle';
import { guardedChatgptSemanticSelector } from './chatgptSemantics';
import { COMMON_CONVERSATION_PATTERNS } from './contracts/commonSemantics';
import { BUNDLED_LOCATOR_SITES } from './sites';
import type { SiteSelectorView } from './types';

const FOREIGN =
  'form, [contenteditable="true"], [contenteditable="plaintext-only"], [role="dialog"], [role="alertdialog"], dialog';
const NAVIGATION = 'nav, aside, [role="navigation"]';
const CODE_DECORATIONS = new Set([
  'gv-code-block-collapsible',
  'gv-code-block-collapsed',
  'gv-code-block-clip',
]);

function hasStructureVoyagerOwner(element: Element): boolean {
  const doc = element.ownerDocument;
  for (
    let node: Element | null = element;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    if (
      node.matches('[data-gv-component], [data-gv-layer], [data-gv-plugin]') ||
      (hasVoyagerOwner(node, node.parentElement ?? undefined) &&
        Array.from(node.classList).some(
          (name) => name.startsWith('gv-') && !CODE_DECORATIONS.has(name),
        ))
    )
      return true;
  }
  return false;
}

/** Only remote proofs need rendered ownership; bundled reads retain their original query cost. */
function isOriginalVisible(element: Element, doc: Document): boolean {
  const window = doc.defaultView;
  if (
    !window ||
    hasStructureVoyagerOwner(element) ||
    element.closest(`${FOREIGN}, [hidden], [inert], [aria-hidden="true"]`)
  )
    return false;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    // A diagram hides its retained native source; only its owning renderer can attest that hide.
    if (
      (style.display === 'none' && !isOwnedDiagramSource(node)) ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

function turnSelector(
  view: SiteSelectorView,
  role: 'userTurn' | 'assistantTurn',
  doc: Document,
): string {
  return (
    (view.siteId === 'chatgpt'
      ? guardedChatgptSemanticSelector(role, view, doc)
      : getBundledSiteSelectorView(view.siteId).profiles[role]?.join(',')) ?? ':not(*)'
  );
}

function nativeTurns(doc: Document, view: SiteSelectorView, assistantOnly = false): Element[] {
  const roles = assistantOnly
    ? (['assistantTurn'] as const)
    : (['userTurn', 'assistantTurn'] as const);
  return Array.from(
    doc.querySelectorAll(roles.map((role) => turnSelector(view, role, doc)).join(',')),
  ).filter((turn) => isOriginalVisible(turn, doc));
}

function provesSidebar(candidate: Element, doc: Document, view: SiteSelectorView): boolean {
  const pattern = COMMON_CONVERSATION_PATTERNS[view.siteId];
  if (!pattern || !candidate.matches(NAVIGATION)) return false;
  const path = new RegExp(pattern);
  const account = /^\/u\/[^/]+/.exec(doc.location.pathname)?.[0] ?? '';
  const turns = nativeTurns(doc, view);
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((link) => {
    const url = new URL(link.href, doc.location.href);
    return (
      url.origin === doc.location.origin &&
      path.test(url.pathname) &&
      (view.siteId !== 'chatgpt' || (/^\/u\/[^/]+/.exec(url.pathname)?.[0] ?? '') === account) &&
      isOriginalVisible(link, doc) &&
      !turns.some((turn) => turn.contains(link)) &&
      !!link.closest(NAVIGATION)
    );
  });
  return links.length > 0 && links.every((link) => candidate.contains(link));
}

function actuallyScrolls(candidate: Element, doc: Document): candidate is HTMLElement {
  if (!(candidate instanceof HTMLElement)) return false;
  const style = doc.defaultView?.getComputedStyle(candidate);
  return (
    !!style &&
    /^(auto|scroll|overlay)$/.test(style.overflowY || style.overflow) &&
    candidate.scrollHeight > candidate.clientHeight
  );
}

function provesScroll(candidate: Element, doc: Document, view: SiteSelectorView): boolean {
  const turns = nativeTurns(doc, view);
  if (!turns.length) return false;
  // The innermost real scroller that owns every turn is the conversation viewport, not an outer page shell.
  for (
    let owner = turns[0].parentElement;
    owner && owner !== doc.body;
    owner = owner.parentElement
  ) {
    const current = owner;
    if (
      actuallyScrolls(current, doc) &&
      isOriginalVisible(current, doc) &&
      turns.every((turn) => current.contains(turn))
    )
      return (
        candidate === current &&
        !current.querySelector(`${NAVIGATION}, form, textarea, [contenteditable="true"]`)
      );
  }
  return false;
}

function onlyCode(candidate: Element, source: Element, chatgpt: boolean): boolean {
  if (candidate === source) return source.localName === 'pre';
  if (!candidate.contains(source)) return false;
  // ChatGPT's current blocks use a whitespace-preserving code element without a pre.
  const nativeSources = Array.from(candidate.querySelectorAll('pre, code')).filter(
    (node) => !chatgpt || !node.closest('[data-markdown-copy="exclude"]'),
  );
  if (nativeSources.some((node) => node !== source && !source.contains(node))) return false;
  const walker = candidate.ownerDocument.createTreeWalker(
    candidate,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    (node) =>
      node instanceof Element &&
      (node.matches('button.gv-code-block-toggle') ||
        (chatgpt && node.matches('[data-markdown-copy="exclude"]')))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (source.contains(node)) continue;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false;
    if (
      node instanceof Element &&
      (node.shadowRoot ||
        node.matches(
          'img, svg, canvas, table, math, [data-math-source], .katex, iframe, video, audio',
        ))
    )
      return false;
  }
  return candidate.shadowRoot === null;
}

function provesCode(candidates: Element[], doc: Document, view: SiteSelectorView): boolean {
  const turns = nativeTurns(doc, view, true);
  const chatgpt = view.siteId === 'chatgpt';
  const code = Array.from(doc.querySelectorAll(chatgpt ? 'pre, code' : 'pre')).filter((source) => {
    if (!turns.some((turn) => turn.contains(source)) || !isOriginalVisible(source, doc))
      return false;
    if (source.localName === 'pre') return true;
    if (source.closest('pre, [data-markdown-copy="exclude"]')) return false;
    const style = doc.defaultView?.getComputedStyle(source);
    return style?.display === 'block' && /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace);
  });
  return (
    code.length > 0 &&
    code.length === candidates.length &&
    candidates.every((candidate, index) => {
      const owner = turns.find((turn) => turn.contains(code[index]));
      // A user code sample or the whole response wrapper is not an assistant code-block host.
      return (
        owner !== candidate &&
        !!owner?.contains(candidate) &&
        onlyCode(candidate, code[index], chatgpt)
      );
    })
  );
}

/** Remote structure may narrow neither an existing collection nor the site's conversation owner. */
export function guardedSiteStructureSelector(
  key: string,
  view: SiteSelectorView,
  doc: Document,
): string | undefined {
  const bundle = getBundledSiteSelectorView(view.siteId);
  const fallback = bundle.profiles[key]?.join(',');
  const selector = view.profiles[key]?.join(',');
  if (!view.remoteKeys.has(key) || !selector) return fallback;
  try {
    const candidates = Array.from(doc.querySelectorAll(selector));
    const original = fallback ? Array.from(doc.querySelectorAll(fallback)) : [];
    if (original.length) return sameItems(candidates, original) ? selector : fallback;
    if (
      !candidates.length ||
      candidates.some(
        (candidate) =>
          candidate === doc.body ||
          candidate === doc.documentElement ||
          !isOriginalVisible(candidate, doc),
      )
    )
      return fallback;
    if (key === 'codeBlock') return provesCode(candidates, doc, view) ? selector : fallback;
    if (candidates.length !== 1) return fallback;
    const candidate = candidates[0];
    if (key === 'sidebar') return provesSidebar(candidate, doc, view) ? selector : fallback;
    if (key === 'scrollContainer') return provesScroll(candidate, doc, view) ? selector : fallback;
  } catch {
    // Invalid syntax and retired page contexts keep the packaged read.
  }
  return fallback;
}

/** Whether this is one of the structural fields the current site actually declares. */
export function isSiteStructureKey(siteId: string, key: string): boolean {
  return (
    ['codeBlock', 'sidebar', 'scrollContainer'].includes(key) &&
    !!BUNDLED_LOCATOR_SITES.find((site) => site.id === siteId)?.selectors[key]
  );
}
