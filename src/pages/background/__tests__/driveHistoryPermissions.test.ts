import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncPlatform } from '@/core/types/sync';

import {
  createGuardDevice,
  guardEnvelope,
  guardFolders,
  guardHierarchy,
  guardPrompt,
  GUARD_TIME,
  scopedGuardFile,
} from './fixtures/uploadGuardDevice';

const emailScope = { accountKey: 'email:restore-person', accountId: 1, routeUserId: '2' };

function seedHistory(
  d: Awaited<ReturnType<typeof createGuardDevice>>,
  name: string,
  old: unknown = guardEnvelope('prompts', [guardPrompt('older')]),
  current: unknown = guardEnvelope('prompts', [guardPrompt('current')]),
) {
  d.drive.put(name, current);
  const backup = name.replace(/\.json$/, '.backup-2026-10-28-120000.json');
  d.drive.put(backup, old);
  d.drive.metadata.set(backup, {
    ...d.drive.metadata.get(backup)!,
    appProperties: { voyagerHistorySource: name },
  });
}

function setIsolationFlags(flags: Record<string, boolean>) {
  vi.stubGlobal('chrome', {
    ...chrome,
    storage: {
      ...chrome.storage,
      sync: { ...chrome.storage.sync, get: async () => flags },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  {
    platform: 'gemini',
    pageUrl: 'https://gemini.google.com/app/one',
    file: 'gemini-voyager-chatgpt-folders.json',
  },
  {
    platform: 'aistudio',
    pageUrl: 'https://aistudio.google.com/prompts/one',
    file: 'gemini-voyager-folders.json',
  },
  {
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/one',
    file: 'gemini-voyager-prompts.json',
  },
] satisfies { platform: SyncPlatform; pageUrl: string; file: string }[])(
  '$platform content cannot restore another site or unauthorized shared files',
  async ({ platform, pageUrl, file }) => {
    const d = await createGuardDevice({ platform, pageUrl });
    d.drive.put(file, guardEnvelope('folders', guardFolders(1)));
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request('gv.sync.restorePreviousVersion', { files: [file] })).resolves.toEqual({
      ok: false,
      error: 'untrusted_sender',
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  },
);

it('an extension page cannot use an unscoped platform to bypass Gemini prompt isolation', async () => {
  const d = await createGuardDevice({ platform: 'chatgpt', isolation: true });
  const name = 'gemini-voyager-prompts.json';
  seedHistory(d, name);
  const cloud = new Map(d.drive.files);
  const local = structuredClone(d.values);

  await expect(d.request('gv.sync.restorePreviousVersion', { files: [name] })).resolves.toEqual({
    ok: false,
    error: 'account_unconfirmed',
  });
  expect(d.drive.files).toEqual(cloud);
  expect(d.drive.writes).toEqual([]);
  expect(d.values).toEqual(local);
});

it('global settings and plugin history restore without a confirmed page account', async () => {
  const d = await createGuardDevice({
    isolation: true,
    scope: { accountKey: 'route:2', accountId: 1, routeUserId: '2' },
  });
  const settings = 'gemini-voyager-settings.json';
  const plugins = 'gemini-voyager-plugins.json';
  const oldSettings = { format: 'gemini-voyager.settings.v1', data: { language: 'en' } };
  const oldPlugins = guardEnvelope('plugins', { plugin: { enabled: false, installedAt: 1 } });
  seedHistory(d, settings, oldSettings, { ...oldSettings, data: { language: 'zh' } });
  seedHistory(d, plugins, oldPlugins, guardEnvelope('plugins', {}));
  const local = structuredClone(d.values);

  await expect(
    d.request('gv.sync.restorePreviousVersion', { files: [settings, plugins] }),
  ).resolves.toMatchObject({
    ok: true,
    files: [
      { name: settings, status: 'restored' },
      { name: plugins, status: 'restored' },
    ],
  });
  expect(d.drive.payload(settings)).toEqual(oldSettings);
  expect(d.drive.payload(plugins)).toEqual(oldPlugins);
  expect(d.values).toEqual(local);
});

it('a Gemini content sender can restore its shared prompts and retains the replaced cloud content', async () => {
  const d = await createGuardDevice({ pageUrl: 'https://gemini.google.com/app/one' });
  const name = 'gemini-voyager-prompts.json';
  const old = guardEnvelope('prompts', [guardPrompt('older')]);
  const current = guardEnvelope('prompts', [guardPrompt('current')]);
  d.drive.put(name, current);
  const backup = name.replace('.json', '.backup-2026-10-28-120000.json');
  d.drive.put(backup, old);
  d.drive.metadata.set(backup, {
    ...d.drive.metadata.get(backup)!,
    appProperties: { voyagerHistorySource: name },
  });
  await expect(
    d.request('gv.sync.restorePreviousVersion', { files: [name] }),
  ).resolves.toMatchObject({ ok: true, files: [{ name, status: 'restored' }] });
  expect(d.drive.payload(name)).toEqual(old);
  expect(
    d.drive.histories(name).some((file) => d.drive.files.get(file.id) === JSON.stringify(current)),
  ).toBe(true);
});

it.each(['explicit', 'omitted'] as const)(
  'account isolation blocks a base prompt restore with %s account scope',
  async (scopeSource) => {
    const d = await createGuardDevice({
      scope: emailScope,
      isolation: true,
      pageUrl: 'https://gemini.google.com/u/2/app/one',
    });
    const name = 'gemini-voyager-prompts.json';
    seedHistory(d, name);
    const cloud = new Map(d.drive.files);
    const metadata = structuredClone(d.drive.metadata);
    const local = structuredClone(d.values);

    await expect(
      d.request('gv.sync.restorePreviousVersion', {
        files: [name],
        ...(scopeSource === 'omitted' ? { accountScope: undefined } : {}),
      }),
    ).resolves.toEqual({ ok: false, error: 'account_unconfirmed' });
    expect(d.drive.files).toEqual(cloud);
    expect(d.drive.metadata).toEqual(metadata);
    expect(d.drive.writes).toEqual([]);
    expect(d.values).toEqual(local);
  },
);

it('an omitted scope resolves the bound page account without changing its local profile map', async () => {
  const d = await createGuardDevice({
    isolation: true,
    pageUrl: 'https://gemini.google.com/u/2/app/one',
  });
  d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
    version: 1,
    nextId: 2,
    profiles: {
      'route:2': {
        id: 1,
        createdAt: 1,
        updatedAt: 1,
        routeUserId: '2',
        emailHash: 'restore-person',
      },
    },
    routeAliases: { '2': 'route:2' },
    emailAliases: { 'restore-person': 'route:2' },
  };
  const name = scopedGuardFile('gemini-voyager-prompts.json', emailScope);
  seedHistory(d, name);
  const local = structuredClone(d.values);

  await expect(
    d.request('gv.sync.restorePreviousVersion', { files: [name] }),
  ).resolves.toMatchObject({ ok: true, files: [{ name, status: 'restored' }] });
  expect(d.drive.payload(name)).toMatchObject({ items: [guardPrompt('older')] });
  expect(d.values).toEqual(local);
});

it('disabling isolation prevents an explicit account scope from selecting an account file', async () => {
  const d = await createGuardDevice({ scope: emailScope, isolation: false });
  const name = scopedGuardFile('gemini-voyager-prompts.json', emailScope);
  seedHistory(d, name);
  const cloud = new Map(d.drive.files);
  const local = structuredClone(d.values);

  await expect(d.request('gv.sync.restorePreviousVersion', { files: [name] })).resolves.toEqual({
    ok: false,
    error: 'account_unconfirmed',
  });
  expect(d.drive.files).toEqual(cloud);
  expect(d.drive.writes).toEqual([]);
  expect(d.values).toEqual(local);
});

it.each([true, false])(
  'timeline history keeps its independent account scope with isolation off (explicit=%s)',
  async (explicit) => {
    const d = await createGuardDevice({
      isolation: false,
      ...(explicit ? { scope: emailScope } : {}),
    });
    const base = 'gemini-voyager-timeline-hierarchy.json';
    const name = explicit ? scopedGuardFile(base, emailScope) : base;
    const older = guardEnvelope('timelineHierarchy', guardHierarchy(1));
    const current = guardEnvelope('timelineHierarchy', guardHierarchy(2));
    seedHistory(d, name, older, current);
    const local = structuredClone(d.values);

    await expect(
      d.request('gv.sync.restorePreviousVersion', { files: [name] }),
    ).resolves.toMatchObject({ ok: true, files: [{ name, status: 'restored' }] });
    expect(d.drive.payload(name)).toEqual(older);
    expect(
      d.drive
        .histories(name)
        .some((entry) => d.drive.files.get(entry.id) === JSON.stringify(current)),
    ).toBe(true);
    expect(d.values).toEqual(local);
  },
);

it('AI Studio restore uses its own isolation flag before accepting a base folder name', async () => {
  const d = await createGuardDevice({
    platform: 'aistudio',
    scope: emailScope,
    pageUrl: 'https://aistudio.google.com/u/2/prompts/one',
  });
  setIsolationFlags({
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: false,
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: true,
  });
  const name = 'gemini-voyager-aistudio-folders.json';
  seedHistory(
    d,
    name,
    guardEnvelope('folders', guardFolders(1)),
    guardEnvelope('folders', guardFolders(2)),
  );
  const cloud = new Map(d.drive.files);
  const local = structuredClone(d.values);

  await expect(d.request('gv.sync.restorePreviousVersion', { files: [name] })).resolves.toEqual({
    ok: false,
    error: 'account_unconfirmed',
  });
  expect(d.drive.files).toEqual(cloud);
  expect(d.drive.writes).toEqual([]);
  expect(d.values).toEqual(local);
});

it('a mixed restore batch keeps the independent isolation policy of each folder platform', async () => {
  const d = await createGuardDevice({ scope: emailScope });
  setIsolationFlags({
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_GEMINI]: true,
    [StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED_AISTUDIO]: false,
  });
  const gemini = scopedGuardFile('gemini-voyager-folders.json', emailScope);
  const aistudio = 'gemini-voyager-aistudio-folders.json';
  const old = guardEnvelope('folders', guardFolders(1));
  for (const name of [gemini, aistudio])
    seedHistory(d, name, old, guardEnvelope('folders', guardFolders(2)));
  const local = structuredClone(d.values);

  await expect(
    d.request('gv.sync.restorePreviousVersion', { files: [gemini, aistudio] }),
  ).resolves.toMatchObject({
    ok: true,
    files: [
      { name: gemini, status: 'restored' },
      { name: aistudio, status: 'restored' },
    ],
  });
  expect(d.drive.payload(gemini)).toEqual(old);
  expect(d.drive.payload(aistudio)).toEqual(old);
  expect(d.values).toEqual(local);
});

it.each([
  { platform: 'chatgpt', pageUrl: 'https://chatgpt.com/c/one' },
  { platform: 'claude', pageUrl: 'https://claude.ai/chat/one' },
  { platform: 'deepseek', pageUrl: 'https://chat.deepseek.com/a/chat/s/one' },
] satisfies { platform: SyncPlatform; pageUrl: string }[])(
  '$platform keeps its global restore target when the caller includes an unrelated route scope',
  async ({ platform, pageUrl }) => {
    const d = await createGuardDevice({
      platform,
      pageUrl,
      isolation: true,
      scope: { accountKey: 'route:unconfirmed', accountId: 1, routeUserId: null },
    });
    const name = `gemini-voyager-${platform}-folders.json`;
    const old = { ...guardEnvelope('folders', guardFolders(1)), platform };
    seedHistory(d, name, old, { ...guardEnvelope('folders', guardFolders(2)), platform });
    const local = structuredClone(d.values);

    await expect(
      d.request('gv.sync.restorePreviousVersion', { files: [name] }),
    ).resolves.toMatchObject({ ok: true, files: [{ name, status: 'restored' }] });
    expect(d.drive.payload(name)).toEqual(old);
    expect(d.values).toEqual(local);
  },
);
