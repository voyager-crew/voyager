/**
 * The history readers a `site.json` `timeline.history.source` can name. Each
 * turns a site's conversation endpoint into the rail's `HistoryTurn` list;
 * the paths and key attributes come from site data, so a host rename ships
 * through the online catalog.
 */
import type { SiteAdapter } from '@/features/plugins/types';
import {
  type ChatGptApiTurn,
  ChatGptHistoryReader,
} from '@/pages/content/export/adapter/chatgptHistoryApi';

import type { CatalogTimelineHistory, HistoryTurn } from './historyLoader';

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Prompts only: a reply before any prompt (a GPT's greeting) has no bubble to mark. */
export function chatGptHistoryTurns(turns: readonly ChatGptApiTurn[]): HistoryTurn[] {
  return turns
    .filter((turn) => turn.user || turn.attachments.length)
    .map((turn) => ({
      key: turn.key,
      summary: collapse(turn.user),
      assistantSummary: collapse(turn.assistant),
    }));
}

/** The reader the adapter's data names, or null: the rail then lists the turns it has seen. */
export function catalogTimelineHistory(
  adapter: Pick<SiteAdapter, 'timeline' | 'turnKeyAttributes'>,
): CatalogTimelineHistory | null {
  const section = adapter.timeline?.history;
  if (!section) return null;
  const keyAttributes = section.keyAttributes ?? adapter.turnKeyAttributes ?? [];
  if (!keyAttributes.length) return null;
  switch (section.source) {
    case 'chatgptConversation': {
      // One reader per activation keeps the session headers it learned.
      const reader = new ChatGptHistoryReader({
        sessionPath: section.sessionPath,
        conversationPath: section.conversationPath,
      });
      return {
        keyAttributes,
        attachmentAnchor: (keyedTurn) =>
          keyedTurn.querySelector<HTMLElement>(
            'h4[data-conversation-role="user"] + [data-chatgpt-search-unit-key]:has(img)',
          ),
        load: async (conversationId, signal) =>
          chatGptHistoryTurns(await reader.branchOf(conversationId, signal)),
      };
    }
    default: {
      const _exhaustive: never = section.source;
      return _exhaustive;
    }
  }
}
