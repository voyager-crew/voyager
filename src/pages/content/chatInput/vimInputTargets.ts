import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { GEMINI_VIM_PROFILE_KEYS } from '@/core/gemini/selectors/vimKeys';
import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/vim-packaged.json';

import { resolveConfiguredComposer, isVisibleHudMount } from './vimConfiguredComposer';
import type { ResolveVimComposer } from './vimGeminiComposer';

export { resolveConfiguredComposer, isVisibleHudMount } from './vimConfiguredComposer';
import { findChatInput } from './index';

interface FindVimInputOptions {
  requireVisible?: boolean;
  target?: HTMLElement | null;
}

const EDITABLE_SELECTOR = packaged['vim.editable'].join(',');
const EDIT_PROMPT_SELECTOR = packaged['vim.editInputs'].join(',');
const SEND_BUTTON_SELECTOR = packaged['vim.sendTarget'].join(',');

export function isEditableTarget(element: HTMLElement | null): boolean {
  if (!element) return false;
  return element.matches(EDITABLE_SELECTOR) || Boolean(element.closest(EDITABLE_SELECTOR));
}

export function isEditPromptInput(element: HTMLElement): boolean {
  return element.matches(EDIT_PROMPT_SELECTOR);
}

export function getSendButtonTarget(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;

  const matched = element.closest(SEND_BUTTON_SELECTOR);
  if (!(matched instanceof HTMLElement)) return null;

  const button = matched.closest('button');
  return button instanceof HTMLElement ? button : matched;
}

export function createVimInputTargets(
  getConfiguredSelector: () => string | null,
  resolveComposer?: ResolveVimComposer,
) {
  function locateChatInput(options: { requireVisible?: boolean } = {}): HTMLElement | null {
    if (resolveComposer) {
      return resolveComposer({ doc: document, requireVisible: options.requireVisible ?? true })
        .element;
    }
    const configuredComposerSelector = getConfiguredSelector();
    if (configuredComposerSelector) {
      const configured = resolveConfiguredComposer(configuredComposerSelector, options);
      if (configured) return configured;
    }
    return findChatInput(options);
  }

  function findEditPromptInput(requireVisible = true): HTMLElement | null {
    let fallback: HTMLElement | null = null;

    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>(EDIT_PROMPT_SELECTOR),
    )) {
      if (!fallback && element.isConnected) fallback = element;
      if (isVisibleHudMount(element)) return element;
    }

    return requireVisible ? null : fallback;
  }

  function findVimInputFromTarget(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null;

    const editable = element.matches(EDITABLE_SELECTOR)
      ? element
      : element.closest<HTMLElement>(EDITABLE_SELECTOR);
    if (!editable) {
      // OFF keeps unrelated focus and key events out of composer style/layout queries.
      const view = getGeminiSelectorView();
      if (!GEMINI_VIM_PROFILE_KEYS.some((key) => view.remoteKeys.has(key))) return null;
      const accepted = resolveComposer?.({ doc: element.ownerDocument, requireVisible: false });
      // A repaired native editable still owns its events when its new markup misses the legacy union.
      if (
        accepted &&
        (accepted.view.remoteKeys.has('vim.candidates') ||
          accepted.view.remoteKeys.has('vim.configuredComposer')) &&
        accepted.element &&
        (accepted.element === element || accepted.element.contains(element))
      )
        return accepted.element;
      return null;
    }

    if (isEditPromptInput(editable)) return editable;

    const input = locateChatInput({ requireVisible: false });
    return input && (editable === input || input.contains(editable)) ? input : null;
  }

  function findVimInput(options: FindVimInputOptions = {}): HTMLElement | null {
    const requireVisible = options.requireVisible ?? true;
    const activeElement =
      options.target ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const targetedInput = findVimInputFromTarget(activeElement);

    if (targetedInput && (!requireVisible || isVisibleHudMount(targetedInput))) {
      return targetedInput;
    }

    const editInput = findEditPromptInput(true);
    if (editInput) return editInput;

    const chatInput = locateChatInput();
    if (chatInput) return chatInput;

    if (requireVisible) return null;
    return findEditPromptInput(false) ?? locateChatInput({ requireVisible: false });
  }

  return { findVimInput, findVimInputFromTarget };
}
