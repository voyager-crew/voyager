import type { SyncAccountScope } from '@/core/types/sync';
import { FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';
import type { StarStore } from '@/features/savedLibrary/starStore';
import type { StarSyncSources } from '@/features/savedLibrary/starSyncPayload';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { isTrustedSyncMessageSender } from './runtimeMessageRouting';

type StarredMessageRequest =
  | { type: 'gv.starred.add'; payload: StarredMessage }
  | {
      type: 'gv.starred.backfillTexts';
      payload: { conversationId: string; entries: Array<{ turnId: string; text: string }> };
    }
  | {
      type: 'gv.starred.remove' | 'gv.starred.isStarred';
      payload: Pick<StarredMessage, 'conversationId' | 'turnId'>;
    }
  | { type: 'gv.starred.getAll' }
  | { type: 'gv.starred.getForConversation'; payload: Pick<StarredMessage, 'conversationId'> }
  | { type: 'gv.starred.mergeCloud'; payload: unknown }
  | { type: 'gv.starred.mergeSync'; payload: StarSyncSources & { accountScope: unknown } }
  | {
      type: 'gv.starred.reconcileConversationIds';
      payload: {
        targetConversationId: string;
        sourceConversationIds?: unknown;
        conversationUrl?: unknown;
      };
    };

function isSyncAccountScope(value: unknown): value is SyncAccountScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Record<string, unknown>;
  return (
    typeof scope.accountKey === 'string' &&
    typeof scope.accountId === 'number' &&
    Number.isFinite(scope.accountId) &&
    (typeof scope.routeUserId === 'string' || scope.routeUserId === null)
  );
}

export function createStarredMessagesHandler(store: StarStore) {
  return (
    message: unknown,
    sender?: chrome.runtime.MessageSender,
  ): Promise<Record<string, unknown>> | null => {
    const request = message as StarredMessageRequest | null;
    switch (request?.type) {
      case 'gv.starred.add':
        return store.add(request.payload).then((added) => ({ ok: true, added }));
      case 'gv.starred.backfillTexts':
        return store
          .backfill(request.payload.conversationId, request.payload.entries)
          .then(() => ({ ok: true }));
      case 'gv.starred.remove':
        return store
          .remove(request.payload.conversationId, request.payload.turnId)
          .then((removed) => ({ ok: true, removed }));
      case 'gv.starred.getAll':
        return store.getAll().then((data) => ({ ok: true, data }));
      case 'gv.starred.getForConversation':
        return store
          .getForConversation(request.payload.conversationId)
          .then((messages) => ({ ok: true, messages }));
      case 'gv.starred.isStarred':
        return store.getForConversation(request.payload.conversationId).then((messages) => ({
          ok: true,
          isStarred: messages.some((item) => item.turnId === request.payload.turnId),
        }));
      case 'gv.starred.reconcileConversationIds':
        return store
          .reconcile(
            request.payload.targetConversationId,
            Array.isArray(request.payload.sourceConversationIds)
              ? request.payload.sourceConversationIds.filter(
                  (id): id is string => typeof id === 'string',
                )
              : [],
            typeof request.payload.conversationUrl === 'string'
              ? request.payload.conversationUrl
              : undefined,
          )
          .then((messages) => ({ ok: true, messages }));
      case 'gv.starred.mergeSync':
      case 'gv.starred.mergeCloud':
        if (
          !sender ||
          !FOLDER_PLATFORM_IDS.some((platform) => isTrustedSyncMessageSender(sender, platform))
        ) {
          return Promise.reject(new Error('Untrusted starred messages restore sender'));
        }
        if (request.type === 'gv.starred.mergeSync') {
          const scope = request.payload?.accountScope;
          if (scope !== null && !isSyncAccountScope(scope)) {
            return Promise.reject(new Error('Invalid starred messages restore scope'));
          }
          return store.mergeSync(request.payload, scope).then(({ data }) => ({
            ok: true,
            status: 'merged',
            count: Object.values(data.messages).reduce((total, bucket) => total + bucket.length, 0),
          }));
        }
        return store.mergeCloud(request.payload).then((result) => ({ ok: true, ...result }));
      default:
        return null;
    }
  };
}
