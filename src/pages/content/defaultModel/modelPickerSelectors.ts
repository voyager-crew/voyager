import {
  getBundledGeminiSelectorView,
  getGeminiSelectorView,
  resolveGeminiSelectorOperationInView,
  type GeminiSelectorView,
} from '@/core/gemini/selectors';
import type { GeminiModelPickerProfileKey } from '@/core/gemini/selectors/modelPickerKeys';

export function pickerSelector(view: GeminiSelectorView, key: GeminiModelPickerProfileKey): string {
  return view.profiles[key].join(', ');
}

/** The callers that previously used ??/for loops retain selector priority. */
export function firstPickerMatch(
  root: ParentNode,
  view: GeminiSelectorView,
  key: GeminiModelPickerProfileKey,
): HTMLElement | null {
  for (const selector of view.profiles[key]) {
    const found = root.querySelector<HTMLElement>(selector);
    if (!found) continue;
    if (hasRemotePickerProfile(view) && !(found instanceof HTMLElement)) {
      throw new Error('Non-HTML picker candidate');
    }
    return found;
  }
  return null;
}

export function hasRemotePickerProfile(view: GeminiSelectorView): boolean {
  return [...view.remoteKeys].some((key) => key.startsWith('modelPicker.'));
}

export function readPickerPill(button: HTMLElement | null): string[] {
  return (button?.innerText ?? button?.textContent ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function findModelFocusInput(): HTMLElement | null {
  const current = getGeminiSelectorView();
  return resolveGeminiSelectorOperationInView(
    current.remoteKeys.has('modelPicker.focusInput') ? current : getBundledGeminiSelectorView(),
    (view) => {
      const remote = view.remoteKeys.has('modelPicker.focusInput');
      const nativeComposer = remote ? findBundledFocusInput() : null;
      for (const selector of view.profiles['modelPicker.focusInput']) {
        for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
          if (!candidate.isConnected) continue;
          if (candidate instanceof HTMLTextAreaElement && candidate.disabled) continue;
          // A remote match must still be the packaged composer's editable surface.
          if (remote && !isNativeComposer(candidate, nativeComposer)) continue;
          return candidate;
        }
      }
      return null;
    },
    (value) => value !== null,
  ).value;
}

function findBundledFocusInput(): HTMLElement | null {
  const bundle = getBundledGeminiSelectorView();
  for (const selector of bundle.profiles['modelPicker.focusInput']) {
    for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
      if (!candidate.isConnected) continue;
      if (candidate instanceof HTMLTextAreaElement && candidate.disabled) continue;
      return candidate;
    }
  }
  return null;
}

function isNativeComposer(candidate: HTMLElement, preferred: HTMLElement | null): boolean {
  if (!(candidate instanceof HTMLElement)) return false;
  const editable =
    candidate instanceof HTMLTextAreaElement ||
    candidate.getAttribute('contenteditable') === 'true';
  if (!editable || candidate.closest('[role="dialog"], [role="menu"], [role="menuitem"]')) {
    return false;
  }
  if (preferred) return candidate === preferred;
  return Boolean(candidate.closest('rich-textarea, .input-area'));
}
