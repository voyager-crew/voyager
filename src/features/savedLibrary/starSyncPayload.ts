import { extractRouteUserIdFromUrl } from '@/core/services/AccountIsolationService';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import { retargetImportedStarState } from './starAccountRoute';
import { mergeStarredMessages, normalizeStarredMessages } from './starData';
import { normalizeStarTombstones, type StarState } from './starSyncData';
import type { StarredMessage, StarredMessagesData, StarTombstone } from './starTypes';

export const STARS_V2_FORMAT = 'gemini-voyager.stars.v2';
export interface StarsExportPayloadV2 {
  format: typeof STARS_V2_FORMAT;
  exportedAt: string;
  version: string;
  accountScope?: { accountHash: string };
  items: StarredMessage[];
  tombstones: StarTombstone[];
}
export interface StarSyncSources {
  /** Local download receipt context; never part of a Drive payload. */
  snapshotId?: string;
  v1?: unknown;
  v1AccountHash?: string;
  v2?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

function itemsToData(items: StarredMessage[]): StarredMessagesData {
  const messages: Record<string, StarredMessage[]> = Object.create(null);
  for (const item of items) (messages[item.conversationId] ??= []).push(item);
  return normalizeStarredMessages({ messages });
}

export function filterStarStateByScope(
  state: StarState,
  scope: SyncAccountScope | null,
): StarState {
  const matches = (url: string): boolean => {
    if (!scope?.routeUserId) return true;
    const route = extractRouteUserIdFromUrl(url);
    return route === null || route === scope.routeUserId;
  };
  const messages: Record<string, StarredMessage[]> = Object.create(null);
  for (const [id, bucket] of Object.entries(state.data.messages)) {
    const filtered = bucket.filter((item) => matches(item.conversationUrl));
    if (filtered.length) messages[id] = filtered;
  }
  return {
    data: { messages },
    tombstones: state.tombstones.filter((item) => matches(item.conversationUrl)),
  };
}

export function decodeStarsV2(value: unknown, scope: SyncAccountScope | null): StarState {
  if (
    !isRecord(value) ||
    value.format !== STARS_V2_FORMAT ||
    typeof value.exportedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    typeof value.version !== 'string' ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.tombstones) ||
    (scope
      ? !isRecord(value.accountScope) ||
        value.accountScope.accountHash !== hashString(scope.accountKey)
      : value.accountScope !== undefined)
  )
    throw new Error('Invalid stars v2 envelope or account scope');
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !nonempty(item.conversationId) ||
      !nonempty(item.turnId) ||
      typeof item.content !== 'string' ||
      typeof item.conversationUrl !== 'string' ||
      !finite(item.starredAt) ||
      !optionalString(item.account) ||
      !optionalString(item.conversationTitle) ||
      !optionalString(item.text)
    )
      throw new Error('Invalid stars v2 item');
  }
  for (const item of value.tombstones) {
    if (
      !isRecord(item) ||
      !nonempty(item.conversationId) ||
      !nonempty(item.turnId) ||
      typeof item.conversationUrl !== 'string' ||
      !finite(item.starredAt) ||
      !finite(item.deletedAt) ||
      !optionalString(item.account) ||
      (item.movedTo !== undefined && !nonempty(item.movedTo))
    )
      throw new Error('Invalid stars v2 deletion');
  }
  // A matching account hash authorizes the backup; /u/N is only this browser's navigation slot.
  return retargetImportedStarState(
    {
      data: itemsToData(value.items as StarredMessage[]),
      tombstones: normalizeStarTombstones(value.tombstones),
    },
    scope,
  );
}

export function decodeStarSyncSources(
  sources: StarSyncSources,
  scope: SyncAccountScope | null,
): StarState {
  return decodeStarSyncSourcesWithAuthority(sources, scope).state;
}

export function decodeStarSyncSourcesWithAuthority(
  sources: StarSyncSources,
  scope: SyncAccountScope | null,
): { state: StarState; authorized: StarState } {
  if (
    sources.snapshotId !== undefined &&
    (typeof sources.snapshotId !== 'string' || sources.snapshotId.length === 0)
  )
    throw new Error('Invalid cloud snapshot id');
  const v2 =
    sources.v2 == null
      ? { data: normalizeStarredMessages(undefined), tombstones: [] }
      : decodeStarsV2(sources.v2, scope);
  const v1 = sources.v1;
  if (
    v1 != null &&
    (!isRecord(v1) ||
      !isRecord(v1.data) ||
      !isRecord(v1.data.messages) ||
      ('format' in v1 && v1.format !== 'gemini-voyager.starred.v1'))
  )
    throw new Error('Invalid starred messages envelope');
  if (
    sources.v1AccountHash !== undefined &&
    (!scope || sources.v1AccountHash !== hashString(scope.accountKey))
  )
    throw new Error('Invalid starred messages account scope');
  const legacy = {
    data: normalizeStarredMessages(isRecord(v1) ? v1.data : undefined),
    tombstones: [],
  };
  // Resolve each source before merging so an old navigation slot cannot discard the newer choice.
  const scopedLegacy = sources.v1AccountHash !== undefined;
  const accepted = scopedLegacy
    ? retargetImportedStarState(legacy, scope)
    : filterStarStateByScope(legacy, scope);
  return {
    state: {
      data: mergeStarredMessages(v2.data, accepted.data),
      tombstones: v2.tombstones,
    },
    authorized: {
      data: scopedLegacy ? mergeStarredMessages(v2.data, accepted.data) : v2.data,
      tombstones: v2.tombstones,
    },
  };
}

export function buildStarsV2(
  state: StarState,
  scope: SyncAccountScope | null,
  version: string,
  exportedAt = new Date().toISOString(),
): StarsExportPayloadV2 {
  const filtered = filterStarStateByScope(state, scope);
  return {
    format: STARS_V2_FORMAT,
    exportedAt,
    version,
    ...(scope ? { accountScope: { accountHash: hashString(scope.accountKey) } } : {}),
    items: Object.values(filtered.data.messages).flat(),
    tombstones: normalizeStarTombstones(filtered.tombstones),
  };
}
