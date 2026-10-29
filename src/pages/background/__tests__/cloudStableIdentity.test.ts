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
  it('a legacy update during guard reads remains available after the prepared upload commits', async () => {
    const d = await createGuardDevice({ scope });
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
    const legacy = scoped(guardFiles.prompts, scope.accountKey);
    const primary = scoped(guardFiles.prompts, emailKey);
    d.drive.put(primary, guardEnvelope('prompts', [guardPrompt('kept')]));
    d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('prepared')]));
    d.values[StorageKeys.PROMPT_ITEMS] = [guardPrompt('kept')];
    let sourceRead = false;
    d.drive.beforeRead = async (name) => {
      if (name === legacy) sourceRead = true;
    };
    d.drive.beforeFind = async (name) => {
      if (name === legacy && sourceRead) {
        d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('arrived-during-guard')]));
        d.drive.beforeFind = undefined;
      }
    };
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
      guardPrompt('kept'),
      guardPrompt('prepared'),
    ]);
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
      guardPrompt('kept'),
      guardPrompt('arrived-during-guard'),
    ]);
  });

  it.each(['googleDrive', 'icloud'] as const)(
    'only completed legacy downloads suppress the same source after a later local deletion (%s)',
    async (provider) => {
      const d = await createGuardDevice({ scope, provider });
      d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
      const legacy = scoped(guardFiles.prompts, scope.accountKey);
      const primary = scoped(guardFiles.prompts, emailKey);
      d.drive.put(primary, guardEnvelope('prompts', [guardPrompt('kept')]));
      d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('deleted')]));
      const write = chrome.storage.local.set;
      const failure = vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        if (Object.hasOwn(items, StorageKeys.CLOUD_SYNC_PRE_APPLY_SNAPSHOT))
          throw new Error('storage full');
        await write(items);
      });
      await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({ ok: false });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([]);
      expect(d.values[StorageKeys.CLOUD_SYNC_BOOKKEEPING]).toBeUndefined();
      failure.mockRestore();
      await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({ ok: true });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([
        guardPrompt('kept'),
        guardPrompt('deleted'),
      ]);
      d.values[StorageKeys.PROMPT_ITEMS] = [guardPrompt('kept')];
      await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({ ok: true });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([guardPrompt('kept')]);
      // Publishing the local checkpoint prevents another device from replaying the old source.
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.payload<{ items: unknown[] }>(primary).items).toEqual([guardPrompt('kept')]);
      d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('newer')]));
      await expect(d.request('gv.sync.pullPromptsMerge')).resolves.toMatchObject({ ok: true });
      expect(d.values[StorageKeys.PROMPT_ITEMS]).toEqual([
        guardPrompt('kept'),
        guardPrompt('newer'),
      ]);
    },
  );

  it('a failed email upload never consumes its legacy merge', async () => {
    const d = await createGuardDevice({ scope });
    d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
    const legacy = scoped(guardFiles.prompts, scope.accountKey);
    const primary = scoped(guardFiles.prompts, emailKey);
    d.drive.put(primary, guardEnvelope('prompts', [guardPrompt('kept')]));
    d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('must-retry')]));
    d.values[StorageKeys.PROMPT_ITEMS] = [guardPrompt('kept')];
    d.drive.failWrites.add(primary);
    const writing = d.request();
    await vi.runAllTimersAsync();
    await expect(writing).resolves.toMatchObject({ ok: false });
    expect(d.drive.payload(primary)).not.toHaveProperty('legacyMergeSources');
    d.drive.failWrites.delete(primary);
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
      guardPrompt('kept'),
      guardPrompt('must-retry'),
    ]);
  });

  it.each(['chrome', 'safari', 'icloud'] as const)(
    'does not resurrect a deleted legacy prompt on this device or a new device, but imports a changed old-device file (%s)',
    async (runtime) => {
      const options = {
        scope,
        safari: runtime === 'safari',
        provider: runtime === 'icloud' ? ('icloud' as const) : ('googleDrive' as const),
      };
      const d = await createGuardDevice(options);
      d.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
      const legacy = scoped(guardFiles.prompts, scope.accountKey);
      const primary = scoped(guardFiles.prompts, emailKey);
      d.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('deleted')]));
      d.setLocal('prompts', 1);
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
        guardPrompt('prompt-0'),
        guardPrompt('deleted'),
      ]);
      // The source stays frozen. A subsequent local deletion must survive both directions.
      await expect(d.request()).resolves.toMatchObject({ ok: true });
      expect(d.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
        guardPrompt('prompt-0'),
      ]);
      await expect(d.request('gv.sync.download')).resolves.toMatchObject({
        ok: true,
        data: { prompts: { items: [guardPrompt('prompt-0')] } },
      });

      const other = await createGuardDevice(options);
      other.values[StorageKeys.GV_ACCOUNT_PROFILE_MAP] = boundProfiles();
      for (const [id, text] of d.drive.files) other.drive.files.set(id, text);
      for (const [id, metadata] of d.drive.metadata)
        other.drive.metadata.set(id, structuredClone(metadata));
      await expect(other.request('gv.sync.download')).resolves.toMatchObject({
        ok: true,
        data: { prompts: { items: [guardPrompt('prompt-0')] } },
      });
      other.drive.put(legacy, guardEnvelope('prompts', [guardPrompt('old-device-new')]));
      other.setLocal('prompts', 1);
      await expect(other.request()).resolves.toMatchObject({ ok: true });
      expect(other.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
        guardPrompt('prompt-0'),
        guardPrompt('old-device-new'),
      ]);
      await expect(other.request()).resolves.toMatchObject({ ok: true });
      expect(other.drive.payload<{ items: unknown[] }>(primary).items).toEqual([
        guardPrompt('prompt-0'),
      ]);
      expect(d.drive.payload<{ items: unknown[] }>(legacy).items).toEqual([guardPrompt('deleted')]);
    },
  );

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

  it('seeds a bound route source once, filters foreign content, and keeps later deletions', async () => {
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
    await expect(d.request()).resolves.toMatchObject({ ok: true });
    expect(d.drive.payload<{ items: unknown[] }>(emailName(guardFiles.prompts)).items).toEqual([
      guardPrompt('prompt-0'),
    ]);
    const after = await d.request('gv.sync.download');
    expect(after).toHaveProperty('ok', true);
    expect(after).toHaveProperty('data.folders.data', guardFolders(1));
    expect(after).toHaveProperty('data.prompts.items', [guardPrompt('prompt-0')]);
    expect(after).toHaveProperty('data.forks.data', guardForks(1));
    expect(after).toHaveProperty('data.timelineHierarchy.data', guardHierarchy(1));
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
