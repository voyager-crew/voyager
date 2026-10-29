/** Selectable messages and final turn conversion over a packaged page-reading policy. */
import {
  type ContentExtractor,
  extractTurnContent,
} from '@/features/export/services/DOMContentExtractor';
import type { ChatTurn as ExportChatTurn } from '@/features/export/types/export';

import type { ExportPlatformAdapter } from './adapter/platformAdapters';
import { groupSelectedMessagesByTurn } from './selectionUtils';
import { createCollectorPolicy } from './sites/collectorPolicy';

export { removeCanvasExportSections } from './sites/inPlaceCollection';

export type ChatTurn = {
  turnId: string;
  user: string;
  assistant: string;
  starred: boolean;
  userElement?: HTMLElement;
  assistantElement?: HTMLElement;
  assistantHostElement?: HTMLElement;
};

export type ExportMessageRole = 'user' | 'assistant' | 'unknown';

/** One selectable message: `${turnId}:u` / `${turnId}:a`, or an adapter turn-container id. */
export type ExportMessage = {
  messageId: string;
  role: ExportMessageRole;
  hostElement: HTMLElement;
  exportElement?: HTMLElement;
  text: string;
  starred: boolean;
};

export interface ConversationCollector {
  /** User/assistant pairs in document order. Appends Canvas sections to responses (once). */
  collectChatPairs(): ChatTurn[];
  /** Selectable messages for the current page, in reading order. */
  collectSelectionMessages(): ExportMessage[];
  /** Export turns for the given message ids, read fresh from the page. Empty turns are dropped. */
  turnsForMessageIds(
    selectedMessageIds: ReadonlySet<string>,
    starredIds?: ReadonlySet<string>,
  ): ExportChatTurn[];
  /** Message id of the response that owns a response-menu trigger, or null. */
  assistantMessageIdFor(trigger: HTMLElement | null): string | null;
  /** First top-level user turn inside the conversation root. */
  topUserElement(): HTMLElement | null;
  conversationRoot(): HTMLElement;
  /**
   * Remember open Canvas documents so their content still exports after the
   * preload loop scrolls or re-renders the page and closes the panel.
   */
  snapshotOpenCanvasDocs(): void;
  /** Forget the snapshot and remove every appended Canvas section. */
  releaseCanvasDocs(): void;
}

function buildExportMessagesFromPairs(pairs: ChatTurn[]): ExportMessage[] {
  const out: ExportMessage[] = [];
  pairs.forEach((pair) => {
    if (pair.userElement) {
      out.push({
        messageId: `${pair.turnId}:u`,
        role: 'user',
        hostElement: pair.userElement,
        exportElement: pair.userElement,
        text: pair.user,
        starred: pair.starred,
      });
    }

    const assistantHost = pair.assistantHostElement;
    if (assistantHost) {
      out.push({
        messageId: `${pair.turnId}:a`,
        role: 'assistant',
        hostElement: assistantHost,
        exportElement: pair.assistantElement || assistantHost,
        text: pair.assistant,
        starred: pair.starred,
      });
    }
  });
  return out;
}

/** Turns read once from the page, after Canvas sections were appended to their responses. */
function buildTurnsForSelectedMessages(
  selectedMessages: readonly ExportMessage[],
  extractor: ContentExtractor,
): ExportChatTurn[] {
  const groupedTurns = groupSelectedMessagesByTurn(
    selectedMessages.filter(
      (message): message is ExportMessage & { role: Exclude<ExportMessageRole, 'unknown'> } =>
        message.role !== 'unknown',
    ),
  );
  return groupedTurns
    .map((turn) => ({
      user: turn.user?.text || '',
      assistant: turn.assistant?.text || '',
      starred: turn.starred,
      omitEmptySections: true,
      userElement: turn.user?.exportElement,
      assistantElement: turn.assistant?.exportElement,
    }))
    .filter(
      (turn) =>
        turn.user.length > 0 ||
        turn.assistant.length > 0 ||
        !!turn.userElement ||
        !!turn.assistantElement,
    )
    .map((turn) => extractTurnContent(turn, extractor));
}

export function createConversationCollector(adapter: ExportPlatformAdapter): ConversationCollector {
  const policy = createCollectorPolicy(adapter);
  const collectChatPairs = (starredIds: ReadonlySet<string> = new Set()): ChatTurn[] =>
    policy.collect(starredIds).pairs;
  const selectionMessagesFromPairs = (pairsInput: ChatTurn[]): ExportMessage[] => {
    const messages = buildExportMessagesFromPairs(pairsInput);
    return messages
      .map((message) => {
        const rect = message.hostElement.getBoundingClientRect();
        return {
          ...message,
          absTop: rect.top + window.scrollY,
        };
      })
      .sort((a, b) => a.absTop - b.absTop);
  };

  return {
    collectChatPairs,
    collectSelectionMessages: () => selectionMessagesFromPairs(collectChatPairs()),
    turnsForMessageIds: (selectedMessageIds, starredIds = new Set()) => {
      const { pairs, extractor } = policy.collect(starredIds);
      if (selectedMessageIds.size === 0) return [];
      const selectedMessages = selectionMessagesFromPairs(pairs).filter((message) =>
        selectedMessageIds.has(message.messageId),
      );
      return buildTurnsForSelectedMessages(selectedMessages, extractor);
    },
    assistantMessageIdFor: policy.assistantMessageIdFor,
    topUserElement: policy.topUserElement,
    conversationRoot: policy.conversationRoot,
    snapshotOpenCanvasDocs: policy.snapshotOpenCanvasDocs,
    releaseCanvasDocs: policy.releaseCanvasDocs,
  };
}
