import conversation from '@/features/plugins/catalog/sites/gemini/selector-data/conversation.json';

import { getGeminiSelectorView, getBundledGeminiSelectorView } from '../selectors';
import { acceptsGeminiTurnView, readGeminiTurnCollection } from '../turnIntegrity';
import { isOriginalGeminiTranscriptElement } from '../turnOwnership';

/** A renamed conversation root must be the scrolling common ancestor of every proved turn. */
function remoteConversationRoot(doc: Document): HTMLElement | null {
  const view = getGeminiSelectorView();
  if (!view.remoteKeys.has('conversation.roots')) return null;
  const turns = readGeminiTurnCollection(
    acceptsGeminiTurnView(view, doc) ? view : getBundledGeminiSelectorView(),
    doc,
    false,
  );
  const nodes = [...turns.users, ...turns.assistants].filter(isOriginalGeminiTranscriptElement);
  if (!nodes.length) return null;
  let owner = nodes[0].parentElement;
  while (owner && !nodes.every((node) => owner?.contains(node))) owner = owner.parentElement;
  while (owner && owner !== doc.body && owner !== doc.documentElement) {
    const style = doc.defaultView?.getComputedStyle(owner);
    if (
      /^(auto|scroll|overlay)$/.test(style?.overflowY || style?.overflow || '') &&
      owner.scrollHeight > owner.clientHeight
    )
      break;
    owner = owner.parentElement;
  }
  if (!owner || owner === doc.body || owner === doc.documentElement) return null;
  // A partial transcript or preview must not become the root of an export.
  for (const selector of view.profiles['conversation.roots']) {
    const candidates = doc.querySelectorAll<HTMLElement>(selector);
    if (
      candidates.length === 1 &&
      candidates[0] === owner &&
      isOriginalGeminiTranscriptElement(candidates[0])
    )
      return candidates[0];
  }
  return null;
}
export function resolveGeminiConversationRoot(
  userSelectors: readonly string[],
  doc: Document = document,
): HTMLElement {
  const repaired = remoteConversationRoot(doc);
  if (repaired) return repaired;
  let first: HTMLElement | null = null;
  for (const selector of conversation['conversation.roots']) {
    const candidate = doc.querySelector<HTMLElement>(selector);
    if (!candidate) continue;
    first ??= candidate;
    if (
      userSelectors.length &&
      Array.from(candidate.querySelectorAll(userSelectors.join(','))).some(
        (node) => !node.closest('deep-research-immersive-panel'),
      )
    )
      return candidate;
  }
  return first ?? doc.body;
}
