// Keep sent quote markers for export, timeline and teardown; repaint after user-LaTeX rendering.
// Composer classes alone preserve caret, IME and native submitted Markdown.
import { resolveGeminiUserLatexLines } from '@/core/gemini/math/userLatex';
import { getBundledGeminiSelectorView, getGeminiSelectorView } from '@/core/gemini/selectors';

import { CHAT_INPUT_SELECTOR, findChatInput } from '../chatInput/index';

const USER_LINE_SELECTOR = getBundledGeminiSelectorView().profiles['userLatex.lines'].join(',');
const QUOTE_LINE_CLASS = 'gv-rendered-quote-line';
const QUOTE_START_CLASS = 'gv-rendered-quote-start';
const QUOTE_END_CLASS = 'gv-rendered-quote-end';
const QUOTE_EMPTY_LINE_CLASS = 'gv-rendered-quote-empty';
const QUOTE_LINE_CLASSES = [
  QUOTE_LINE_CLASS,
  QUOTE_START_CLASS,
  QUOTE_END_CLASS,
  QUOTE_EMPTY_LINE_CLASS,
] as const;
const QUOTE_MARKER_CLASS = 'gv-rendered-quote-marker';
const COMPOSER_QUOTE_LINE_CLASS = 'gv-composer-quote-line';
const COMPOSER_QUOTE_START_CLASS = 'gv-composer-quote-start';
const COMPOSER_QUOTE_END_CLASS = 'gv-composer-quote-end';
const COMPOSER_QUOTE_CLASSES = [
  COMPOSER_QUOTE_LINE_CLASS,
  COMPOSER_QUOTE_START_CLASS,
  COMPOSER_QUOTE_END_CLASS,
] as const;
const QUOTE_PREFIX_PATTERN = /^\s*>(?:[ \t]+|$)/u;
const OBSERVER_DEBOUNCE_MS = 80;

/**
 * Every node this content script decorated. Teardown restores these, not whatever a selector
 * finds in the document: a host re-render can detach a decorated message that comes back later,
 * and another content script's decorations are not ours to undo.
 */
const owned = {
  markers: new Set<HTMLElement>(),
  lines: new Set<HTMLElement>(),
  composerLines: new Set<HTMLElement>(),
};

function getLineSource(line: HTMLElement): string {
  return line.textContent ?? '';
}

function isQuoteLine(line: HTMLElement): boolean {
  return QUOTE_PREFIX_PATTERN.test(getLineSource(line));
}

function isEmptyQuoteLine(line: HTMLElement): boolean {
  return getLineSource(line).replace(QUOTE_PREFIX_PATTERN, '').trim().length === 0;
}

function addHiddenQuoteMarker(line: HTMLElement): void {
  if (line.querySelector(`.${QUOTE_MARKER_CLASS}`)) return;

  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    const value = textNode.textContent ?? '';
    const match = value.match(QUOTE_PREFIX_PATTERN);
    if (match) {
      const marker = document.createElement('span');
      marker.className = QUOTE_MARKER_CLASS;
      marker.setAttribute('aria-hidden', 'true');
      marker.textContent = match[0];
      owned.markers.add(marker);

      textNode.parentNode?.insertBefore(marker, textNode);
      textNode.textContent = value.slice(match[0].length);
      return;
    }

    if (value.trim().length > 0) return;
    textNode = walker.nextNode();
  }
}

function clearQuoteLine(line: HTMLElement): void {
  owned.lines.delete(line);
  line.classList.remove(...QUOTE_LINE_CLASSES);
}

/**
 * Quoted lines stay where Gemini rendered them and only gain classes: the quote is painted by
 * CSS, so the message keeps its native structure and height. Gemini re-collapses a message that
 * grows after Expand (#1117), and it inserts into the line list we would otherwise rearrange.
 */
function decorateContainer(container: HTMLElement, lines: ReadonlySet<HTMLElement>): void {
  let run: HTMLElement[] = [];
  const flush = (): void => {
    const visible = run.filter((line) => !isEmptyQuoteLine(line));
    run.forEach((line) => {
      owned.lines.add(line);
      line.classList.add(QUOTE_LINE_CLASS);
      line.classList.toggle(QUOTE_EMPTY_LINE_CLASS, !visible.includes(line));
      line.classList.toggle(QUOTE_START_CLASS, line === visible[0]);
      line.classList.toggle(QUOTE_END_CLASS, line === visible[visible.length - 1]);
      addHiddenQuoteMarker(line);
    });
    run = [];
  };

  Array.from(container.children).forEach((child) => {
    if (child instanceof HTMLElement && lines.has(child) && isQuoteLine(child)) {
      run.push(child);
      return;
    }
    flush();
    if (child instanceof HTMLElement && owned.lines.has(child)) clearQuoteLine(child);
  });
  flush();
}

function collectUserLineContainers(lines: ReadonlySet<HTMLElement>): Set<HTMLElement> {
  const containers = new Set<HTMLElement>();
  lines.forEach((line) => {
    if (line.parentElement) containers.add(line.parentElement);
  });
  return containers;
}

function renderQuotedComposerLines(): void {
  const input = findChatInput({ requireVisible: false, online: true });
  if (!input || input instanceof HTMLTextAreaElement) return;

  const lines = Array.from(input.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.matches('p'),
  );

  lines.forEach((line) => line.classList.remove(...COMPOSER_QUOTE_CLASSES));
  lines.forEach((line, index) => {
    if (!isQuoteLine(line)) return;

    const previousIsQuote = index > 0 && isQuoteLine(lines[index - 1]);
    const nextIsQuote = index < lines.length - 1 && isQuoteLine(lines[index + 1]);
    owned.composerLines.add(line);
    line.classList.add(COMPOSER_QUOTE_LINE_CLASS);
    line.classList.toggle(COMPOSER_QUOTE_START_CLASS, !previousIsQuote);
    line.classList.toggle(COMPOSER_QUOTE_END_CLASS, !nextIsQuote);
  });
}

export function renderQuotedUserMessages(): void {
  restoreOwnedNodes((node) => !node.isConnected);
  const lines = new Set(resolveGeminiUserLatexLines(document).value);
  collectUserLineContainers(lines).forEach((container) => decorateContainer(container, lines));

  renderQuotedComposerLines();
}

// The body observer sees every record Gemini produces, including each row the
// sidebar appends while paginating. Match by selector only: resolving the live
// input measures layout, and doing that per record slows long histories (#1040).
const QUOTE_RELEVANT_SELECTOR = `${USER_LINE_SELECTOR}, .${QUOTE_LINE_CLASS}, ${CHAT_INPUT_SELECTOR}`;

const NATIVE_EDITABLE_SELECTOR =
  'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';

function mutationMayAffectQuotes(mutation: MutationRecord, selector: string): boolean {
  const targetElement =
    mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (targetElement?.closest(selector)) return true;

  return Array.from(mutation.addedNodes).some(
    (node) =>
      node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null),
  );
}

/**
 * Undo the decorations on the owned nodes `select` picks and forget them. Each render drops the
 * detached ones this way, so a message that returns after stop carries nothing of ours.
 */
function restoreOwnedNodes(select: (node: HTMLElement) => boolean): void {
  const restoreMarker = (marker: HTMLElement): void => {
    owned.markers.delete(marker);
    marker.replaceWith(document.createTextNode(marker.textContent ?? ''));
  };
  Array.from(owned.markers).filter(select).forEach(restoreMarker);
  Array.from(owned.lines)
    .filter(select)
    .forEach((line) => {
      clearQuoteLine(line);
      // A marker another renderer saved while it was detached can come back into the line.
      line.querySelectorAll<HTMLElement>(`.${QUOTE_MARKER_CLASS}`).forEach(restoreMarker);
    });
  Array.from(owned.composerLines)
    .filter(select)
    .forEach((line) => {
      owned.composerLines.delete(line);
      line.classList.remove(...COMPOSER_QUOTE_CLASSES);
    });
}

export function startRenderedQuoteStyling(): () => void {
  renderQuotedUserMessages();

  const handleInput = (event: Event) => {
    const input = findChatInput({ requireVisible: false, online: true });
    if (!input || !(event.target instanceof Node) || !input.contains(event.target)) return;
    renderQuotedComposerLines();
  };
  document.addEventListener('input', handleInput, true);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((mutations) => {
    // Renamed composers must reach the guarded read even when the host replaces lines without input.
    const view = getGeminiSelectorView();
    const composerSelector = view.remoteKeys.has('composer.candidates')
      ? `${QUOTE_RELEVANT_SELECTOR}, ${NATIVE_EDITABLE_SELECTOR}`
      : QUOTE_RELEVANT_SELECTOR;
    const selector = view.remoteKeys.has('userLatex.lines')
      ? `${composerSelector}, ${view.profiles['userLatex.lines'].join(',')}`
      : composerSelector;
    if (!mutations.some((mutation) => mutationMayAffectQuotes(mutation, selector))) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      renderQuotedUserMessages();
    }, OBSERVER_DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    document.removeEventListener('input', handleInput, true);
    if (debounceTimer) clearTimeout(debounceTimer);
    restoreOwnedNodes(() => true);
  };
}
