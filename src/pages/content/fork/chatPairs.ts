import { createContentExtractor } from '@/features/export/services/DOMContentExtractor';

import { resolveExportAdapter } from '../export/adapter/platformAdapters';
import { findAssistantForTurn, pickAssistantExportElement } from '../export/conversationDom';
import { resolveConversationTurnOperation } from '../export/conversationTurnOperation';
import { makeTurnId } from './turnId';

export interface ForkChatPair {
  turnId: string;
  user: string;
  assistant: string;
  userElement: HTMLElement;
}

function normalizeText(text: string | null): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

export function collectForkChatPairs(): ForkChatPair[] {
  const adapter = resolveExportAdapter();
  const { users, assistants, userSelector, assistantSelector } = resolveConversationTurnOperation(
    adapter,
    (turns) => turns,
    ({ users }) => users.length > 0,
  );
  if (users.length === 0) return [];

  // Rich extraction marks live code/images. Run it only after choosing the whole turn view.
  const extractor = createContentExtractor(adapter);
  const pairs: ForkChatPair[] = [];
  for (let i = 0; i < users.length; i++) {
    const userEl = users[i];
    const turnId = makeTurnId(userEl, i);
    userEl.dataset.turnId = turnId;

    const userExtracted = extractor.extractUserContent(userEl).text;
    const userText = userExtracted || normalizeText(userEl.innerText || userEl.textContent || '');
    const assistantHost = findAssistantForTurn(
      userEl,
      users[i + 1],
      assistants,
      userSelector,
      assistantSelector,
    );

    let assistantText = '';
    if (assistantHost) {
      const assistantExportEl = pickAssistantExportElement(assistantHost);
      const extracted = extractor.extractAssistantContent(assistantExportEl).text;
      assistantText =
        extracted ||
        normalizeText(assistantExportEl.innerText || assistantExportEl.textContent || '');
    }
    if (userText || assistantText) {
      pairs.push({
        turnId,
        user: userText,
        assistant: assistantText,
        userElement: userEl,
      });
    }
  }
  return pairs;
}
