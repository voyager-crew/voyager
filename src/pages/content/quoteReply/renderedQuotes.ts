// Keep sent quote markers for export, timeline and teardown; repaint after user-LaTeX rendering.
// Composer classes alone preserve caret, IME and native submitted Markdown.
import { getGeminiSelectorView } from '@/core/gemini/selectors';

import { CHAT_INPUT_SELECTOR, findChatInput } from '../chatInput/index';

const USER_LINE_SELECTOR = 'p.query-text-line';
const QUOTE_WRAPPER_CLASS = 'gv-rendered-quote';
const QUOTE_LINE_CLASS = 'gv-rendered-quote-line';
const QUOTE_EMPTY_LINE_CLASS = 'gv-rendered-quote-empty';
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
  wrappers: new Set<HTMLElement>(),
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

function decorateQuoteLine(line: HTMLElement): void {
  owned.lines.add(line);
  line.classList.add(QUOTE_LINE_CLASS);
  line.classList.toggle(QUOTE_EMPTY_LINE_CLASS, isEmptyQuoteLine(line));
  addHiddenQuoteMarker(line);
}

function unwrapQuote(wrapper: HTMLElement): void {
  owned.wrappers.delete(wrapper);
  const parent = wrapper.parentNode;
  if (!parent) return;

  const fragment = document.createDocumentFragment();
  while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
  parent.insertBefore(fragment, wrapper);
  wrapper.remove();
}

function rebuildContainer(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(`:scope > .${QUOTE_WRAPPER_CLASS}`).forEach(unwrapQuote);

  let current = container.firstElementChild;
  while (current) {
    if (!(current instanceof HTMLElement) || !current.matches(USER_LINE_SELECTOR)) {
      current = current.nextElementSibling;
      continue;
    }

    if (!isQuoteLine(current)) {
      current.classList.remove(QUOTE_LINE_CLASS, QUOTE_EMPTY_LINE_CLASS);
      current = current.nextElementSibling;
      continue;
    }

    const wrapper = document.createElement('blockquote');
    wrapper.className = QUOTE_WRAPPER_CLASS;
    owned.wrappers.add(wrapper);
    container.insertBefore(wrapper, current);

    while (
      current instanceof HTMLElement &&
      current.matches(USER_LINE_SELECTOR) &&
      isQuoteLine(current)
    ) {
      const next: Element | null = current.nextElementSibling;
      decorateQuoteLine(current);
      wrapper.appendChild(current);
      current = next;
    }
  }
}

function containerNeedsRebuild(container: HTMLElement): boolean {
  const directQuoteLine = Array.from(container.children).some(
    (child) =>
      child instanceof HTMLElement && child.matches(USER_LINE_SELECTOR) && isQuoteLine(child),
  );
  if (directQuoteLine) return true;

  const wrappers = Array.from(
    container.querySelectorAll<HTMLElement>(`:scope > .${QUOTE_WRAPPER_CLASS}`),
  );
  if (
    wrappers.some((wrapper) =>
      Array.from(wrapper.children).some(
        (child) =>
          !(child instanceof HTMLElement) ||
          !child.matches(USER_LINE_SELECTOR) ||
          !isQuoteLine(child),
      ),
    )
  ) {
    return true;
  }

  return wrappers.some((wrapper) => {
    const previous = wrapper.previousElementSibling;
    const next = wrapper.nextElementSibling;
    return (
      previous?.classList.contains(QUOTE_WRAPPER_CLASS) ||
      next?.classList.contains(QUOTE_WRAPPER_CLASS)
    );
  });
}

function collectUserLineContainers(): Set<HTMLElement> {
  const containers = new Set<HTMLElement>();

  document.querySelectorAll<HTMLElement>(USER_LINE_SELECTOR).forEach((line) => {
    const wrapper = line.closest<HTMLElement>(`.${QUOTE_WRAPPER_CLASS}`);
    const container = wrapper?.parentElement ?? line.parentElement;
    if (container) containers.add(container);
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
  collectUserLineContainers().forEach((container) => {
    if (containerNeedsRebuild(container)) rebuildContainer(container);

    container
      .querySelectorAll<HTMLElement>(`:scope > .${QUOTE_WRAPPER_CLASS} > ${USER_LINE_SELECTOR}`)
      .forEach(decorateQuoteLine);
  });

  renderQuotedComposerLines();
}

// The body observer sees every record Gemini produces, including each row the
// sidebar appends while paginating. Match by selector only: resolving the live
// input measures layout, and doing that per record slows long histories (#1040).
const QUOTE_RELEVANT_SELECTOR = `${USER_LINE_SELECTOR}, .${QUOTE_WRAPPER_CLASS}, ${CHAT_INPUT_SELECTOR}`;

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
  Array.from(owned.wrappers).filter(select).forEach(unwrapQuote);
  Array.from(owned.markers).filter(select).forEach(restoreMarker);
  Array.from(owned.lines)
    .filter(select)
    .forEach((line) => {
      owned.lines.delete(line);
      line.classList.remove(QUOTE_LINE_CLASS, QUOTE_EMPTY_LINE_CLASS);
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
    const selector = getGeminiSelectorView().remoteKeys.has('composer.candidates')
      ? `${QUOTE_RELEVANT_SELECTOR}, ${NATIVE_EDITABLE_SELECTOR}`
      : QUOTE_RELEVANT_SELECTOR;
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
