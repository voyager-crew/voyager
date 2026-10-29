import { SafariGoogleDriveError } from '@/core/utils/safariGoogleDrive';

import {
  parseDriveFileMetadata,
  type DriveFileMetadata,
  DriveMetadataError,
} from './CloudSyncBookkeeping';

/** Native keeps the OAuth token; this action returns only public file metadata. */
export async function readSafariDriveMetadata(id: string): Promise<DriveFileMetadata | null> {
  const data = await sendMetadataMessage({ action: 'googleDriveGetFileMetadata', fileID: id });
  if ('found' in data && data.found === false) return null;
  return parseDriveFileMetadata(data);
}

/** The native upload response carries the metadata of that same atomic media write. */
export async function uploadSafariDriveWithMetadata(
  id: string,
  value: unknown,
): Promise<DriveFileMetadata> {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('invalid_sync_payload');
  const data = await sendMetadataMessage({ action: 'googleDriveUploadFile', fileID: id, json });
  if (!('saved' in data) || data.saved !== true) throw new DriveMetadataError();
  return parseDriveFileMetadata(data);
}

async function sendMetadataMessage(message: Record<string, unknown>): Promise<object> {
  const { default: browser } = await import('webextension-polyfill');
  const response: unknown = await browser.runtime.sendNativeMessage(
    'com.yourCompany.Gemini-Voyager',
    message,
  );
  if (
    !response ||
    typeof response !== 'object' ||
    !('success' in response) ||
    response.success !== true ||
    !('data' in response) ||
    !response.data ||
    typeof response.data !== 'object'
  ) {
    const error = response && typeof response === 'object' ? response : {};
    throw new SafariGoogleDriveError(
      'error' in error && typeof error.error === 'string' ? error.error : 'metadata_read_failed',
      'code' in error && typeof error.code === 'string' ? error.code : null,
      'retryAfterMs' in error && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : null,
    );
  }
  return response.data;
}
