import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope } from '@/core/types/sync';
import { hashString } from '@/core/utils/hash';

import {
  createGuardDevice,
  guardEnvelope,
  guardFiles,
  guardFolders,
  guardForks,
  guardHierarchy,
  guardPrompt,
  GUARD_TIME,
} from './fixtures/uploadGuardDevice';

const emailHash = hashString('owner@example.com');
const emailKey = `email:${emailHash}`;
const scope: SyncAccountScope = { accountKey: 'route:2', accountId: 1, routeUserId: '2' };
const scoped = (name: string, key: string) =>
  name.replace(/\.json$/, `.acct-${hashString(key)}.json`);

function boundProfiles() {
  return {
    version: 1,
    nextId: 2,
    profiles: {
      'route:2': { id: 1, createdAt: 1, updatedAt: 1, routeUserId: '2', emailHash },
    },
    routeAliases: { '2': 'route:2' },
    emailAliases: { [emailHash]: 'route:2' },
  };
}

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

describe('stable cloud identity through real background messages', () => {
  it.each([false, true])(
    'route-first local buckets use the observed email for upload and download (Safari=%s)',
    async (safari) => {
      const d = await createGuardDevice({ scope, safari });
      d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
      d.setLocal('folders', 1);
      d.setLocal('prompts', 1);
      d.setLocal('forks', 1);
      d.setLocal('timelineHierarchy', 1);
      const localKey = `${StorageKeys.FOLDER_DATA}:acct:${hashString(scope.accountKey)}`;
      const local = structuredClone(d.values[localKey]);

      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.payload(scoped(guardFiles.folders, emailKey))).toMatchObject({
        data: guardFolders(1),
      });
      expect(d.drive.payload(scoped(guardFiles.prompts, emailKey))).toMatchObject({
        items: [guardPrompt('prompt-0')],
      });
      expect(d.drive.files.has(scoped(guardFiles.folders, scope.accountKey))).toBe(false);
      expect(d.values[localKey]).toEqual(local);
      expect(d.values[`${StorageKeys.FOLDER_DATA}:acct:${hashString(emailKey)}`]).toBeUndefined();

      d.drive.put(
        scoped(guardFiles.prompts, emailKey),
        guardEnvelope('prompts', [guardPrompt('cloud-email')]),
      );
      await expect(d.request('gv.sync.download')).resolves.toMatchObject({
        ok: true,
        data: {
          folders: { data: guardFolders(1) },
          prompts: { items: [guardPrompt('cloud-email')] },
        },
      });
      expect(d.values[localKey]).toEqual(local);
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('prompt-0')]);
    },
  );

  it.each([
    'gv.sync.upload',
    'gv.sync.download',
    'gv.sync.pushPromptsMerge',
    'gv.sync.pullPromptsMerge',
  ])(
    'refuses %s for an account with no observed email without changing Drive or storage',
    async (type) => {
      const d = await createGuardDevice({ scope });
      const cloud = new Map(d.drive.files);
      const local = structuredClone(d.values);
      await expect(d.request(type)).resolves.toMatchObject({
        ok: false,
        error: 'account_unconfirmed',
      });
      expect(d.drive.files).toEqual(cloud);
      expect(d.values).toEqual(local);
      await expect(d.service.getState()).resolves.toMatchObject({ isSyncing: false, error: null });
    },
  );

  it('refuses independently scoped highlights even when folder account isolation is off', async () => {
    const d = await createGuardDevice({ isolation: false });
    const cloud = new Map(d.drive.files);
    const local = structuredClone(d.values);
    await expect(
      d.request('gv.sync.upload', { includeHighlights: true, highlightAccountScope: scope }),
    ).resolves.toMatchObject({ ok: false, error: 'account_unconfirmed' });
    expect(d.drive.files).toEqual(cloud);
    expect(d.values).toEqual(local);
  });

  it('merges only a bound legacy route source, filters route-bearing content, and never writes that source', async () => {
    const d = await createGuardDevice({ scope });
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
    const legacyName = (name: string) => scoped(name, scope.accountKey);
    const emailName = (name: string) => scoped(name, emailKey);
    const ours = 'https://gemini.google.com/u/2/app/ours';
    const other = 'https://gemini.google.com/u/7/app/other';
    const currentFolders = guardFolders(1);
    currentFolders.folders[0].id = 'email-folder';
    currentFolders.folders[0].name = 'Email folder';
    const legacyFolders = guardFolders(1);
    legacyFolders.folders[0].id = 'legacy-folder';
    legacyFolders.folders[0].name = 'Legacy folder';
    legacyFolders.folderContents['legacy-folder'] = [
      { conversationId: 'ours', title: 'Ours', url: ours, addedAt: 1 },
      { conversationId: 'other', title: 'Other account', url: other, addedAt: 1 },
    ];
    d.drive.put(emailName(guardFiles.folders), guardEnvelope('folders', currentFolders));
    d.drive.put(legacyName(guardFiles.folders), guardEnvelope('folders', legacyFolders));
    d.drive.put(
      emailName(guardFiles.prompts),
      guardEnvelope('prompts', [guardPrompt('email-prompt')]),
    );
    d.drive.put(
      legacyName(guardFiles.prompts),
      guardEnvelope('prompts', [guardPrompt('legacy-prompt')]),
    );
    const legacyFork = guardForks(1).nodes.conversation[0];
    d.drive.put(
      legacyName(guardFiles.forks),
      guardEnvelope('forks', {
        nodes: {
          ours: [{ ...legacyFork, conversationId: 'ours', conversationUrl: ours }],
          other: [{ ...legacyFork, conversationId: 'other', conversationUrl: other }],
        },
        groups: {},
      }),
    );
    const legacyHierarchy = guardHierarchy(1).conversations.conversation;
    d.drive.put(
      legacyName(guardFiles.timelineHierarchy),
      guardEnvelope('timelineHierarchy', {
        conversations: {
          ours: { ...legacyHierarchy, conversationUrl: ours },
          other: { ...legacyHierarchy, conversationUrl: other },
        },
      }),
    );
    const starred = (conversationId: string, conversationUrl: string) => ({
      conversationId,
      conversationUrl,
      turnId: 'turn',
      content: conversationId,
      starredAt: 1,
    });
    const starredName = legacyName('gemini-voyager-starred.json');
    d.drive.put(starredName, {
      format: 'gemini-voyager.starred.v1',
      exportedAt: GUARD_TIME,
      data: { messages: { ours: [starred('ours', ours)], other: [starred('other', other)] } },
    });
    const legacy = new Map(
      [...d.drive.files].filter(([name]) =>
        name.includes(`.acct-${hashString(scope.accountKey)}.`),
      ),
    );

    const result = (await d.request('gv.sync.download')) as {
      data: {
        folders: { data: typeof currentFolders };
        prompts: { items: { id: string }[] };
        forks: { data: { nodes: Record<string, unknown> } };
        timelineHierarchy: { data: { conversations: Record<string, unknown> } };
        starred: { data: { messages: Record<string, unknown> } };
      };
    };
    expect(result.data.folders.data.folders.map((folder) => folder.id).sort()).toEqual([
      'email-folder',
      'legacy-folder',
    ]);
    expect(result.data.folders.data.folderContents['legacy-folder']).toEqual([
      { conversationId: 'ours', title: 'Ours', url: ours, addedAt: 1 },
    ]);
    expect(result.data.prompts.items.map((item) => item.id).sort()).toEqual([
      'email-prompt',
      'legacy-prompt',
    ]);
    expect(Object.keys(result.data.forks.data.nodes)).toEqual(['ours']);
    expect(Object.keys(result.data.timelineHierarchy.data.conversations)).toEqual(['ours']);
    expect(Object.keys(result.data.starred.data.messages)).toEqual(['ours']);

    d.setLocal('folders', 1);
    d.setLocal('prompts', 1);
    d.setLocal('forks', 1);
    d.setLocal('timelineHierarchy', 1);
    await expect(d.request('gv.sync.upload', { force: true })).resolves.toMatchObject({ ok: true });
    for (const [name, body] of legacy) expect(d.drive.files.get(name)).toBe(body);
    expect(d.drive.writes.some((name) => legacy.has(name))).toBe(false);
    expect(d.drive.payload(emailName(guardFiles.prompts))).toMatchObject({
      items: [guardPrompt('prompt-0'), guardPrompt('legacy-prompt')],
    });
  });

  it('skips a legacy route file whose profile is bound to another email', async () => {
    const emailScope: SyncAccountScope = { accountKey: emailKey, accountId: 2, routeUserId: '2' };
    const d = await createGuardDevice({ scope: emailScope });
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
      ...boundProfiles(),
      nextId: 3,
      profiles: {
        'route:2': {
          id: 1,
          createdAt: 1,
          updatedAt: 1,
          routeUserId: '2',
          emailHash: 'someone-else',
        },
        [emailKey]: { id: 2, createdAt: 1, updatedAt: 1, routeUserId: '2', emailHash },
      },
      routeAliases: { '2': emailKey },
      emailAliases: { [emailHash]: emailKey },
    };
    const legacy = scoped(guardFiles.prompts, scope.accountKey);
    d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('another-account')]));
    d.drive.failReads.add(legacy);
    d.drive.put(
      scoped(guardFiles.prompts, emailKey),
      guardEnvelope('prompts', [guardPrompt('ours')]),
    );
    const body = d.drive.files.get(legacy);
    await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({ ok: true });
    expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('ours')]);
    expect(d.drive.files.get(legacy)).toBe(body);
    expect(d.drive.writes).not.toContain(legacy);
  });

  it.each([false, true])(
    'keeps the bound account after its route changes while its legacy filename keeps the original route key (Safari=%s)',
    async (safari) => {
      const movedScope: SyncAccountScope = { ...scope, routeUserId: '5' };
      const d = await createGuardDevice({ scope: movedScope, safari });
      const map = boundProfiles();
      map.profiles['route:2'].routeUserId = '5';
      d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = {
        ...map,
        routeAliases: { '5': 'route:2' },
      };
      const template = guardForks(1).nodes.conversation[0];
      const node = (id: string, route: string) => ({
        ...template,
        conversationId: id,
        conversationUrl: `https://gemini.google.com/u/${route}/app/${id}`,
      });
      const legacy = scoped(guardFiles.forks, scope.accountKey);
      d.drive.put(
        legacy,
        guardEnvelope('forks', {
          nodes: { moved: [node('moved', '5')], foreign: [node('foreign', '2')] },
          groups: {},
        }),
      );
      d.drive.put(
        scoped(guardFiles.forks, emailKey),
        guardEnvelope('forks', {
          nodes: { email: [node('email', '5')] },
          groups: {},
        }),
      );
      const cloud = new Map(d.drive.files);
      const localForks = structuredClone(d.values[StorageKeys.FORK_NODES]);

      const result = (await d.request('gv.sync.download')) as {
        ok: boolean;
        data: { forks: { data: { nodes: Record<string, unknown> } } };
      };
      expect(result.ok).toBe(true);
      expect(Object.keys(result.data.forks.data.nodes).sort()).toEqual(['email', 'moved']);
      expect(result.data.forks.data.nodes).toMatchObject({
        email: [node('email', '5')],
        moved: [node('moved', '5')],
      });
      expect(d.drive.files).toEqual(cloud);
      expect(d.drive.writes).toEqual([]);
      expect(d.values[StorageKeys.FORK_NODES]).toEqual(localForks);
    },
  );
});
