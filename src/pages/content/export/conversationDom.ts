import { resolveGeminiConversationRoot } from '@/core/gemini/content/conversation';
import { GEMINI_PACKAGED_CONTENT } from '@/core/gemini/content/packaged';
import { resolveGeminiAnswerElement } from '@/core/gemini/content/reads';
import { getGeminiTurnView, type GeminiTurnView } from '@/core/gemini/selectors';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';

import { readAssistantExportElement } from './assistantExportElement';
import { readConfiguredExportUserSelector } from './configuredUserSelector';

type ResolveConversationRootOptions = {
  userSelectors: string[];
  doc?: Document;
};

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
export function pickAssistantExportElement(
  assistantHost: HTMLElement,
  view?: GeminiTurnView,
): HTMLElement {
  return resolveGeminiAnswerElement(
    assistantHost,
    () => pickBundledAssistantExportElement(assistantHost),
    view,
  );
}

function pickBundledAssistantExportElement(assistantHost: HTMLElement): HTMLElement {
  return readAssistantExportElement(assistantHost, {
    content: GEMINI_PACKAGED_CONTENT['export.messageContent'],
    markdown: GEMINI_PACKAGED_CONTENT['export.markdown'].join(','),
    presentedAncestor: GEMINI_PACKAGED_CONTENT['export.presentedAncestor'].join(','),
    presentedContent: GEMINI_PACKAGED_CONTENT['export.presentedContent'].join(','),
    responseElement: GEMINI_PACKAGED_CONTENT['export.responseElement'].join(','),
  });
}

/** Gemini prompt selectors, led by the one the timeline configured or detected. */
export function geminiUserTurnSelectors(view: GeminiTurnView = getGeminiTurnView()): string[] {
  const configured = readConfiguredExportUserSelector(
    !getGeminiTurnView().remoteKeys.has('turn.user'),
  );
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

export function resolveConversationRoot({
  userSelectors,
  doc = document,
}: ResolveConversationRootOptions): HTMLElement {
  return resolveGeminiConversationRoot(userSelectors, doc);
}
