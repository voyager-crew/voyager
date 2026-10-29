import browser from 'webextension-polyfill';

import { SafariICloudSyncError } from './safariICloudSync';

export function isICloudRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function invalidICloudResponse(): Error {
  return new SafariICloudSyncError(
    'The iCloud sync file is invalid',
    'icloud_invalid_payload',
    null,
  );
}

export async function sendICloudRequest(
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response: unknown = await browser.runtime.sendNativeMessage(
    'com.yourCompany.Gemini-Voyager',
    message,
  );
  if (!isICloudRecord(response)) throw invalidICloudResponse();
  if (response.success !== true) {
    throw new SafariICloudSyncError(
      typeof response.error === 'string' ? response.error : 'iCloud upload failed',
      typeof response.code === 'string' ? response.code : null,
      typeof response.retryAfterMs === 'number' && Number.isFinite(response.retryAfterMs)
        ? Math.max(0, response.retryAfterMs)
        : null,
    );
  }
  if (!isICloudRecord(response.data)) throw invalidICloudResponse();
  return response.data;
}

export async function readICloudUploadVersion(
  fileName: string,
): Promise<{ json: string | null; version: string | null }> {
  const data = await sendICloudRequest({ action: 'iCloudReadUploadVersion', fileName });
  if (data.found === false && data.json == null && data.version == null)
    return { json: null, version: null };
  if (
    data.found === true &&
    typeof data.json === 'string' &&
    typeof data.version === 'string' &&
    data.version
  )
    return { json: data.json, version: data.version };
  throw invalidICloudResponse();
}
