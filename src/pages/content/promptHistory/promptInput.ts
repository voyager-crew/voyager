/** Which editable elements are prompt inputs, and the text a capture reads from them. */
import { readChatInput } from '@/core/gemini/composer/inputs';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/prompt-history-packaged.json';

import { resolvePromptInputRead } from '../prompt/selectorInput';
import type { PromptHistoryType } from './storage';

const PROMPT_INPUT_SELECTOR = packaged['promptHistory.input'];
const EDIT_CONTAINER_SELECTOR = packaged['promptHistory.editOwner'];
const MAIN_COMPOSER_SELECTOR = packaged['promptHistory.mainOwner'];
const VOYAGER_UI_SELECTOR = '.gv-ph-panel, .gv-pm-panel, [role="dialog"]';

export function readInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement) return input.value;
  return input.innerText ?? input.textContent ?? '';
}

function isVoyagerInput(input: HTMLElement): boolean {
  return Boolean(input.closest(VOYAGER_UI_SELECTOR));
}

export function isPromptInput(input: HTMLElement): boolean {
  if (isVoyagerInput(input)) return false;
  if (input.closest(EDIT_CONTAINER_SELECTOR)) return true;
  if (input.closest(MAIN_COMPOSER_SELECTOR)) return true;
  return (
    resolvePromptInputRead('promptHistory.candidates', (selectors) =>
      readChatInput(selectors, { requireVisible: false }),
    ) === input
  );
}

export function promptTypeForInput(input: HTMLElement): PromptHistoryType {
  return input.closest(EDIT_CONTAINER_SELECTOR) ? 'edited' : 'sent';
}

export function inputFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const input = target.closest<HTMLElement>(PROMPT_INPUT_SELECTOR);
  return input && isPromptInput(input) ? input : null;
}

export function findFormPromptInput(form: HTMLFormElement): HTMLElement | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    form.contains(active) &&
    active.matches(PROMPT_INPUT_SELECTOR) &&
    isPromptInput(active)
  ) {
    return active;
  }
  return (
    Array.from(form.querySelectorAll<HTMLElement>(PROMPT_INPUT_SELECTOR)).find(isPromptInput) ??
    null
  );
}
