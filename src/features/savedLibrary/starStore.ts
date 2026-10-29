import { recordCloudSyncWrites } from '@/core/services/CloudSyncSnapshotService';
import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';

import { retargetKnownStarState } from './starAccountRoute';
import { mergeStarredMessages, normalizeStarredMessages } from './starData';
import {
  mergeStarState,
  normalizeStarTombstones,
  starDeletionConversationIds,
  type StarState,
} from './starSyncData';
import {
  decodeStarSyncSourcesWithAuthority,
  filterStarStateByScope,
  type StarSyncSources,
} from './starSyncPayload';
import { getBackfillStarText, legacyStarProjection } from './starText';
import type { StarredMessage, StarredMessagesData, StarTombstone } from './starTypes';

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StarStore {
  getSyncSnapshot(scope: SyncAccountScope | null): Promise<StarState>;
  mergeSync(sources: StarSyncSources, scope: SyncAccountScope | null): Promise<StarState>;
  getAll(): Promise<StarredMessagesData>;
  getForConversation(id: string): Promise<StarredMessage[]>;
  add(item: StarredMessage): Promise<boolean>;
  backfill(conversationId: string, entries: Array<{ turnId: string; text: string }>): Promise<void>;
  remove(conversationId: string, turnId: string): Promise<boolean>;
  reconcile(target: string, sources: string[], url?: string): Promise<StarredMessage[]>;
  mergeCloud(envelope: unknown): Promise<{ status: 'absent' | 'merged'; count: number }>;
}

const MAX_CONTENT_LENGTH = 60;

export function createStarStore(area: StorageArea): StarStore {
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  const keys = [
    StorageKeys.SAVED_LIBRARY_STARS,
    StorageKeys.TIMELINE_STARRED_MESSAGES,
    StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES,
  ];
  const write = async ({ data, tombstones }: StarState, snapshotId?: string): Promise<void> => {
    const items = {
      [StorageKeys.SAVED_LIBRARY_STARS]: data,
      [StorageKeys.TIMELINE_STARRED_MESSAGES]: legacyStarProjection(data),
      [StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES]: tombstones,
    };
    // The scoped return value omits other accounts that this physical write preserves.
    if (snapshotId !== undefined)
      await recordCloudSyncWrites(
        snapshotId,
        Object.entries(items).map(([key, value]) => ({
          area: 'local',
          key,
          kind: 'starred',
          value,
        })),
      );
    await area.set(items);
  };
  const read = async (sources: StarredMessagesData[] = [], deletions: StarTombstone[] = []) => {
    const values = await area.get(keys);
    const rawTombstones = normalizeStarTombstones(
      values[StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES],
    );
    const state = mergeStarState(
      [
        normalizeStarredMessages(values[StorageKeys.SAVED_LIBRARY_STARS]),
        normalizeStarredMessages(values[StorageKeys.TIMELINE_STARRED_MESSAGES]),
        ...sources,
      ],
      [...rawTombstones, ...deletions],
      Date.now(),
    );
    const serialized = JSON.stringify(state.data);
    return {
      ...state,
      rawTombstones,
      dirty:
        keys.some((key) => values[key] !== undefined) &&
        (JSON.stringify(values[StorageKeys.SAVED_LIBRARY_STARS]) !== serialized ||
          JSON.stringify(values[StorageKeys.TIMELINE_STARRED_MESSAGES]) !==
            JSON.stringify(legacyStarProjection(state.data)) ||
          JSON.stringify(values[StorageKeys.SAVED_LIBRARY_STAR_TOMBSTONES]) !==
            JSON.stringify(state.tombstones)),
    };
  };
  const readReconciled = async (): Promise<StarredMessagesData> => {
    const state = await read();
    if (state.dirty) await write(state);
    return state.data;
  };
  const deletionFor = (conversationId: string, item: StarredMessage): StarTombstone => ({
    conversationId,
    turnId: item.turnId,
    conversationUrl: item.conversationUrl,
    starredAt: item.starredAt,
    deletedAt: Date.now(),
    ...(typeof item.account === 'string' ? { account: item.account } : {}),
  });

  const mergeSync = (sources: StarSyncSources, scope: SyncAccountScope | null) => {
    const capturedScope = scope ? { ...scope } : null;
    return serialize(async () => {
      const { state: incoming, authorized } = decodeStarSyncSourcesWithAuthority(
        sources,
        capturedScope,
      );
      const state = await read([incoming.data], incoming.tombstones);
      const imported = retargetKnownStarState(state, authorized, capturedScope);
      if (sources.v1 != null || sources.v2 != null || state.dirty)
        await write(imported, sources.snapshotId);
      return filterStarStateByScope(imported, capturedScope);
    });
  };

  return {
    mergeSync,
    getSyncSnapshot: (scope) => mergeSync({}, scope),
    getAll: () => serialize(readReconciled),
    getForConversation: (id) => serialize(async () => (await readReconciled()).messages[id] || []),
    add: (item) =>
      serialize(async () => {
        const state = await read();
        const { data, rawTombstones } = state;
        const bucket = data.messages[item.conversationId] || [];
        if (bucket.some((message) => message.turnId === item.turnId)) {
          if (state.dirty) await write(state);
          return false;
        }
        const incoming: Record<string, StarredMessage[]> = Object.create(null);
        incoming[item.conversationId] = [item];
        const normalized = normalizeStarredMessages({ messages: incoming }).messages[
          item.conversationId
        ][0];
        if (!normalized) throw new Error('Invalid starred message');
        const deletionIds = starDeletionConversationIds(
          item.conversationId,
          normalized.conversationUrl,
        );
        const starredAt = rawTombstones.reduce(
          (timestamp, deletion) =>
            deletionIds.includes(deletion.conversationId) && deletion.turnId === item.turnId
              ? Math.max(timestamp, deletion.starredAt + 1)
              : timestamp,
          normalized.starredAt,
        );
        data.messages[item.conversationId] = [
          ...bucket,
          {
            ...normalized,
            starredAt,
            content:
              normalized.content.length > MAX_CONTENT_LENGTH
                ? `${normalized.content.slice(0, MAX_CONTENT_LENGTH)}...`
                : normalized.content,
          },
        ];
        await write(mergeStarState([data], rawTombstones, Date.now()));
        return true;
      }),
    backfill: (conversationId, entries) =>
      serialize(async () => {
        const state = await read();
        const bucket = state.data.messages[conversationId] || [];
        let changed = false;
        for (const entry of entries) {
          if (!entry || typeof entry.turnId !== 'string' || typeof entry.text !== 'string')
            continue;
          const item = bucket.find((record) => record.turnId === entry.turnId);
          if (!item) continue;
          const text = getBackfillStarText(item, entry.text);
          if (text === undefined) continue;
          item.text = text;
          changed = true;
        }
        if (changed || state.dirty) await write(state);
      }),
    remove: (conversationId, turnId) =>
      serialize(async () => {
        const state = await read();
        const { data, rawTombstones } = state;
        const bucket = data.messages[conversationId] || [];
        const remaining = bucket.filter((item) => item.turnId !== turnId);
        if (bucket.length === remaining.length) {
          if (state.dirty) await write(state);
          return false;
        }
        if (remaining.length) data.messages[conversationId] = remaining;
        else delete data.messages[conversationId];
        const deleted = bucket
          .filter((item) => item.turnId === turnId)
          .map((item) => deletionFor(conversationId, item));
        await write(mergeStarState([data], [...rawTombstones, ...deleted], Date.now()));
        return true;
      }),
    reconcile: (target, sources, url) =>
      serialize(async () => {
        const { data, rawTombstones } = await read();
        const ids = Array.from(new Set([target, ...sources])).filter(Boolean);
        const deletions = [...rawTombstones];
        for (const item of rawTombstones) {
          if (
            !item.movedTo &&
            ids.includes(item.conversationId) &&
            item.conversationId !== target
          ) {
            deletions.push({
              ...item,
              conversationId: target,
              conversationUrl: url || item.conversationUrl,
            });
          }
        }
        let merged = normalizeStarredMessages(undefined);
        for (const id of ids) {
          if (id !== target) {
            deletions.push(
              ...(data.messages[id] || []).map((item) => ({
                ...deletionFor(id, item),
                movedTo: target,
              })),
            );
          }
          const bucket = (data.messages[id] || []).map((item) => ({
            ...item,
            conversationId: target,
            conversationUrl: url || item.conversationUrl,
          }));
          // Later source buckets keep the existing reconciliation tie precedence.
          const source: Record<string, StarredMessage[]> = Object.create(null);
          source[target] = bucket;
          merged = mergeStarredMessages({ messages: source }, merged);
        }
        const result = merged.messages[target] || [];
        if (result.length) data.messages[target] = result;
        else delete data.messages[target];
        for (const id of ids) if (id !== target) delete data.messages[id];
        const state = mergeStarState([data], deletions, Date.now());
        await write(state);
        return state.data.messages[target] || [];
      }),
    mergeCloud: async (envelope) => {
      if (envelope === null || typeof envelope !== 'object') return { status: 'absent', count: 0 };
      const state = await mergeSync(
        {
          v1: {
            ...envelope,
            data: normalizeStarredMessages('data' in envelope ? envelope.data : undefined),
          },
        },
        null,
      );
      return {
        status: 'merged',
        count: Object.values(state.data.messages).reduce(
          (total, bucket) => total + bucket.length,
          0,
        ),
      };
    },
  };
}
