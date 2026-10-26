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

function hasVoyagerOwner(input: HTMLElement): boolean {
  const doc = input.ownerDocument;
  // Page-wide theme/RTL markers describe all native content, not a Voyager editor.
  for (
    let node: HTMLElement | null = input;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    if (
      Array.from(node.classList).some(
        (name) => name.startsWith('gv-') && !NATIVE_DECORATIONS.has(name),
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
