import { nativeDomDecorations } from '@/core/services/NativeDomDecorationService';
import { isEditable } from '@/core/services/composer/find';

// Native ownership and Voyager's own decorations are packaged protocol, never remote aliases.
const MAIN_OWNER = '.text-input-field, .input-area, input-area, input-area-v2, input-container';
const OTHER_OWNER =
  '.edit-container, .user-query-container.edit-mode, [role="dialog"], dialog, user-query, model-response, [data-message-author-role], [data-gv-plugin]';
const NATIVE_DECORATIONS = new Set([
  'gv-input-collapsed',
  'gv-input-collapse-processed',
  'gv-input-vim-hud-composer-mount',
  'gv-input-vim-hud-mount',
  'gv-input-vim-mode-insert',
  'gv-input-vim-mode-normal',
  'gv-input-vim-mode-visual',
  'gv-pm-slash-textarea-has-token',
  'gv-pm-slash-textarea-hide-value',
  'gv-pm-slash-prompt-only-selection',
  'gv-pm-slash-contenteditable-hide-value',
]);

export function hasVoyagerOwner(input: Element, host?: Element): boolean {
  const doc = input.ownerDocument;
  // Page markers and wrappers outside a proved host must not turn its native content into Voyager UI.
  for (
    let node: Element | null = input;
    node && node !== host && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    if (
      node.matches('[data-gv-component], [data-gv-layer], [data-gv-plugin]') ||
      Array.from(node.classList).some(
        (name) =>
          name.startsWith('gv-') &&
          !NATIVE_DECORATIONS.has(name) &&
          !nativeDomDecorations.has(node!, name),
      )
    )
      return true;
  }
  return false;
}

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
      !hasVoyagerOwner(input),
  );
}
