/**
 * Where the user's focus was before the panel took it: the element and, in a
 * composer, the exact selection, so closing the panel puts the caret back.
 */
import { deepActiveElement } from '@/core/utils/composedTarget';

export interface FocusSnapshot {
  /** Focuses the element again and reselects what was selected. False when it left the page. */
  restore(): boolean;
}

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isTextField(element: Element): element is TextField {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  try {
    // Inputs without a selection (checkbox, number, …) report null.
    return element.selectionStart !== null;
  } catch {
    return false;
  }
}

function editingHost(element: Element): HTMLElement | null {
  return element instanceof HTMLElement && element.isContentEditable ? element : null;
}

function captureFieldSelection(field: TextField): () => void {
  const { selectionStart, selectionEnd, selectionDirection } = field;
  return () => {
    if (selectionStart === null || selectionEnd === null) return;
    field.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
  };
}

function captureEditableSelection(host: HTMLElement): () => void {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return () => {};
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  if (!anchorNode || !focusNode || !host.contains(anchorNode) || !host.contains(focusNode)) {
    return () => {};
  }
  return () => {
    // The composer may have re-rendered meanwhile; a detached node cannot take the caret.
    if (!host.contains(anchorNode) || !host.contains(focusNode)) return;
    try {
      document.getSelection()?.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    } catch {
      // An offset the edited text no longer has: keep where focus put the caret.
    }
  };
}

/** The focused element now; null when nothing on the page has focus. */
export function captureFocus(): FocusSnapshot | null {
  const element = deepActiveElement();
  if (!(element instanceof HTMLElement) || element === document.body) return null;
  const host = editingHost(element);
  const reselect = isTextField(element)
    ? captureFieldSelection(element)
    : host
      ? captureEditableSelection(host)
      : () => {};
  return {
    restore() {
      if (!element.isConnected) return false;
      element.focus({ preventScroll: true });
      reselect();
      return true;
    },
  };
}
