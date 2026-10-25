import {
  getGeminiTurnView,
  resolveGeminiTurnOperation,
  type GeminiTurnView,
} from '@/core/gemini/selectors';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import {
  buildConversationIdFromUrl,
  extractConversationIdFromUrl,
} from '@/core/utils/conversationIdentity';

import {
  filterOutDeepResearchImmersiveNodes,
  resolveConversationRoot,
} from '../export/conversationDom';
import { getLegacyTurnIndex, makeTurnId, normalizeTurnId } from '../fork/turnId';
import { historyTimestampStore } from '../timestamp/historyTimestamps';

const ASSISTANT_CONTENT_SELECTORS = [
  'message-content',
  '.markdown-main-panel',
  '.markdown',
  '.response-content',
  'response-element',
] as const;

const THOUGHTS_SELECTOR = 'model-thoughts, .thoughts-container, .thoughts-content';

export interface HighlightTurnDom {
  turnId: string;
  userElement: HTMLElement;
  assistantHost: HTMLElement;
  assistantRoot: HTMLElement;
}

export interface HighlightSelectionContext extends HighlightTurnDom {
  conversationId: string;
  conversationUrl: string;
  conversationTitle?: string;
}

function filterTopLevel(elements: HTMLElement[]): HTMLElement[] {
  const candidates = new Set<Element>(elements);
  return elements.filter((element) => {
    let parent = element.parentElement;
    while (parent) {
      if (candidates.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

function isBefore(left: Node, right: Node): boolean {
  return Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function getUserSelectors(view: GeminiTurnView): string[] {
  let configured = '';
  try {
    configured =
      localStorage.getItem('geminiTimelineUserTurnSelector') ||
      // Auto belongs to bundled discovery: skip it while the page has an online user profile.
      (!getGeminiTurnView().remoteKeys.has('turn.user')
        ? localStorage.getItem('geminiTimelineUserTurnSelectorAuto')
        : '') ||
      '';
  } catch {}
  if (configured) {
    try {
      document.querySelector(configured);
    } catch {
      configured = '';
    }
  }
  const defaults = getGeminiTurnSelectors('turn.user', view);
  return configured
    ? [configured, ...defaults.filter((selector) => selector !== configured)]
    : defaults;
}

function getTopLevelMatches(root: HTMLElement, selectors: readonly string[]): HTMLElement[] {
  const matchesBySelector = selectors.flatMap((selector) => {
    try {
      return Array.from(root.querySelectorAll<HTMLElement>(selector));
    } catch {
      return [];
    }
  });
  const matches = filterOutDeepResearchImmersiveNodes(
    Array.from(new Set(matchesBySelector)),
  ).filter((element) => !element.closest(THOUGHTS_SELECTOR));
  return filterTopLevel(matches);
}

function getAssistantMatches(root: HTMLElement, view: GeminiTurnView): HTMLElement[] {
  const specific = getTopLevelMatches(root, getGeminiTurnSelectors('turn.assistant', view));
  return specific.length > 0
    ? specific
    : getTopLevelMatches(root, getGeminiTurnSelectors('turn.assistantFallback', view));
}

function findAssistantRootForTarget(host: HTMLElement, target?: Node): HTMLElement {
  for (const selector of ASSISTANT_CONTENT_SELECTORS) {
    const candidates = Array.from(host.querySelectorAll<HTMLElement>(selector));
    const candidate = candidates.find(
      (element) =>
        !element.closest(THOUGHTS_SELECTOR) &&
        (!target || element === target || element.contains(target)),
    );
    if (candidate) return candidate;
  }
  return host;
}

function getConversationTitle(users: HTMLElement[]): string | undefined {
  const title = document.title.trim();
  if (title && title !== 'Gemini' && title !== 'Google Gemini' && !title.startsWith('Gemini -')) {
    return title;
  }

  const firstUserText = users[0]?.textContent?.replace(/\s+/g, ' ').trim();
  if (!firstUserText) return undefined;
  return firstUserText.length > 80 ? `${firstUserText.slice(0, 77)}...` : firstUserText;
}

function readHighlightTurns(view: GeminiTurnView): HighlightTurnDom[] {
  const userSelectors = getUserSelectors(view);
  const root = resolveConversationRoot({ userSelectors, doc: document });
  const users = getTopLevelMatches(root, userSelectors);
  const assistants = getAssistantMatches(root, view);
  const turns: HighlightTurnDom[] = [];
  let assistantIndex = 0;

  users.forEach((userElement, index) => {
    const nextUser = users[index + 1];
    while (
      assistantIndex < assistants.length &&
      !isBefore(userElement, assistants[assistantIndex])
    ) {
      assistantIndex += 1;
    }
    const candidate = assistants[assistantIndex];
    const assistantHost =
      candidate && (!nextUser || isBefore(candidate, nextUser)) ? candidate : null;
    if (!assistantHost) return;
    assistantIndex += 1;

    const turnId = makeTurnId(userElement, index);
    turns.push({
      turnId,
      userElement,
      assistantHost,
      assistantRoot: findAssistantRootForTarget(assistantHost),
    });
  });

  return turns;
}

export function collectHighlightTurns(): HighlightTurnDom[] {
  const { value: turns } = resolveGeminiTurnOperation(
    readHighlightTurns,
    (turns) => turns.length > 0,
  );
  // A rejected online read must not leave turn ids on nodes that highlighting never accepted.
  turns.forEach(({ userElement, turnId }) => {
    userElement.dataset.turnId = turnId;
  });
  return turns;
}

export function getHighlightSelectionContext(range: Range): HighlightSelectionContext | null {
  if (range.collapsed) return null;
  const target =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!target || target.closest(THOUGHTS_SELECTOR)) return null;

  const turns = collectHighlightTurns();
  const turn = turns.find(
    ({ assistantHost }) => assistantHost === target || assistantHost.contains(target),
  );
  if (!turn) return null;
  const stableTurnId = resolveMountedHighlightTurnId(turn.turnId);
  if (!stableTurnId) return null;

  const assistantRoot = findAssistantRootForTarget(turn.assistantHost, target);
  if (
    (!assistantRoot.contains(range.startContainer) && assistantRoot !== range.startContainer) ||
    (!assistantRoot.contains(range.endContainer) && assistantRoot !== range.endContainer)
  ) {
    return null;
  }

  const users = turns.map(({ userElement }) => userElement);
  const conversationUrl = `${location.origin}${location.pathname}${location.search}`;
  return {
    ...turn,
    turnId: stableTurnId,
    assistantRoot,
    conversationId: buildConversationIdFromUrl(conversationUrl),
    conversationUrl,
    conversationTitle: getConversationTitle(users),
  };
}

export function findHighlightTurn(turnId: string): HighlightTurnDom | null {
  const normalized = resolveStoredHighlightTurnId(turnId);
  if (!normalized) return null;
  return (
    collectHighlightTurns().find(
      (turn) => resolveMountedHighlightTurnId(turn.turnId) === normalized,
    ) ?? null
  );
}

/** Resolve persisted ids, including verified legacy aliases. */
export function resolveStoredHighlightTurnId(turnId: string): string | null {
  const nativeConversationId = extractConversationIdFromUrl(window.location.href);
  if (!nativeConversationId) return normalizeTurnId(turnId);
  return historyTimestampStore.resolveCanonicalTurnId(nativeConversationId, turnId);
}

/** A live positional fallback is never proof of full-conversation identity. */
export function resolveMountedHighlightTurnId(turnId: string): string | null {
  if (getLegacyTurnIndex(turnId) !== null) return null;
  return resolveStoredHighlightTurnId(turnId);
}

export function findScrollableAncestor(element: HTMLElement): HTMLElement {
  let current = element.parentElement;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return current;
    current = current.parentElement;
  }
  return (
    (document.scrollingElement as HTMLElement | null) ?? document.documentElement ?? document.body
  );
}

export function isVisibleHighlightMark(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hidden ||
      current.hasAttribute('inert') ||
      current.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }
    const style = window.getComputedStyle(current);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.contentVisibility === 'hidden'
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}
