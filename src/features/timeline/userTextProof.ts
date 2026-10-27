import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getGeminiSelectorView, getBundledGeminiSelectorView } from '@/core/gemini/selectors';
import { acceptsGeminiTurnView, readGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { getBundledSiteSelectorView, getSiteSelectorView } from '@/core/selectors';
import { guardedChatgptSemanticSelector } from '@/core/selectors/chatgptSemantics';
import { hasForeignPageOwner } from '@/core/selectors/pageProofBoundary';

/** Attachment names are metadata, never independent evidence of the authored prompt. */
export const USER_TEXT_ATTACHMENT_PREVIEW = 'user-query-file-preview';

/** Preserve every authored line even when its original text wrapper disappears. */
export function isCompleteUserText(candidate: string, reference: string): boolean {
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const actual = normalize(candidate);
  const expected = normalize(reference);
  if (!actual) return false;
  return actual === expected;
}

export function ownsTimelineUserText(element: HTMLElement, site: string): boolean {
  const doc = element.ownerDocument;
  if (
    hasVoyagerOwner(element) ||
    hasForeignPageOwner(element, 'form, [role="dialog"], [role="alertdialog"], dialog') ||
    element.closest('[contenteditable]:not([contenteditable="false"]), input, textarea, select')
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
