import { hashString } from '@/core/utils/hash';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { activeStarNamespace } from '@/features/timeline/adapters/catalog/activeStarNamespace';
import {
  siteConversationConfig,
  starConversationId,
} from '@/features/timeline/adapters/catalog/conversationId';
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
  const conversationId = starConversationId(namespace, url);
  // An unnamed temporary/new chat has no timeline star namespace to read.
  if (!conversationId) return new Set();
  const messages = await StarredMessagesService.getStarredMessagesForConversation(conversationId);
  return new Set(messages.map((message) => extractTurnHash(message.turnId)));
}
