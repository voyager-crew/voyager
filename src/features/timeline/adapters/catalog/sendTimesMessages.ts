/**
 * The runtime message a catalog page sends to have one send time stored. The
 * background is the only writer of catalog send times (`sendTimesStore`); a
 * page reads them itself.
 */
import { MAX_REGEX_INPUT_LENGTH } from '@/features/plugins/sites/safeRegex';

import type { TurnTimes } from './sendTimesStore';

export const SEND_TIME_RECORD_MESSAGE = 'gv.sendTimes.record';

export interface SendTimeRecordRequest {
  site: string;
  conversationId: string;
  turnKey: string;
  sentAt: number;
}

/** The conversation's times after the write, as `[hashed turn key, ms]` pairs. */
export type SendTimeRecordResponse =
  | { ok: true; turns: Array<[string, number]> }
  | { ok: false; error: string };

const SITE_ID = /^[a-z][a-z0-9-]{0,63}$/;
// oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const MAX_TURN_KEY_LENGTH = 512;

/**
 * Anything a site's `conversationIdPattern` can capture from the route,
 * slashes included (`^/(c/[^/?#]+)` yields `c/abc123`); the storage key is just
 * a string. A stricter check would silently stop that site's stamps.
 */
function isConversationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REGEX_INPUT_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

export function parseSendTimeRecordRequest(payload: unknown): SendTimeRecordRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { site, conversationId, turnKey, sentAt } = payload as Record<string, unknown>;
  if (typeof site !== 'string' || !SITE_ID.test(site)) return null;
  if (!isConversationId(conversationId)) return null;
  if (typeof turnKey !== 'string' || turnKey.length === 0) return null;
  if (turnKey.length > MAX_TURN_KEY_LENGTH) return null;
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt) || sentAt <= 0) return null;
  return { site, conversationId, turnKey, sentAt };
}

/**
 * Asks the background to store one send. Resolves to the conversation's times
 * after the write, or null when nothing was stored.
 */
export function requestSendTimeRecord(request: SendTimeRecordRequest): Promise<TurnTimes | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: SEND_TIME_RECORD_MESSAGE, payload: request },
        (response?: SendTimeRecordResponse) => {
          if (chrome.runtime.lastError || !response?.ok || !Array.isArray(response.turns)) {
            resolve(null);
            return;
          }
          resolve(new Map(response.turns));
        },
      );
    } catch {
      // An invalidated extension context stores nothing.
      resolve(null);
    }
  });
}
