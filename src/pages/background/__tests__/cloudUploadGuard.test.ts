import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { HIGHLIGHT_EXPORT_FORMAT } from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import { refusedGuardToken } from './fixtures/guardConfirmation';
import {
  createGuardDevice,
  guardData,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardForks,
  guardHierarchy,
  guardKinds,
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

describe('whole-file upload guard through real background messages', () => {
  for (const kind of guardKinds) {
    it.each([
      { cloud: 24, local: 0, refused: true, reason: 'empty_local' },
      { cloud: 24, local: 11, refused: true, reason: 'large_drop' },
      { cloud: 24, local: 12, refused: false },
      { cloud: 24, local: 13, refused: false },
      { cloud: 4, local: 1, refused: true, reason: 'large_drop' },
      { cloud: 3, local: 1, refused: false },
      { cloud: 3, local: 0, refused: true, reason: 'empty_local' },
    ])(
      `${kind}: cloud $cloud and local $local protects the actual file`,
      async ({ cloud, local, refused, reason }) => {
        const d = await createGuardDevice();
        d.setLocal(kind, local);
        d.putCloud(kind, cloud);
        const cloudBefore = new Map(d.drive.files);
        const storageBefore = structuredClone(d.values);
        const result = await d.request();
        if (kind === 'prompts' && local === 0) {
          expect(result).toMatchObject({ ok: true });
          expect(d.drive.files.get(guardFiles.prompts)).toBe(cloudBefore.get(guardFiles.prompts));
        } else if (refused) {
          expect(result).toMatchObject({
            ok: false,
            error: 'upload_guard_refused',
            refusedFiles: [{ kind, localCount: local, cloudCount: cloud, reason }],
            state: { error: null, isSyncing: false },
          });
          expect(d.drive.files).toEqual(cloudBefore);
          expect(d.values).toEqual(storageBefore);
        } else {
          expect(result).toMatchObject({ ok: true });
          const payload = d.drive.payload<{ items?: unknown; data?: unknown }>(guardFiles[kind]);
          expect(kind === 'prompts' ? payload.items : payload.data).toEqual(guardData(kind, local));
        }
      },
    );
  }

  it('counts folders and the conversation entries in them together', async () => {
    const d = await createGuardDevice();
    const cloud = guardFolders(1);
    cloud.folderContents['folder-0'] = Array.from({ length: 23 }, (_, index) => ({
      conversationId: `conversation-${index}`,
      title: `Conversation ${index}`,
      url: `https://gemini.google.com/app/conversation-${index}`,
      addedAt: 1,
    }));
    d.drive.put(guardFiles.folders, guardEnvelope('folders', cloud));
    d.setLocal('folders', 11);
    const before = new Map(d.drive.files);
    await expect(d.request()).resolves.toMatchObject({
      ok: false,
      refusedFiles: [{ kind: 'folders', localCount: 11, cloudCount: 24 }],
    });
    expect(d.drive.files).toEqual(before);
    d.setLocal('folders', 12);
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(12) });
  });

  it('counts only marked hierarchy turns across conversations, excluding collapsed-only turns', async () => {
    const d = await createGuardDevice();
    const first = guardHierarchy(12).conversations.conversation;
    const second = { ...first, conversationUrl: 'https://gemini.google.com/app/second' };
    d.drive.put(
      guardFiles.timelineHierarchy,
      guardEnvelope('timelineHierarchy', {
        conversations: {
          first,
          second,
          collapsedOnly: {
            conversationUrl: 'https://gemini.google.com/app/collapsed',
            levels: {},
            collapsed: Array.from({ length: 100 }, (_, index) => `collapsed-${index}`),
            updatedAt: 1,
          },
        },
      }),
    );
    d.setLocal('timelineHierarchy', 11);
    const cloud = new Map(d.drive.files);
    await expect(d.request()).resolves.toMatchObject({
      ok: false,
      refusedFiles: [{ kind: 'timelineHierarchy', localCount: 11, cloudCount: 24 }],
    });
    expect(d.drive.files).toEqual(cloud);
    d.setLocal('timelineHierarchy', 12);
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.timelineHierarchy)).toMatchObject({
      data: guardHierarchy(12),
    });
  });

  it('counts fork nodes independently of their group index', async () => {
    const d = await createGuardDevice();
    d.drive.put(
      guardFiles.forks,
      guardEnvelope('forks', {
        ...guardForks(3),
        groups: Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [`group-${index}`, ['conversation:turn-0']]),
        ),
      }),
    );
    d.setLocal('forks', 1);
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.forks)).toMatchObject({ data: guardForks(1) });
  });

  it('checks kinds separately and lists all refusals despite a growing folder library', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 3);
    d.setLocal('folders', 100);
    d.putCloud('prompts', 24);
    d.setLocal('prompts', 11);
    d.putCloud('plugins', 3);
    const cloud = new Map(d.drive.files);
    const storage = structuredClone(d.values);
    await expect(d.request()).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
      refusedFiles: expect.arrayContaining([
        { kind: 'prompts', localCount: 11, cloudCount: 24, reason: 'large_drop' },
        { kind: 'plugins', localCount: 0, cloudCount: 3, reason: 'empty_local' },
      ]),
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(storage);
  });

  it('refuses before applying remote stars or highlight clear markers and releases the queue', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 24);
    d.setLocal('folders', 11);
    d.values[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] = true;
    const scope: SyncAccountScope = { accountKey: 'email:guard', accountId: 0, routeUserId: null };
    const accountHash = hashString(scope.accountKey);
    d.drive.put(`gemini-voyager-highlights.acct-${accountHash}.json`, {
      format: HIGHLIGHT_EXPORT_FORMAT,
      exportedAt: GUARD_TIME,
      version: '2.2.1',
      accountScope: { platform: 'gemini', accountHash },
      items: [],
      clearMarker: { clearedAt: 2, revision: { counter: 2, deviceId: 'remote' } },
    });
    d.drive.put('gemini-voyager-stars.json', {
      format: 'gemini-voyager.stars.v2',
      exportedAt: GUARD_TIME,
      version: '2.2.1',
      items: [
        {
          conversationId: 'cloud',
          conversationUrl: 'https://gemini.google.com/app/cloud',
          turnId: 'remote',
          content: 'Remote star',
          starredAt: 1,
        },
      ],
      tombstones: [],
    });
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(
      d.request('gv.sync.upload', { includeHighlights: true, highlightAccountScope: scope }),
    ).resolves.toMatchObject({ ok: false, error: 'upload_guard_refused' });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(d.service.getState()).resolves.toMatchObject({ error: null, isSyncing: false });
    d.setLocal('folders', 12);
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(12) });
    expect(d.values[StorageKeys.TIMELINE_STARRED_MESSAGES]).toMatchObject({
      messages: { cloud: [{ turnId: 'remote' }] },
    });
  });

  it('a refusal also leaves a legacy-only local star projection unchanged', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 24);
    d.setLocal('folders', 11);
    d.values[StorageKeys.TIMELINE_STARRED_MESSAGES] = {
      messages: {
        local: [
          {
            conversationId: 'local',
            conversationUrl: 'https://gemini.google.com/app/local',
            turnId: 'saved',
            content: 'Stored by an older client',
            starredAt: 1,
          },
        ],
      },
    };
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request()).resolves.toMatchObject({ ok: false, error: 'upload_guard_refused' });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  });

  it('a first-auth refusal does not persist a token or change user storage', async () => {
    const d = await createGuardDevice();
    delete d.values.gvAccessToken;
    delete d.values.gvTokenExpiry;
    d.putCloud('folders', 24);
    d.setLocal('folders', 11);
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(d.request('gv.sync.upload', { interactive: true })).resolves.toMatchObject({
      ok: false,
      error: 'upload_guard_refused',
    });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
    await expect(
      d.request('gv.sync.upload', {
        force: true,
        guardToken: await refusedGuardToken(d.request()),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(11) });
    expect(d.values.gvAccessToken).toBe('fresh-guard-token');
  });

  it('a refused request releases a queued unconfirmed retry without bypassing its guard', async () => {
    const d = await createGuardDevice();
    d.putCloud('folders', 24);
    d.setLocal('folders', 11);
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const reading = new Promise<void>((done) => {
      started = done;
    });
    d.drive.beforeRead = async (name) => {
      if (name === guardFiles.folders) {
        started();
        await held;
      }
    };
    const first = d.request();
    await reading;
    const next = d.request('gv.sync.upload', { force: true });
    release();
    await expect(first).resolves.toMatchObject({ ok: false, error: 'upload_guard_refused' });
    await expect(next).resolves.toMatchObject({ ok: false, error: 'upload_guard_refused' });
    await expect(
      d.request('gv.sync.upload', {
        force: true,
        guardToken: await refusedGuardToken(d.request()),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload(guardFiles.folders)).toMatchObject({ data: guardFolders(11) });
    expect(d.values[StorageKeys.FOLDER_DATA]).toEqual(guardFolders(11));
    await expect(d.service.getState()).resolves.toMatchObject({ error: null, isSyncing: false });
  });
});
