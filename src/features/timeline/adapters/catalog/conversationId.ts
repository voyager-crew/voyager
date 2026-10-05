/**
 * Conversation ids for the navigator's starred messages. They are read from
 * the URL at the moment of each star read or write; markers never carry one.
 */
import { hashString } from '@/core/utils/hash';
import { MAX_REGEX_INPUT_LENGTH } from '@/features/plugins/sites/safeRegex';
import type { SiteAdapter } from '@/features/plugins/types';

interface ConversationIdConfig {
  readonly siteId: string;
  readonly conversationIdPattern?: string;
  /** Attribute holding the id the route pattern captures, on the turn's ancestor or in its item. */
  readonly conversationIdAttribute?: string;
  /** Element wrapping one exchange, searched when no ancestor of the turn carries the id. */
  readonly turnItemSelector?: string;
}

/**
 * A site's star namespace, the one source for the timeline and the export's starred filter:
 * site.json's id and route pattern. A plugin's pattern only fills in where site.json has none.
 */
export function siteConversationConfig(
  adapter: Pick<SiteAdapter, 'id' | 'conversationIdPattern'>,
  fallbackPattern?: string,
): Pick<ConversationIdConfig, 'siteId' | 'conversationIdPattern'> {
  return {
    siteId: adapter.id,
    conversationIdPattern: adapter.conversationIdPattern ?? fallbackPattern,
  };
}

/** Site prefixes isolate stars while preserving historical `claude:conv:<id>` keys. */
export function buildConversationId(
  config: ConversationIdConfig,
  input: string = location.href,
): string {
  try {
    const url = new URL(input, location.origin);
    if (config.conversationIdPattern) {
      // The pattern policy (sites/safeRegex.ts) forbids the constructs that
      // backtrack catastrophically; a bounded subject caps the rest.
      const subject = url.pathname.slice(0, MAX_REGEX_INPUT_LENGTH);
      const match = new RegExp(config.conversationIdPattern).exec(subject);
      if (match?.[1]) return `${config.siteId}:conv:${match[1]}`;
    }
    return `${config.siteId}:${hashString(`${url.origin}${url.pathname}`)}`;
  } catch {
    return `${config.siteId}:${hashString(String(input || ''))}`;
  }
}

/**
 * The id stars are filed under, or null where a site names its conversations
 * in the route but this URL does not: a new chat the host has not given an id
 * yet. Every new chat shares that path, so nothing starred there could be told
 * apart later; starring waits for the real id instead of migrating records.
 */
export function starConversationId(
  config: ConversationIdConfig,
  input: string = location.href,
): string | null {
  const id = buildConversationId(config, input);
  return !config.conversationIdPattern || id.startsWith(`${config.siteId}:conv:`) ? id : null;
}

/**
 * The conversation the host itself says a turn belongs to, as a star id:
 * from the nearest ancestor carrying the attribute (Claude's thread
 * container), else from inside the turn's item (ChatGPT puts it on the reply).
 * Null when the site names the attribute but the turn has none yet, or its
 * item names more than one conversation; undefined when the site names none.
 * Read live: the host may move a turn to another conversation.
 */
export function turnConversationId(
  config: ConversationIdConfig,
  element: Element,
): string | null | undefined {
  const attribute = config.conversationIdAttribute;
  if (!attribute) return undefined;
  try {
    const holder = `[${attribute}]`;
    const own = element.closest(holder);
    const item = own || !config.turnItemSelector ? null : element.closest(config.turnItemSelector);
    const holders = own ? [own] : Array.from(item?.querySelectorAll(holder) ?? []);
    const ids = new Set(holders.map((node) => node.getAttribute(attribute)?.trim() ?? ''));
    const [id] = ids;
    return ids.size === 1 && id ? `${config.siteId}:conv:${id}` : null;
  } catch {
    return null;
  }
}
