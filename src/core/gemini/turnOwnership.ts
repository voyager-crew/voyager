import { hasVoyagerOwner } from './composer/ownedInput';
import { hasGeminiBoundaryConflict } from './domBoundary';

/** Transcript proof excludes copied conversations in editors, dialogs and Voyager previews. */
export function isOriginalGeminiTranscriptElement(element: Element): boolean {
  return (
    !hasVoyagerOwner(element) &&
    !element.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
    ) &&
    !hasGeminiBoundaryConflict(
      element,
      element.closest('chat-window, .conversation-container'),
      'form, dialog, [role="dialog"], [role="alertdialog"], [role="menu"]',
    )
  );
}
