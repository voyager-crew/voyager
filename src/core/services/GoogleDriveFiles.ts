import type { DriveHistoryFile } from '@/core/types/driveHistory';
import type { SyncProvider } from '@/core/types/sync';
import { UnrecognizedDriveFileError, parseDriveJson } from '@/core/utils/driveReadResult';
import {
  downloadSafariGoogleDriveFile,
  downloadSafariGoogleDriveText,
  ensureSafariGoogleDriveFile,
  findSafariGoogleDriveFile,
  getSafariGoogleDriveRetryDelay,
  isSafariGoogleDriveAuthError,
  uploadSafariGoogleDriveText,
} from '@/core/utils/safariGoogleDrive';
import {
  getSafariICloudRetryDelay,
  isSafariICloudConflictError,
  readSafariICloudFile,
  writeSafariICloudFile,
} from '@/core/utils/safariICloudSync';

import {
  parseDriveFileMetadata,
  type DriveFileMetadata,
  DriveMetadataError,
} from './CloudSyncBookkeeping';
import { isSafariRuntime } from './GoogleDriveAuth';
import type { GoogleDriveBackupFolder } from './GoogleDriveBackupFolder';
import { GoogleDriveHistoryFiles } from './GoogleDriveHistoryFiles';
import { readSafariDriveMetadata, uploadSafariDriveWithMetadata } from './GoogleDriveMetadata';
import { logger } from './LoggerService';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/** Owns file discovery/cache, relocation and provider-specific media retry policy. */
export class GoogleDriveFiles {
  private fileIdByName: Record<string, string> = {};
  private readonly history: GoogleDriveHistoryFiles;
  constructor(
    private readonly folder: GoogleDriveBackupFolder,
    private readonly options: {
      getProvider: () => SyncProvider;
      onAuthLost: (error: unknown) => void;
    },
  ) {
    this.history = new GoogleDriveHistoryFiles(folder, options.getProvider);
  }
  reset(): void {
    this.folder.reset();
    this.fileIdByName = {};
  }

  supportsHistory(): boolean {
    return this.history.supported();
  }

  /** Status never downloads file media. A missing or trashed file has no cloud version. */
  async metadata(token: string, id: string): Promise<DriveFileMetadata | null> {
    return this.retryMedia(async () => {
      if (this.options.getProvider() === 'icloud') throw new Error('unsupported_provider');
      if (isSafariRuntime()) return readSafariDriveMetadata(id);
      const response = await fetch(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(id)}?fields=id,md5Checksum,modifiedTime,trashed`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('metadata_read_failed');
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && 'trashed' in value && value.trashed === true)
        return null;
      return parseDriveFileMetadata(value);
    });
  }

  async createHistory(
    token: string,
    name: string,
    sourceName: string,
    text: string,
  ): Promise<DriveHistoryFile> {
    return this.historyOperation(() => this.history.create(token, name, sourceName, text));
  }

  async listHistory(token: string, sourceName: string): Promise<DriveHistoryFile[]> {
    return this.historyOperation(() => this.history.list(token, sourceName));
  }

  async trash(token: string, id: string): Promise<void> {
    return this.historyOperation(() => this.history.trash(token, id));
  }

  private async historyOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.markAuthLostIfNeeded(error);
      throw error;
    }
  }

  async find(token: string, fileName: string): Promise<string | null> {
    if (this.options.getProvider() === 'icloud') {
      return fileName;
    }

    if (isSafariRuntime()) {
      return findSafariGoogleDriveFile(fileName);
    }

    if (this.folder.id) {
      const folderFileId = await this.searchDriveFile(token, fileName, this.folder.id);
      if (folderFileId) return folderFileId;
    }

    // Backward compatibility: files created by older versions may still live
    // outside the resolved folder. Uploads move this fallback result into the
    // stable folder; downloads can still recover it before that happens.
    return this.searchDriveFile(token, fileName, null);
  }

  private async searchDriveFile(
    token: string,
    fileName: string,
    parentId: string | null,
  ): Promise<string | null> {
    const parentClause = parentId
      ? ` and '${this.escapeDriveQueryValue(parentId)}' in parents`
      : '';
    const query = encodeURIComponent(
      `name='${this.escapeDriveQueryValue(fileName)}' and trashed=false${parentClause}`,
    );
    const url = `${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      throw new Error(`Failed to search files: ${response.status}`);
    }
    const result: unknown = await response.json().catch(() => {
      throw new Error(`Failed to search files: ${response.status}`);
    });
    if (
      !result ||
      typeof result !== 'object' ||
      !('files' in result) ||
      !Array.isArray(result.files)
    ) {
      throw new Error(`Failed to search files: ${response.status}`);
    }
    let firstId: string | null = null;
    const candidates: unknown[] = result.files;
    for (const file of candidates) {
      if (
        !file ||
        typeof file !== 'object' ||
        !('id' in file) ||
        typeof file.id !== 'string' ||
        file.id.length === 0
      ) {
        throw new Error(`Failed to search files: ${response.status}`);
      }
      firstId ??= file.id;
    }
    return firstId;
  }

  async ensure(token: string, fileName: string, knownFileId?: string | null): Promise<string> {
    if (this.options.getProvider() === 'icloud') {
      return fileName;
    }

    if (isSafariRuntime()) {
      const fileId = await ensureSafariGoogleDriveFile(
        fileName,
        knownFileId === undefined ? (this.fileIdByName[fileName] ?? null) : knownFileId,
      );
      this.fileIdByName[fileName] = fileId;
      return fileId;
    }

    // 1. Ensure backup folder exists
    const folderId = await this.ensureBackupFolder(token);

    if (knownFileId) {
      this.fileIdByName[fileName] = knownFileId;
      const parents = await this.getFileParents(token, knownFileId);
      if (parents && !parents.includes(folderId))
        await this.moveFile(token, knownFileId, folderId, parents);
      return knownFileId;
    }

    // 2. Check if we have a valid cached file ID
    const currentId = knownFileId === null ? null : (this.fileIdByName[fileName] ?? null);

    if (currentId) {
      const parents = await this.getFileParents(token, currentId);
      if (parents) {
        // File exists
        if (!parents.includes(folderId)) {
          // File exists but not in the backup folder, move it
          logger.info(`[GoogleDriveSyncService] Moving ${fileName} to backup folder`);
          await this.moveFile(token, currentId, folderId, parents);
        }
        return currentId;
      }
      // If checkFileParents returns null, the file doesn't exist (e.g. deleted externally), proceed to find/create
    }

    // 3. Search for the file globally (in case it was created before but we lost the ID reference)
    const existingId = knownFileId === undefined ? await this.find(token, fileName) : null;
    if (existingId) {
      // Found existing file
      this.fileIdByName[fileName] = existingId;

      // Check if it needs moving
      const parents = await this.getFileParents(token, existingId);
      if (parents && !parents.includes(folderId)) {
        logger.info(`[GoogleDriveSyncService] Moving existing ${fileName} to backup folder`);
        await this.moveFile(token, existingId, folderId, parents);
      }
      return existingId;
    }

    // 4. Create new file in the backup folder
    logger.info(`[GoogleDriveSyncService] Creating new file ${fileName} in backup folder`);
    const newId = await this.createFile(token, fileName, folderId);
    this.fileIdByName[fileName] = newId;
    return newId;
  }

  private async ensureBackupFolder(token: string): Promise<string> {
    const folderId = await this.folder.resolve(token, true);
    if (!folderId) throw new Error('Failed to create backup folder');
    return folderId;
  }

  async prepareDownload(token: string): Promise<void> {
    if (this.options.getProvider() === 'icloud' || isSafariRuntime()) return;

    try {
      await this.folder.resolve(token, false);
    } catch (error) {
      // Folder metadata migration must never block a read-only download. Any
      // subsequent upload will retry the same migration before writing files.
      console.warn('[GoogleDriveSyncService] Backup folder migration deferred:', error);
    }
  }

  private async getFileParents(token: string, fileId: string): Promise<string[] | null> {
    try {
      // Also check if file is trashed - if so, treat as non-existent
      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?fields=parents,trashed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) return null;
      const data = await response.json();
      // If file is in trash, treat as non-existent so we create a new one
      if (data.trashed) {
        logger.info(`[GoogleDriveSyncService] File ${fileId} is in trash, will create new one`);
        return null;
      }
      return data.parents || [];
    } catch {
      return null;
    }
  }

  private async moveFile(
    token: string,
    fileId: string,
    targetFolderId: string,
    currentParents: string[],
  ): Promise<void> {
    const previousParents = currentParents.join(',');
    const url = `${DRIVE_API_BASE}/files/${fileId}?addParents=${targetFolderId}&removeParents=${previousParents}&fields=id,parents`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.error('[GoogleDriveSyncService] Failed to move file:', await response.text());
      // Don't throw, just log. It's not critical if move fails, as long as we can access the file.
    }
  }

  private async createFile(token: string, fileName: string, parentId?: string): Promise<string> {
    const metadata: { name: string; mimeType: string; parents?: string[] } = {
      name: fileName,
      mimeType: 'application/json',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const response = await fetch(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    if (!response.ok) {
      throw new Error(`Failed to create file: ${response.status}`);
    }
    const result = await response.json();
    return result.id;
  }

  async upload(token: string, fileId: string, data: unknown): Promise<DriveFileMetadata | void> {
    let delay = INITIAL_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (this.options.getProvider() === 'icloud') {
          await writeSafariICloudFile(fileId, data);
          return;
        }

        if (isSafariRuntime()) {
          return await uploadSafariDriveWithMetadata(fileId, data);
        }

        const url = `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,md5Checksum,modifiedTime`;
        const response = await fetch(url, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!response.ok) {
          throw new Error(`Upload failed: ${response.status}`);
        }
        const metadata: unknown = await response.json().catch(() => {
          throw new DriveMetadataError();
        });
        return parseDriveFileMetadata(metadata);
      } catch (error) {
        // A malformed success receipt is not permission to repeat a media write that succeeded.
        if (error instanceof DriveMetadataError) throw error;
        if (isSafariICloudConflictError(error)) throw error;
        if (this.markAuthLostIfNeeded(error)) throw error;
        if (attempt === MAX_RETRIES) throw error;
        await this.sleep(
          Math.max(
            delay,
            getSafariICloudRetryDelay(error) ?? 0,
            getSafariGoogleDriveRetryDelay(error) ?? 0,
          ),
        );
        delay *= 2;
      }
    }
  }

  async download<T>(token: string, fileId: string): Promise<T | null> {
    let delay = INITIAL_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (this.options.getProvider() === 'icloud') {
          return await readSafariICloudFile<T>(fileId);
        }

        if (isSafariRuntime()) {
          return await downloadSafariGoogleDriveFile<T>(fileId);
        }

        const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          if (response.status === 404) return null;
          throw new Error(`Download failed: ${response.status}`);
        }
        return parseDriveJson(await response.text()) as T | null;
      } catch (error) {
        if (error instanceof UnrecognizedDriveFileError) throw error;
        if (this.markAuthLostIfNeeded(error)) throw error;
        if (attempt === MAX_RETRIES) throw error;
        await this.sleep(Math.max(delay, getSafariGoogleDriveRetryDelay(error) ?? 0));
        delay *= 2;
      }
    }
    return null;
  }

  /** History preserves the old media bytes, even when the current build cannot decode them. */
  async downloadText(token: string, fileId: string): Promise<string | null> {
    return this.retryMedia(async () => {
      if (this.options.getProvider() === 'icloud') throw new Error('Download failed');
      if (isSafariRuntime()) return downloadSafariGoogleDriveText(fileId);
      const response = await fetch(`${DRIVE_API_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      // Preserve a UTF-8 BOM; invalid bytes must abort rather than become replacement text.
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await response.arrayBuffer(),
      );
    });
  }

  async uploadText(token: string, fileId: string, text: string): Promise<void> {
    await this.retryMedia(async () => {
      if (this.options.getProvider() === 'icloud') throw new Error('Upload failed');
      if (isSafariRuntime()) return uploadSafariGoogleDriveText(fileId, text);
      const response = await fetch(`${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: text,
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    });
  }

  private async retryMedia<T>(operation: () => Promise<T>): Promise<T> {
    let delay = INITIAL_RETRY_DELAY_MS;
    for (let attempt = 1; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (isSafariICloudConflictError(error)) throw error;
        if (this.markAuthLostIfNeeded(error)) throw error;
        if (attempt === MAX_RETRIES) throw error;
        await this.sleep(Math.max(delay, getSafariGoogleDriveRetryDelay(error) ?? 0));
        delay *= 2;
      }
    }
  }

  /**
   * Safari native bridge signals a permanently revoked/expired Google session
   * with a structured code; retrying it is pointless, so surface it at once
   * and flip the authenticated flag so the UI offers reconnecting.
   */
  private markAuthLostIfNeeded(error: unknown): boolean {
    if (!isSafariGoogleDriveAuthError(error)) return false;
    this.options.onAuthLost(error);
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private escapeDriveQueryValue(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  }
}

/** Only a session-bound turn exposes this port to transfer planners. */
export type DriveFilesPort = Pick<
  GoogleDriveFiles,
  | 'find'
  | 'metadata'
  | 'ensure'
  | 'upload'
  | 'download'
  | 'prepareDownload'
  | 'supportsHistory'
  | 'downloadText'
  | 'uploadText'
  | 'createHistory'
  | 'listHistory'
  | 'trash'
>;
