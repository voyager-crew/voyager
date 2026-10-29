import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { hashString } from '@/core/utils/hash';
import { handlePageRuntimeMessage } from '@/pages/background/pageRuntimeMessages';

import { AccountIsolationService } from '../AccountIsolationService';

function device(initial: Record<string, unknown> = {}) {
  const stored = structuredClone(initial);
  vi.stubGlobal('chrome', {
    storage: {
      sync: { get: async () => ({}) },
      local: {
        get: async () => structuredClone(stored),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(items));
        },
      },
    },
  });
  return stored;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  vi.stubEnv('VOYAGER_BUILD_TARGET', 'chrome');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('account scope upload preflight', () => {
  it('resolves a new route profile without creating it until the upload is allowed', async () => {
    const stored = device({ unrelated: 'keep' });
    const service = new AccountIsolationService();
    const hints = { pageUrl: 'https://gemini.google.com/u/2/app', routeUserId: '2' };
    const preview = await service.resolveAccountScope(hints, false);
    expect(preview).toEqual({
      accountKey: 'route:2',
      accountId: 1,
      routeUserId: '2',
      emailHash: null,
    });
    expect(stored).toEqual({ unrelated: 'keep' });

    await expect(service.resolveAccountScope(hints)).resolves.toEqual(preview);
    expect(stored).toEqual({
      unrelated: 'keep',
      [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: {
        version: 1,
        nextId: 2,
        profiles: {
          'route:2': { id: 1, createdAt: Date.now(), updatedAt: Date.now(), routeUserId: '2' },
        },
        routeAliases: { '2': 'route:2' },
        emailAliases: {},
      },
    });
  });

  it('previews the existing route-to-email binding without changing its id or stored aliases', async () => {
    const initial = {
      [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: {
        version: 1,
        nextId: 8,
        profiles: { 'route:2': { id: 7, createdAt: 1, updatedAt: 1, routeUserId: '2' } },
        routeAliases: { '2': 'route:2' },
        emailAliases: {},
      },
    };
    const stored = device(initial);
    const service = new AccountIsolationService();
    const hints = { routeUserId: '2', email: 'owner@example.com' };
    const preview = await service.resolveAccountScope(hints, false);
    expect(preview).toMatchObject({ accountKey: 'route:2', accountId: 7 });
    expect(stored).toEqual(initial);

    await expect(service.resolveAccountScope(hints)).resolves.toEqual(preview);
    expect(stored).toEqual({
      [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: {
        version: 1,
        nextId: 8,
        profiles: {
          'route:2': {
            id: 7,
            createdAt: 1,
            updatedAt: Date.now(),
            routeUserId: '2',
            emailHash: hashString('owner@example.com'),
          },
        },
        routeAliases: { '2': 'route:2' },
        emailAliases: { [hashString('owner@example.com')]: 'route:2' },
      },
    });
  });

  it('keeps Firefox forwarded preflight read-only through the real background resolver', async () => {
    vi.stubEnv('VOYAGER_BUILD_TARGET', 'firefox');
    const stored = device({ unrelated: 'keep' });
    Object.assign(chrome, {
      runtime: {
        sendMessage: async (message: { type: string; payload?: unknown }) => {
          // The background has no content-script forwarding; emulate that separate context.
          vi.stubEnv('VOYAGER_BUILD_TARGET', 'chrome');
          try {
            return await handlePageRuntimeMessage(message, {});
          } finally {
            vi.stubEnv('VOYAGER_BUILD_TARGET', 'firefox');
          }
        },
      },
    });
    const service = new AccountIsolationService();
    const hints = { pageUrl: 'https://gemini.google.com/u/3/app', routeUserId: '3' };

    const preview = await service.resolveAccountScope(hints, false);
    expect(preview).toEqual({
      accountKey: 'route:3',
      accountId: 1,
      routeUserId: '3',
      emailHash: null,
    });
    expect(stored).toEqual({ unrelated: 'keep' });

    await expect(service.resolveAccountScope(hints)).resolves.toEqual(preview);
    expect(stored).toEqual({
      unrelated: 'keep',
      [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: {
        version: 1,
        nextId: 2,
        profiles: {
          'route:3': { id: 1, createdAt: Date.now(), updatedAt: Date.now(), routeUserId: '3' },
        },
        routeAliases: { '3': 'route:3' },
        emailAliases: {},
      },
    });
  });
});
