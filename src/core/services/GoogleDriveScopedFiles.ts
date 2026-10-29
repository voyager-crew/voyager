import type { SyncAccountScope } from '@/core/types/sync';

import type { DriveFilesPort } from './GoogleDriveFiles';
import { GoogleDriveIdentity, scopedDriveFileName } from './GoogleDriveIdentity';
import {
  mergeLegacyDrivePayload,
  prepareStarredMergeBase,
  translateCloudIdentity,
} from './GoogleDriveLegacyMerge';

/** Email-named primary, optional base fallback, and only locally bound route merge sources. */
export class GoogleDriveScopedFiles {
  constructor(
    private readonly files: Pick<DriveFilesPort, 'find' | 'download'>,
    readonly identity = new GoogleDriveIdentity(),
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
    let authorized = value !== null;
    const identity = this.identity.get(scope);
    if (value !== null)
      value = translateCloudIdentity(value, { ...scope, accountKey: identity.emailKey }, scope);
    if (value === null && fallbackBase) {
      const legacy = await this.files.find(token, base);
      value = legacy ? await this.files.download<unknown>(token, legacy) : null;
    }
    for (const source of identity.legacy) {
      const sourceId = await this.files.find(token, scopedDriveFileName(base, source.accountKey));
      const payload = sourceId ? await this.files.download<unknown>(token, sourceId) : null;
      if (payload !== null) {
        if (value !== null) value = prepareStarredMergeBase(value, scope, authorized);
        value = mergeLegacyDrivePayload(value, payload, source, scope);
        authorized = true;
      }
    }
    return { value, authorized };
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
    let merged: unknown = value;
    for (const source of this.identity.get(scope).legacy) {
      const id = await this.files.find(token, scopedDriveFileName(base, source.accountKey));
      const legacy = id ? await this.files.download<unknown>(token, id) : null;
      if (legacy !== null) merged = mergeLegacyDrivePayload(merged, legacy, source, scope);
    }
    // The per-format merge parser validates incoming entries and keeps the input envelope kind.
    return merged as T;
  }
}
