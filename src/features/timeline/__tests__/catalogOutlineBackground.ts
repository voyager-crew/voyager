/**
 * Routes catalog outline writes to a real background writer, sent as this extension's content
 * script on the site that owns the bucket, or as `sender` when given (the popup). Install the result
 * as `chrome.runtime.sendMessage`; any other message goes to `fallback`.
 */
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { catalogHierarchySiteOf } from '@/features/timeline/catalogHierarchySync';
import { createCatalogOutlineMessageHandler } from '@/pages/background/catalogOutlineMessages';

type Respond = (response: unknown) => void;
type Message = { type?: string; payload?: { key?: string; buckets?: Record<string, unknown> } };

function siteSender(message: Message): chrome.runtime.MessageSender {
  const key = message.payload?.key ?? Object.keys(message.payload?.buckets ?? {})[0] ?? '';
  const site = BUNDLED_SITE_ADAPTERS.find((adapter) => adapter.id === catalogHierarchySiteOf(key));
  const url = site?.matches[0]?.replace(/\*$/, '') ?? 'https://unknown.invalid/';
  return { id: chrome.runtime.id, url, frameId: 0, tab: { id: 1, url } as chrome.tabs.Tab };
}

export function routeCatalogOutlineWrites(
  fallback: (message: never, respond: Respond) => unknown = () => undefined,
  sender?: chrome.runtime.MessageSender,
): (message: unknown, respond?: Respond) => unknown {
  const handle = createCatalogOutlineMessageHandler();
  return (message, respond) => {
    const response = handle(message, sender ?? siteSender(message as Message));
    if (!response) return fallback(message as never, respond ?? (() => {}));
    void response.then((value) => respond?.(value));
    return response;
  };
}
