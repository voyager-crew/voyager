import { createPackageIcon } from '@/core/icons/promptManagerIcons';
import type { PromptScheme } from '@/features/prompt/PromptSiteAdapter';

import {
  type PromptQuery,
  type TokenPrompt,
  TOKEN_CLASS,
  TOKEN_SPACER,
  createQueryRange,
  setCaretAfter,
  dispatchInput,
} from './slashComposerText';
import { applyPromptTokenColor } from './slashTheme';
type BindPreview = (target: HTMLElement, text: string) => void;

function createPromptToken(
  prompt: TokenPrompt,
  bindPreview: BindPreview,
  scheme: PromptScheme,
): HTMLSpanElement {
  const token = document.createElement('span');
  token.className = TOKEN_CLASS;
  token.contentEditable = 'false';
  token.dataset.gvPromptId = prompt.id;
  token.dataset.gvPromptName = prompt.name!.trim();
  token.dataset.gvPromptText = prompt.text;
  if (prompt.gvSourceText) token.dataset.gvPromptSource = prompt.gvSourceText;
  token.setAttribute('role', 'button');
  token.setAttribute('aria-label', prompt.name!.trim());
  // The icon carries no text, so everything that reads this token by its text -
  // `expandPromptTokens`, `isTextareaPromptOnlyValue`, `readText` - still sees
  // exactly the prompt's name.
  token.append(createPackageIcon(14), prompt.name!.trim());
  applyPromptTokenColor(token, scheme);
  bindPreview(token, prompt.text);
  return token;
}

export function replaceContentEditableQuery(
  query: PromptQuery,
  prompt: TokenPrompt,
  bindPreview: BindPreview,
  scheme: PromptScheme,
): boolean {
  const range = createQueryRange(query);
  if (!range) return false;
  range.deleteContents();
  const token = createPromptToken(prompt, bindPreview, scheme);
  range.insertNode(token);
  const spacer = document.createTextNode(TOKEN_SPACER);
  token.after(spacer);
  setCaretAfter(query.input, spacer);
  dispatchInput(query.input);
  return true;
}

export function replaceTextareaQuery(query: PromptQuery, prompt: TokenPrompt): boolean {
  const textarea = query.input as HTMLTextAreaElement;
  textarea.focus();
  textarea.setRangeText(`${prompt.name!.trim()}${TOKEN_SPACER}`, query.start, query.end, 'end');
  dispatchInput(textarea);
  return true;
}

export function getAtomicPromptGap(range: Range): string | null {
  const contents = range.cloneContents();
  if (contents.querySelector('*')) return null;
  const gap = contents.textContent || '';
  return gap === '' || gap === TOKEN_SPACER ? gap : null;
}

export function findPromptTokenBeforeCaret(
  input: HTMLElement,
  promptId: string,
  startOffset: number,
  caretRange: Range,
): { token: HTMLElement; start: number } | null {
  const candidates = Array.from(input.querySelectorAll<HTMLElement>(`.${TOKEN_CLASS}`))
    .filter((candidate) => candidate.dataset.gvPromptId === promptId)
    .map((token) => {
      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(input);
      prefixRange.setEndBefore(token);
      return { token, start: prefixRange.toString().length };
    });
  const candidatesBeforeCaret = candidates.filter(({ token }) => {
    const tokenRange = document.createRange();
    tokenRange.selectNode(token);
    return tokenRange.compareBoundaryPoints(Range.END_TO_END, caretRange) <= 0;
  });
  const exact = candidatesBeforeCaret.find((candidate) => candidate.start === startOffset);
  if (exact) return exact;
  return candidatesBeforeCaret.sort((left, right) => right.start - left.start)[0] || null;
}

export function isTextareaPromptOnlyValue(
  inputText: string,
  selected: { start: number; name: string }[],
): boolean {
  return (
    selected.length === 1 &&
    selected[0].start === 0 &&
    inputText === `${selected[0].name}${TOKEN_SPACER}`
  );
}
