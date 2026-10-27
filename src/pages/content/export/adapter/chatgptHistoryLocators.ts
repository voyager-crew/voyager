import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledSiteSelectorView, getSiteSelectorView } from '@/core/selectors';
import { hasForeignPageOwner } from '@/core/selectors/pageProofBoundary';

const TURN_IDS = '[data-turn-key], [data-turn-id-container]';
const FOREIGN = 'form, dialog, [role="dialog"], [role="alertdialog"]';
const THREAD_KEY = 'export.threadList';
const PENDING_KEY = 'export.historyPending';

function isTurn(node: Element): boolean {
  const key = node.getAttribute('data-turn-key')?.trim();
  const legacy = node.getAttribute('data-turn-id-container')?.trim();
  return !!(key || (legacy && !/-root(?::|$)/.test(legacy)));
}

function insideTurn(node: Element): boolean {
  for (let owner: Element | null = node; owner; owner = owner.parentElement) {
    if (isTurn(owner)) return true;
  }
  return false;
}

/** Native IDs prove completeness; a remote list cannot hide an older mounted turn. */
function provesLists(candidates: Element[], selector: string, fallback: string): boolean {
  return (
    candidates.length > 0 &&
    candidates.every((candidate) => {
      const owner = candidate.closest('main, [role="main"]');
      if (
        !owner ||
        candidate === owner ||
        hasForeignPageOwner(candidate, FOREIGN) ||
        candidate.closest('[contenteditable], input, textarea') ||
        hasVoyagerOwner(candidate)
      )
        return false;
      const native = Array.from(owner.querySelectorAll(fallback));
      if (native.length && (native.length !== 1 || native[0] !== candidate)) return false;
      if (owner.querySelectorAll(selector).length !== 1) return false;
      const turns = Array.from(owner.querySelectorAll(TURN_IDS)).filter(isTurn);
      return (
        turns.length > 0 &&
        turns.every((turn) => candidate.contains(turn)) &&
        !candidate.querySelector('dialog, [role="dialog"], [role="alertdialog"], [role="menu"]') &&
        !Array.from(candidate.querySelectorAll('form, nav, aside, [role="navigation"]')).some(
          (node) => !turns.some((turn) => turn.contains(node)),
        )
      );
    })
  );
}

export function chatgptThreadListSelector(root: ParentNode = document): string {
  const bundle = getBundledSiteSelectorView('chatgpt');
  const fallback = bundle.profiles[THREAD_KEY].join(',');
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(THREAD_KEY)) return fallback;
  const doc = root instanceof Document ? root : (root.ownerDocument ?? document);
  try {
    const selector = view.profiles[THREAD_KEY].join(',');
    return provesLists(Array.from(doc.querySelectorAll(selector)), selector, fallback)
      ? selector
      : fallback;
  } catch {
    return fallback;
  }
}

function precedesTurn(status: Element, first: Element | null): boolean {
  return !first || !!(status.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** A history marker belongs before the turn list, never to a reply or another page operation. */
export function chatgptHistoryPendingSelector(scope: ParentNode, first: Element | null): string {
  const bundle = getBundledSiteSelectorView('chatgpt');
  const fallback = bundle.profiles[PENDING_KEY].join(',');
  const view = getSiteSelectorView('chatgpt');
  if (!view.remoteKeys.has(PENDING_KEY)) return fallback;
  try {
    const selector = view.profiles[PENDING_KEY].join(',');
    const candidates = Array.from(scope.querySelectorAll(selector));
    const list = first?.closest(chatgptThreadListSelector(first));
    if (!list || !candidates.length) return fallback;
    const valid = candidates.every(
      (node) =>
        list.contains(node) &&
        !insideTurn(node) &&
        !Array.from(node.querySelectorAll(TURN_IDS)).some(isTurn) &&
        !hasForeignPageOwner(node, FOREIGN) &&
        !node.closest('[contenteditable], input, textarea') &&
        !hasVoyagerOwner(node) &&
        precedesTurn(node, first) &&
        node.matches('[role="status"], [aria-busy="true"]'),
    );
    // Keep the native loading floor: a partial repair must not let the crawl finish early.
    const native = Array.from(list.querySelectorAll(fallback)).filter(
      (node) => !insideTurn(node) && precedesTurn(node, first),
    );
    return valid && native.every((node) => candidates.includes(node)) ? selector : fallback;
  } catch {
    return fallback;
  }
}
