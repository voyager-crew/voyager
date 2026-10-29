import browser from 'webextension-polyfill';

import { parseDriveJson } from '@/core/utils/driveReadResult';

const SAFARI_NATIVE_APP_ID = 'com.yourCompany.Gemini-Voyager';

type NativeResponse<Data> = {
  success?: boolean;
  data?: Data;
  error?: unknown;
  code?: unknown;
  retryAfterMs?: unknown;
};

type NativeSessionData = {
  signedIn?: unknown;
  requiresAppLaunch?: unknown;
};

type NativeFileData = {
  fileID?: unknown;
};

type NativeDownloadData = {
  found?: unknown;
  json?: unknown;
};

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

async function sendNativeMessage<Data>(
  message: Record<string, unknown>,
): Promise<NativeResponse<Data>> {
  return browser.runtime.sendNativeMessage<Record<string, unknown>, NativeResponse<Data>>(
    SAFARI_NATIVE_APP_ID,
    message,
  );
}

function requireSuccess<Data>(response: NativeResponse<Data>, fallback: string): Data {
  if (response?.success !== true || response.data === undefined) {
    throw new SafariGoogleDriveError(
      typeof response?.error === 'string' ? response.error : fallback,
      typeof response?.code === 'string' ? response.code : null,
      typeof response?.retryAfterMs === 'number' && Number.isFinite(response.retryAfterMs)
        ? Math.max(0, response.retryAfterMs)
        : null,
    );
  }
  return response.data;
}

export async function requestSafariGoogleDriveSession(
  interactive: boolean,
): Promise<SafariGoogleDriveSession> {
  const response = await sendNativeMessage<NativeSessionData>({
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
  const response = await sendNativeMessage<{ signedOut?: unknown }>({
    action: 'googleDriveSignOut',
  });
  requireSuccess(response, 'Safari Google Sign-Out failed');
}

export async function findSafariGoogleDriveFile(fileName: string): Promise<string | null> {
  const response = await sendNativeMessage<NativeFileData>({
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
  const response = await sendNativeMessage<NativeFileData>({
    action: 'googleDriveEnsureFile',
    fileName,
    ...(cachedFileID ? { cachedFileID } : {}),
  });
  const data = requireSuccess(response, 'Safari Google Drive file setup failed');
  if (typeof data.fileID !== 'string' || !data.fileID) {
    throw new Error('Safari Google Drive returned an invalid file ID');
  }
  return data.fileID;
}

export async function uploadSafariGoogleDriveFile(fileID: string, data: unknown): Promise<void> {
  const response = await sendNativeMessage<{ saved?: unknown }>({
    action: 'googleDriveUploadFile',
    fileID,
    json: JSON.stringify(data),
  });
  requireSuccess(response, 'Safari Google Drive upload failed');
}

export async function downloadSafariGoogleDriveFile<T>(fileID: string): Promise<T | null> {
  const response = await sendNativeMessage<NativeDownloadData>({
    action: 'googleDriveDownloadFile',
    fileID,
  });
  const data = requireSuccess(response, 'Safari Google Drive download failed');
  if (data.found === false) return null;
  if (data.found !== true || typeof data.json !== 'string') {
    throw new Error('Safari Google Drive returned an invalid download');
  }
  return parseDriveJson(data.json) as T | null;
}
