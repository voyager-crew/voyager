import browser from 'webextension-polyfill';

import { parseDriveJson } from '@/core/utils/driveReadResult';

const SAFARI_NATIVE_APP_ID = 'com.yourCompany.Gemini-Voyager';

type NativeICloudResponse = {
  success?: boolean;
  data?: {
    available?: unknown;
    found?: unknown;
    json?: unknown;
    deleted?: unknown;
  };
  code?: unknown;
  error?: unknown;
  retryAfterMs?: unknown;
};

export class SafariICloudSyncError extends Error {
  readonly code: string | null;
  readonly retryAfterMs: number | null;

  constructor(message: string, code: string | null, retryAfterMs: number | null) {
    super(message);
    this.name = 'SafariICloudSyncError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

async function sendICloudMessage(message: Record<string, unknown>): Promise<NativeICloudResponse> {
  return browser.runtime.sendNativeMessage<Record<string, unknown>, NativeICloudResponse>(
    SAFARI_NATIVE_APP_ID,
    message,
  );
}

function responseError(response: NativeICloudResponse, fallback: string): Error {
  return new SafariICloudSyncError(
    typeof response.error === 'string' ? response.error : fallback,
    typeof response.code === 'string' ? response.code : null,
    typeof response.retryAfterMs === 'number' && Number.isFinite(response.retryAfterMs)
      ? Math.max(0, response.retryAfterMs)
      : null,
  );
}

export function isSafariICloudConflictError(error: unknown): boolean {
  return error instanceof SafariICloudSyncError && error.code === 'icloud_conflict';
}

export function getSafariICloudRetryDelay(error: unknown): number | null {
  return error instanceof SafariICloudSyncError ? error.retryAfterMs : null;
}

export async function checkSafariICloudAccount(): Promise<void> {
  const response = await sendICloudMessage({ action: 'iCloudAccountStatus' });
  if (response.success !== true || response.data?.available !== true) {
    throw responseError(response, 'iCloud is unavailable');
  }
}

export async function writeSafariICloudFile(fileName: string, value: unknown): Promise<void> {
  const response = await sendICloudMessage({
    action: 'iCloudWriteFile',
    fileName,
    json: JSON.stringify(value),
  });
  if (response.success !== true) {
    throw responseError(response, 'iCloud upload failed');
  }
}

export async function readSafariICloudFile<T>(fileName: string): Promise<T | null> {
  const response = await sendICloudMessage({ action: 'iCloudReadFile', fileName });
  if (response.success !== true) {
    throw responseError(response, 'iCloud download failed');
  }
  if (response.data?.found === false) return null;
  if (response.data?.found !== true || typeof response.data.json !== 'string') {
    throw new Error('The iCloud sync file is invalid');
  }
  return parseDriveJson(response.data.json) as T | null;
}

export async function deleteSafariICloudBackup(): Promise<number> {
  const response = await sendICloudMessage({ action: 'iCloudDeleteBackup' });
  if (response.success !== true || typeof response.data?.deleted !== 'number') {
    throw responseError(response, 'iCloud backup deletion failed');
  }
  return response.data.deleted;
}
