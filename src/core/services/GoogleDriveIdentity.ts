import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

export class AccountUnconfirmedError extends Error {
  readonly code = 'account_unconfirmed';
  constructor() {
    super('account_unconfirmed');
  }
}

export interface DriveAccountIdentity {
  emailKey: string;
  legacy: SyncAccountScope[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

export function scopedDriveFileName(base: string, key: string): string {
  const dot = base.lastIndexOf('.');
  const suffix = `.acct-${hashString(key)}`;
  return dot > 0 ? `${base.slice(0, dot)}${suffix}${base.slice(dot)}` : `${base}${suffix}`;
}

/** One turn captures cloud identity without changing the account's local bucket identity. */
export class GoogleDriveIdentity {
  private readonly captured = new Map<string, DriveAccountIdentity>();

  async capture(...scopes: (SyncAccountScope | null | undefined)[]): Promise<void> {
    const required = scopes.filter((scope) => scope && !this.captured.has(scope.accountKey));
    if (required.length === 0) return;
    const values = await chrome.storage.local.get([StorageKeys.GV_ACCOUNT_PROFILE_MAP]);
    const map = record(values[StorageKeys.GV_ACCOUNT_PROFILE_MAP]);
    const profiles = record(map?.profiles) ?? {};
    for (const scope of required) {
      if (!scope) continue;
      const profile = record(profiles[scope.accountKey]);
      const observed = profile?.emailHash;
      const emailHash =
        typeof observed === 'string' && observed.length > 0
          ? observed
          : scope.accountKey.startsWith('email:')
            ? scope.accountKey.slice('email:'.length)
            : '';
      if (!emailHash) throw new AccountUnconfirmedError();
      const legacy: SyncAccountScope[] = [];
      for (const [key, value] of Object.entries(profiles)) {
        const route = /^route:(\d+)$/.exec(key)?.[1];
        const bound = record(value);
        if (route && bound?.emailHash === emailHash) {
          // A route-first bucket key survives account moves; the profile tracks its latest slot.
          const currentRoute = typeof bound.routeUserId === 'string' ? bound.routeUserId : route;
          legacy.push({ accountKey: key, accountId: scope.accountId, routeUserId: currentRoute });
        }
      }
      this.captured.set(scope.accountKey, { emailKey: `email:${emailHash}`, legacy });
    }
  }

  get(scope: SyncAccountScope): DriveAccountIdentity {
    const identity = this.captured.get(scope.accountKey);
    if (!identity) throw new AccountUnconfirmedError();
    return identity;
  }

  name(base: string, scope: SyncAccountScope | null): string {
    return scope ? scopedDriveFileName(base, this.get(scope).emailKey) : base;
  }
}
