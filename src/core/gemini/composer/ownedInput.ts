import { isEditable } from '@/core/services/composer/find';

import { hasGeminiBoundaryConflict } from '../domBoundary';
import { hasVoyagerOwner } from './voyagerOwner';

// Native ownership and Voyager's own decorations are packaged protocol, never remote aliases.
const MAIN_OWNER = '.text-input-field, .input-area, input-area, input-area-v2, input-container';
const OTHER_OWNER =
  '.edit-container, .user-query-container.edit-mode, user-query, model-response, [data-message-author-role], [data-gv-plugin]';
export { hasVoyagerOwner } from './voyagerOwner';

/** Identity survives collapsing and HUD/token decoration; each owner retains its visibility policy. */
export function findOwnedGeminiMainInputs(doc: Document): HTMLElement[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
    ),
  ).filter(
    (input) =>
      isEditable(input) &&
      input.closest(MAIN_OWNER) &&
      !input.closest(OTHER_OWNER) &&
      !hasGeminiBoundaryConflict(input, input.closest(MAIN_OWNER), 'dialog, [role="dialog"]') &&
      !hasVoyagerOwner(input),
  );
}
