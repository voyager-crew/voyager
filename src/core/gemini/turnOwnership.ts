import { hasVoyagerOwner } from './composer/ownedInput';

/** Transcript proof excludes copied conversations in editors, dialogs and Voyager previews. */
export function isOriginalGeminiTranscriptElement(element: Element): boolean {
  return (
    !hasVoyagerOwner(element) &&
    !element.closest(
      'form, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], dialog, [role="dialog"], [role="alertdialog"], [role="menu"]',
    )
  );
}
