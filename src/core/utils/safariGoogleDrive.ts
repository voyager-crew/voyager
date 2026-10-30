import browser from 'webextension-polyfill';

import type { DriveHistoryFile } from '@/core/types/driveHistory';
import { parseDriveJson } from '@/core/utils/driveReadResult';

export type { DriveHistoryFile } from '@/core/types/driveHistory';

const SAFARI_NATIVE_APP_ID = 'com.yourCompany.Gemini-Voyager';

export type SafariGoogleDriveSession = {
  signedIn: boolean;
  requiresAppLaunch: boolean;
  /** When the Voyager app last completed a Drive sign-in (ms since 1970), if it recorded one. */
  signedInAt: number | null;
  /** Names the signed-in Google account without revealing it; see SafariDriveAccountBinding. */
  driveAccount: string | null;
};

/**
 * The Google account a sync session's Drive requests are bound to. The Voyager app can sign in
 * another account at any time; a request names the account its session expects and the native
 * side refuses it once the app stores another, so one sync never mixes two Drives.
 */
export interface SafariDriveAccountBinding {
  /** The account the session's first answer named; null until then. */
  readonly driveAccount: string | null;
  /** Records the account an answer came from; a different one ends the session. */
  bindDriveAccount(account: string): void;
  /** The native side refused a request because the account changed. */
  endForDriveAccountChange(): void;
}

const DRIVE_ACCOUNT_CHANGED = 'drive_account_changed';

export class SafariGoogleDriveError extends Error {
  readonly code: string | null;
  readonly retryAfterMs: number | null;

  constructor(message: string, code: string | null, retryAfterMs: number | null) {
    super(message);
    this.name = 'SafariGoogleDriveError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isSafariGoogleDriveAuthError(error: unknown): boolean {
  return error instanceof SafariGoogleDriveError && error.code === 'drive_auth_required';
}

/** The session already ended for the new account; repeating the request cannot succeed. */
export function isSafariGoogleDriveAccountChangedError(error: unknown): boolean {
  return error instanceof SafariGoogleDriveError && error.code === DRIVE_ACCOUNT_CHANGED;
}

export function getSafariGoogleDriveRetryDelay(error: unknown): number | null {
  return error instanceof SafariGoogleDriveError ? error.retryAfterMs : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sendNativeMessage(message: Record<string, unknown>): Promise<unknown> {
  return browser.runtime.sendNativeMessage<Record<string, unknown>, unknown>(
    SAFARI_NATIVE_APP_ID,
    message,
  );
}

/** Every Drive transfer request carries the account its session expects and records the answer's. */
export async function sendSafariDriveMessage(
  message: Record<string, unknown>,
  account?: SafariDriveAccountBinding,
): Promise<unknown> {
  const expected = account?.driveAccount;
  const response = await sendNativeMessage(
    expected ? { ...message, expectedDriveAccount: expected } : message,
  );
  if (isRecord(response) && account) {
    if (response.code === DRIVE_ACCOUNT_CHANGED) account.endForDriveAccountChange();
    else if (
      response.success === true &&
      typeof response.driveAccount === 'string' &&
      response.driveAccount
    )
      account.bindDriveAccount(response.driveAccount);
  }
  return response;
}

function requireSuccess(response: unknown, fallback: string): Record<string, unknown> {
  if (!isRecord(response) || response.success !== true || !isRecord(response.data)) {
    throw new SafariGoogleDriveError(
      isRecord(response) && typeof response.error === 'string' ? response.error : fallback,
      isRecord(response) && typeof response.code === 'string' ? response.code : null,
      isRecord(response) &&
        typeof response.retryAfterMs === 'number' &&
        Number.isFinite(response.retryAfterMs)
        ? Math.max(0, response.retryAfterMs)
        : null,
    );
  }
  return response.data;
}

function fileIDFromResponse(response: unknown): string {
  const data = requireSuccess(response, 'Safari Google Drive file setup failed');
  if (typeof data.fileID !== 'string' || !data.fileID) {
    throw new Error('Safari Google Drive returned an invalid file ID');
  }
  return data.fileID;
}

export async function requestSafariGoogleDriveSession(
  interactive: boolean,
): Promise<SafariGoogleDriveSession> {
  const response = await sendNativeMessage({
    action: 'googleDriveGetSession',
    interactive,
  });
  const data = requireSuccess(response, 'Safari Google Sign-In is unavailable');
  return {
    signedIn: data.signedIn === true,
    requiresAppLaunch: data.requiresAppLaunch === true,
    signedInAt:
      typeof data.signedInAt === 'number' && Number.isFinite(data.signedInAt)
        ? data.signedInAt
        : null,
    driveAccount:
      isRecord(response) && typeof response.driveAccount === 'string' && response.driveAccount
        ? response.driveAccount
        : null,
  };
}

export async function signOutSafariGoogleDrive(): Promise<void> {
  const response = await sendNativeMessage({
    action: 'googleDriveSignOut',
  });
  requireSuccess(response, 'Safari Google Sign-Out failed');
}

export async function findSafariGoogleDriveFile(
  fileName: string,
  account?: SafariDriveAccountBinding,
): Promise<string | null> {
  const response = await sendSafariDriveMessage(
    { action: 'googleDriveFindFile', fileName },
    account,
  );
  const data = requireSuccess(response, 'Safari Google Drive file search failed');
  if (data.fileID === undefined || data.fileID === null) return null;
  if (typeof data.fileID !== 'string' || data.fileID.length === 0) {
    throw new Error('Safari Google Drive file search failed');
  }
  return data.fileID;
}

export async function ensureSafariGoogleDriveFile(
  fileName: string,
  cachedFileID: string | null,
  account?: SafariDriveAccountBinding,
): Promise<string> {
  const response = await sendSafariDriveMessage(
    { action: 'googleDriveEnsureFile', fileName, ...(cachedFileID ? { cachedFileID } : {}) },
    account,
  );
  return fileIDFromResponse(response);
}

/** Preserve the exact media body when archiving an existing file, including unknown formats. */
export async function uploadSafariGoogleDriveText(
  fileID: string,
  json: string,
  account?: SafariDriveAccountBinding,
): Promise<void> {
  const response = await sendSafariDriveMessage(
    { action: 'googleDriveUploadFile', fileID, json },
    account,
  );
  const data = requireSuccess(response, 'Safari Google Drive upload failed');
  if (data.saved !== true) throw new Error('Safari Google Drive upload failed');
}

export async function downloadSafariGoogleDriveText(
  fileID: string,
  account?: SafariDriveAccountBinding,
): Promise<string | null> {
  const response = await sendSafariDriveMessage(
    { action: 'googleDriveDownloadFile', fileID },
    account,
  );
  const data = requireSuccess(response, 'Safari Google Drive download failed');
  if (data.found === false) return null;
  if (data.found !== true || typeof data.json !== 'string') {
    throw new Error('Safari Google Drive returned an invalid download');
  }
  return data.json;
}

export async function downloadSafariGoogleDriveFile<T>(
  fileID: string,
  account?: SafariDriveAccountBinding,
): Promise<T | null> {
  const text = await downloadSafariGoogleDriveText(fileID, account);
  // Only parsed reads strip a BOM; history keeps the exact raw media.
  return text === null ? null : (parseDriveJson(text.replace(/^\uFEFF/, '')) as T | null);
}

export async function createSafariGoogleDriveFile(
  fileName: string,
  appProperties: Record<string, string>,
  json: string,
  account?: SafariDriveAccountBinding,
): Promise<DriveHistoryFile> {
  const data = requireSuccess(
    await sendSafariDriveMessage(
      { action: 'googleDriveCreateFile', fileName, appProperties, json },
      account,
    ),
    'Safari Google Drive file creation failed',
  );
  return parseHistoryFile(data);
}

export async function listSafariGoogleDriveHistory(
  sourceFileName: string,
  account?: SafariDriveAccountBinding,
): Promise<DriveHistoryFile[]> {
  const data = requireSuccess(
    await sendSafariDriveMessage({ action: 'googleDriveListHistory', sourceFileName }, account),
    'Safari Google Drive file search failed',
  );
  if (!Array.isArray(data.files)) throw new Error('Safari Google Drive file search failed');
  return data.files.map(parseHistoryFile);
}

function parseHistoryFile(file: unknown): DriveHistoryFile {
  if (
    !isRecord(file) ||
    typeof file.fileID !== 'string' ||
    !file.fileID ||
    typeof file.name !== 'string' ||
    !file.name ||
    typeof file.createdTime !== 'string' ||
    !Number.isFinite(Date.parse(file.createdTime))
  ) {
    throw new Error('Safari Google Drive returned invalid history metadata');
  }
  return { id: file.fileID, name: file.name, createdTime: file.createdTime };
}

export async function trashSafariGoogleDriveFile(
  fileID: string,
  account?: SafariDriveAccountBinding,
): Promise<void> {
  const data = requireSuccess(
    await sendSafariDriveMessage({ action: 'googleDriveTrashFile', fileID }, account),
    'Safari Google Drive upload failed',
  );
  if (data.trashed !== true) throw new Error('Safari Google Drive upload failed');
}
