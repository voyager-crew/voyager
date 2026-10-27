import { hasVoyagerOwner } from '../gemini/composer/ownedInput';
import { sameItems } from '../utils/array';
import { getBundledSiteSelectorView } from './bundle';
import { preservesCompleteContent } from './contentIntegrity';
import { hasForeignPageOwner } from './pageProofBoundary';
import { placementSelector } from './placement';
import type { SiteSelectorView } from './types';

const TURN_KEYS = ['userTurn', 'assistantTurn'] as const;
const FOREIGN = 'dialog, [role="dialog"], [role="alertdialog"], form';

/** Role and identity attributes are native evidence, never supplied by the catalog. */
function provesTurns(doc: Document, view: SiteSelectorView): boolean {
  const bundle = getBundledSiteSelectorView('chatgpt');
  for (const key of TURN_KEYS) {
    const candidates = Array.from(doc.querySelectorAll(view.profiles[key].join(',')));
    const native = Array.from(doc.querySelectorAll(bundle.profiles[key].join(',')));
    if (sameItems(candidates, native)) continue;
    const role = key === 'userTurn' ? 'user' : 'assistant';
    const ownerSelector = `[data-chatgpt-search-unit-key$=":${role}"], [data-message-author-role="${role}"], [data-message-role="${role}"]`;
    const owners = Array.from(doc.querySelectorAll(ownerSelector)).filter(
      (owner) => !owner.parentElement?.closest(ownerSelector),
    );
    // A partial list cannot change turn order or attach a saved star to a different prompt.
    if (!candidates.length || candidates.length !== owners.length) return false;
    if (native.some((node) => !candidates.includes(node))) return false;
    for (const [index, candidate] of candidates.entries()) {
      const owner = owners[index];
      if (
        hasVoyagerOwner(candidate) ||
        hasForeignPageOwner(candidate, FOREIGN) ||
        candidate.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')
      )
        return false;
      if (candidate.closest(ownerSelector) !== owner) return false;
      if (
        !preservesCompleteContent(candidate, owner, (node) =>
          node.matches('h4[data-conversation-role]'),
        )
      )
        return false;
    }
  }
  return true;
}

/** Every ChatGPT turn consumer gets the same complete, independently owned pair of profiles. */
export function guardedChatgptSemanticSelector(
  key: string,
  view: SiteSelectorView,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): string | undefined {
  const bundle = getBundledSiteSelectorView('chatgpt');
  const fallback = bundle.profiles[key]?.join(',');
  if (!doc) return fallback;
  if (key === 'headerActions') return placementSelector(view, key, doc);
  if (
    !TURN_KEYS.some((turn) => turn === key) ||
    !TURN_KEYS.some((turn) => view.remoteKeys.has(turn))
  )
    return view.profiles[key]?.join(',');
  try {
    return provesTurns(doc, view) ? view.profiles[key]?.join(',') : fallback;
  } catch {
    return fallback;
  }
}
