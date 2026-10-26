import { resolveGeminiConversationRoot } from '@/core/gemini/content/conversation';
import { acceptsGeminiContentCollection } from '@/core/gemini/content/reads';
import {
  getGeminiSelectorView,
  getBundledGeminiSelectorView,
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiTurnView,
} from '@/core/gemini/selectors';
import { acceptsGeminiTurnCollection } from '@/core/gemini/turnIntegrity';
import { filterTopLevel } from '@/core/utils/array';

import type { ExportPlatformAdapter } from './adapter/platformAdapters';
import {
  filterOutDeepResearchImmersiveNodes,
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
    if (
      acceptsGeminiTurnCollection(candidate, bundled) &&
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
