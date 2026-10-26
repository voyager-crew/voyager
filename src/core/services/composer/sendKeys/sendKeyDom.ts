/**
 * DOM side of the Gemini / AI Studio send keys: find the send button that
 * belongs to an input and insert a newline the host editor accepts. Moved
 * verbatim from the legacy send behavior module; not pure.
 */
import { hasPendingComposerUpload } from '@/core/services/composer/sendGuards';
import {
  SEND_BUTTON_SELECTORS,
  isSendActionButton,
  isUnavailableSendControl,
} from '@/pages/content/sendBehavior/sendButton';
import { getTextOffset, setCaretPosition } from '@/pages/content/sendBehavior/utils';

export type EditableKind = 'contenteditable' | 'textarea';

/** INPUT elements are single-line (search, rename): their Enter keeps its default submit. */
export function editableKindOf(target: HTMLElement): EditableKind | null {
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
    return 'contenteditable';
  }
  if (target.tagName === 'TEXTAREA') return 'textarea';
  return null;
}

function isVisibleButton(element: Element): element is HTMLButtonElement {
  return element instanceof HTMLButtonElement && element.offsetParent !== null;
}

export function findSendContainer(
  inputElement: HTMLElement,
  containerSelectors: readonly string[],
): HTMLElement | null {
  let container: HTMLElement | null = null;
  for (const selector of containerSelectors) {
    const closest = inputElement.closest(selector);
    if (closest instanceof HTMLElement) {
      container = closest;
      break;
    }
  }

  return container;
}

/**
 * Find the send button associated with the current input element.
 *
 * Strategy:
 * 1. Container Search: Use `closest()` to find a known container (e.g. `.text-input-field`, `chat-message`).
 * 2. Scoped Button Search: Only search for buttons within the found container to avoid stale matches.
 */
export function findSendButton(
  inputElement: HTMLElement,
  containerSelectors: readonly string[],
): HTMLElement | null {
  return findSendButtonInContainer(findSendContainer(inputElement, containerSelectors));
}

/** Uses the unchanged packaged button order, upload checks and semantic fallback. */
export function findSendButtonInContainer(container: HTMLElement | null): HTMLElement | null {
  // Gemini renders a semantic progressbar inside the composer while an
  // attachment is still uploading. Its native Enter handler waits for that
  // state to clear, but a programmatic button click bypasses the guard.
  if (container && hasPendingComposerUpload(container)) return null;

  // Search for the button strictly WITHIN the container
  if (container) {
    for (const selector of SEND_BUTTON_SELECTORS) {
      try {
        const element = container.querySelector(selector);
        if (element instanceof HTMLElement) {
          // Gemini's gem-button wrapper does not forward click() to its inner button.
          const closestButton = element.closest('button') ?? element.querySelector('button');
          // Ensure the found button is still within our safe container boundary
          const button =
            closestButton && container.contains(closestButton) ? closestButton : element;

          if (
            button instanceof HTMLElement &&
            button.offsetParent !== null &&
            !isUnavailableSendControl(button)
          ) {
            return button;
          }
        }
      } catch {
        // Invalid selector, continue
      }
    }

    // Fallback search within container by localized labels or icon text
    const allButtons = container.querySelectorAll('button');
    for (const button of allButtons) {
      if (isVisibleButton(button) && isSendActionButton(button)) {
        return button;
      }
    }
  }

  return null;
}

/**
 * Insert a newline in a contenteditable element
 *
 * Gemini uses Quill editor (identified by class "ql-editor").
 * Direct DOM manipulation with <br> elements doesn't work well with Quill
 * because it manages its own DOM state.
 *
 * Strategy:
 * 1. First try document.execCommand - works in most browsers
 * 2. If that fails, simulate a Shift+Enter keypress which Quill handles natively
 */
function insertNewlineInContentEditable(target: HTMLElement): void {
  // Method 1: Try execCommand (deprecated but still works in most browsers)
  // This is the most reliable method for contenteditable elements
  const currentOffset = getTextOffset(target);

  // This might trigger a React re-render, creating a new DOM structure
  const success = document.execCommand('insertParagraph', false);
  if (success) {
    if (currentOffset !== null) {
      const newOffset = currentOffset + 1;
      const restoreCaret = () => setCaretPosition(target, newOffset);

      restoreCaret();
      requestAnimationFrame(restoreCaret);
    }

    // Trigger input event to notify listeners (ensure data sync)
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  // Method 2: Try insertHTML with a <br> tag
  const htmlSuccess = document.execCommand('insertHTML', false, '<br><br>');

  if (htmlSuccess) {
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Method 3: Simulate Shift+Enter keypress as fallback
  // This tells Quill to handle the newline in its own way
  const shiftEnterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

  target.dispatchEvent(shiftEnterEvent);
}

/**
 * Insert a newline in a textarea
 */
function insertNewlineInTextarea(textarea: HTMLTextAreaElement): void {
  // add this line to prevent focus loss in Angular's internal Textarea updates
  textarea.focus();
  const success = document.execCommand('insertText', false, '\n');

  if (!success) {
    // Fallback: direct value manipulation (loses undo history but guarantees insertion)
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.substring(0, start) + '\n' + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 1;
  }

  // Trigger input event to notify any listeners
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function insertNewline(target: HTMLElement, kind: EditableKind): void {
  if (kind === 'contenteditable') insertNewlineInContentEditable(target);
  else insertNewlineInTextarea(target as HTMLTextAreaElement);
}
