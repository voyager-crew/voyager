import { getGeminiTurnView, type GeminiTurnView } from '@/core/gemini/selectors';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import { queryOutsideThoughts } from '@/features/export/services/exportDomPolicy';

type ResolveConversationRootOptions = {
  userSelectors: string[];
  doc?: Document;
};

const CONVERSATION_ROOT_CANDIDATES = [
  '#chat-history',
  'infinite-scroller.chat-history',
  'chat-window-content',
  'main',
];

export function filterOutDeepResearchImmersiveNodes<T extends HTMLElement>(elements: T[]): T[] {
  return elements.filter((element) => !element.closest('deep-research-immersive-panel'));
}

// Virtualized turns have incomparable offset parents; DOM order bounds replies by the next prompt.
// Repeated prompt text still represents separate turns.
export function findFirstElementBetweenTurns(
  currentTurn: HTMLElement,
  nextTurn: HTMLElement | undefined,
  candidates: readonly HTMLElement[],
): HTMLElement | null {
  for (const candidate of candidates) {
    const followsCurrent = !!(
      currentTurn.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const precedesNext =
      !nextTurn ||
      !!(candidate.compareDocumentPosition(nextTurn) & Node.DOCUMENT_POSITION_FOLLOWING);

    if (followsCurrent && precedesNext) return candidate;
  }

  return null;
}

/** How many siblings after a prompt are searched for its response when DOM order finds none. */
const SIBLING_RESPONSE_WINDOW = 8;

/**
 * The response that belongs to `user`: the first assistant node before the next
 * prompt, or else a response among the prompt's next few siblings.
 */
export function findAssistantForTurn(
  user: HTMLElement,
  nextUser: HTMLElement | undefined,
  assistants: readonly HTMLElement[],
  userSelector: string,
  assistantSelector: string,
): HTMLElement | null {
  const between = findFirstElementBetweenTurns(user, nextUser, assistants);
  if (between) return between;

  let sibling: HTMLElement | null = user;
  for (let step = 0; step < SIBLING_RESPONSE_WINDOW && sibling; step++) {
    sibling = sibling.nextElementSibling as HTMLElement | null;
    if (!sibling) break;
    if (sibling.matches(userSelector)) break;
    if (sibling.matches(assistantSelector)) return sibling;
  }
  return null;
}

/** The element inside a Gemini response host that holds the answer itself. */
export function pickAssistantExportElement(assistantHost: HTMLElement): HTMLElement {
  return (
    queryOutsideThoughts<HTMLElement>(assistantHost, 'message-content') ||
    queryOutsideThoughts<HTMLElement>(assistantHost, '.markdown, .markdown-main-panel') ||
    (assistantHost.closest('.presented-response-container') as HTMLElement | null) ||
    queryOutsideThoughts<HTMLElement>(
      assistantHost,
      '.presented-response-container, .response-content',
    ) ||
    queryOutsideThoughts<HTMLElement>(assistantHost, 'response-element') ||
    assistantHost
  );
}

/** Gemini prompt selectors, led by the one the timeline configured or detected. */
export function geminiUserTurnSelectors(view: GeminiTurnView = getGeminiTurnView()): string[] {
  const configured = (() => {
    try {
      return (
        localStorage.getItem('geminiTimelineUserTurnSelector') ||
        // Auto belongs to bundled discovery. It cannot add stale nodes to an online profile.
        (!getGeminiTurnView().remoteKeys.has('turn.user')
          ? localStorage.getItem('geminiTimelineUserTurnSelectorAuto')
          : '') ||
        ''
      );
    } catch {
      return '';
    }
  })();
  const defaults = getGeminiTurnSelectors('turn.user', view);
  return configured
    ? [configured, ...defaults.filter((selector) => selector !== configured)]
    : defaults;
}

export function geminiAssistantTurnSelectors(view: GeminiTurnView = getGeminiTurnView()): string[] {
  return [
    ...getGeminiTurnSelectors('turn.assistant', view),
    ...getGeminiTurnSelectors('turn.assistantFallback', view),
  ];
}

function hasVisibleUserTurns(root: HTMLElement, userSelectors: string[]): boolean {
  if (userSelectors.length === 0) return false;
  const nodes = filterOutDeepResearchImmersiveNodes(
    Array.from(root.querySelectorAll<HTMLElement>(userSelectors.join(','))),
  );
  return nodes.length > 0;
}

export function resolveConversationRoot({
  userSelectors,
  doc = document,
}: ResolveConversationRootOptions): HTMLElement {
  const body = doc.body as HTMLElement;
  let firstCandidate: HTMLElement | null = null;

  for (const selector of CONVERSATION_ROOT_CANDIDATES) {
    const candidate = doc.querySelector(selector) as HTMLElement | null;
    if (!candidate) continue;
    if (!firstCandidate) firstCandidate = candidate;
    if (hasVisibleUserTurns(candidate, userSelectors)) return candidate;
  }

  return firstCandidate || body;
}
