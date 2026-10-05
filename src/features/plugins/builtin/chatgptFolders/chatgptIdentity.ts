/**
 * Which ChatGPT conversation a URL names, and how it is stored in a folder.
 *
 * A conversation lives at `/c/<id>`, inside a Project at `/g/g-p-<project>/c/<id>`,
 * or inside a GPT at `/g/g-<gpt>/c/<id>`. The id alone is the identity, namespaced
 * as `chatgpt:conv:<id>` like the timeline's ids, so a conversation that moves in or
 * out of a Project is still the same folder entry. The stored URL keeps the full
 * path it was filed under. site.json's `conversationIdPattern` also accepts the
 * `/g/` and `/u/` prefixes, but this module keeps its own stricter id match and
 * adds the stored namespace.
 */

export const CHATGPT_CONVERSATION_ID_PREFIX = 'chatgpt:conv:';

/** The route id inside a stored `chatgpt:conv:<id>`; any other id is returned as is. */
export function bareConversationId(conversationId: string): string {
  return conversationId.startsWith(CHATGPT_CONVERSATION_ID_PREFIX)
    ? conversationId.slice(CHATGPT_CONVERSATION_ID_PREFIX.length)
    : conversationId;
}

/** Hosts that serve ChatGPT conversations; `chat.openai.com` redirects to `chatgpt.com`. */
export const CHATGPT_HOSTS: readonly string[] = ['chatgpt.com', 'chat.openai.com'];

/** `/c/<id>`, `/g/<project-or-gpt>/c/<id>`, optionally under `/u/<index>/`. */
const CONVERSATION_PATH = /^((?:\/u\/[^/]+)?(?:\/g\/[^/]+)?\/c\/([A-Za-z0-9_-]+))(?:[/?#]|$)/;

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

function parseChatGptUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') return null;
    return CHATGPT_HOSTS.includes(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
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
  const match = CONVERSATION_PATH.exec(href);
  return match ? { id: match[2], path: match[1] } : null;
}

/** The conversation `href` names, or `null` for any other page or site. */
export function readChatGptConversation(href: string): ChatGptConversationIdentity | null {
  const url = parseChatGptUrl(href);
  if (!url) return null;
  const match = CONVERSATION_PATH.exec(url.pathname);
  if (!match) return null;
  const [, path, id] = match;
  return {
    id,
    conversationId: `${CHATGPT_CONVERSATION_ID_PREFIX}${id}`,
    url: `${url.origin}${path}`,
    path,
  };
}
