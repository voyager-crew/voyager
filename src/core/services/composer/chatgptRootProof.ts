import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledSiteSelectorView } from '@/core/selectors/bundle';

import { isEditable } from './find';
import { hasSiteContentOwner, ownedSiteInputs } from './siteInputReads';

const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';
const FOREIGN =
  '[role="dialog"], [role="alertdialog"], dialog, nav, aside, [data-turn-key], [data-message-author-role], [data-chatgpt-search-unit-key], [data-chatgpt-selection-message-id]';

/** A renamed owner must contain the independently identified editor and its unique native submit. */
export function provesChatgptComposerRoot(
  doc: Document,
  selector: string,
  field: HTMLElement,
  root: Element,
): boolean {
  const roots = Array.from(doc.querySelectorAll(selector));
  if (roots.length !== 1 || roots[0] !== root) return false;
  if (
    root.matches('html, body, main') ||
    root.closest(FOREIGN) ||
    root.querySelector(FOREIGN) ||
    hasVoyagerOwner(field) ||
    hasSiteContentOwner('chatgpt', field)
  )
    return false;
  const fields = Array.from(root.querySelectorAll<HTMLElement>(EDITABLE));
  if (fields.length !== 1 || fields[0] !== field || !isEditable(field)) return false;
  const bundled = getBundledSiteSelectorView('chatgpt');
  const original = Array.from(doc.querySelectorAll(bundled.profiles.composer.join(',')));
  const proven = original.length ? original : ownedSiteInputs('chatgpt', doc);
  if (proven.length !== 1 || proven[0] !== field) return false;
  const submits = root.querySelectorAll<HTMLButtonElement>('button[type="submit"]');
  // Preserve enclosing upload owners without letting a sibling form lend its submit button.
  return submits.length === 1 && submits[0].form === field.closest('form');
}
