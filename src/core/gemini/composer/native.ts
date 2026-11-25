import { isEditable } from '@/core/services/composer/find';

import { hasGeminiBoundaryConflict } from '../domBoundary';
import { hasVoyagerOwner, MAIN_OWNER, OTHER_OWNER } from './ownedInput';

// Independent native ownership and editing protocols, never downloaded locator data.
const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';

/** CSS-hidden controls can still have an offsetParent, so layout alone cannot prove visibility. */
export function isNativeComposerElementVisible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(node);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

/** Only remote proofs use these checks; bundled readers retain their original behavior. */
export function isNativeComposerInput(element: HTMLElement): boolean {
  if (
    !isEditable(element) ||
    element.closest(OTHER_OWNER) ||
    hasGeminiBoundaryConflict(element, element.closest(MAIN_OWNER), 'dialog, [role="dialog"]') ||
    hasVoyagerOwner(element)
  )
    return false;
  return isNativeComposerElementVisible(element) && element.getBoundingClientRect().height > 0;
}

export function findNativeMainInputs(doc: Document): HTMLElement[] {
  // Quote insertion and draft persistence must agree on which renamed main field they own.
  return Array.from(doc.querySelectorAll<HTMLElement>(EDITABLE)).filter(
    (element) => element.closest(MAIN_OWNER) && isNativeComposerInput(element),
  );
}
