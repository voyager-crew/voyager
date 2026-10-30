/**
 * Safari signs in to Google Drive in the Voyager app, after the popup has closed. A connect the
 * popup started is remembered here until the app reports a sign-in completed after it, so a
 * cancelled sign-in or an older session never counts as that connect succeeding.
 */
import { StorageKeys } from '@/core/types/common';

/** A sign-in completed this long after the click no longer answers it. */
export const GOOGLE_DRIVE_CONNECT_WINDOW_MS = 30 * 60 * 1000;

const PENDING_KEY = StorageKeys.GOOGLE_DRIVE_CONNECT_PENDING;

interface PendingConnect {
  startedAt: number;
}

function parsePendingConnect(value: unknown): PendingConnect | null {
  if (typeof value !== 'object' || value === null || !('startedAt' in value)) return null;
  const { startedAt } = value;
  return typeof startedAt === 'number' && Number.isFinite(startedAt) ? { startedAt } : null;
}

export async function recordGoogleDriveConnectStart(now: number = Date.now()): Promise<void> {
  const pending: PendingConnect = { startedAt: now };
  await chrome.storage.local.set({ [PENDING_KEY]: pending });
}

/**
 * True when the app's latest sign-in (`signedInAt`, null while signed out) completed within the
 * window after the pending connect. That answer, an expired or unreadable record, all clear it.
 */
export async function settleGoogleDriveConnect(
  signedInAt: number | null,
  now: number = Date.now(),
): Promise<boolean> {
  const stored = await chrome.storage.local.get(PENDING_KEY);
  if (!(PENDING_KEY in stored)) return false;
  const pending = parsePendingConnect(stored[PENDING_KEY]);
  const windowEnd = pending ? pending.startedAt + GOOGLE_DRIVE_CONNECT_WINDOW_MS : 0;
  const answered =
    pending !== null &&
    signedInAt !== null &&
    signedInAt >= pending.startedAt &&
    signedInAt <= windowEnd;
  if (answered || !pending || now > windowEnd || now < pending.startedAt) {
    await chrome.storage.local.remove(PENDING_KEY);
  }
  return answered;
}
