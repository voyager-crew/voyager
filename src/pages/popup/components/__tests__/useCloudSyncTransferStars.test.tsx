import { describe, expect, it, vi } from 'vitest';

import {
  accountIsolationService,
  buildScopedStorageKey,
} from '@/core/services/AccountIsolationService';
import { StorageKeys } from '@/core/types/common';
import { hashString } from '@/core/utils/hash';
import type { ForkNode } from '@/pages/content/fork/forkTypes';

import { folders, pageScope, setupTransferHarness, tabScope } from './cloudSyncTransferHarness';

describe('popup cloud restore of stars and forks', () => {
  const h = setupTransferHarness();
  const { tabMessage } = h;

  it.each(['merge', 'overwrite'] as const)(
    'keeps other sites and Gemini accounts when %s restores stars',
    async (mode) => {
      const makeStar = (id: string, url: string) => ({
        conversationId: id,
        turnId: 't',
        content: id,
        conversationUrl: url,
        starredAt: 1,
      });
      const claude = makeStar('claude:conv:one', 'https://claude.ai/chat/one');
      const otherAccount = makeStar('gemini:conv:other', 'https://gemini.google.com/u/2/app/other');
      const cloud = makeStar('gemini:conv:cloud', 'https://gemini.google.com/u/1/app/cloud');
      h.stored[StorageKeys.TIMELINE_STARRED_MESSAGES] = {
        messages: {
          [claude.conversationId]: [claude],
          [otherAccount.conversationId]: [otherAccount],
        },
      };
      await h.render('gemini', false);
      const download = await h.transfer.prepareDownload();
      await download.restore(
        {
          folders: { data: folders },
          starred: {
            format: 'gemini-voyager.starred.v1',
            data: { messages: { [cloud.conversationId]: [cloud] } },
          },
        },
        mode,
        false,
      );
      expect((await h.starStore.getAll()).messages).toEqual({
        [claude.conversationId]: [claude],
        [otherAccount.conversationId]: [otherAccount],
        [cloud.conversationId]: [cloud],
      });
      await download.restore(
        {
          folders: { data: folders },
          starred: {
            format: 'gemini-voyager.starred.v1',
            data: { messages: {} },
          },
        },
        mode,
        false,
      );
      expect(Object.keys((await h.starStore.getAll()).messages)).toHaveLength(3);
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    'a cloud tombstone removes a local star in both restore modes (%s)',
    async (mode) => {
      const local = {
        conversationId: 'gemini:conv:deleted',
        turnId: 'turn',
        content: 'Deleted',
        conversationUrl: 'https://gemini.google.com/u/1/app/deleted',
        starredAt: 5,
      };
      const other = {
        ...local,
        conversationId: 'gemini:conv:other',
        conversationUrl: 'https://gemini.google.com/u/2/app/other',
      };
      h.stored[StorageKeys.SAVED_LIBRARY_STARS] = {
        messages: { [local.conversationId]: [local], [other.conversationId]: [other] },
      };
      await h.render('gemini', false);
      const download = await h.transfer.prepareDownload();
      await download.restore(
        {
          folders: { data: folders },
          stars: {
            format: 'gemini-voyager.stars.v2',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            accountScope: { accountHash: hashString(pageScope.accountKey) },
            items: [],
            tombstones: [
              {
                conversationId: local.conversationId,
                turnId: local.turnId,
                conversationUrl: local.conversationUrl,
                starredAt: 5,
                deletedAt: Date.now(),
              },
            ],
          },
        },
        mode,
        false,
      );
      expect((await h.starStore.getAll()).messages).toEqual({ [other.conversationId]: [other] });
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    'a scoped old-version re-star survives popup restore from another account slot (%s)',
    async (mode) => {
      const cloud = {
        conversationId: 'gemini:conv:peer',
        turnId: 'turn',
        content: 'Peer',
        conversationUrl: 'https://gemini.google.com/u/0/app/peer',
        starredAt: 60,
      };
      await h.render('gemini', false);
      const download = await h.transfer.prepareDownload();
      await download.restore(
        {
          folders: { data: folders },
          starred: {
            format: 'gemini-voyager.starred.v1',
            data: { messages: { [cloud.conversationId]: [cloud] } },
          },
          starredAccountHash: hashString(pageScope.accountKey),
          stars: {
            format: 'gemini-voyager.stars.v2',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            accountScope: { accountHash: hashString(pageScope.accountKey) },
            items: [{ ...cloud, starredAt: 50, text: 'Full\nprompt' }],
            tombstones: [],
          },
        },
        mode,
        false,
      );
      expect((await h.starStore.getAll()).messages).toEqual({
        [cloud.conversationId]: [
          {
            ...cloud,
            conversationUrl: 'https://gemini.google.com/u/1/app/peer',
            text: 'Full\nprompt',
          },
        ],
      });
    },
  );

  it('a v2-only download restores the full starred prompt without a legacy file', async () => {
    const cloud = {
      conversationId: 'gemini:conv:full',
      turnId: 'turn',
      content: 'First line',
      text: 'First line\nFull second line',
      conversationUrl: 'https://gemini.google.com/u/1/app/full',
      starredAt: 5,
    };
    await h.render('gemini', false);
    const download = await h.transfer.prepareDownload();
    vi.mocked(accountIsolationService.resolveAccountScope).mockResolvedValue({
      ...tabScope,
      emailHash: null,
    });
    await download.restore(
      {
        folders: { data: folders },
        stars: {
          format: 'gemini-voyager.stars.v2',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          accountScope: { accountHash: hashString(pageScope.accountKey) },
          items: [cloud],
          tombstones: [],
        },
      },
      'merge',
      false,
    );
    expect((await h.starStore.getAll()).messages).toEqual({ [cloud.conversationId]: [cloud] });
    expect(h.stored[StorageKeys.TIMELINE_STARRED_MESSAGES]).toEqual({
      messages: {
        [cloud.conversationId]: [
          {
            conversationId: cloud.conversationId,
            turnId: cloud.turnId,
            content: cloud.content,
            conversationUrl: cloud.conversationUrl,
            starredAt: cloud.starredAt,
          },
        ],
      },
    });
  });

  it('a failed v2 restore reports earlier writes and leaves later forks unrestored', async () => {
    await h.render('gemini', false);
    const download = await h.transfer.prepareDownload();
    await expect(
      download.restore(
        {
          folders: { data: folders },
          stars: {
            format: 'gemini-voyager.stars.v2',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            accountScope: { accountHash: 'wrong' },
            items: [],
            tombstones: [],
          },
          forks: { format: 'gemini-voyager.forks.v1', data: { nodes: {}, groups: {} } },
        },
        'merge',
        false,
      ),
    ).rejects.toMatchObject({
      restored: ['folders', 'prompts'],
      failed: ['starred', 'forks'],
    });
    expect(h.stored[buildScopedStorageKey(StorageKeys.FOLDER_DATA, 'page')]).toEqual({
      ...folders,
      folderContents: { local: [] },
    });
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([]);
    expect(h.stored[StorageKeys.FORK_NODES]).toBeUndefined();
    expect(tabMessage).not.toHaveBeenCalledWith(7, { type: 'gv.folders.reload' });
  });

  it('overwrite merges a v2-only backup while leaving missing folders and prompts untouched', async () => {
    const folderKey = buildScopedStorageKey(StorageKeys.FOLDER_DATA, pageScope.accountKey);
    const localPrompt = { id: 'local', text: 'Local prompt', tags: [], createdAt: 1 };
    h.stored[folderKey] = folders;
    h.stored[StorageKeys.PROMPT_ITEMS] = [localPrompt];
    const cloud = {
      conversationId: 'gemini:conv:cloud',
      turnId: 'turn',
      content: 'Cloud star',
      conversationUrl: 'https://gemini.google.com/u/1/app/cloud',
      starredAt: 5,
    };
    await h.render('gemini', false);
    const download = await h.transfer.prepareDownload();
    const result = await download.restore(
      {
        stars: {
          format: 'gemini-voyager.stars.v2',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          items: [cloud],
          tombstones: [],
          accountScope: { accountHash: hashString(pageScope.accountKey) },
        },
      },
      'overwrite',
      false,
    );
    expect(result.restored).toEqual(['starred']);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { kind: 'folders', reason: 'missing' },
        { kind: 'prompts', reason: 'missing' },
      ]),
    );
    expect(h.stored[folderKey]).toEqual(folders);
    expect(h.stored[StorageKeys.PROMPT_ITEMS]).toEqual([localPrompt]);
    expect((await h.starStore.getAll()).messages).toEqual({ [cloud.conversationId]: [cloud] });
  });

  it.each([undefined, null, 42])(
    'leaves stars untouched when the cloud star file is %s',
    async (starred) => {
      const existing = {
        turnId: 't',
        content: 'Keep',
        conversationId: 'one',
        conversationUrl: '',
        starredAt: 1,
      };
      h.stored[StorageKeys.TIMELINE_STARRED_MESSAGES] = { messages: { one: [existing] } };
      await h.render('gemini', false);
      const download = await h.transfer.prepareDownload();
      await download.restore({ folders: { data: folders }, starred }, 'overwrite', false);
      expect((await h.starStore.getAll()).messages).toEqual({ one: [existing] });
    },
  );

  it.each(['merge', 'overwrite'] as const)(
    'a fork uploaded on one device is restored on another without dropping local forks (%s)',
    async (mode) => {
      const fork = (conversationId: string, forkIndex: number): ForkNode => ({
        conversationId,
        turnId: 'turn',
        forkGroupId: 'group',
        forkIndex,
        createdAt: 1,
        conversationUrl: `https://gemini.google.com/u/1/app/${conversationId}`,
      });
      const local = fork('local', 0);
      const cloud = fork('cloud', 1);
      h.stored[StorageKeys.FORK_NODES] = {
        nodes: { local: [local] },
        groups: { group: ['local:turn'] },
      };
      await h.render('gemini', false);
      const download = await h.transfer.prepareDownload();
      await download.restore(
        {
          folders: { data: folders },
          forks: {
            format: 'gemini-voyager.forks.v1',
            exportedAt: '2026-10-05T00:00:00.000Z',
            data: { nodes: { cloud: [cloud] }, groups: { group: ['cloud:turn'] } },
          },
        },
        mode,
        false,
      );
      expect(await h.forkOwner.getAllForkNodes()).toEqual({
        nodes: { local: [local], cloud: [cloud] },
        groups: { group: ['local:turn', 'cloud:turn'] },
      });
    },
  );
});
