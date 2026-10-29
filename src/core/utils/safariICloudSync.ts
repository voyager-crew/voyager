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
    errors?: unknown;
  };
  code?: unknown;
  error?: unknown;
  retryAfterMs?: unknown;
};

export class SafariICloudSyncError extends Error {
  readonly code: string | null;
  readonly retryAfterMs: number | null;
  readonly deleted: number | null;
  readonly errors: readonly SafariICloudDeleteIssue[];

  constructor(
    message: string,
    code: string | null,
    retryAfterMs: number | null,
    progress?: { deleted: number; errors: SafariICloudDeleteIssue[] },
  ) {
    super(message);
    this.name = 'SafariICloudSyncError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.deleted = progress?.deleted ?? null;
    this.errors = progress?.errors ?? [];
  }
}

export interface SafariICloudDeleteIssue {
  recordName: string | null;
  error: string;
  code: string | null;
  retryAfterMs: number | null;
}

function parseDeleteIssues(value: unknown): SafariICloudDeleteIssue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('iCloud backup deletion failed');
  return value.map((issue: unknown) => {
    if (
      typeof issue !== 'object' ||
      issue === null ||
      !('error' in issue) ||
      typeof issue.error !== 'string'
    )
      throw new Error('iCloud backup deletion failed');
    return {
      recordName:
        'recordName' in issue && typeof issue.recordName === 'string' ? issue.recordName : null,
      error: issue.error,
      code: 'code' in issue && typeof issue.code === 'string' ? issue.code : null,
      retryAfterMs:
        'retryAfterMs' in issue &&
        typeof issue.retryAfterMs === 'number' &&
        Number.isFinite(issue.retryAfterMs)
          ? Math.max(0, issue.retryAfterMs)
          : null,
    };
  });
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
  if (
    response.success !== true ||
    typeof response.data?.deleted !== 'number' ||
    !Number.isSafeInteger(response.data.deleted) ||
    response.data.deleted < 0
  ) {
    throw responseError(response, 'iCloud backup deletion failed');
  }
  const errors = parseDeleteIssues(response.data.errors);
  if (errors.length)
    throw new SafariICloudSyncError(errors[0].error, errors[0].code, errors[0].retryAfterMs, {
      deleted: response.data.deleted,
      errors,
    });
  return response.data.deleted;
}
