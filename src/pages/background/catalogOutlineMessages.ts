/**
 * The single writer of catalog outlines (`gvCatalogTimelineHierarchy:<site>…`). Page edits from
 * every tab and cloud restores from the popup or a page all run one at a time in each site's
 * in-memory queue, every step reading storage afresh, so neither can overwrite the other. A worker
 * restart drops what was queued: a missed edit, never a wrong one. Gemini outlines stay page-written.
 */
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { catalogHierarchySiteOf } from '@/features/timeline/catalogHierarchySync';
import {
  CATALOG_OUTLINE_WRITE_MESSAGE,
  type CatalogOutlineWriteResponse,
  parseCatalogOutlineWriteRequest,
} from '@/features/timeline/catalogOutlineMessages';
import {
  restoreCatalogOutlineBucket,
  writeCatalogOutlineEdit,
} from '@/features/timeline/catalogOutlineWriter';

import { getSenderPageUrl, isTrustedExtensionPageSender } from './runtimeMessageRouting';

/** Only a top-frame content script of ours on one of the site's own pages may write its outlines. */
function isSiteSender(sender: chrome.runtime.MessageSender, siteId: string): boolean {
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;
  const site = BUNDLED_SITE_ADAPTERS.find((adapter) => adapter.id === siteId);
  const pageUrl = getSenderPageUrl(sender);
  return !!site && !!pageUrl && matchesAnyPattern(pageUrl, site.matches);
}

export function createCatalogOutlineMessageHandler(): (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => Promise<CatalogOutlineWriteResponse> | null {
  const queues = new Map<string, Promise<unknown>>();

  const enqueue = <T>(site: string, step: () => Promise<T>): Promise<T> => {
    const run = (queues.get(site) ?? Promise.resolve()).then(step);
    queues.set(
      site,
      run.catch(() => {}),
    );
    return run;
  };

  return (message, sender) => {
    if (typeof message !== 'object' || message === null) return null;
    const { type, payload } = message as { type?: unknown; payload?: unknown };
    if (type !== CATALOG_OUTLINE_WRITE_MESSAGE) return null;
    const request = parseCatalogOutlineWriteRequest(payload);
    if (!request) return Promise.resolve({ ok: false, error: 'invalid_payload' });

    if (request.kind === 'edit') {
      const site = catalogHierarchySiteOf(request.key)!;
      if (!isSiteSender(sender, site)) {
        return Promise.resolve({ ok: false, error: 'untrusted_sender' });
      }
      const { key, conversationId, edit } = request;
      return enqueue(site, () => writeCatalogOutlineEdit(key, conversationId, edit)).then(
        (ok): CatalogOutlineWriteResponse =>
          ok ? { ok: true } : { ok: false, error: 'write_failed' },
      );
    }

    const entries = Object.entries(request.buckets).map(
      ([key, bucket]) => [key, catalogHierarchySiteOf(key)!, bucket] as const,
    );
    // The popup restores every site; a page restores only its own site's buckets.
    if (
      !isTrustedExtensionPageSender(sender) &&
      !entries.every(([, site]) => isSiteSender(sender, site))
    ) {
      return Promise.resolve({ ok: false, error: 'untrusted_sender' });
    }
    return Promise.all(
      entries.map(([key, site, bucket]) =>
        enqueue(site, () => restoreCatalogOutlineBucket(key, bucket)),
      ),
    ).then((results): CatalogOutlineWriteResponse => {
      const restored = results.filter(Boolean).length;
      return { ok: true, restored, failed: results.length - restored };
    });
  };
}
