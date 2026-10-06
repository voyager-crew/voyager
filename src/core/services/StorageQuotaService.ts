import { StorageKeys } from '@/core/types/common';
import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';

import { StorageQuotaApi } from './StorageQuotaApi';
import { StorageQuotaPolicy } from './StorageQuotaPolicy';
import type { StorageAreaLike, StorageQuotaBrowserOptions } from './StorageQuotaTypes';
import { dataBackupKeyPrefix } from './dataBackupKeys';

const MEBIBYTE = 1024 * 1024;

export const STORAGE_QUOTA_SOFT_CAP_KEY = 'gvStorageSoftCapMb';
export const STORAGE_SOFT_CAP_OPTIONS_MB = [25, 50, 100] as const;
export const DEFAULT_STORAGE_SOFT_CAP_MB = 25;
export const STORAGE_QUOTA_WARNING_RATIO = 0.8;
export const STORAGE_QUOTA_CRITICAL_RATIO = 0.95;

export type StorageSoftCapMb = (typeof STORAGE_SOFT_CAP_OPTIONS_MB)[number];
export type StorageAreaId = 'local' | 'sync';
export type StorageCategoryId =
  | 'prompts'
  | 'folders'
  | 'timeline'
  | 'highlights'
  | 'drafts'
  | 'cache'
  | 'settings'
  | 'other';
export type ClearableStorageCategoryId = 'cache' | 'drafts' | 'highlights';

export interface StorageAreaUsage {
  area: StorageAreaId;
  bytesInUse: number;
  quotaBytes: number | null;
  usageRatio: number | null;
  available: boolean;
  estimated: boolean;
  quotaEstimated: boolean;
}

export interface StorageCategoryUsage {
  id: StorageCategoryId;
  area: 'local';
  bytesInUse: number;
  keys: readonly string[];
  clearable: boolean;
  estimated: boolean;
}

export type UnlimitedStoragePermissionStatus = Awaited<ReturnType<StorageQuotaPolicy['getStatus']>>;
export type UnlimitedStoragePermissionReason = UnlimitedStoragePermissionStatus['reason'];
export type UnlimitedStoragePermissionRequestResult = Awaited<
  ReturnType<StorageQuotaPolicy['request']>
>;
export type UnlimitedStoragePermissionRequestReason =
  UnlimitedStoragePermissionRequestResult['reason'];

export interface StorageQuotaSnapshot {
  measuredAt: number;
  softCapMb: StorageSoftCapMb;
  softCapBytes: number;
  softCapUsageRatio: number;
  local: StorageAreaUsage;
  sync: StorageAreaUsage;
  categories: readonly StorageCategoryUsage[];
  permission: UnlimitedStoragePermissionStatus;
  estimated: boolean;
}

/** What the local area holds before some keys are replaced, and the most it should hold. */
export interface LocalStorageHeadroom {
  bytesInUse: number;
  /** Bytes the keys hold now; writing them replaces those bytes. */
  keyBytes: number;
  /** Voyager's soft cap, or the browser's quota when that is lower. */
  limitBytes: number;
  /** The browser's effective quota; `null` when there is no practical one. */
  quotaBytes: number | null;
}

export type EffectiveLocalQuota = ReturnType<StorageQuotaPolicy['localQuota']>;

export function getStorageQuotaEffectiveUsageRatio(snapshot: StorageQuotaSnapshot): number | null {
  const localRatio =
    snapshot.local.available && snapshot.local.quotaBytes === null
      ? snapshot.softCapUsageRatio
      : snapshot.local.available
        ? snapshot.local.usageRatio
        : null;
  const ratios = [localRatio, snapshot.sync.available ? snapshot.sync.usageRatio : null].filter(
    (ratio): ratio is number => ratio !== null && Number.isFinite(ratio),
  );
  return ratios.length > 0 ? Math.max(...ratios) : null;
}

export interface StorageCleanupResult {
  category: ClearableStorageCategoryId;
  removedKeys: readonly string[];
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
  estimated: boolean;
}

export interface StorageQuotaServiceDependencies extends StorageQuotaBrowserOptions {
  now?: () => number;
}

interface AreaReadResult {
  usage: StorageAreaUsage;
  items: Record<string, unknown>;
}

interface CategoryDefinition {
  id: Exclude<StorageCategoryId, 'other'>;
  exactKeys?: ReadonlySet<string>;
  prefixes?: readonly string[];
  clearable: boolean;
}

const PROMPT_KEYS = new Set<string>([StorageKeys.PROMPT_ITEMS, StorageKeys.PROMPT_HISTORY_ITEMS]);

const FOLDER_PLATFORM_DEFINITIONS = FOLDER_PLATFORM_IDS.map(
  (platform) => FOLDER_PLATFORMS[platform],
);
const FOLDER_KEYS = new Set<string>(
  FOLDER_PLATFORM_DEFINITIONS.map((definition) => definition.folderStorageKey),
);
// Account-scoped buckets, then the page-side recovery copies of every folder platform.
const FOLDER_PREFIXES = [
  ...FOLDER_PLATFORM_DEFINITIONS.flatMap((definition) =>
    definition.accountIsolationStorageKey === null ? [] : [`${definition.folderStorageKey}:acct:`],
  ),
  ...FOLDER_PLATFORM_DEFINITIONS.map((definition) =>
    dataBackupKeyPrefix(definition.backupNamespace),
  ),
];

const TIMELINE_KEYS = new Set<string>([
  StorageKeys.TIMELINE_STARRED_MESSAGES,
  StorageKeys.SAVED_LIBRARY_STARS,
  StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES,
  StorageKeys.TIMELINE_HIERARCHY,
  StorageKeys.FORK_NODES,
  StorageKeys.GV_MESSAGE_TIMESTAMPS,
  'gvPendingFork',
]);

// Only values that can be rebuilt from the page/network belong here. User state
// such as Gems MRU, announcement history, prompts and folders is deliberately excluded.
const REGENERABLE_CACHE_KEYS = new Set<string>([
  StorageKeys.GV_GEMS_LIST_CACHE,
  StorageKeys.GV_USAGE_CACHE,
  StorageKeys.GV_USAGE_RECIPE,
  StorageKeys.GV_CLAUDE_USAGE_CACHE,
  StorageKeys.GV_CLAUDE_USAGE_REFRESH_LOCK,
  StorageKeys.PLUGIN_CATALOG_CACHE,
  'gvLatestVersionCache',
]);

// Centralized settings plus the few persisted literal keys that have not yet
// been moved into StorageKeys. This is intentionally explicit: unknown future
// keys remain visible in Other and are never deletable.
const SETTINGS_KEYS = new Set<string>([
  ...Object.values(StorageKeys),
  STORAGE_QUOTA_SOFT_CAP_KEY,
  'gvAccessToken',
  'gvTokenExpiry',
  'gvSyncMode',
  'gvLastUpload',
  'gvLastDownload',
  'gvSyncError',
  'gvBackupConfig',
  'gvGemsSidebarExpanded',
  // Legacy/pre-release annotation metadata. Canonical account indexes are
  // matched by the settings prefix below so clear markers survive cleanup.
  'gvAnnotation:index',
]);

const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  {
    id: 'prompts',
    exactKeys: PROMPT_KEYS,
    prefixes: [`${StorageKeys.PROMPT_HISTORY_ITEMS}:`],
    clearable: false,
  },
  {
    id: 'folders',
    exactKeys: FOLDER_KEYS,
    prefixes: FOLDER_PREFIXES,
    clearable: false,
  },
  {
    id: 'timeline',
    exactKeys: TIMELINE_KEYS,
    prefixes: [
      `${StorageKeys.TIMELINE_HIERARCHY}:acct:`,
      StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX,
      StorageKeys.CATALOG_MESSAGE_TIMESTAMPS_PREFIX,
      `${StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES}:acct:`,
      'geminiTimelineStars:',
      'geminiTimelineLevels:',
      'geminiTimelineCollapsed:',
    ],
    clearable: false,
  },
  {
    // Reserved for issue #794. Matching stays deliberately narrow so future
    // annotation data can be removed without touching unrelated user content.
    id: 'highlights',
    prefixes: ['gvHighlight:', 'gvAnnotation:bucket:'],
    clearable: true,
  },
  { id: 'drafts', prefixes: ['gvDraft_'], clearable: true },
  {
    id: 'cache',
    exactKeys: REGENERABLE_CACHE_KEYS,
    prefixes: [`${StorageKeys.GV_USAGE_CACHE}:`],
    clearable: true,
  },
  {
    id: 'settings',
    exactKeys: SETTINGS_KEYS,
    prefixes: ['gvAnnotation:index:'],
    clearable: false,
  },
];

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function estimateBytes(items: Record<string, unknown>): number {
  try {
    return new TextEncoder().encode(JSON.stringify(items)).byteLength;
  } catch {
    return 0;
  }
}

function pickItems(
  items: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in items).map((key) => [key, items[key]]));
}

function matchesCategory(key: string, definition: CategoryDefinition): boolean {
  return (
    definition.exactKeys?.has(key) === true ||
    definition.prefixes?.some((prefix) => key.startsWith(prefix)) === true
  );
}

function normalizeSoftCap(value: unknown): StorageSoftCapMb {
  return STORAGE_SOFT_CAP_OPTIONS_MB.includes(value as StorageSoftCapMb)
    ? (value as StorageSoftCapMb)
    : DEFAULT_STORAGE_SOFT_CAP_MB;
}

export class StorageQuotaService {
  private readonly api: StorageQuotaApi;
  private readonly policy: StorageQuotaPolicy;

  constructor(private readonly dependencies: StorageQuotaServiceDependencies = {}) {
    this.api = new StorageQuotaApi(dependencies);
    this.policy = new StorageQuotaPolicy(dependencies);
  }

  private async readArea(
    areaId: StorageAreaId,
    unlimitedGranted: boolean,
  ): Promise<AreaReadResult> {
    const area = this.api.chromeApi.storage?.[areaId];
    if (!area?.get) {
      return this.unavailableArea(areaId);
    }

    let items: Record<string, unknown>;
    try {
      items = (await this.api.call<Record<string, unknown>>(area, area.get, [null])) ?? {};
    } catch {
      return this.unavailableArea(areaId);
    }

    let bytesInUse = estimateBytes(items);
    let estimated = true;
    if (area.getBytesInUse) {
      try {
        const measured = await this.api.call<number>(area, area.getBytesInUse, [null]);
        if (typeof measured === 'number' && Number.isFinite(measured) && measured >= 0) {
          bytesInUse = measured;
          estimated = false;
        }
      } catch {
        // JSON byte estimation above is the graceful fallback for older APIs.
      }
    }

    const { quotaBytes, quotaEstimated } =
      areaId === 'local'
        ? this.localAreaQuota(unlimitedGranted)
        : this.policy.syncQuota(area.QUOTA_BYTES);

    return {
      usage: {
        area: areaId,
        bytesInUse,
        quotaBytes,
        usageRatio: quotaBytes === null ? null : clampRatio(bytesInUse / quotaBytes),
        available: true,
        estimated,
        quotaEstimated,
      },
      items,
    };
  }

  private unavailableArea(area: StorageAreaId): AreaReadResult {
    return {
      usage: {
        area,
        bytesInUse: 0,
        quotaBytes: null,
        usageRatio: null,
        available: false,
        estimated: true,
        quotaEstimated: true,
      },
      items: {},
    };
  }

  private localAreaQuota(
    unlimitedGranted: boolean,
  ): Pick<StorageAreaUsage, 'quotaBytes' | 'quotaEstimated'> {
    const { quotaBytes, estimated } = this.policy.localQuota(unlimitedGranted);
    return { quotaBytes, quotaEstimated: estimated };
  }

  /**
   * The area rule, or, when its result is estimated, the lower of it and the
   * fixed per-browser rule the highlights used to apply on their own. Re-reads
   * the grant on every call, since the user can grant it at any time.
   */
  async resolveEffectiveLocalQuota(): Promise<EffectiveLocalQuota> {
    const permission = await this.getUnlimitedStoragePermissionStatus();
    return this.policy.localQuota(permission.granted);
  }

  private async bytesForKeys(
    area: StorageAreaLike | undefined,
    items: Record<string, unknown>,
    keys: readonly string[],
  ): Promise<{ bytes: number; estimated: boolean }> {
    if (keys.length === 0) return { bytes: 0, estimated: false };
    if (area?.getBytesInUse) {
      try {
        const measured = await this.api.call<number>(area, area.getBytesInUse, [[...keys]]);
        if (typeof measured === 'number' && Number.isFinite(measured) && measured >= 0) {
          return { bytes: measured, estimated: false };
        }
      } catch {
        // Fall through to a deterministic JSON estimate.
      }
    }
    return { bytes: estimateBytes(pickItems(items, keys)), estimated: true };
  }

  private async buildCategories(items: Record<string, unknown>): Promise<StorageCategoryUsage[]> {
    const keysByCategory = new Map<StorageCategoryId, string[]>();
    for (const definition of CATEGORY_DEFINITIONS) keysByCategory.set(definition.id, []);
    keysByCategory.set('other', []);

    for (const key of Object.keys(items)) {
      const definition = CATEGORY_DEFINITIONS.find((candidate) => matchesCategory(key, candidate));
      keysByCategory.get(definition?.id ?? 'other')?.push(key);
    }

    const area = this.api.chromeApi.storage?.local;
    const categories: StorageCategoryUsage[] = [];
    for (const definition of CATEGORY_DEFINITIONS) {
      const keys = keysByCategory.get(definition.id) ?? [];
      const usage = await this.bytesForKeys(area, items, keys);
      categories.push({
        id: definition.id,
        area: 'local',
        bytesInUse: usage.bytes,
        keys,
        clearable: definition.clearable,
        estimated: usage.estimated,
      });
    }

    const otherKeys = keysByCategory.get('other') ?? [];
    const otherUsage = await this.bytesForKeys(area, items, otherKeys);
    categories.push({
      id: 'other',
      area: 'local',
      bytesInUse: otherUsage.bytes,
      keys: otherKeys,
      clearable: false,
      estimated: otherUsage.estimated,
    });
    return categories;
  }

  async getUnlimitedStoragePermissionStatus(): Promise<UnlimitedStoragePermissionStatus> {
    return this.policy.getStatus();
  }

  async requestUnlimitedStoragePermission(): Promise<UnlimitedStoragePermissionRequestResult> {
    return this.policy.request();
  }

  async getSnapshot(): Promise<StorageQuotaSnapshot> {
    const permission = await this.getUnlimitedStoragePermissionStatus();
    const [local, sync] = await Promise.all([
      this.readArea('local', permission.granted),
      this.readArea('sync', false),
    ]);
    const softCapMb = normalizeSoftCap(local.items[STORAGE_QUOTA_SOFT_CAP_KEY]);
    const softCapBytes = softCapMb * MEBIBYTE;
    const categories = await this.buildCategories(local.items);

    return {
      measuredAt: this.dependencies.now?.() ?? Date.now(),
      softCapMb,
      softCapBytes,
      softCapUsageRatio: clampRatio(local.usage.bytesInUse / softCapBytes),
      local: local.usage,
      sync: sync.usage,
      categories,
      permission,
      estimated:
        local.usage.estimated || sync.usage.estimated || categories.some((item) => item.estimated),
    };
  }

  /** A pre-write probe of the local area that reads no items when the browser can measure them. */
  async getLocalHeadroom(keyOrKeys: string | readonly string[]): Promise<LocalStorageHeadroom> {
    const keys = typeof keyOrKeys === 'string' ? [keyOrKeys] : [...keyOrKeys];
    const area = this.api.chromeApi.storage?.local;
    const permission = await this.getUnlimitedStoragePermissionStatus();
    const settings =
      (await this.api.call<Record<string, unknown>>(area ?? {}, area?.get, [
        [STORAGE_QUOTA_SOFT_CAP_KEY],
      ])) ?? {};
    let bytesInUse: number | null = null;
    let keyBytes: number | null = null;
    if (area?.getBytesInUse) {
      try {
        const [total, own] = await Promise.all([
          this.api.call<number>(area, area.getBytesInUse, [null]),
          keys.length > 0 ? this.api.call<number>(area, area.getBytesInUse, [keys]) : 0,
        ]);
        if (Number.isFinite(total) && total >= 0 && Number.isFinite(own) && own >= 0) {
          bytesInUse = total;
          keyBytes = own;
        }
      } catch {
        // Estimated below, as for older APIs.
      }
    }
    if (bytesInUse === null || keyBytes === null) {
      const items =
        (await this.api.call<Record<string, unknown>>(area ?? {}, area?.get, [null])) ?? {};
      bytesInUse = estimateBytes(items);
      const present = keys.filter((key) => key in items);
      keyBytes = present.length > 0 ? estimateBytes(pickItems(items, present)) : 0;
    }
    const softCapBytes = normalizeSoftCap(settings[STORAGE_QUOTA_SOFT_CAP_KEY]) * MEBIBYTE;
    const { quotaBytes } = this.policy.localQuota(permission.granted);
    return {
      bytesInUse,
      keyBytes,
      limitBytes: quotaBytes === null ? softCapBytes : Math.min(softCapBytes, quotaBytes),
      quotaBytes,
    };
  }

  async saveSoftCapMb(value: StorageSoftCapMb): Promise<void> {
    if (!STORAGE_SOFT_CAP_OPTIONS_MB.includes(value)) {
      throw new RangeError('Storage soft cap must be 25, 50, or 100 MB');
    }
    const area = this.api.chromeApi.storage?.local;
    await this.api.call<void>(area ?? {}, area?.set, [{ [STORAGE_QUOTA_SOFT_CAP_KEY]: value }]);
  }

  async clearCategory(category: ClearableStorageCategoryId): Promise<StorageCleanupResult> {
    if (category !== 'cache' && category !== 'drafts' && category !== 'highlights') {
      throw new Error(`Storage category is not clearable: ${String(category)}`);
    }

    const beforeSnapshot = await this.getSnapshot();
    const before = beforeSnapshot.categories.find((item) => item.id === category);
    const removedKeys = [...(before?.keys ?? [])];
    if (removedKeys.length > 0) {
      const area = this.api.chromeApi.storage?.local;
      await this.api.call<void>(area ?? {}, area?.remove, [removedKeys]);
    }
    const afterSnapshot = await this.getSnapshot();
    const after = afterSnapshot.categories.find((item) => item.id === category);
    const bytesBefore = before?.bytesInUse ?? 0;
    const bytesAfter = after?.bytesInUse ?? 0;

    return {
      category,
      removedKeys,
      bytesBefore,
      bytesAfter,
      bytesFreed: Math.max(0, bytesBefore - bytesAfter),
      estimated: before?.estimated === true || after?.estimated === true,
    };
  }
}

export const storageQuotaService = new StorageQuotaService();
