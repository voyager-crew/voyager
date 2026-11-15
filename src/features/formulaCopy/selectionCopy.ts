import { extractQuoteText } from './extractQuoteText';
import { FORMULA_TARGET_SELECTOR } from './formulaSource';

interface ClipboardWriter {
  setData(type: string, data: string): void;
}

function formulaHost(node: Node): Element | null {
  let current = node instanceof Element ? node : node.parentElement;
  let found: Element | null = null;
  while (current) {
    if (current.matches(FORMULA_TARGET_SELECTOR)) found = current;
    current = current.parentElement;
  }
  return found;
}

function inEditingHost(node: Node): boolean {
  // jsdom leaves isContentEditable unset, so read the attribute the composer sets.
  let current = node instanceof Element ? node : node.parentElement;
  while (current) {
    if (current.tagName === 'INPUT' || current.tagName === 'TEXTAREA') return true;
    const editable = current.getAttribute('contenteditable');
    if (editable !== null && editable.toLowerCase() !== 'false') return true;
    current = current.parentElement;
  }
  return false;
}

function rangeIntersectsFormula(range: Range): boolean {
  if (formulaHost(range.startContainer) || formulaHost(range.endContainer)) return true;
  const root = range.commonAncestorContainer;
  const scope = root instanceof Element ? root : root.parentElement;
  if (!scope) return false;
  for (const formula of scope.querySelectorAll(FORMULA_TARGET_SELECTOR)) {
    if (range.intersectsNode(formula)) return true;
  }
  return false;
}

/** Cover a formula the selection only cuts through, without touching the live range. */
function expandToWholeFormulas(range: Range): Range {
  const expanded = range.cloneRange();
  const startFormula = formulaHost(expanded.startContainer);
  if (startFormula) expanded.setStartBefore(startFormula);
  const endFormula = formulaHost(expanded.endContainer);
  if (endFormula) expanded.setEndAfter(endFormula);
  return expanded;
}

function fragmentHtml(fragment: DocumentFragment): string {
  const holder = fragment.ownerDocument.createElement('div');
  holder.append(fragment);
  return holder.innerHTML;
}

function hasClipboardData(event: Event): event is Event & { clipboardData: unknown } {
  return 'clipboardData' in event;
}

function isClipboardWriter(value: object): value is ClipboardWriter {
  return 'setData' in value && typeof value.setData === 'function';
}

function clipboardWriter(event: Event): ClipboardWriter | null {
  if (!hasClipboardData(event)) return null;
  const data = event.clipboardData;
  if (typeof data !== 'object' || data === null || !isClipboardWriter(data)) return null;
  return data;
}

/**
 * Replace a user copy with LaTeX plain text plus the original selection HTML.
 * HTML stays on the unexpanded range so a rich paste keeps the fragment the
 * browser would have written. A miss, an empty reading, or a throw leaves the
 * event alone.
 */
export function writeSelectionCopy(event: Event, selection: Selection | null): void {
  const clipboard = clipboardWriter(event);
  if (!clipboard || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  const ranges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (!range.collapsed) ranges.push(range);
  }
  if (ranges.length === 0) return;
  if (
    ranges.some((range) => inEditingHost(range.startContainer) || inEditingHost(range.endContainer))
  ) {
    return;
  }
  if (!ranges.some(rangeIntersectsFormula)) return;

  try {
    const texts: string[] = [];
    const htmls: string[] = [];
    for (const range of ranges) {
      texts.push(extractQuoteText(expandToWholeFormulas(range)));
      htmls.push(fragmentHtml(range.cloneContents()));
    }
    const text = texts.join('\n');
    if (!text.trim()) return;
    clipboard.setData('text/plain', text);
    clipboard.setData('text/html', htmls.join('\n'));
    event.preventDefault();
  } catch {
    // Native copy remains.
  }
}
