import type { SyncProvider } from '@/core/types/sync';

import {
  classifySyncFile,
  commitSyncBookkeeping,
  hashSyncFileContent,
  readSyncBookkeeping,
  type SyncFileStatus,
  type SyncReadFile,
  type SyncStatusFileRequest,
  type DriveFileMetadata,
} from './CloudSyncBookkeeping';
import type { GoogleDriveFiles } from './GoogleDriveFiles';
import type { GoogleDriveIdentity } from './GoogleDriveIdentity';
import { nativeStarBaselineContent } from './GoogleDriveStarScope';
import { HIGHLIGHTS_FILE_NAME, STARS_FILE_NAME } from './GoogleDriveSyncFileNames';

/** Ephemeral receipts belong to a queue turn; partial operations never persist them. */
export class GoogleDriveBookkeepingTurn {
  readonly names = new Map<string, string>();
  readonly readsById = new Map<string, DriveFileMetadata>();
  readonly legacyTargets = new Map<string, string>();
  readonly writes = new Map<
    string,
    { id: string; content: unknown; metadata?: DriveFileMetadata }
  >();
  private captureReads = false;

  constructor(
    private readonly files: Pick<GoogleDriveFiles, 'metadata' | 'find'>,
    private readonly identity: GoogleDriveIdentity,
    private readonly provider: SyncProvider,
    private readonly token: () => Promise<string | null>,
  ) {}

  beginDownload(): void {
    this.captureReads = true;
  }

  async beforeRead(token: string, id: string): Promise<DriveFileMetadata | null> {
    return this.captureReads && this.provider === 'googleDrive'
      ? this.files.metadata(token, id)
      : null;
  }

  private async requireToken(): Promise<string> {
    const token = await this.token();
    if (!token) throw new Error('not_authenticated');
    return token;
  }

  async reads(): Promise<SyncReadFile[]> {
    const result: SyncReadFile[] = [];
    for (const [id, metadata] of this.readsById) {
      const name = this.names.get(id);
      if (!name) continue;
      const legacyMergedInto = this.legacyTargets.get(id);
      result.push({
        ...metadata,
        provider: this.provider,
        name,
        ...(legacyMergedInto ? { legacyMergedInto } : {}),
      });
    }
    return result;
  }

  async commit(localRequests: readonly SyncStatusFileRequest[] = []): Promise<void> {
    if (this.provider !== 'googleDrive' || !this.writes.size) return;
    const localHashes = new Map<string, string>();
    for (const request of localRequests) {
      const scope = request.accountScope ?? null;
      await this.identity.capture(scope);
      localHashes.set(
        this.identity.name(request.name, scope),
        await hashSyncFileContent(request.content),
      );
    }
    const files = [];
    for (const [name, write] of this.writes) {
      const metadata = write.metadata;
      if (!metadata) throw new Error('sync_metadata_unavailable');
      const nativeStars = nativeStarBaselineContent(name, write.content);
      const localContentHash =
        nativeStars === undefined ? localHashes.get(name) : await hashSyncFileContent(nativeStars);
      files.push({
        ...metadata,
        provider: this.provider,
        name,
        contentHash: await hashSyncFileContent(write.content),
        ...(localContentHash !== undefined ? { localContentHash } : {}),
        syncedAt: Date.now(),
      });
    }
    await commitSyncBookkeeping(files);
  }

  async applied(files: readonly (SyncReadFile & { content: unknown })[]): Promise<void> {
    await commitSyncBookkeeping(
      await Promise.all(
        files.map(async (file) => ({
          id: file.id,
          provider: file.provider,
          name: file.name,
          md5Checksum: file.md5Checksum,
          modifiedTime: file.modifiedTime,
          contentHash: await hashSyncFileContent(file.content),
          syncedAt: Date.now(),
          ...(file.legacyMergedInto ? { legacyMergedInto: file.legacyMergedInto } : {}),
        })),
      ),
    );
  }

  async status(requests: readonly SyncStatusFileRequest[]): Promise<SyncFileStatus[]> {
    if (this.provider !== 'googleDrive') throw new Error('unsupported_provider');
    const token = await this.requireToken();
    const baselines = await readSyncBookkeeping();
    const statuses: SyncFileStatus[] = [];
    for (const request of requests) {
      const scope = request.accountScope ?? null;
      await this.identity.capture(scope);
      let name = this.identity.name(request.name, scope);
      let id = await this.files.find(token, name);
      // Match the scoped download's base fallback without reading media on a status request.
      if (
        !id &&
        scope &&
        request.name !== HIGHLIGHTS_FILE_NAME &&
        request.name !== STARS_FILE_NAME
      ) {
        const fallback = await this.files.find(token, request.name);
        if (fallback) {
          name = request.name;
          id = fallback;
        }
      }
      const metadata = id ? await this.files.metadata(token, id) : null;
      statuses.push(
        classifySyncFile({
          request,
          name,
          provider: this.provider,
          contentHash: await hashSyncFileContent(request.content),
          metadata,
          baselines,
        }),
      );
    }
    return statuses;
  }
}
