/**
 * Preview search marks in the host transcript, and how the engine tells its
 * own DOM edits (search marks, message timestamps) from the host's, so they
 * never trigger a marker recalc.
 */

export const SEARCH_HIGHLIGHT_CLASS = 'timeline-search-highlight';
const SELF_INJECTED = `.gv-timestamp, .${SEARCH_HIGHLIGHT_CLASS}`;

/** Unwrap every search mark under `container`, restoring its text. */
export function clearSearchHighlights(container: ParentNode | null): void {
  const marks = container?.querySelectorAll(`mark.${SEARCH_HIGHLIGHT_CLASS}`);
  if (!marks) return;
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });
}

/** Wrap each case-insensitive match of `query` inside the elements in a search mark. */
export function highlightSearchText(elements: Iterable<HTMLElement>, query: string): void {
  const lowerQuery = query.toLowerCase();
  for (const element of elements) {
    if (!element) continue;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const matches: { node: Text; index: number }[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.textContent?.toLowerCase().indexOf(lowerQuery) ?? -1;
      if (idx !== -1) matches.push({ node, index: idx });
    }
    // Process in reverse to keep offsets stable
    for (let i = matches.length - 1; i >= 0; i--) {
      const { node: textNode, index: matchIdx } = matches[i];
      const after = textNode.splitText(matchIdx + query.length);
      const matchText = textNode.splitText(matchIdx);
      const mark = document.createElement('mark');
      mark.className = SEARCH_HIGHLIGHT_CLASS;
      mark.textContent = matchText.textContent;
      matchText.parentNode!.replaceChild(mark, matchText);
      // keep reference to 'after' to avoid TS unused warning
      void after;
    }
  }
}

export function isSelfInjectedMutationNode(node: Node): boolean {
  if (node instanceof HTMLElement) {
    return (
      node.classList.contains('gv-timestamp') ||
      node.classList.contains(SEARCH_HIGHLIGHT_CLASS) ||
      !!node.closest(SELF_INJECTED)
    );
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return !!node.parentElement?.closest(SELF_INJECTED);
  }

  return false;
}

/**
 * True when every record was caused by the timeline's own DOM injections
 * (message timestamps or search-highlight marks). Those mutations must not
 * re-trigger a full marker recalc.
 */
export function areSelfInjectedMutations(records: readonly MutationRecord[]): boolean {
  if (records.length === 0) return false;

  return records.every((record) => {
    if (record.type !== 'childList') return false;

    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    if (changedNodes.length === 0) return false;

    return changedNodes.every((node) => isSelfInjectedMutationNode(node));
  });
}

/**
 * Whether records taken right after a highlight edit hold a host change.
 * Highlighting splits text nodes inside message elements, so plain text-node
 * changes count as the timeline's own within that synchronous window only.
 */
export function hasForeignHighlightRecords(records: readonly MutationRecord[]): boolean {
  return records.some((record) => {
    if (record.type !== 'childList') return true;
    const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
    return changedNodes.some(
      (node) => node.nodeType !== Node.TEXT_NODE && !isSelfInjectedMutationNode(node),
    );
  });
}
