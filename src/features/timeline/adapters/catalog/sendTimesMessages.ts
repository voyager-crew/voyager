/**
 * The runtime message a catalog page sends to have one send time stored. The
 * background is the only writer of catalog send times (`sendTimesStore`); a
 * page reads them itself.
 */
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
// A conversation id becomes part of a storage key; route ids are plain tokens.
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_TURN_KEY_LENGTH = 512;

export function parseSendTimeRecordRequest(payload: unknown): SendTimeRecordRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { site, conversationId, turnKey, sentAt } = payload as Record<string, unknown>;
  if (typeof site !== 'string' || !SITE_ID.test(site)) return null;
  if (typeof conversationId !== 'string' || !CONVERSATION_ID.test(conversationId)) return null;
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
