/**
 * The single writer of catalog send times. Pages of every tab send
 * `SEND_TIME_RECORD_MESSAGE`; each site's writes and its prune run one at a
 * time in an in-memory queue, every step reading storage afresh, so two tabs
 * sending in one chat keep both times and a prune never deletes a chat that
 * just got a send. A worker restart drops what was queued: a missed time,
 * never a wrong one.
 */
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import {
  SEND_TIME_RECORD_MESSAGE,
  type SendTimeRecordResponse,
  parseSendTimeRecordRequest,
} from '@/features/timeline/adapters/catalog/sendTimesMessages';
import {
  catalogSendConversationCap,
  pruneSite,
  recordSendTime,
} from '@/features/timeline/adapters/catalog/sendTimesStore';

import { getSenderPageUrl } from './runtimeMessageRouting';

/** Only a top-frame content script of ours on one of the site's own pages may write its times. */
function isSiteSender(sender: chrome.runtime.MessageSender, siteId: string): boolean {
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;
  const site = BUNDLED_SITE_ADAPTERS.find((adapter) => adapter.id === siteId);
  const pageUrl = getSenderPageUrl(sender);
  return !!site && !!pageUrl && matchesAnyPattern(pageUrl, site.matches);
}

export function createSendTimeMessageHandler(
  options: { cap?: () => number } = {},
): (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => Promise<SendTimeRecordResponse> | null {
  const cap = options.cap ?? catalogSendConversationCap;
  const queues = new Map<string, Promise<unknown>>();
  /** Sites pruned in this worker's lifetime: pruning reads every listed conversation. */
  const pruned = new Set<string>();

  const enqueue = <T>(siteId: string, step: () => Promise<T>): Promise<T> => {
    const run = (queues.get(siteId) ?? Promise.resolve()).then(step);
    queues.set(
      siteId,
      run.catch(() => {}),
    );
    return run;
  };

  return (message, sender) => {
    if (typeof message !== 'object' || message === null) return null;
    const { type, payload } = message as { type?: unknown; payload?: unknown };
    if (type !== SEND_TIME_RECORD_MESSAGE) return null;
    const request = parseSendTimeRecordRequest(payload);
    if (!request) return Promise.resolve({ ok: false, error: 'invalid_payload' });
    if (!isSiteSender(sender, request.site)) {
      return Promise.resolve({ ok: false, error: 'untrusted_sender' });
    }
    const { site, conversationId, turnKey, sentAt } = request;
    return enqueue(site, async (): Promise<SendTimeRecordResponse> => {
      const times = await recordSendTime(site, `${site}:conv:${conversationId}`, turnKey, sentAt);
      if (!times) return { ok: false, error: 'read_failed' };
      if (!pruned.has(site)) {
        pruned.add(site);
        await pruneSite(site, cap());
      }
      return { ok: true, turns: [...times] };
    }).catch(() => ({ ok: false, error: 'write_failed' }));
  };
}
