/**
 * Which composer a slash event belongs to: the page's own chat input, never a
 * Voyager surface, and for a send button the composer it sends.
 */
import { CHAT_INPUT_SELECTOR, findChatInput } from '../chatInput/index';

const SEND_COMPOSER_SELECTOR =
  'form, .text-input-field, .input-area, ms-prompt-input-wrapper, chat-message';

export function inputFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('.gv-pm-panel, .gv-pm-slash-root, .gv-pm-slash-tooltip')) return null;
  const input = target.closest<HTMLElement>(CHAT_INPUT_SELECTOR);
  if (!input) return null;
  if (findChatInput({ requireVisible: false }) !== input) return null;
  if (input instanceof HTMLTextAreaElement) return input;
  if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') return input;
  return null;
}

export function findPromptInputForSendButton(
  button: HTMLElement,
  hasPrompt: (input: HTMLElement) => boolean,
): HTMLElement | null {
  let ancestor = button.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (ancestor.matches(SEND_COMPOSER_SELECTOR)) {
      const input = Array.from(ancestor.querySelectorAll<HTMLElement>(CHAT_INPUT_SELECTOR)).find(
        (candidate) => hasPrompt(candidate),
      );
      if (input) return input;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}
