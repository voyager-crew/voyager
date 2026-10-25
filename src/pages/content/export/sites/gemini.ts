import { buildConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';

import { findMatchingStarredMessages } from '../../timeline/starredLookup';
import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import { createConversationCollector } from '../conversationCollector';
import { throwIfExportCancelled } from '../exportCancellation';
import type { ExportSite } from '../exportSite';
import { geminiFingerprintSelectors, geminiReadyUserSelectors } from '../geminiTurnReadiness';

/** Gemini keeps every loaded turn mounted, so the export reads the page in place. */
export function createGeminiExportSite(adapter: ExportPlatformAdapter): ExportSite {
  const page = createConversationCollector(adapter);
  return {
    id: adapter.site.id,
    label: adapter.site.label,
    entryPoints: {
      kind: 'gemini',
      userSelectors: geminiReadyUserSelectors,
      assistantMessageIdFor: page.assistantMessageIdFor,
    },
    title: adapter.extractConversationTitle,
    turns: {
      scrollsWhileBuilding: false,
      messages: page.collectSelectionMessages,
      build: async (selectedIds, options) => {
        const url = options.expectedUrl ?? location.href;
        const assertCurrent = () => {
          throwIfExportCancelled(options.signal);
          // Keep account slots in the route: the same chat path may open under another account.
          if (location.href.split('#')[0] !== url.split('#')[0]) {
            throw new Error('export_conversation_changed');
          }
        };
        assertCurrent();
        const data = await StarredMessagesService.getAllStarredMessages();
        assertCurrent();
        const { messages } = findMatchingStarredMessages(
          data,
          buildConversationIdFromUrl(url),
          url,
        );
        return page.turnsForMessageIds(
          selectedIds,
          new Set(messages.map((message) => message.turnId)),
        );
      },
    },
    page,
    history: {
      userSelectors: geminiReadyUserSelectors,
      assistantSelectors: adapter.getAssistantSelectors,
      fingerprintSelectors: geminiFingerprintSelectors,
    },
  };
}
