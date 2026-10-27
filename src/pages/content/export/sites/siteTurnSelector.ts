import type { SiteAdapter } from '@/features/plugins/types';

/**
 * Elements that hold one conversation turn on `site`: the export's
 * message-key holders, which on a virtualized host (Claude) wrap a turn's
 * per-message controls too, and its user and assistant turn selectors.
 * Undefined when the site describes none.
 *
 * The toolbar tests this with `closest()` on every page mutation while a reply
 * streams, so a turn selector using `:has()` is left out: it would scan the
 * streaming message's subtree on each one (DeepSeek, ChatGPT's user turn).
 */
export function siteTurnSelector(site: SiteAdapter): string | undefined {
  const messageKey = site.export?.messageKey;
  const parts = [
    messageKey ? `[${messageKey}]` : undefined,
    site.selectors.userTurn,
    site.selectors.assistantTurn,
  ].filter((part): part is string => Boolean(part) && !part?.includes(':has('));
  return parts.length > 0 ? parts.join(', ') : undefined;
}
