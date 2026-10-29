import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleDriveAuth } from '../GoogleDriveAuth';

const runtime = vi.hoisted(() => ({ brave: false }));
const webAuth = vi.hoisted(() => vi.fn());
vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => 'chrome',
  isBrave: () => runtime.brave,
  isSafari: () => false,
}));
vi.mock('@/core/services/googleOAuthWebFlow', () => ({ runGoogleWebAuthFlow: webAuth }));

function device() {
  const stored: Record<string, unknown> = { unrelated: 'keep' };
  const identity = vi.fn((_options: unknown, callback: (token: string) => void) =>
    callback('identity-token'),
  );
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      getManifest: () => ({ oauth2: { client_id: 'client', scopes: ['drive.file'] } }),
    },
    identity: {
      getAuthToken: identity,
      getRedirectURL: () => 'https://test.chromiumapp.org/',
    },
    storage: {
      local: {
        get: async () => structuredClone(stored),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(items));
        },
        remove: async (keys: string[]) => {
          for (const key of keys) delete stored[key];
        },
      },
    },
  });
  return { stored, identity };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  runtime.brave = false;
  webAuth.mockReset();
  webAuth.mockResolvedValue({ accessToken: 'web-token', expiresIn: 3600 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('upload preflight token persistence', () => {
  it.each(['identity', 'web'] as const)(
    '%s authentication can read cloud without writing local storage, then persist the original token',
    async (source) => {
      runtime.brave = source === 'web';
      const d = device();
      const auth = new GoogleDriveAuth(() => 'googleDrive');
      const token = source === 'identity' ? 'identity-token' : 'web-token';
      const expiry = Date.now() + (source === 'identity' ? 54 : 59) * 60 * 1000;

      await expect(auth.getToken(true, false)).resolves.toBe(token);
      await expect(auth.getToken(false, false)).resolves.toBe(token);
      expect(d.stored).toEqual({ unrelated: 'keep' });

      vi.advanceTimersByTime(30_000);
      await expect(auth.getToken(false)).resolves.toBe(token);
      expect(d.stored).toEqual({
        unrelated: 'keep',
        gvAccessToken: token,
        gvTokenExpiry: expiry,
      });
      const nextWorker = new GoogleDriveAuth(() => 'googleDrive');
      await expect(nextWorker.getToken(false)).resolves.toBe(token);
      expect(d.identity).toHaveBeenCalledTimes(source === 'identity' ? 1 : 0);
      expect(webAuth).toHaveBeenCalledTimes(source === 'web' ? 1 : 0);
    },
  );

  it('clearing an unpersisted token prevents a later call from resurrecting it', async () => {
    const d = device();
    const auth = new GoogleDriveAuth(() => 'googleDrive');
    await auth.getToken(false, false);
    await auth.clear();
    d.identity.mockImplementation((_options, callback) => callback('new-token'));

    await expect(auth.getToken(false)).resolves.toBe('new-token');
    expect(d.stored).toEqual({
      unrelated: 'keep',
      gvAccessToken: 'new-token',
      gvTokenExpiry: Date.now() + 54 * 60 * 1000,
    });
    expect(d.identity).toHaveBeenCalledTimes(2);
  });
});
