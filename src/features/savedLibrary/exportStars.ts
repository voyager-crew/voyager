import { hashString } from '@/core/utils/hash';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { parseSiteConversation } from '@/features/plugins/sites/siteConversation';
import { activeStarNamespace } from '@/features/timeline/adapters/catalog/activeStarNamespace';
import { siteConversationConfig } from '@/features/timeline/adapters/catalog/conversationId';
import { extractTurnHash, turnSummary } from '@/features/timeline/adapters/catalog/turnHash';

import { StarredMessagesService } from './StarredMessagesService';

/** The timeline hashes the bubble's DOM text, before export transforms its rich content. */
export function chatGptTurnHash(element: Element): string {
  return hashString(turnSummary(element));
}

/** One export's Library input; its caller owns route and cancellation checks. */
export async function loadChatGptStarHashes(url: string): Promise<ReadonlySet<string>> {
  // Read the ids the mounted timeline files under; with none mounted, site.json's.
  const namespace =
    activeStarNamespace(chatgptAdapter.id) ?? siteConversationConfig(chatgptAdapter);
  const conversation = parseSiteConversation(namespace, url);
  // An unnamed temporary/new chat has no timeline star namespace to read.
  if (!conversation) return new Set();
  const messages = await StarredMessagesService.getStarredMessagesForConversation(conversation.key);
  return new Set(messages.map((message) => extractTurnHash(message.turnId)));
}
