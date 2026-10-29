import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope, SyncProvider } from '@/core/types/sync';
import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';

import {
  createGuardDevice,
  guardData,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardKinds,
  guardPrompt,
  GUARD_TIME,
  scopedGuardFile,
} from './fixtures/uploadGuardDevice';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(GUARD_TIME));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('guard refusal, force and provider boundaries', () => {
  it.each(guardKinds)('an unrecognized %s cloud file requires explicit force', async (kind) => {
    const d = await createGuardDevice();
    d.setLocal(kind, 1);
    d.drive.put(guardFiles[kind], { format: 'future.format.v99', items: [], data: {} });
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request()).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
      refusedFiles: [{ kind, localCount: 1, cloudCount: null, reason: 'unrecognized' }],
      state: { error: null, isSyncing: false },
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.request('gv.sync.upload', { force: true })).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles[kind])).toMatchObject(
      kind === 'prompts' ? { items: guardData(kind, 1) } : { data: guardData(kind, 1) },
    );
  });

  it('malformed JSON is refused rather than counted as an empty cloud file', async () => {
    const d = await createGuardDevice();
    d.setLocal('prompts', 1);
    d.drive.files.set(guardFiles.prompts, '{bad JSON');
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request()).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
      refusedFiles: [{ kind: 'prompts', localCount: 1, cloudCount: null, reason: 'unrecognized' }],
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.request('gv.sync.upload', { force: true })).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.prompts)).toMatchObject({ items: [guardPrompt('prompt-0')] });
  });

  it.each([
    { kind: 'folders', broken: { folders: [], folderContents: [] } },
    { kind: 'prompts', broken: {} },
    { kind: 'timelineHierarchy', broken: { conversations: [] } },
    { kind: 'forks', broken: { nodes: [], groups: {} } },
    { kind: 'plugins', broken: [] },
  ] as const)(
    'a malformed $kind container cannot be treated as empty cloud data',
    async ({ kind, broken }) => {
      const d = await createGuardDevice();
      d.setLocal(kind, 1);
      d.drive.put(guardFiles[kind], guardEnvelope(kind, broken));
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.values);
      await expect(d.request()).resolves.toMatchObject({
        ok: false,
        error: 'upload_guard_refused',
        refusedFiles: [{ kind, localCount: 1, cloudCount: null, reason: 'unrecognized' }],
      });
      expect(d.drive.files).toEqual(cloud);
      expect(d.values).toEqual(local);
    },
  );

  it.each<SyncProvider>(['googleDrive', 'icloud'])(
    '%s guard refuses, force retries once, and later ordinary requests stay guarded',
    async (provider) => {
      const d = await createGuardDevice({ provider });
      d.putCloud('folders', 24);
      d.setLocal('folders', 11);
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.values);
      await expect(d.request()).resolves.toMatchObject({
        ok: false,
        error: 'upload_guard_refused',
      });
      expect(d.drive.files).toEqual(cloud);
      expect(d.values).toEqual(local);
      await expect(d.request('gv.sync.upload', { force: true })).resolves.toMatchObject({
        ok: true,
      });
      expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(11) });
      d.setLocal('folders', 0);
      const forcedCloud = new Map(d.drive.files);
      const forcedLocal = structuredClone(d.values);
      await expect(d.request()).resolves.toMatchObject({
        ok: false,
        refusedFiles: [{ kind: 'folders', localCount: 0, cloudCount: 11 }],
      });
      expect(d.drive.files).toEqual(forcedCloud);
      expect(d.values).toEqual(forcedLocal);
    },
  );

  it.each<SyncProvider>(['googleDrive', 'icloud'])(
    '%s force cannot bypass a failed cloud read',
    async (provider) => {
      const d = await createGuardDevice({ provider });
      d.putCloud('prompts', 24);
      d.setLocal('prompts', 1);
      d.drive.failReads.add(guardFiles.prompts);
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.values);
      const result = d.request('gv.sync.upload', { force: true });
      await vi.runAllTimersAsync();
      const outcome = await result;
      expect(outcome).toMatchObject({ ok: false });
      expect(outcome).not.toMatchObject({ error: 'upload_guard_refused' });
      expect(d.drive.files).toEqual(cloud);
      expect(d.values).toEqual(local);
      await expect(d.service.getState()).resolves.toMatchObject({ isSyncing: false });
    },
  );

  it('a later failed guarded read aborts instead of reporting an earlier count refusal', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 24);
    d.setLocal('folders', 11);
    d.putCloud('plugins', 3);
    d.setLocal('plugins', 1);
    d.drive.failReads.add(guardFiles.plugins);
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    const pending = d.request();
    await vi.runAllTimersAsync();
    const outcome = await pending;
    expect(outcome).toMatchObject({
      ok: false,
      state: { error: 'Download failed: 503', isSyncing: false },
    });
    expect(outcome).not.toMatchObject({ error: 'upload_guard_refused' });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  });

  it('force preserves the existing omission of an empty whole-upload prompts list', async () => {
    const d = await createGuardDevice();
    d.putCloud('prompts', 24);
    d.setLocal('folders', 1);
    const promptsBefore = d.drive.files.get(guardFiles.prompts);
    await expect(d.request('gv.sync.upload', { force: true })).resolves.toMatchObject({ ok: true });
    expect(d.drive.files.get(guardFiles.prompts)).toBe(promptsBefore);
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(1) });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([]);
  });

  it.each([false, true])(
    'counts base prompts when the scoped file is missing or empty (empty=%s)',
    async (emptyScoped) => {
      const scope: SyncAccountScope = {
        accountKey: 'email:scoped-guard',
        accountId: 2,
        routeUserId: '2',
      };
      const d = await createGuardDevice({ scope });
      d.putCloud('prompts', 24);
      d.setLocal('prompts', 11);
      const scoped = scopedGuardFile(guardFiles.prompts, scope);
      if (emptyScoped) d.drive.files.set(scoped, '');
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.values);
      await expect(d.request()).resolves.toMatchObject({
        ok: false,
        error: 'upload_guard_refused',
        refusedFiles: [{ kind: 'prompts', localCount: 11, cloudCount: 24 }],
      });
      expect(d.drive.files).toEqual(cloud);
      expect(d.values).toEqual(local);
      d.setLocal('prompts', 12);
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.payload(scoped)).toMatchObject({ items: guardData('prompts', 12) });
      expect(d.drive.files.get(guardFiles.prompts)).toBe(cloud.get(guardFiles.prompts));
    },
  );

  it.each(FOLDER_PLATFORM_IDS)(
    'guards the actual folders file for %s without guarding unrelated data',
    async (platform) => {
      const d = await createGuardDevice({ platform });
      d.putCloud('folders', 24);
      d.setLocal('folders', 11);
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.values);
      await expect(d.request()).resolves.toMatchObject({
        ok: false,
        error: 'upload_guard_refused',
        refusedFiles: [{ kind: 'folders', localCount: 11, cloudCount: 24 }],
      });
      expect(d.drive.files).toEqual(cloud);
      expect(d.values).toEqual(local);
      d.setLocal('folders', 12);
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.payload(FOLDER_PLATFORMS[platform].driveFoldersFileName)).toMatchObject({
        data: guardFolders(12),
      });
    },
  );
});

describe('prompts merge upload guard', () => {
  it('implicit account resolution keeps the profile map untouched on refusal and persists it after force', async () => {
    const d = await createGuardDevice({
      isolation: true,
      pageUrl: 'https://gemini.google.com/u/2/app/one',
    });
    const accountKey = 'email:implicit-guard';
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
      version: 1,
      nextId: 2,
      profiles: {
        [accountKey]: { id: 1, createdAt: 1, updatedAt: 1, emailHash: 'implicit-guard' },
      },
      routeAliases: { '2': accountKey },
      emailAliases: { 'implicit-guard': accountKey },
    };
    const duplicates = Array.from({ length: 24 }, (_, index) => ({
      ...guardPrompt(`cloud-${index}`),
      text: 'One merged body',
    }));
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', duplicates));
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
      refusedFiles: [{ kind: 'prompts', localCount: 1, cloudCount: 24 }],
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.request('gv.sync.pushPromptsMerge', { force: true })).resolves.toMatchObject({
      ok: true,
      count: 1,
    });
    expect(d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP]).toMatchObject({
      profiles: { [accountKey]: { id: 1, routeUserId: '2', updatedAt: Date.now() } },
    });
    const scoped = scopedGuardFile(guardFiles.prompts, {
      accountKey,
      accountId: 1,
      routeUserId: '2',
    });
    expect(d.drive.payload(scoped)).toMatchObject({ items: [duplicates[0]] });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([duplicates[0]]);
    expect(d.drive.files.get(guardFiles.prompts)).toBe(cloud.get(guardFiles.prompts));
  });

  it('checks the merged list before storing it, and force preserves the existing merge policy', async () => {
    const d = await createGuardDevice();
    const duplicates = Array.from({ length: 24 }, (_, index) => ({
      ...guardPrompt(`cloud-${index}`),
      text: 'Shared cloud body',
    }));
    d.drive.put(guardFiles.prompts, guardEnvelope('prompts', duplicates));
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
      refusedFiles: [{ kind: 'prompts', localCount: 1, cloudCount: 24, reason: 'large_drop' }],
      state: { error: null, isSyncing: false },
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.request('gv.sync.pushPromptsMerge', { force: true })).resolves.toMatchObject({
      ok: true,
      count: 1,
    });
    expect(d.drive.payload(guardFiles.prompts)).toMatchObject({ items: [duplicates[0]] });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([duplicates[0]]);
  });

  it('compares the merge union rather than refusing a small local library before the merge', async () => {
    const d = await createGuardDevice();
    d.putCloud('prompts', 24);
    d.values[StorageKeys.PROMPT_ITEMS] = [guardPrompt('local-only')];
    await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({
      ok: true,
      count: 25,
    });
    const items = d.drive.payload<{ items: unknown[] }>(guardFiles.prompts).items;
    expect(items).toHaveLength(25);
    expect(items).toEqual(
      expect.arrayContaining([guardPrompt('local-only'), guardPrompt('prompt-23')]),
    );
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual(items);
  });

  it('an unrecognized cloud merge requires force and then uploads the intact local library', async () => {
    const d = await createGuardDevice();
    d.setLocal('prompts', 1);
    d.drive.files.set(guardFiles.prompts, '{bad JSON');
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request('gv.sync.pushPromptsMerge')).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
      refusedFiles: [{ kind: 'prompts', localCount: 1, cloudCount: null, reason: 'unrecognized' }],
      state: { error: null, isSyncing: false },
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.request('gv.sync.pushPromptsMerge', { force: true })).resolves.toMatchObject({
      ok: true,
    });
    expect(d.drive.payload(guardFiles.prompts)).toMatchObject({ items: [guardPrompt('prompt-0')] });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('prompt-0')]);
  });

  it('a forced merge with a failed cloud read changes neither side', async () => {
    const d = await createGuardDevice();
    d.putCloud('prompts', 24);
    d.setLocal('prompts', 1);
    d.drive.failReads.add(guardFiles.prompts);
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    const result = d.request('gv.sync.pushPromptsMerge', { force: true });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  });
});
