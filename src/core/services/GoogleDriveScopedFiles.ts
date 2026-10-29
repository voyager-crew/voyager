import type { SyncAccountScope } from '@/core/types/sync';
import { hashValue } from '@/core/utils/canonicalHash';
import { readDriveValue } from '@/core/utils/driveReadResult';

import {
  readSyncBookkeeping,
  type DriveFileMetadata,
  type SyncFileBaseline,
} from './CloudSyncBookkeeping';
import type { DriveFilesPort } from './GoogleDriveFiles';
import { GoogleDriveIdentity, scopedDriveFileName } from './GoogleDriveIdentity';
import {
  mergeLegacyDrivePayload,
  prepareStarredMergeBase,
  translateCloudIdentity,
} from './GoogleDriveLegacyMerge';
import { readLegacyMergeSources, withLegacyMergeSources } from './GoogleDriveLegacySources';

/** Email-named primary, optional base fallback, and only locally bound route merge sources. */
export class GoogleDriveScopedFiles {
  private readonly mergedSources = new Map<string, Record<string, string>>();
  private readonly publishedSources = new Map<string, Record<string, string>>();
  private baselines: Promise<Record<string, SyncFileBaseline>> | undefined;

  constructor(
    private readonly files: Pick<
      DriveFilesPort,
      'find' | 'download' | 'metadata' | 'supportsHistory'
    >,
    readonly identity = new GoogleDriveIdentity(),
    private readonly onLegacyRead?: (metadata: DriveFileMetadata, target: string) => void,
  ) {}

  name(base: string, scope: SyncAccountScope | null): string {
    return this.identity.name(base, scope);
  }

  async read(
    token: string,
    base: string,
    scope: SyncAccountScope | null,
    fallbackBase = true,
  ): Promise<unknown | null> {
    return (await this.readWithAuthority(token, base, scope, fallbackBase)).value;
  }

  async readWithAuthority(
    token: string,
    base: string,
    scope: SyncAccountScope | null,
    fallbackBase = true,
  ): Promise<{ value: unknown | null; authorized: boolean }> {
    await this.identity.capture(scope);
    const id = await this.files.find(token, this.name(base, scope));
    let value = id ? await this.files.download<unknown>(token, id) : null;
    if (!scope) return { value, authorized: false };
    const primaryExists = value !== null;
    this.rememberSources(base, scope, value);
    let authorized = value !== null;
    const identity = this.identity.get(scope);
    if (value !== null)
      value = translateCloudIdentity(value, { ...scope, accountKey: identity.emailKey }, scope);
    if (value === null && fallbackBase) {
      const legacy = await this.files.find(token, base);
      value = legacy ? await this.files.download<unknown>(token, legacy) : null;
    }
    for (const source of identity.legacy) {
      const payload = await this.readLegacy(token, base, scope, source, primaryExists);
      if (payload !== null) {
        if (value !== null) value = prepareStarredMergeBase(value, scope, authorized);
        value = mergeLegacyDrivePayload(value, payload, source, scope);
        authorized = true;
      }
    }
    return { value, authorized };
  }

  private rememberSources(base: string, scope: SyncAccountScope, value: unknown): void {
    const name = this.name(base, scope);
    const published = readLegacyMergeSources(value);
    this.publishedSources.set(name, published);
    this.mergedSources.set(name, {
      ...published,
      ...this.mergedSources.get(name),
    });
  }

  withSources(name: string, value: unknown): unknown {
    return withLegacyMergeSources(value, this.mergedSources.get(name) ?? {});
  }

  private async wasApplied(
    id: string,
    name: string,
    target: string,
    checksum: string,
  ): Promise<boolean> {
    this.baselines ??= readSyncBookkeeping();
    const provider = this.files.supportsHistory() ? 'googleDrive' : 'icloud';
    return Object.values(await this.baselines).some(
      (file) =>
        file.provider === provider &&
        file.id === id &&
        file.name === name &&
        file.legacyMergedInto === target &&
        file.md5Checksum === checksum,
    );
  }

  private async readLegacy(
    token: string,
    base: string,
    scope: SyncAccountScope,
    source: SyncAccountScope,
    primaryExists: boolean,
  ): Promise<unknown | null> {
    const name = scopedDriveFileName(base, source.accountKey);
    const id = await this.files.find(token, name);
    if (!id) return null;
    const metadata = this.files.supportsHistory() ? await this.files.metadata(token, id) : null;
    const sources = this.mergedSources.get(this.name(base, scope)) ?? {};
    if (metadata && primaryExists) {
      if (
        this.publishedSources.get(this.name(base, scope))?.[id] === metadata.md5Checksum ||
        (await this.wasApplied(id, name, this.name(base, scope), metadata.md5Checksum))
      ) {
        // A completed local merge can also publish its checkpoint on the next upload.
        sources[id] = metadata.md5Checksum;
        this.mergedSources.set(this.name(base, scope), sources);
        return null;
      }
    }
    const payload = await this.files.download<unknown>(token, id);
    if (payload !== null) {
      // iCloud exposes no md5 metadata; compare a canonical content digest after reading it.
      const checksum = metadata?.md5Checksum ?? `sha256:${await hashValue(payload)}`;
      sources[id] = checksum;
      this.mergedSources.set(this.name(base, scope), sources);
      if (
        primaryExists &&
        (this.publishedSources.get(this.name(base, scope))?.[id] === checksum ||
          (!metadata && (await this.wasApplied(id, name, this.name(base, scope), checksum))))
      )
        return null;
      this.onLegacyRead?.(
        metadata ?? {
          id,
          md5Checksum: checksum,
          modifiedTime: '1970-01-01T00:00:00.000Z',
        },
        this.name(base, scope),
      );
    }
    return payload;
  }

  toCloud(value: unknown, scope: SyncAccountScope | null): unknown {
    return scope
      ? translateCloudIdentity(value, scope, {
          ...scope,
          accountKey: this.identity.get(scope).emailKey,
        })
      : value;
  }

  async mergeForUpload<T>(
    token: string,
    base: string,
    scope: SyncAccountScope | null,
    value: T,
  ): Promise<T> {
    await this.identity.capture(scope);
    if (!scope) return value;
    const primaryId = await this.files.find(token, this.name(base, scope));
    const read = await readDriveValue(() =>
      primaryId ? this.files.download<unknown>(token, primaryId) : Promise.resolve(null),
    );
    if (read.kind === 'failed') throw read.error;
    const primary = read.kind === 'found' ? read.value : null;
    this.rememberSources(base, scope, primary);
    let merged: unknown = value;
    for (const source of this.identity.get(scope).legacy) {
      const legacy = await this.readLegacy(token, base, scope, source, read.kind !== 'missing');
      if (legacy !== null) merged = mergeLegacyDrivePayload(merged, legacy, source, scope);
    }
    // The per-format merge parser validates incoming entries and keeps the input envelope kind.
    return merged as T;
  }
}
