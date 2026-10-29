/**
 * `gv.storageBudget.writeCopy`: a page asks the background to write one legacy
 * backup copy (`DataBackupService`) inside the storage budget, which measures
 * fresh and admits or skips it in the same step (addendum P3P4 R6.1, F1, F3).
 */
import browser from 'webextension-polyfill';

import { parseDataBackupKey } from '@/core/services/dataBackupKeys';

export const WRITE_COPY_MESSAGE = 'gv.storageBudget.writeCopy';
export const CLEAN_UNDONE_COPIES_MESSAGE = 'gv.storageBudget.cleanUndoneCopies';

export interface WriteCopyMessage {
  type: typeof WRITE_COPY_MESSAGE;
  key: string;
  value: string;
}

export type WriteCopyReply = { status: 'saved' } | { status: 'skipped' };
export type CleanUndoneCopiesReply = { status: 'cleared' } | { status: 'failed' };

export function isCleanUndoneCopiesMessage(
  message: unknown,
): message is { type: typeof CLEAN_UNDONE_COPIES_MESSAGE } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === CLEAN_UNDONE_COPIES_MESSAGE
  );
}

/** The background reads the current suppression itself and cleans inside its backup write queue. */
export async function requestUndoneBackupCleanup(): Promise<boolean> {
  try {
    const reply: unknown = await browser.runtime.sendMessage({ type: CLEAN_UNDONE_COPIES_MESSAGE });
    return (
      typeof reply === 'object' && reply !== null && 'status' in reply && reply.status === 'cleared'
    );
  } catch {
    return false;
  }
}

export function isWriteCopyMessage(message: unknown): message is WriteCopyMessage {
  if (typeof message !== 'object' || message === null) return false;
  const { type, key, value } = message as Record<string, unknown>;
  return (
    type === WRITE_COPY_MESSAGE &&
    typeof key === 'string' &&
    parseDataBackupKey(key) !== null &&
    typeof value === 'string'
  );
}

/**
 * Sends the copy before any await, so an unloading page still dispatches it.
 * Resolves `true` only once the background wrote it; an unreachable background
 * (waking, or this page's extension context gone) skips the copy.
 */
export function requestBudgetCopy(key: string, value: string): Promise<boolean> {
  const message: WriteCopyMessage = { type: WRITE_COPY_MESSAGE, key, value };
  try {
    return browser.runtime.sendMessage(message).then(
      (reply: unknown) => (reply as WriteCopyReply | undefined)?.status === 'saved',
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
