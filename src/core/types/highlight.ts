/**
 * Canonical, versioned highlight/annotation data contracts.
 *
 * The persisted representation intentionally stores only quote anchors and
 * bounded user-authored notes. It never stores response HTML or a complete
 * response snapshot.
 */
import { StorageKeys } from '@/core/types/common';
import { packagedSiteForUrl } from '@/features/plugins/sites/hostPolicy';

export const HIGHLIGHT_SCHEMA_VERSION = 1 as const;
export const HIGHLIGHT_EXPORT_FORMAT = 'gemini-voyager.annotations.v1' as const;
export const HIGHLIGHT_STORAGE_NAMESPACE = 'gvAnnotation' as const;
export const HIGHLIGHT_INDEX_KEY_PREFIX = `${HIGHLIGHT_STORAGE_NAMESPACE}:index:v1:acct:` as const;
export const HIGHLIGHT_BUCKET_KEY_PREFIX =
  `${HIGHLIGHT_STORAGE_NAMESPACE}:bucket:v1:acct:` as const;
// Device identity survives "clear highlights" so future sync revisions remain
// monotonic, but it is categorized as a tiny setting rather than user content.
export const HIGHLIGHT_DEVICE_ID_KEY = StorageKeys.HIGHLIGHT_DEVICE_ID;

export const HIGHLIGHT_LIMITS = {
  exactBytes: 16 * 1024,
  contextCharacters: 128,
  noteBytes: 8 * 1024,
  recordBytes: 32 * 1024,
} as const;

export type HighlightPlatform = 'gemini' | 'aistudio';
export type HighlightRole = 'assistant' | 'user';
export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightPresetColor = (typeof HIGHLIGHT_COLORS)[number];
export type HighlightCustomColor = `#${string}`;
export type HighlightColor = HighlightPresetColor | HighlightCustomColor;
export const HIGHLIGHT_PALETTE_SIZE = 5 as const;
export const HIGHLIGHT_COLOR_HEX: Record<HighlightPresetColor, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
};
export const DEFAULT_HIGHLIGHT_COLOR_PALETTE: readonly HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
  '#c084fc',
];

export function isHighlightPresetColor(value: unknown): value is HighlightPresetColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightPresetColor);
}

export function isHighlightCustomColor(value: unknown): value is HighlightCustomColor {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

export function getHighlightColorHex(color: HighlightColor): string {
  return isHighlightPresetColor(color) ? HIGHLIGHT_COLOR_HEX[color] : color;
}

export function areHighlightColorsEqual(left: HighlightColor, right: HighlightColor): boolean {
  return getHighlightColorHex(left).toLowerCase() === getHighlightColorHex(right).toLowerCase();
}

/** Resolve exactly five persistent color slots and migrate a legacy custom default
 * into the first slot when no palette has been stored yet. */
export function normalizeHighlightColorPalette(
  value: unknown,
  legacyDefault?: unknown,
): HighlightColor[] {
  const stored = Array.isArray(value) ? value : null;
  const palette = DEFAULT_HIGHLIGHT_COLOR_PALETTE.slice(0, HIGHLIGHT_PALETTE_SIZE).map(
    (fallback, index) => {
      const candidate = stored?.[index];
      return isHighlightPresetColor(candidate) || isHighlightCustomColor(candidate)
        ? candidate
        : fallback;
    },
  );

  if (
    !stored &&
    (isHighlightPresetColor(legacyDefault) || isHighlightCustomColor(legacyDefault)) &&
    !palette.some((color) => areHighlightColorsEqual(color, legacyDefault))
  ) {
    palette[0] = legacyDefault;
  }
  return palette;
}

/** Input scope. The raw account key is hashed before anything is persisted. */
export interface HighlightAccountScope {
  platform: HighlightPlatform;
  accountKey: string;
  accountId: number;
  routeUserId: string | null;
}

/** Safe persisted/exported account identity. */
export interface HighlightStoredAccountScope {
  platform: HighlightPlatform;
  accountHash: string;
}

export interface HighlightTextQuoteSelector {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface HighlightTextPositionSelector {
  start: number;
  end: number;
}

export interface HighlightAnchor {
  quote: HighlightTextQuoteSelector;
  position: HighlightTextPositionSelector;
  sourceTextHash: string;
}

/**
 * A Lamport-style counter plus a stable device id. Ordering by
 * counter -> updatedAt -> deviceId -> record id gives deterministic merges.
 */
export interface HighlightRevision {
  counter: number;
  deviceId: string;
}

export interface HighlightRecordV1 {
  id: string;
  schemaVersion: typeof HIGHLIGHT_SCHEMA_VERSION;
  platform: HighlightPlatform;
  accountHash: string;
  conversationId: string;
  conversationUrl: string;
  conversationTitle?: string;
  turnId: string;
  role: HighlightRole;
  anchor: HighlightAnchor;
  note?: string;
  color: HighlightColor;
  createdAt: number;
  updatedAt: number;
  revision: HighlightRevision;
  /** The bounded clear generation observed when this record was created. */
  clearGeneration?: string;
  /** Present only when this record is retained as a sync tombstone. */
  deletedAt?: number;
}

export interface HighlightCreateInput {
  conversationId: string;
  conversationUrl: string;
  conversationTitle?: string;
  turnId: string;
  role: HighlightRole;
  anchor: HighlightAnchor;
  note?: string;
  color?: HighlightColor;
}

export interface HighlightUpdatePatch {
  conversationUrl?: string;
  conversationTitle?: string | null;
  turnId?: string;
  role?: HighlightRole;
  anchor?: HighlightAnchor;
  note?: string | null;
  color?: HighlightColor;
}

export interface HighlightClearMarkerV1 {
  clearedAt: number;
  revision: HighlightRevision;
  /**
   * A constant-size clear epoch. The counter orders causally observed clears;
   * the random id deterministically resolves concurrent clears without clocks.
   * Optional only for backwards-compatible reads of legacy v1 exports.
   */
  generation?: {
    counter: number;
    id: string;
  };
}

export interface HighlightConversationIndexEntryV1 {
  platform: HighlightPlatform;
  conversationId: string;
  conversationKey: string;
  bucketKey: string;
  activeCount: number;
  totalCount: number;
  updatedAt: number;
}

export interface HighlightIndexV1 {
  schemaVersion: typeof HIGHLIGHT_SCHEMA_VERSION;
  accountHash: string;
  conversations: Record<string, HighlightConversationIndexEntryV1>;
  clearMarkers?: Partial<Record<HighlightPlatform, HighlightClearMarkerV1>>;
  updatedAt: number;
}

export interface HighlightConversationBucketV1 {
  schemaVersion: typeof HIGHLIGHT_SCHEMA_VERSION;
  platform: HighlightPlatform;
  accountHash: string;
  conversationId: string;
  records: Record<string, HighlightRecordV1>;
  updatedAt: number;
}

export interface HighlightExportPayloadV1 {
  format: typeof HIGHLIGHT_EXPORT_FORMAT;
  exportedAt: string;
  version: string;
  accountScope: HighlightStoredAccountScope;
  clearMarker?: HighlightClearMarkerV1;
  items: HighlightRecordV1[];
}

export interface HighlightImportStats {
  imported: number;
  updated: number;
  duplicates: number;
  skippedByClearMarker: number;
  total: number;
}

export type HighlightMessage =
  | {
      type: 'gv.highlight.list';
      payload: {
        scope: HighlightAccountScope;
        conversationId?: string;
        includeDeleted?: boolean;
      };
    }
  | {
      type: 'gv.highlight.listAll';
      payload?: { includeDeleted?: boolean };
    }
  | {
      type: 'gv.highlight.create';
      payload: { scope: HighlightAccountScope; input: HighlightCreateInput };
    }
  | {
      type: 'gv.highlight.update';
      payload: {
        scope: HighlightAccountScope;
        conversationId: string;
        id: string;
        patch: HighlightUpdatePatch;
      };
    }
  | {
      type: 'gv.highlight.delete';
      payload: {
        scope: HighlightAccountScope;
        conversationId: string;
        id: string;
        tombstone?: boolean;
      };
    }
  | {
      type: 'gv.highlight.updateStored';
      payload: {
        platform: HighlightPlatform;
        accountHash: string;
        conversationId: string;
        id: string;
        patch: HighlightUpdatePatch;
      };
    }
  | {
      type: 'gv.highlight.deleteStored';
      payload: {
        platform: HighlightPlatform;
        accountHash: string;
        conversationId: string;
        id: string;
        tombstone?: boolean;
      };
    }
  | {
      type: 'gv.highlight.clearAll';
      payload?: { scope?: HighlightAccountScope };
    }
  | {
      /** Trusted popup action used by quota cleanup across account scopes. */
      type: 'gv.highlight.clearAllAccounts';
    }
  | {
      type: 'gv.highlight.export';
      payload: { scope?: HighlightAccountScope; format: 'json' | 'markdown' };
    }
  | {
      type: 'gv.highlight.import';
      payload: { scope?: HighlightAccountScope; data: string };
    };

export type HighlightMessageResponse =
  | { ok: true; records: HighlightRecordV1[] }
  | { ok: true; record: HighlightRecordV1; duplicate?: boolean }
  | { ok: true; removed: boolean; tombstone: boolean; record?: HighlightRecordV1 }
  | { ok: true; removed: number }
  | { ok: false; error: string; code?: string };

export interface HighlightChangedMessage {
  type: 'gv.highlight.changed';
  payload: {
    accountHash: string;
    platform: HighlightPlatform;
    conversationId?: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isPlatform(value: unknown): value is HighlightPlatform {
  return value === 'gemini' || value === 'aistudio';
}

function isRole(value: unknown): value is HighlightRole {
  return value === 'assistant' || value === 'user';
}

function isColor(value: unknown): value is HighlightColor {
  return isHighlightPresetColor(value) || isHighlightCustomColor(value);
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return isColor(value);
}

export function isHighlightConversationUrl(value: string, platform: HighlightPlatform): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return packagedSiteForUrl(url.href) === platform;
  } catch {
    return false;
  }
}

function isRevision(value: unknown): value is HighlightRevision {
  if (!isObject(value)) return false;
  return (
    Number.isSafeInteger(value.counter) &&
    (value.counter as number) >= 0 &&
    typeof value.deviceId === 'string' &&
    value.deviceId.length > 0 &&
    value.deviceId.length <= 128
  );
}

function isAnchor(value: unknown): value is HighlightAnchor {
  if (!isObject(value) || !isObject(value.quote) || !isObject(value.position)) return false;
  const { exact, prefix, suffix } = value.quote;
  const { start, end } = value.position;
  return (
    typeof exact === 'string' &&
    exact.length > 0 &&
    utf8Bytes(exact) <= HIGHLIGHT_LIMITS.exactBytes &&
    typeof prefix === 'string' &&
    Array.from(prefix).length <= HIGHLIGHT_LIMITS.contextCharacters &&
    typeof suffix === 'string' &&
    Array.from(suffix).length <= HIGHLIGHT_LIMITS.contextCharacters &&
    Number.isSafeInteger(start) &&
    (start as number) >= 0 &&
    Number.isSafeInteger(end) &&
    (end as number) >= (start as number) &&
    typeof value.sourceTextHash === 'string' &&
    value.sourceTextHash.length > 0 &&
    value.sourceTextHash.length <= 256
  );
}

export function isHighlightRecordV1(value: unknown): value is HighlightRecordV1 {
  if (!isObject(value)) return false;
  const noteIsValid =
    value.note === undefined ||
    (typeof value.note === 'string' && utf8Bytes(value.note) <= HIGHLIGHT_LIMITS.noteBytes);
  const optionalTitleIsValid =
    value.conversationTitle === undefined || typeof value.conversationTitle === 'string';
  const optionalDeletedAtIsValid = value.deletedAt === undefined || isFiniteNumber(value.deletedAt);
  const optionalClearGenerationIsValid =
    value.clearGeneration === undefined ||
    (typeof value.clearGeneration === 'string' &&
      value.clearGeneration.length > 0 &&
      value.clearGeneration.length <= 128);

  if (
    value.schemaVersion !== HIGHLIGHT_SCHEMA_VERSION ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    !isPlatform(value.platform) ||
    typeof value.accountHash !== 'string' ||
    value.accountHash.length === 0 ||
    value.accountHash.length > 128 ||
    typeof value.conversationId !== 'string' ||
    value.conversationId.length === 0 ||
    typeof value.conversationUrl !== 'string' ||
    !isHighlightConversationUrl(value.conversationUrl, value.platform) ||
    !optionalTitleIsValid ||
    typeof value.turnId !== 'string' ||
    value.turnId.length === 0 ||
    !isRole(value.role) ||
    !isAnchor(value.anchor) ||
    !noteIsValid ||
    !isColor(value.color) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    !isRevision(value.revision) ||
    !optionalClearGenerationIsValid ||
    !optionalDeletedAtIsValid
  ) {
    return false;
  }

  return utf8Bytes(JSON.stringify(value)) <= HIGHLIGHT_LIMITS.recordBytes;
}

export function isHighlightClearMarkerV1(value: unknown): value is HighlightClearMarkerV1 {
  if (!isObject(value) || !isFiniteNumber(value.clearedAt) || !isRevision(value.revision)) {
    return false;
  }
  if (value.generation === undefined) return true;
  return (
    isObject(value.generation) &&
    Number.isSafeInteger(value.generation.counter) &&
    (value.generation.counter as number) > 0 &&
    typeof value.generation.id === 'string' &&
    value.generation.id.length > 0 &&
    value.generation.id.length <= 128
  );
}

export function isHighlightExportPayloadV1(value: unknown): value is HighlightExportPayloadV1 {
  if (!isObject(value) || !isObject(value.accountScope) || !Array.isArray(value.items)) {
    return false;
  }

  return (
    value.format === HIGHLIGHT_EXPORT_FORMAT &&
    typeof value.exportedAt === 'string' &&
    !Number.isNaN(Date.parse(value.exportedAt)) &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    isPlatform(value.accountScope.platform) &&
    typeof value.accountScope.accountHash === 'string' &&
    value.accountScope.accountHash.length > 0 &&
    (value.clearMarker === undefined || isHighlightClearMarkerV1(value.clearMarker)) &&
    value.items.every(isHighlightRecordV1)
  );
}
