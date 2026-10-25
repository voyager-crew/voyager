import { resolveGeminiTurnOperation, type GeminiTurnView } from '@/core/gemini/selectors';
import { filterTopLevel } from '@/core/utils/array';

import type { ExportPlatformAdapter } from './adapter/platformAdapters';
import {
  filterOutDeepResearchImmersiveNodes,
  geminiAssistantTurnSelectors,
  geminiUserTurnSelectors,
} from './conversationDom';

export interface ConversationTurnDom {
  readonly root: HTMLElement;
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
  const root = adapter.resolveConversationRoot(userSelectors, document);
  const userSelector = userSelectors.join(',');
  const assistantSelector = assistantSelectors.join(',');
  const read = (selector: string): HTMLElement[] =>
    filterTopLevel(
      filterOutDeepResearchImmersiveNodes(Array.from(root.querySelectorAll<HTMLElement>(selector))),
    );
  return {
    root,
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
  return resolveGeminiTurnOperation((view) => read(readConversationTurns(adapter, view)), isUsable)
    .value;
}
