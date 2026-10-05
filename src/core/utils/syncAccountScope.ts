import type { AccountScope } from '@/core/services/AccountIsolationService';
import type { SyncAccountScope } from '@/core/types/sync';

/** The part of an account scope a sync message carries; no scope stays `undefined`. */
export function toSyncAccountScope(scope: AccountScope): SyncAccountScope;
export function toSyncAccountScope(scope: AccountScope | null): SyncAccountScope | undefined;
export function toSyncAccountScope(scope: AccountScope | null): SyncAccountScope | undefined {
  if (!scope) return undefined;
  return {
    accountKey: scope.accountKey,
    accountId: scope.accountId,
    routeUserId: scope.routeUserId,
  };
}
