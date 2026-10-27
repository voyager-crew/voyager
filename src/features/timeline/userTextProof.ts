import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getGeminiSelectorView, getBundledGeminiSelectorView } from '@/core/gemini/selectors';
import { acceptsGeminiTurnView, readGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { getBundledSiteSelectorView, getSiteSelectorView } from '@/core/selectors';
import { guardedChatgptSemanticSelector } from '@/core/selectors/chatgptSemantics';

/** Preserve the complete known prompt; without it, only a whole-word turn prefix is evidence. */
export function isCompleteUserText(
  candidate: string,
  reference: string,
  hasBundledContent: boolean,
): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const actual = normalize(candidate);
  const expected = normalize(reference);
  if (!actual) return false;
  return hasBundledContent
    ? actual === expected
    : expected === actual || expected.startsWith(`${actual} `);
}

export function ownsTimelineUserText(element: HTMLElement, site: string): boolean {
  const doc = element.ownerDocument;
  if (
    hasVoyagerOwner(element) ||
    element.closest(
      'form, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], dialog, input, textarea, select',
    )
  )
    return false;
  if (site === 'gemini') {
    const view = getGeminiSelectorView();
    const accepted = acceptsGeminiTurnView(view, doc) ? view : getBundledGeminiSelectorView();
    return readGeminiTurnCollection(accepted, doc, true).users.some(
      (turn) => turn === element || turn.contains(element),
    );
  }
  const selector =
    site === 'chatgpt'
      ? guardedChatgptSemanticSelector('userTurn', getSiteSelectorView(site), doc)
      : getBundledSiteSelectorView(site).profiles.userTurn?.join(',');
  return !!selector && !!element.closest(selector);
}
