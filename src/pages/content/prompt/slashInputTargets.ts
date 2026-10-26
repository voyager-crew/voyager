import { readChatInput } from '@/core/gemini/composer/inputs';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/slash-packaged.json';

import { resolvePromptInputRead } from './selectorInput';
const SEND_COMPOSER_SELECTOR = packaged['slash.sendOwner'];

export function inputFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('.gv-pm-panel, .gv-pm-slash-root, .gv-pm-slash-tooltip')) return null;
  return resolvePromptInputRead('slash.candidates', (selectors) => {
    const input = target.closest<HTMLElement>(selectors.join(', '));
    if (!input) return null;
    if (readChatInput(selectors, { requireVisible: false }) !== input) return null;
    if (input instanceof HTMLTextAreaElement) return input;
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') return input;
    return null;
  });
}

export function findPromptInputForSendButton(
  button: HTMLElement,
  hasPrompt: (input: HTMLElement) => boolean,
): HTMLElement | null {
  return resolvePromptInputRead('slash.candidates', (selectors) => {
    let ancestor = button.parentElement;
    while (ancestor && ancestor !== document.body) {
      if (ancestor.matches(SEND_COMPOSER_SELECTOR)) {
        const input = Array.from(ancestor.querySelectorAll<HTMLElement>(selectors.join(', '))).find(
          (candidate) => hasPrompt(candidate),
        );
        if (input) return input;
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  });
}

export function findSlashFormInput(form: HTMLFormElement): HTMLElement | null {
  return resolvePromptInputRead('slash.candidates', (selectors) =>
    form.querySelector<HTMLElement>(selectors.join(', ')),
  );
}
export function isInsideSlashInput(target: Element): boolean {
  return Boolean(
    resolvePromptInputRead('slash.candidates', (selectors) =>
      target.closest<HTMLElement>(selectors.join(', ')),
    ),
  );
}

/** Teardown follows the same accepted editor after the host replaces a token's original node. */
export function findSlashTokenInput(token: HTMLElement): HTMLElement | null {
  return resolvePromptInputRead('slash.candidates', (selectors) =>
    token.closest<HTMLElement>(selectors.join(', ')),
  );
}
