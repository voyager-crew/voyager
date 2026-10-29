import { describe, expect, it } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { OpName } from '@/features/bridge/protocol';
import type { HostCatalogCacheEntry } from '@/features/plugins/remote/hostCatalogCache';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import type { SiteAdapter } from '@/features/plugins/types';

import {
  BRIDGE_PLUGIN_ID,
  type PolicyEvaluationInput,
  createBridgePolicy,
  evaluateBridgePolicy,
} from '../bridgePolicy';
import { testArea } from './bridgeTestKit';

const VERSION = '2.1.0';
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const SITE = {
  id: 'chatgpt',
  label: 'ChatGPT',
  matches: ['https://chatgpt.com/*'],
  selectors: { composer: '#prompt-textarea' },
  theme: { hostSelector: 'html', lightSelector: 'html.light', darkSelector: 'html.dark' },
};

function site(revision: number, allow?: readonly OpName[] | 'broken'): Record<string, unknown> {
  return {
    ...SITE,
    catalogRevision: revision,
    ...(allow === 'broken'
      ? { bridge: { format: 9, allow: [] } }
      : allow
        ? { bridge: { format: 1, allow } }
        : {}),
  };
}

function adapter(raw: Record<string, unknown>): SiteAdapter {
  const result = validateSiteAdapterData(raw);
  if (!result.success) throw new Error('fixture must validate');
  return result.data;
}

function entry(
  raw: Record<string, unknown> | null,
  overrides: Partial<HostCatalogCacheEntry> = {},
) {
  return {
    host: 'chatgpt.com',
    status: 'ok',
    manifests: [],
    fetchedAt: NOW - HOUR,
    lastAttemptAt: NOW - HOUR,
    failureCount: 0,
    extensionVersion: VERSION,
    ...(raw ? { site: raw } : {}),
    ...overrides,
  } as HostCatalogCacheEntry;
}

const PACKAGED_RELEASE = adapter(site(500, ['composer.send']));
const PACKAGED_DEV = adapter(site(0, ['composer.send']));

function evaluate(input: Partial<PolicyEvaluationInput>) {
  return evaluateBridgePolicy({
    entry: null,
    extensionVersion: VERSION,
    packaged: PACKAGED_RELEASE,
    highWater: null,
    now: NOW,
    ...input,
  });
}

describe('evaluateBridgePolicy', () => {
  it('allows the ops of a fresh remote policy newer than the packaged site', () => {
    const { verdict, nextHighWater } = evaluate({ entry: entry(site(501, ['composer.send'])) });
    expect(verdict).toMatchObject({ state: 'allowed', source: 'remote', allow: ['composer.send'] });
    expect(nextHighWater).toEqual({ revision: 501, allow: ['composer.send'] });
  });

  it('never lets a release build run on its packaged policy', () => {
    expect(evaluate({ entry: null }).verdict).toMatchObject({
      state: 'denied',
      code: 'policy-stale',
    });
  });

  it('runs the first bridge release on the catalog published from its own commit', () => {
    const { verdict, nextHighWater } = evaluate({ entry: entry(site(500, ['composer.send'])) });
    expect(verdict).toMatchObject({ state: 'allowed', source: 'remote', revision: 500 });
    expect(nextHighWater).toEqual({ revision: 500, allow: ['composer.send'] });
  });

  it('calls a catalog older than this build stale', () => {
    expect(evaluate({ entry: entry(site(499, ['composer.send'])) }).verdict).toMatchObject({
      state: 'denied',
      code: 'policy-stale',
    });
  });

  it('still expires, and still keeps the high-water mark for, a catalog of the build revision', () => {
    const old = entry(site(500, ['composer.send']), { fetchedAt: NOW - 25 * HOUR });
    expect(evaluate({ entry: old }).verdict).toMatchObject({ code: 'policy-stale' });
    const behind = evaluate({
      entry: entry(site(500, ['composer.send'])),
      highWater: { revision: 501, allow: ['composer.send'] },
    });
    expect(behind.verdict).toMatchObject({ code: 'policy-stale' });
  });

  it('keeps a dev build on its packaged policy when the remote one is unstamped too', () => {
    const { verdict } = evaluate({ packaged: PACKAGED_DEV, entry: entry(site(0, [])) });
    expect(verdict).toMatchObject({ state: 'allowed', source: 'packaged' });
  });

  it('lets an unstamped (dev) build use its packaged policy when no remote one applies', () => {
    expect(evaluate({ packaged: PACKAGED_DEV, entry: null }).verdict).toMatchObject({
      state: 'allowed',
      source: 'packaged',
    });
  });

  it('lets a published policy override the packaged one in a dev build', () => {
    const { verdict } = evaluate({ packaged: PACKAGED_DEV, entry: entry(site(9, [])) });
    expect(verdict).toMatchObject({ state: 'denied', code: 'policy-denied' });
  });

  it('refuses a revision older than one already accepted', () => {
    const { verdict, nextHighWater } = evaluate({
      entry: entry(site(600, ['composer.send'])),
      highWater: { revision: 601, allow: [] },
    });
    expect(verdict).toMatchObject({ state: 'denied', code: 'policy-stale' });
    expect(nextHighWater).toBeUndefined();
  });

  it('expires a policy fetched more than 24 hours ago', () => {
    const stale = entry(site(501, ['composer.send']), { fetchedAt: NOW - 25 * HOUR });
    expect(evaluate({ entry: stale }).verdict).toMatchObject({ code: 'policy-stale' });
  });

  it('keeps a Chrome dev build on its cached policy past 24 hours', () => {
    const old = entry(site(501, ['composer.send']), { fetchedAt: NOW - 25 * HOUR });
    expect(evaluate({ entry: old, neverExpires: true }).verdict).toMatchObject({
      state: 'allowed',
      source: 'remote',
      allow: ['composer.send'],
    });
  });

  it.each([
    ['a 404', entry(null, { status: 'missing' })],
    ['a missing bridge section', entry(site(501))],
    ['a broken bridge section', entry(site(501, 'broken'))],
    ['an empty allow list', entry(site(501, []))],
  ])('denies on %s', (_label, cached) => {
    expect(evaluate({ entry: cached }).verdict).toMatchObject({
      state: 'denied',
      code: 'policy-denied',
    });
  });

  it('asks for a fresh check when the cache was written by another version', () => {
    const other = entry(site(501, ['composer.send']), { extensionVersion: '2.0.0' });
    expect(evaluate({ entry: other }).verdict).toMatchObject({ code: 'policy-stale' });
  });
});

describe('createBridgePolicy', () => {
  function setup() {
    const local = testArea({
      [StorageKeys.PLUGINS_STATE]: { [BRIDGE_PLUGIN_ID]: { enabled: true, installedAt: 1 } },
    });
    const state = {
      entry: null as HostCatalogCacheEntry | null,
      origins: new Set(['https://chatgpt.com/*', 'http://127.0.0.1/*']),
    };
    const policy = createBridgePolicy({
      local,
      loadEntry: async () => state.entry,
      packaged: PACKAGED_RELEASE,
      extensionVersion: VERSION,
      hasOrigin: async (pattern) => state.origins.has(pattern),
      refreshCatalog: async () => {},
      loadOnlineUpdatesEnabled: async () => false,
      now: () => NOW,
    });
    return { local, state, policy };
  }

  it('keeps a deny once seen: an older allow arriving later stays refused', async () => {
    const { state, policy } = setup();
    state.entry = entry(site(501, ['composer.send']));
    expect(await policy.checkOp('composer.send')).toBeNull();

    state.entry = entry(site(502, []));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-denied');

    state.entry = entry(site(501, ['composer.send']));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-stale');
  });

  it('still refuses an older allow after one high-water write failed', async () => {
    const { state, policy, local } = setup();
    state.entry = entry(site(501, ['composer.send']));
    expect(await policy.checkOp('composer.send')).toBeNull();

    local.failNextSet = true;
    state.entry = entry(site(502, []));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-denied');

    state.entry = entry(site(503, []));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-denied');
    expect(local.values[StorageKeys.BRIDGE_POLICY_HIGH_WATER]).toEqual({
      revision: 503,
      allow: [],
    });

    state.entry = entry(site(501, ['composer.send']));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-stale');
  });

  it('refuses an older allow after a revoke whose high-water write failed', async () => {
    const { state, policy, local } = setup();
    state.entry = entry(site(501, ['composer.send']));
    expect(await policy.checkOp('composer.send')).toBeNull();

    local.failNextSet = true;
    state.entry = entry(site(502, []));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-denied');

    state.entry = entry(site(501, ['composer.send']));
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-stale');
  });

  it('keeps the high-water mark across a 404 and a broken file', async () => {
    const { state, policy, local } = setup();
    state.entry = entry(site(502, []));
    await policy.checkOp('composer.send');
    state.entry = entry(null, { status: 'missing' });
    expect((await policy.checkOp('composer.send'))?.code).toBe('policy-denied');
    expect(local.values[StorageKeys.BRIDGE_POLICY_HIGH_WATER]).toEqual({
      revision: 502,
      allow: [],
    });
  });

  it('refuses an op the policy does not list', async () => {
    const { state, policy } = setup();
    state.entry = entry(site(501, ['composer.send']));
    expect((await policy.checkOp('turns.read'))?.code).toBe('policy-denied');
  });

  it('checks the builtin switch and both host permissions before the policy', async () => {
    const { state, policy, local } = setup();
    state.entry = entry(site(501, ['composer.send']));
    state.origins.delete('http://127.0.0.1/*');
    expect((await policy.checkOp('composer.send'))?.code).toBe('permission-missing');
    local.values[StorageKeys.PLUGINS_STATE] = {};
    expect((await policy.checkOp('composer.send'))?.code).toBe('bridge-disabled');
  });

  it('tells the person to turn online updates on when the policy went stale', async () => {
    const { policy } = setup();
    const denied = await policy.checkOp('composer.send');
    expect(denied?.code).toBe('policy-stale');
    expect(denied?.message).toMatch(/online plugin updates/);
  });
});
