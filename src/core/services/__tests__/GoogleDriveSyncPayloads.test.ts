import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';
import { EXTENSION_VERSION } from '@/core/utils/version';

import {
  GoogleDriveSyncPayloads,
  type GoogleDriveUploadSnapshot,
} from '../GoogleDriveSyncPayloads';

const scope: SyncAccountScope = { accountKey: 'gemini:person', accountId: 1, routeUserId: '1' };
const hierarchyScope: SyncAccountScope = {
  accountKey: 'gemini:hierarchy-person',
  accountId: 2,
  routeUserId: '2',
};
const exportedAt = '2026-10-03T12:00:00.000Z';

function scoped(name: string, account = scope): string {
  return `${name}.acct-${hashString(account.accountKey)}.json`;
}

function snapshot(overrides: Partial<GoogleDriveUploadSnapshot> = {}): GoogleDriveUploadSnapshot {
  return {
    folders: { folders: [], folderContents: {} },
    prompts: [],
    starred: null,
    platform: 'gemini',
    forks: null,
    timelineHierarchy: null,
    accountScope: scope,
    timelineHierarchyAccountScope: null,
    settings: null,
    plugins: null,
    ...overrides,
  };
}

function fixture() {
  const writes: Array<{ name: string; payload: unknown }> = [];
  const remote = new Map<string, unknown>();
  const files = {
    ensure: vi.fn(async (_token: string, name: string) => name),
    find: vi.fn(async (_token: string, _name: string): Promise<string | null> => null),
    upload: vi.fn(async (_token: string, name: string, payload: unknown) => {
      writes.push({ name, payload });
      remote.set(name, structuredClone(payload));
    }),
    download: async <T>(_token: string, name: string): Promise<T | null> =>
      (remote.get(name) as T) ?? null,
    prepareDownload: vi.fn(async (_token: string) => {}),
  };
  return { payloads: new GoogleDriveSyncPayloads(files), files, writes, remote };
}

const upload = (payloads: GoogleDriveSyncPayloads, data: GoogleDriveUploadSnapshot) =>
  payloads.uploadPlan('token', payloads.planUpload(data));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(exportedAt));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GoogleDriveSyncPayloads', () => {
  it('uploads scoped Gemini files in order, with a separate hierarchy scope while stars use their coordinator', async () => {
    const { payloads, writes } = fixture();
    const long = {
      turnId: 'turn-long',
      content: 'x'.repeat(61),
      conversationId: 'conversation',
      conversationUrl: 'https://gemini.google.com/u/1/app/conversation',
      conversationTitle: 'Saved title',
      starredAt: 123,
    };
    const short = { ...long, turnId: 'turn-short', content: 'x'.repeat(60) };
    const starred = { messages: { conversation: [long, short] } };
    const prompts = [{ id: 'prompt', text: 'Hello', tags: [], createdAt: 1, pinnedAt: null }];
    const data = snapshot({
      prompts,
      starred,
      forks: { nodes: {}, groups: {} },
      timelineHierarchy: { conversations: {} },
      timelineHierarchyAccountScope: hierarchyScope,
      settings: {},
      plugins: {},
    });

    await expect(upload(payloads, data)).resolves.toBe(6);

    expect(writes.map(({ name }) => name)).toEqual([
      scoped('gemini-voyager-folders'),
      scoped('gemini-voyager-prompts'),
      'gemini-voyager-settings.json',
      'gemini-voyager-plugins.json',
      scoped('gemini-voyager-forks'),
      scoped('gemini-voyager-timeline-hierarchy', hierarchyScope),
    ]);
    for (const { payload } of writes) {
      expect(payload).toEqual(expect.objectContaining({ exportedAt, version: EXTENSION_VERSION }));
    }
    expect(writes[1].payload).toEqual({
      format: 'gemini-voyager.prompts.v1',
      exportedAt,
      version: EXTENSION_VERSION,
      items: prompts,
    });
    expect(starred.messages.conversation[0].content).toBe('x'.repeat(61));
    expect(writes[5].payload).toEqual(expect.objectContaining({ data: data.timelineHierarchy }));
  });

  it('omits empty aggregate prompts and Gemini-only files on AI Studio, but writes a prompts-only clear', async () => {
    const { payloads, writes } = fixture();
    await expect(
      upload(
        payloads,
        snapshot({
          platform: 'aistudio',
          starred: { messages: {} },
          forks: { nodes: {}, groups: {} },
          timelineHierarchy: { conversations: {} },
          settings: {},
          plugins: {},
        }),
      ),
    ).resolves.toBe(3);
    expect(writes.map(({ name }) => name)).toEqual([
      scoped('gemini-voyager-aistudio-folders'),
      'gemini-voyager-settings.json',
      'gemini-voyager-plugins.json',
    ]);

    await payloads.uploadPrompts('token', [], scope);

    expect(writes[3]).toEqual({
      name: scoped('gemini-voyager-prompts'),
      payload: {
        format: 'gemini-voyager.prompts.v1',
        exportedAt,
        version: EXTENSION_VERSION,
        items: [],
      },
    });
  });

  it('prefers scoped files, falls back only when missing, and keeps global and hierarchy scopes distinct', async () => {
    const { payloads, files, remote } = fixture();
    const folders = {
      format: 'gemini-voyager.folders.v1',
      data: { folders: [], folderContents: {} },
    };
    const prompts = { format: 'gemini-voyager.prompts.v1', items: [] };
    const hierarchy = {
      format: 'gemini-voyager.timeline-hierarchy.v1',
      data: { conversations: {} },
    };
    remote.set('gemini-voyager-folders.json', folders);
    remote.set(scoped('gemini-voyager-prompts'), prompts);
    remote.set('gemini-voyager-timeline-hierarchy.json', hierarchy);
    files.find.mockImplementation(async (_token, name) => (remote.has(name) ? name : null));

    await expect(payloads.download('token', 'gemini', scope, hierarchyScope)).resolves.toEqual({
      folders,
      prompts,
      settings: null,
      plugins: null,
      starred: null,
      stars: null,
      forks: null,
      timelineHierarchy: hierarchy,
    });

    expect(files.prepareDownload).toHaveBeenCalledExactlyOnceWith('token');
    expect(files.find.mock.calls.map(([, name]) => name)).toEqual([
      scoped('gemini-voyager-folders'),
      'gemini-voyager-folders.json',
      scoped('gemini-voyager-prompts'),
      'gemini-voyager-settings.json',
      'gemini-voyager-plugins.json',
      scoped('gemini-voyager-starred'),
      'gemini-voyager-starred.json',
      scoped('gemini-voyager-stars'),
      scoped('gemini-voyager-forks'),
      'gemini-voyager-forks.json',
      scoped('gemini-voyager-timeline-hierarchy', hierarchyScope),
      'gemini-voyager-timeline-hierarchy.json',
    ]);
  });

  it('an exact scoped v1 star file carries account authority without changing its envelope', async () => {
    const { payloads, files, remote } = fixture();
    const item = {
      conversationId: 'gemini:conv:abc',
      turnId: 'turn',
      content: 'Old peer',
      conversationUrl: 'https://gemini.google.com/u/0/app/abc',
      starredAt: 60,
    };
    const v1 = {
      format: 'gemini-voyager.starred.v1',
      exportedAt,
      data: { messages: { [item.conversationId]: [item] } },
    };
    remote.set(scoped('gemini-voyager-starred'), v1);
    files.find.mockImplementation(async (_token, name) => (remote.has(name) ? name : null));
    expect(await payloads.readStars('token', scope)).toEqual({
      v1,
      v1AccountHash: hashString(scope.accountKey),
      v2: null,
    });
    expect(await payloads.download('token', 'gemini', scope, null)).toMatchObject({
      starred: v1,
      starredAccountHash: hashString(scope.accountKey),
    });
    expect(remote.get(scoped('gemini-voyager-starred'))).toEqual(v1);
    expect(v1).not.toHaveProperty('accountScope');
    expect(v1).not.toHaveProperty('v1AccountHash');
  });

  it.each(['missing', 'empty'] as const)(
    'an unscoped v1 fallback gains no scoped authority when the scoped file is %s',
    async (condition) => {
      const { payloads, files, remote } = fixture();
      const v1 = { format: 'gemini-voyager.starred.v1', exportedAt, data: { messages: {} } };
      remote.set('gemini-voyager-starred.json', v1);
      if (condition === 'empty') remote.set(scoped('gemini-voyager-starred'), null);
      files.find.mockImplementation(async (_token, name) => (remote.has(name) ? name : null));
      expect(await payloads.readStars('token', scope)).toEqual({ v1, v2: null });
      const aggregate = await payloads.download('token', 'gemini', scope, null);
      expect(aggregate?.starred).toEqual(v1);
      expect(aggregate).not.toHaveProperty('starredAccountHash');
    },
  );

  it('a failed content write leaves later cloud files intact', async () => {
    const { payloads, files, writes, remote } = fixture();
    const folderName = scoped('gemini-voyager-folders');
    remote.set(folderName, { previous: 'folders' });
    remote.set('gemini-voyager-settings.json', { previous: 'settings' });
    remote.set('gemini-voyager-plugins.json', { previous: 'plugins' });
    files.upload.mockImplementation(async (_token, name, payload) => {
      if (name === 'gemini-voyager-settings.json') throw new Error('write failed');
      writes.push({ name, payload });
      remote.set(name, structuredClone(payload));
    });

    await expect(upload(payloads, snapshot({ settings: {}, plugins: {} }))).rejects.toThrow(
      'write failed',
    );

    expect(remote.get(folderName)).toMatchObject({
      format: 'gemini-voyager.folders.v1',
      data: { folders: [], folderContents: {} },
    });
    expect(remote.get('gemini-voyager-settings.json')).toEqual({ previous: 'settings' });
    expect(remote.get('gemini-voyager-plugins.json')).toEqual({ previous: 'plugins' });
  });
});
