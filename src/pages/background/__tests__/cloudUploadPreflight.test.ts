import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { hashString } from '@/core/utils/hash';

import {
  createGuardDevice,
  guardEnvelope,
  guardFolders,
  guardPrompt,
  GUARD_TIME,
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

describe('upload preflight persistence', () => {
  it('a first authorized upload with a later failed star read leaves its token and implicit profile unstored', async () => {
    const d = await createGuardDevice({
      isolation: true,
      pageUrl: 'https://gemini.google.com/u/2/app/saved',
    });
    delete d.values.gvAccessToken;
    delete d.values.gvTokenExpiry;
    const emailHash = hashString('owner@example.com');
    const accountKey = `email:${emailHash}`;
    const accountHash = hashString(accountKey);
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
      version: 1,
      nextId: 2,
      profiles: { [accountKey]: { id: 1, createdAt: 1, updatedAt: 1, emailHash } },
      routeAliases: { '2': accountKey },
      emailAliases: { [emailHash]: accountKey },
    };
    d.values[`${StorageKeys.FOLDER_DATA}:acct:${accountHash}`] = guardFolders(0);
    const stars = `gemini-voyager-stars.acct-${accountHash}.json`;
    d.drive.put(stars, {
      format: 'gemini-voyager.stars.v2',
      exportedAt: GUARD_TIME,
      items: [],
      tombstones: [],
    });
    d.drive.failReads.add(stars);
    let attemptedStarReads = 0;
    d.drive.beforeRead = async (name) => {
      if (name === stars) attemptedStarReads++;
    };
    const local = structuredClone(d.values);
    const cloud = new Map(d.drive.files);

    const upload = d.request('gv.sync.upload', { interactive: true });
    await vi.runAllTimersAsync();
    await expect(upload).resolves.toMatchObject({ ok: false });
    expect(attemptedStarReads).toBeGreaterThan(0);
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.service.getState()).resolves.toMatchObject({ isSyncing: false });
  });

  it('a late target lookup failure leaves first-time auth and the implicit profile unstored', async () => {
    const d = await createGuardDevice({
      isolation: true,
      pageUrl: 'https://gemini.google.com/u/2/app/saved',
    });
    delete d.values.gvAccessToken;
    delete d.values.gvTokenExpiry;
    const emailHash = hashString('owner@example.com');
    const accountKey = `email:${emailHash}`;
    const accountHash = hashString(accountKey);
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
      version: 1,
      nextId: 2,
      profiles: { [accountKey]: { id: 1, createdAt: 1, updatedAt: 1, emailHash } },
      routeAliases: { '2': accountKey },
      emailAliases: { [emailHash]: accountKey },
    };
    const folders = guardFolders(0);
    d.values[`${StorageKeys.FOLDER_DATA}:acct:${accountHash}`] = folders;
    const folderName = `gemini-voyager-folders.acct-${accountHash}.json`;
    d.drive.put(folderName, {
      format: 'gemini-voyager.folders.v1',
      exportedAt: GUARD_TIME,
      data: folders,
    });
    let finds = 0;
    d.drive.beforeFind = async (name) => {
      if (name === folderName && ++finds === 2) throw new Error('Target lookup unavailable');
    };
    const local = structuredClone(d.values);
    const cloud = new Map(d.drive.files);

    await expect(d.request('gv.sync.upload', { interactive: true })).resolves.toMatchObject({
      ok: false,
    });
    expect(finds).toBeGreaterThanOrEqual(2);
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.service.getState()).resolves.toMatchObject({ isSyncing: false });
  });

  it('a prompt merge may keep its union but leaves auth and profile unstored when history preflight cannot read the current file', async () => {
    const d = await createGuardDevice({
      isolation: true,
      pageUrl: 'https://gemini.google.com/u/2/app/saved',
    });
    delete d.values.gvAccessToken;
    delete d.values.gvTokenExpiry;
    const emailHash = hashString('owner@example.com');
    const accountKey = `email:${emailHash}`;
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
      version: 1,
      nextId: 2,
      profiles: { [accountKey]: { id: 1, createdAt: 1, updatedAt: 1, emailHash } },
      routeAliases: { '2': accountKey },
      emailAliases: { [emailHash]: accountKey },
    };
    const name = `gemini-voyager-prompts.acct-${hashString(accountKey)}.json`;
    const item = guardPrompt('cloud');
    d.drive.put(name, guardEnvelope('prompts', [item]));
    let reads = 0;
    d.drive.beforeRead = async (reading) => {
      if (reading === name && ++reads >= 2) d.drive.failReads.add(name);
    };
    const local = structuredClone(d.values);
    const cloud = new Map(d.drive.files);

    const upload = d.request('gv.sync.pushPromptsMerge', { interactive: true });
    await vi.runAllTimersAsync();
    await expect(upload).resolves.toMatchObject({ ok: false });
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual({ ...local, [StorageKeys.PROMPT_ITEMS]: [item] });
  });
});
