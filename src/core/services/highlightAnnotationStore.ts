import { storageQuotaService } from '@/core/services/StorageQuotaService';
import type {
  HighlightClearMarkerV1,
  HighlightConversationBucketV1,
  HighlightIndexV1,
  HighlightRecordV1,
  HighlightStoredAccountScope,
} from '@/core/types/highlight';
import {
  HIGHLIGHT_DEVICE_ID_KEY,
  HIGHLIGHT_BUCKET_KEY_PREFIX,
  HIGHLIGHT_INDEX_KEY_PREFIX,
} from '@/core/types/highlight';

import type {
  HighlightAnnotationServiceDependencies,
  HighlightStorageAdapter,
  HighlightQueryOptions,
  HighlightClearAllAccountsResult,
  HighlightImportMergeOptions,
} from './HighlightAnnotationService';
import {
  HighlightAnnotationError,
  getHighlightIndexStorageKey,
  getHighlightBucketStorageKey,
  parseIndex,
  parseBucket,
  isObject,
  isClearedByMarker,
  compareStrings,
  createEmptyIndex,
} from './highlightAnnotationData';
import { measureSoftCap } from './highlightSoftCap';

interface ExtensionStorageAreaLike {
  get?: (...args: unknown[]) => unknown;
  set?: (...args: unknown[]) => unknown;
  remove?: (...args: unknown[]) => unknown;
  getBytesInUse?: (...args: unknown[]) => unknown;
  QUOTA_BYTES?: number;
}

interface ExtensionRuntimeLike {
  lastError?: { message?: string } | null;
}

interface ExtensionChromeLike {
  storage?: { local?: ExtensionStorageAreaLike };
  runtime?: ExtensionRuntimeLike;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

function generateFallbackUuid(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function callExtensionApi<T>(
  owner: object,
  method: ((...args: unknown[]) => unknown) | undefined,
  args: unknown[],
  runtime: ExtensionRuntimeLike | undefined,
): Promise<T> {
  if (!method) {
    throw new HighlightAnnotationError('STORAGE_UNAVAILABLE', 'Extension storage is unavailable');
  }

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const callback = (value: T): void => {
      const lastError = runtime?.lastError;
      if (lastError) {
        fail(new Error(lastError.message || 'Extension storage request failed'));
        return;
      }
      finish(value);
    };

    try {
      const returned = method.apply(owner, [...args, callback]);
      if (isPromiseLike(returned)) {
        void Promise.resolve(returned).then((value) => finish(value as T), fail);
      } else if (returned !== undefined) {
        finish(returned as T);
      }
    } catch (error) {
      fail(error);
    }
  });
}

function createDefaultStorageAdapter(): HighlightStorageAdapter {
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ExtensionChromeLike }).chrome;
  const area = chromeApi?.storage?.local;
  if (!area) {
    throw new HighlightAnnotationError(
      'STORAGE_UNAVAILABLE',
      'Extension local storage is unavailable',
    );
  }

  return {
    async get(keys) {
      return (
        (await callExtensionApi<Record<string, unknown>>(
          area,
          area.get,
          [keys],
          chromeApi?.runtime,
        )) ?? {}
      );
    },
    async set(items) {
      await callExtensionApi<void>(area, area.set, [items], chromeApi?.runtime);
    },
    async remove(keys) {
      await callExtensionApi<void>(area, area.remove, [keys], chromeApi?.runtime);
    },
    getBytesInUse: area.getBytesInUse
      ? async (keys) =>
          await callExtensionApi<number>(area, area.getBytesInUse, [keys], chromeApi?.runtime)
      : undefined,
    // The one resolver every writer shares (addendum P3P4 §0).
    getEffectiveQuotaBytes: async () =>
      (await storageQuotaService.resolveEffectiveLocalQuota()).quotaBytes,
  };
}

/** Owns storage boundaries and keeps admission plus writes in the same budget step. */
export class HighlightAnnotationStore {
  constructor(private readonly dependencies: HighlightAnnotationServiceDependencies) {}
  private get storage(): HighlightStorageAdapter {
    return this.dependencies.storage ?? createDefaultStorageAdapter();
  }

  get now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  generateUuid(): string {
    return (
      this.dependencies.randomUUID?.() ??
      globalThis.crypto?.randomUUID?.() ??
      generateFallbackUuid()
    );
  }

  async getDeviceId(): Promise<{ id: string; needsWrite: boolean }> {
    const result = await this.storage.get(HIGHLIGHT_DEVICE_ID_KEY);
    const existing = result[HIGHLIGHT_DEVICE_ID_KEY];
    if (typeof existing === 'string' && existing.length > 0 && existing.length <= 128) {
      return { id: existing, needsWrite: false };
    }
    return { id: this.generateUuid(), needsWrite: true };
  }

  async readIndex(scope: HighlightStoredAccountScope): Promise<HighlightIndexV1> {
    const key = getHighlightIndexStorageKey(scope);
    const result = await this.storage.get(key);
    return parseIndex(result[key], scope.accountHash, this.now);
  }

  async readBucket(
    scope: HighlightStoredAccountScope,
    conversationId: string,
  ): Promise<HighlightConversationBucketV1> {
    const key = getHighlightBucketStorageKey(scope, conversationId);
    const result = await this.storage.get(key);
    return parseBucket(result[key], scope, conversationId, this.now);
  }

  async readBucketsFromIndex(
    scope: HighlightStoredAccountScope,
    index: HighlightIndexV1,
  ): Promise<Map<string, { key: string; bucket: HighlightConversationBucketV1 }>> {
    const entries = Object.values(index.conversations).filter(
      (entry) => entry.platform === scope.platform,
    );
    const keys = entries.map((entry) => entry.bucketKey);
    const raw = keys.length > 0 ? await this.storage.get(keys) : {};
    const buckets = new Map<string, { key: string; bucket: HighlightConversationBucketV1 }>();
    for (const entry of entries) {
      const bucket = parseBucket(raw[entry.bucketKey], scope, entry.conversationId, this.now);
      buckets.set(entry.conversationKey, { key: entry.bucketKey, bucket });
    }
    return buckets;
  }

  /** Read indexed and orphaned import buckets without changing stored data. */
  async readImportBuckets(
    scope: HighlightStoredAccountScope,
    index: HighlightIndexV1,
    importedRecords: readonly HighlightRecordV1[],
  ): Promise<Map<string, { key: string; bucket: HighlightConversationBucketV1 }>> {
    const indexedBuckets = await this.readBucketsFromIndex(scope, index);
    const buckets = new Map<string, { key: string; bucket: HighlightConversationBucketV1 }>();
    for (const { key, bucket } of indexedBuckets.values()) {
      buckets.set(bucket.conversationId, { key, bucket });
    }

    const missingConversationIds = Array.from(
      new Set(importedRecords.map((record) => record.conversationId)),
    ).filter((conversationId) => !buckets.has(conversationId));
    const missingKeys = missingConversationIds.map((conversationId) =>
      getHighlightBucketStorageKey(scope, conversationId),
    );
    const missingRaw = missingKeys.length > 0 ? await this.storage.get(missingKeys) : {};
    missingConversationIds.forEach((conversationId, indexPosition) => {
      const key = missingKeys[indexPosition];
      buckets.set(conversationId, {
        key,
        bucket: parseBucket(missingRaw[key], scope, conversationId, this.now),
      });
    });

    return buckets;
  }

  private async assertWithinSoftCap(
    setItems: Record<string, unknown>,
    removeKeys: readonly string[],
    options: { allowOverCapGrowth?: boolean },
    reservedBytes: number,
  ): Promise<void> {
    const verdict = await measureSoftCap(this.storage, setItems, removeKeys, reservedBytes);
    if (verdict.exceeds && options.allowOverCapGrowth !== true) {
      throw new HighlightAnnotationError(
        'SOFT_CAP_REACHED',
        'Highlight was not saved because the local storage safety reserve would be crossed',
        verdict.context,
      );
    }
  }

  async commit(
    setItems: Record<string, unknown>,
    removeKeys: readonly string[] = [],
    options: {
      allowOverCapGrowth?: boolean;
      beforeWrite?: HighlightImportMergeOptions['beforeWrite'];
    } = {},
  ): Promise<void> {
    // Freeze a cloud import before its receipt awaits storage; the write must match that receipt.
    const values = options.beforeWrite ? structuredClone(setItems) : setItems;
    const step = async (reservedBytes: number) => {
      await this.assertWithinSoftCap(values, removeKeys, options, reservedBytes);
      if (Object.keys(values).length > 0) {
        await options.beforeWrite?.(values);
        await this.storage.set(values);
      }
      if (removeKeys.length > 0) {
        await options.beforeWrite?.(Object.fromEntries(removeKeys.map((key) => [key, undefined])));
        await this.storage.remove(removeKeys);
      }
    };
    const budget = this.dependencies.budget;
    await (budget ? budget.runChecked(step) : step(0));
  }

  async getAllAccounts(options: HighlightQueryOptions = {}): Promise<HighlightRecordV1[]> {
    const all = await this.storage.get(null);
    const clearMarkers = new Map<string, HighlightClearMarkerV1>();
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(HIGHLIGHT_INDEX_KEY_PREFIX)) continue;
      const accountHash = key.slice(HIGHLIGHT_INDEX_KEY_PREFIX.length);
      try {
        const index = parseIndex(value, accountHash, this.now);
        for (const platform of ['gemini', 'aistudio'] as const) {
          const marker = index.clearMarkers?.[platform];
          if (marker) clearMarkers.set(`${accountHash}:${platform}`, marker);
        }
      } catch {
        // Keep other accounts readable when one index is corrupt.
      }
    }
    const records: HighlightRecordV1[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(HIGHLIGHT_BUCKET_KEY_PREFIX) || !isObject(value)) continue;
      if (
        (value.platform !== 'gemini' && value.platform !== 'aistudio') ||
        typeof value.accountHash !== 'string' ||
        typeof value.conversationId !== 'string'
      ) {
        continue;
      }
      try {
        const bucket = parseBucket(
          value,
          { platform: value.platform, accountHash: value.accountHash },
          value.conversationId,
          this.now,
        );
        records.push(...Object.values(bucket.records));
      } catch {
        // One corrupt account must not make the global read unusable.
      }
    }
    return records
      .filter(
        (record) =>
          !isClearedByMarker(record, clearMarkers.get(`${record.accountHash}:${record.platform}`)),
      )
      .filter((record) => options.includeDeleted === true || record.deletedAt === undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt || compareStrings(left.id, right.id));
  }

  // Keep bounded account clear markers so a later cloud pull cannot restore deleted highlights.
  async clearAllAccounts(): Promise<HighlightClearAllAccountsResult> {
    const all = await this.storage.get(null);
    const device = await this.getDeviceId();
    const now = this.now;
    const bucketKeys = Object.keys(all).filter((key) =>
      key.startsWith(HIGHLIGHT_BUCKET_KEY_PREFIX),
    );
    const accountStates = new Map<
      string,
      {
        index: HighlightIndexV1;
        platforms: Set<HighlightStoredAccountScope['platform']>;
        records: HighlightRecordV1[];
      }
    >();
    const invalidIndexKeys: string[] = [];

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(HIGHLIGHT_INDEX_KEY_PREFIX)) continue;
      const accountHash = key.slice(HIGHLIGHT_INDEX_KEY_PREFIX.length);
      try {
        const index = parseIndex(value, accountHash, now);
        const platforms = new Set<HighlightStoredAccountScope['platform']>();
        Object.values(index.conversations).forEach((entry) => platforms.add(entry.platform));
        for (const platform of ['gemini', 'aistudio'] as const) {
          if (index.clearMarkers?.[platform]) platforms.add(platform);
        }
        accountStates.set(accountHash, { index, platforms, records: [] });
      } catch {
        // The explicit clear still removes corrupt annotation buckets. It
        // does not overwrite an index that cannot be safely interpreted.
        invalidIndexKeys.push(key);
      }
    }

    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(HIGHLIGHT_BUCKET_KEY_PREFIX) || !isObject(value)) continue;
      if (
        (value.platform !== 'gemini' && value.platform !== 'aistudio') ||
        typeof value.accountHash !== 'string' ||
        typeof value.conversationId !== 'string'
      ) {
        continue;
      }
      try {
        const scope: HighlightStoredAccountScope = {
          platform: value.platform,
          accountHash: value.accountHash,
        };
        const bucket = parseBucket(value, scope, value.conversationId, now);
        const state = accountStates.get(scope.accountHash) ?? {
          index: createEmptyIndex(scope.accountHash, now),
          platforms: new Set<HighlightStoredAccountScope['platform']>(),
          records: [],
        };
        state.platforms.add(scope.platform);
        state.records.push(...Object.values(bucket.records));
        accountStates.set(scope.accountHash, state);
      } catch {
        // The raw key remains in bucketKeys and is removed below.
      }
    }

    const setItems: Record<string, unknown> = device.needsWrite
      ? { [HIGHLIGHT_DEVICE_ID_KEY]: device.id }
      : {};
    const accounts: HighlightClearAllAccountsResult['accounts'] = [];
    let removed = 0;
    for (const [accountHash, state] of accountStates) {
      const clearMarkers = { ...state.index.clearMarkers };
      for (const platform of state.platforms) {
        const platformRecords = state.records.filter((record) => record.platform === platform);
        removed += platformRecords.filter((record) => record.deletedAt === undefined).length;
        const clearMarker: HighlightClearMarkerV1 = {
          clearedAt: now,
          revision: {
            counter:
              Math.max(
                clearMarkers[platform]?.revision.counter ?? 0,
                ...platformRecords.map((record) => record.revision.counter),
              ) + 1,
            deviceId: device.id,
          },
          generation: {
            counter: (clearMarkers[platform]?.generation?.counter ?? 0) + 1,
            id: this.generateUuid(),
          },
        };
        clearMarkers[platform] = clearMarker;
        accounts.push({
          accountScope: { platform, accountHash },
          clearMarker,
        });
      }
      setItems[`${HIGHLIGHT_INDEX_KEY_PREFIX}${accountHash}`] = {
        ...state.index,
        conversations: {},
        clearMarkers,
        updatedAt: now,
      } satisfies HighlightIndexV1;
    }

    const removeKeys = [...bucketKeys, ...invalidIndexKeys].filter((key) => !(key in setItems));
    await this.commit(setItems, removeKeys);
    return { removed, accounts };
  }
}
