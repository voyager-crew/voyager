import { resolveGeminiConversationRoot } from '@/core/gemini/content/conversation';
import {
  acceptsGeminiContentCollection,
  preservesGeminiContentFrames,
} from '@/core/gemini/content/reads';
import {
  getGeminiSelectorView,
  getBundledGeminiSelectorView,
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiTurnView,
} from '@/core/gemini/selectors';
import { filterTopLevel } from '@/core/utils/array';
import { shouldSkipElement } from '@/features/export/services/exportDomPolicy';

import type { ExportPlatformAdapter } from './adapter/platformAdapters';
import {
  filterOutDeepResearchImmersiveNodes,
  findAssistantForTurn,
  geminiAssistantTurnSelectors,
  geminiUserTurnSelectors,
} from './conversationDom';

export interface ConversationTurnDom {
  readonly root: HTMLElement;
  readonly view?: GeminiTurnView;
  readonly userSelector: string;
  readonly assistantSelector: string;
  readonly users: HTMLElement[];
  readonly assistants: HTMLElement[];
}

function readConversationTurns(
  adapter: ExportPlatformAdapter,
  view?: GeminiTurnView,
): ConversationTurnDom {
  const userSelectors = view ? geminiUserTurnSelectors(view) : adapter.getUserSelectors();
  const assistantSelectors = view
    ? geminiAssistantTurnSelectors(view)
    : adapter.getAssistantSelectors();
  const root = view
    ? resolveGeminiConversationRoot(userSelectors, document)
    : adapter.resolveConversationRoot(userSelectors, document);
  const userSelector = userSelectors.join(',');
  const assistantSelector = assistantSelectors.join(',');
  const read = (selector: string): HTMLElement[] =>
    filterTopLevel(
      filterOutDeepResearchImmersiveNodes(Array.from(root.querySelectorAll<HTMLElement>(selector))),
    );
  return {
    root,
    view,
    userSelector,
    assistantSelector,
    users: read(userSelector),
    assistants: read(assistantSelector),
  };
}

function sameNodes(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((node, index) => node === right[index]);
}

function hasContent(host: Node, excluded: readonly Node[] = []): boolean {
  if (excluded.includes(host)) return false;
  if (host instanceof Element) {
    if (
      shouldSkipElement(host) ||
      host.matches('message-actions, .message-actions, .thoughts-container, .thoughts-content')
    )
      return false;
    if (host.matches('img, canvas, svg, math')) return true;
  }
  if (host.nodeType === Node.TEXT_NODE && host.textContent?.trim()) return true;
  return Array.from(host.childNodes).some((child) => hasContent(child, excluded));
}

/** Native turn containers prove completeness when both renamed host lists evade the bundle. */
function acceptsRepairedTurns(
  candidate: ConversationTurnDom,
  bundled: ConversationTurnDom,
): boolean {
  if (candidate.root !== bundled.root || candidate.users.length === 0) return false;
  if (bundled.users.length > 0 && !sameNodes(candidate.users, bundled.users)) return false;
  if (bundled.assistants.length > 0 && !sameNodes(candidate.assistants, bundled.assistants))
    return false;
  const containers = filterTopLevel(
    filterOutDeepResearchImmersiveNodes(
      Array.from(candidate.root.querySelectorAll<HTMLElement>('.conversation-container')),
    ),
  ).filter((container) => hasContent(container));
  const paired: HTMLElement[] = [];
  const owners: HTMLElement[] = [];
  for (const [index, user] of candidate.users.entries()) {
    const owner = user.closest<HTMLElement>('.conversation-container');
    if (!owner || owner === user || !candidate.root.contains(owner) || !hasContent(user))
      return false;
    // Rich extraction traverses host children; a semantic host would lose its own frame.
    if (!preservesGeminiContentFrames(user, owner)) return false;
    owners.push(owner);
    const assistant = findAssistantForTurn(
      user,
      candidate.users[index + 1],
      candidate.assistants,
      candidate.userSelector,
      candidate.assistantSelector,
    );
    if (assistant) {
      if (assistant.closest('.conversation-container') !== owner || !hasContent(assistant))
        return false;
      if (!preservesGeminiContentFrames(assistant, owner)) return false;
      // Matching fragments must cover every native content leaf before assigning turn IDs.
      if (hasContent(owner, [user, assistant])) return false;
      paired.push(assistant);
    } else if (index !== candidate.users.length - 1 || hasContent(owner, [user])) return false;
  }
  // A positive match in one renamed turn cannot silently omit another native turn or reply.
  return sameNodes(owners, containers) && sameNodes(paired, candidate.assistants);
}

/** Read a whole native export/fork operation before its accepted result may mutate the page. */
export function resolveConversationTurnOperation<T>(
  adapter: ExportPlatformAdapter,
  read: (turns: ConversationTurnDom) => T,
  isUsable: (result: T) => boolean,
): T {
  if (adapter.site.id !== 'gemini') return read(readConversationTurns(adapter));
  const view = getGeminiSelectorView();
  const bundle = getBundledGeminiSelectorView();
  const relevant = [...GEMINI_TURN_PROFILE_KEYS, 'content.answer', 'content.userLines'] as const;
  if (!relevant.some((key) => view.remoteKeys.has(key)))
    return read(readConversationTurns(adapter, bundle));
  const bundled = readConversationTurns(adapter, bundle);
  try {
    const candidate = readConversationTurns(adapter, view);
    // Keep a partial/foreign list from assigning export IDs or marking the wrong live response.
    const agrees =
      sameNodes(candidate.users, bundled.users) &&
      sameNodes(candidate.assistants, bundled.assistants);
    // P1 repairs renamed hosts; equality alone would make an empty bundled read permanent.
    if (
      (agrees || acceptsRepairedTurns(candidate, bundled)) &&
      acceptsGeminiContentCollection(candidate.users, candidate.assistants, view)
    ) {
      const result = read(candidate);
      if (isUsable(result)) return result;
    }
  } catch {
    // The whole operation reruns with its bundled roots, descendants and ordering.
  }
  return read(bundled);
}
