import type { DriveHistoryFile } from '@/core/types/driveHistory';
import type { SyncProvider } from '@/core/types/sync';
import {
  type SafariDriveAccountBinding,
  createSafariGoogleDriveFile,
  listSafariGoogleDriveHistory,
  trashSafariGoogleDriveFile,
} from '@/core/utils/safariGoogleDrive';

import { isSafariRuntime } from './GoogleDriveAuth';
import type { GoogleDriveBackupFolder } from './GoogleDriveBackupFolder';
import { DRIVE_API_BASE, DRIVE_UPLOAD_BASE } from './GoogleDriveFiles';

export const DRIVE_HISTORY_SOURCE_PROPERTY = 'voyagerHistorySource';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/** Source-marked files are siblings of current files, never backup-folder candidates. */
export class GoogleDriveHistoryFiles {
  constructor(
    private readonly folder: Pick<GoogleDriveBackupFolder, 'resolve'>,
    private readonly getProvider: () => SyncProvider,
    private readonly getDriveAccount: () => SafariDriveAccountBinding | undefined = () => undefined,
  ) {}

  supported(): boolean {
    return this.getProvider() === 'googleDrive';
  }

  async create(
    token: string,
    name: string,
    sourceName: string,
    text: string,
  ): Promise<DriveHistoryFile> {
    const appProperties = { [DRIVE_HISTORY_SOURCE_PROPERTY]: sourceName };
    if (isSafariRuntime()) {
      return createSafariGoogleDriveFile(name, appProperties, text, this.getDriveAccount());
    }
    const folderId = await this.folder.resolve(token, true);
    if (!folderId) throw new Error('Upload failed');
    const metadata = JSON.stringify({
      name,
      mimeType: 'application/json',
      parents: [folderId],
      appProperties,
    });
    let boundary = 'voyager-history';
    let suffix = 0;
    while (metadata.includes(boundary) || text.includes(boundary)) {
      boundary = `voyager-history-${++suffix}`;
    }
    // Commit the source marker and exact old media together; a failed create leaves no stub.
    const response = await fetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,createdTime`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body:
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n` +
          `--${boundary}--\r\n`,
      },
    );
    if (!response.ok) throw new Error(`Failed to create file: ${response.status}`);
    const raw: unknown = await response.json();
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      !raw.id ||
      typeof raw.createdTime !== 'string' ||
      !Number.isFinite(Date.parse(raw.createdTime))
    )
      throw new Error('Upload failed');
    return {
      id: raw.id,
      name,
      createdTime: raw.createdTime,
    };
  }

  async list(token: string, sourceName: string): Promise<DriveHistoryFile[]> {
    if (isSafariRuntime()) return listSafariGoogleDriveHistory(sourceName, this.getDriveAccount());
    const folderId = await this.folder.resolve(token, false);
    if (!folderId) return [];
    const files: DriveHistoryFile[] = [];
    const seenPages = new Set<string>();
    let pageToken: string | undefined;
    do {
      const url = new URL(`${DRIVE_API_BASE}/files`);
      url.searchParams.set(
        'q',
        `appProperties has { key='${DRIVE_HISTORY_SOURCE_PROPERTY}' and value='${escapeQuery(sourceName)}' } and '${escapeQuery(folderId)}' in parents and trashed=false`,
      );
      url.searchParams.set('fields', 'nextPageToken,files(id,name,createdTime)');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Failed to search files: ${response.status}`);
      const raw: unknown = await response.json();
      if (!isRecord(raw) || !Array.isArray(raw.files)) throw new Error('Download failed');
      for (const file of raw.files) {
        if (
          !isRecord(file) ||
          typeof file.id !== 'string' ||
          !file.id ||
          typeof file.name !== 'string' ||
          typeof file.createdTime !== 'string' ||
          !Number.isFinite(Date.parse(file.createdTime))
        ) {
          throw new Error('Download failed');
        }
        files.push({ id: file.id, name: file.name, createdTime: file.createdTime });
      }
      if (raw.nextPageToken !== undefined && typeof raw.nextPageToken !== 'string') {
        throw new Error('Download failed');
      }
      pageToken = raw.nextPageToken || undefined;
      if (pageToken) {
        if (seenPages.has(pageToken)) throw new Error('Download failed');
        seenPages.add(pageToken);
      }
    } while (pageToken);
    return files;
  }

  async trash(token: string, id: string): Promise<void> {
    if (isSafariRuntime()) return trashSafariGoogleDriveFile(id, this.getDriveAccount());
    const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  }
}
