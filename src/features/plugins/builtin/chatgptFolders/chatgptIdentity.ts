/**
 * Which ChatGPT conversation a URL names, and how it is stored in a folder.
 *
 * A conversation lives at `/c/<id>`, inside a Project at `/g/g-p-<project>/c/<id>`,
 * or inside a GPT at `/g/g-<gpt>/c/<id>`, optionally under `/u/<index>/`: the
 * route site.json's `conversationIdPattern` reads, as the timeline's stars do.
 * The id alone is the identity, `chatgpt:conv:<id>`, so a conversation that moves
 * in or out of a Project is still the same folder entry. The stored URL keeps the
 * full path it was filed under.
 */
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { parseSiteConversation } from '@/features/plugins/sites/siteConversation';
import { siteConversationConfig } from '@/features/timeline/adapters/catalog/conversationId';

export const CHATGPT_CONVERSATION_ID_PREFIX = 'chatgpt:conv:';

/** The route id inside a stored `chatgpt:conv:<id>`; any other id is returned as is. */
export function bareConversationId(conversationId: string): string {
  return conversationId.startsWith(CHATGPT_CONVERSATION_ID_PREFIX)
    ? conversationId.slice(CHATGPT_CONVERSATION_ID_PREFIX.length)
    : conversationId;
}

const NAMESPACE = siteConversationConfig(chatgptAdapter);

export interface ChatGptConversationIdentity {
  /** The bare conversation id from the route. */
  readonly id: string;
  /** `chatgpt:conv:<id>`: what a folder entry is keyed by. */
  readonly conversationId: string;
  /** Origin plus the conversation path, without query or hash. */
  readonly url: string;
  /** The conversation path, for in-page navigation. */
  readonly path: string;
}

/**
 * The conversation a root-relative link (`/c/<id>`, `/g/<project>/c/<id>`) names,
 * as its bare id and path; `null` for any other link. No URL parsing, so a pass
 * over every sidebar row stays cheap.
 */
export function readChatGptConversationPath(
  href: string | null,
): { readonly id: string; readonly path: string } | null {
  if (!href?.startsWith('/') || href.startsWith('//')) return null;
  const conversation = parseSiteConversation(NAMESPACE, href);
  return conversation ? { id: conversation.id, path: conversation.path } : null;
}

/**
 * The conversation `href` names, or `null` for any other page or site. Every
 * host site.json matches is accepted, `chat.openai.com` (which redirects) too,
 * so a stored link from it still opens; imports require the canonical host.
 */
export function readChatGptConversation(href: string): ChatGptConversationIdentity | null {
  if (!matchesAnyPattern(href, chatgptAdapter.matches)) return null;
  const conversation = parseSiteConversation(NAMESPACE, href);
  if (!conversation) return null;
  return {
    id: conversation.id,
    conversationId: conversation.key,
    url: `${new URL(href).origin}${conversation.path}`,
    path: conversation.path,
  };
}
