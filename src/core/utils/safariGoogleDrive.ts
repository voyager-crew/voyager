import browser from 'webextension-polyfill';

import type { DriveHistoryFile } from '@/core/types/driveHistory';
import { parseDriveJson } from '@/core/utils/driveReadResult';

export type { DriveHistoryFile } from '@/core/types/driveHistory';

const SAFARI_NATIVE_APP_ID = 'com.yourCompany.Gemini-Voyager';

export type SafariGoogleDriveSession = {
  signedIn: boolean;
  requiresAppLaunch: boolean;
};

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
  };
}

export async function signOutSafariGoogleDrive(): Promise<void> {
  const response = await sendNativeMessage({
    action: 'googleDriveSignOut',
  });
  requireSuccess(response, 'Safari Google Sign-Out failed');
}

export async function findSafariGoogleDriveFile(fileName: string): Promise<string | null> {
  const response = await sendNativeMessage({
    action: 'googleDriveFindFile',
    fileName,
  });
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
): Promise<string> {
  const response = await sendNativeMessage({
    action: 'googleDriveEnsureFile',
    fileName,
    ...(cachedFileID ? { cachedFileID } : {}),
  });
  return fileIDFromResponse(response);
}

export async function uploadSafariGoogleDriveFile(fileID: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  if (typeof json !== 'string') throw new Error('Safari Google Drive upload failed');
  return uploadSafariGoogleDriveText(fileID, json);
}

/** Preserve the exact media body when archiving an existing file, including unknown formats. */
export async function uploadSafariGoogleDriveText(fileID: string, json: string): Promise<void> {
  const response = await sendNativeMessage({ action: 'googleDriveUploadFile', fileID, json });
  const data = requireSuccess(response, 'Safari Google Drive upload failed');
  if (data.saved !== true) throw new Error('Safari Google Drive upload failed');
}

export async function downloadSafariGoogleDriveText(fileID: string): Promise<string | null> {
  const response = await sendNativeMessage({ action: 'googleDriveDownloadFile', fileID });
  const data = requireSuccess(response, 'Safari Google Drive download failed');
  if (data.found === false) return null;
  if (data.found !== true || typeof data.json !== 'string') {
    throw new Error('Safari Google Drive returned an invalid download');
  }
  return data.json;
}

export async function downloadSafariGoogleDriveFile<T>(fileID: string): Promise<T | null> {
  const text = await downloadSafariGoogleDriveText(fileID);
  // Only parsed reads strip a BOM; history keeps the exact raw media.
  return text === null ? null : (parseDriveJson(text.replace(/^\uFEFF/, '')) as T | null);
}

export async function createSafariGoogleDriveFile(
  fileName: string,
  appProperties: Record<string, string>,
  json: string,
): Promise<DriveHistoryFile> {
  const data = requireSuccess(
    await sendNativeMessage({ action: 'googleDriveCreateFile', fileName, appProperties, json }),
    'Safari Google Drive file creation failed',
  );
  return parseHistoryFile(data);
}

export async function listSafariGoogleDriveHistory(
  sourceFileName: string,
): Promise<DriveHistoryFile[]> {
  const data = requireSuccess(
    await sendNativeMessage({ action: 'googleDriveListHistory', sourceFileName }),
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

export async function trashSafariGoogleDriveFile(fileID: string): Promise<void> {
  const data = requireSuccess(
    await sendNativeMessage({ action: 'googleDriveTrashFile', fileID }),
    'Safari Google Drive upload failed',
  );
  if (data.trashed !== true) throw new Error('Safari Google Drive upload failed');
}
