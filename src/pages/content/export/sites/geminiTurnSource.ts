import { buildConversationIdFromUrl } from '@/core/utils/conversationIdentity';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';

import { findMatchingStarredMessages } from '../../timeline/starredLookup';
import type { ExportSelectionOptions } from '../adapter/type';
import type { ConversationCollector } from '../conversationCollector';
import { throwIfExportCancelled } from '../exportCancellation';
import type { ExportTurnReader, ExportTurnSource } from '../exportSite';

/** Gemini keeps loaded turns mounted; the session reads their current accepted DOM in place. */
export function createGeminiTurnSource(page: ConversationCollector): ExportTurnSource {
  const assertCurrent = (options: ExportSelectionOptions, url: string) => {
    throwIfExportCancelled(options.signal);
    // Account slots are part of the route even when two accounts have the same chat path.
    if (location.href.split('#')[0] !== url.split('#')[0]) {
      throw new Error('export_conversation_changed');
    }
  };
  const reader: ExportTurnReader = {
    messages: page.collectSelectionMessages,
    build: async (selectedIds, options) => {
      const url = options.expectedUrl ?? location.href;
      assertCurrent(options, url);
      const data = await StarredMessagesService.getAllStarredMessages();
      assertCurrent(options, url);
      const { messages } = findMatchingStarredMessages(data, buildConversationIdFromUrl(url), url);
      return page.turnsForMessageIds(
        selectedIds,
        new Set(messages.map((message) => message.turnId)),
      );
    },
  };
  return {
    ...reader,
    scrollsWhileBuilding: false,
    prepare: async (options) => {
      assertCurrent(options, options.expectedUrl ?? location.href);
      return { ...reader, release: page.releaseCanvasDocs };
    },
  };
}
