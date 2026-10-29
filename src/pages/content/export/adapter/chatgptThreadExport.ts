import type { ChatTurn } from '@/features/export/types/export';
import { loadChatGptStarHashes } from '@/features/savedLibrary/exportStars';

import { type ChatGptCrawlOptions, crawlChatGptThread } from './chatgptCrawl';
import { assertActive } from './chatgptShared';
import {
  type ChatGptThreadMessage,
  isChatGptThreadGenerating,
  resolveVisibleConversationRoot,
} from './chatgptThread';
import { watchThreadVersions } from './chatgptThreadWatch';

export function turnsFromMessages(
  messages: readonly ChatGptThreadMessage[],
  starHashes: ReadonlySet<string>,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const byKey = new Map<string, ChatTurn>();
  for (const message of messages) {
    let turn = byKey.get(message.turnKey);
    if (!turn) {
      turn = {
        user: '',
        assistant: '',
        starred: message.starHash !== undefined && starHashes.has(message.starHash),
        omitEmptySections: true,
      };
      byKey.set(message.turnKey, turn);
      turns.push(turn);
    }
    if (message.role === 'user') {
      turn.user = message.content.text;
      turn.attachments = message.content.attachments;
      turn.userContent = message.content;
    } else {
      turn.assistant = message.content.text;
      turn.assistantContent = message.content;
    }
  }
  return turns;
}

/**
 * Read the whole current thread as export turns, for a caller that takes the
 * entire conversation at once (the temporary-chat handoff). Throws when the
 * crawl cannot prove it complete, when the last prompt has no reply yet, or
 * when the thread changed by the time the crawl returned.
 */
export async function readChatGptThreadTurns(options: ChatGptCrawlOptions): Promise<ChatTurn[]> {
  const captured = { ...options, expectedUrl: options.expectedUrl ?? location.href };
  const versions = watchThreadVersions();
  try {
    const messages = await crawlChatGptThread(captured);
    if (messages.at(-1)?.role === 'user') {
      throw new Error('chatgpt_export_response_still_generating');
    }
    versions.adopt(messages);
    const starHashes = await loadChatGptStarHashes(captured.expectedUrl);
    assertActive(captured);
    if (isChatGptThreadGenerating(resolveVisibleConversationRoot(document)) || versions.changed()) {
      throw new Error('chatgpt_export_conversation_changed');
    }
    return turnsFromMessages(messages, starHashes);
  } finally {
    versions.stop();
  }
}
