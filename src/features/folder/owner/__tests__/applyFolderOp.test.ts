import { describe, expect, it } from 'vitest';

import { AISTUDIO_ROOT_BUCKET_ID } from '@/features/folder/constants';

import { applyFolderOp } from '../applyFolderOp';
import type { FolderOpBody } from '../folderOps';
import { FOLDER_SITE_POLICIES, type FolderSite } from '../folderOwnerPolicy';
import { conversation, folder, folderData } from './ownerHarness';

const NOW = 5_000;
const gemini = FOLDER_SITE_POLICIES.gemini;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('applyFolderOp', () => {
  it.each<FolderSite>(['gemini', 'chatgpt', 'aistudio'])(
    'T6a: a move files the fresh stored record on %s, whatever the mover last saw',
    (site) => {
      // Another tab renamed, starred and opened c after this tab rendered it.
      const fresh = conversation('c', {
        title: 'Renamed elsewhere',
        customTitle: true,
        starred: true,
        lastOpenedAt: 400,
        addedAt: 10,
      });
      const data = folderData([folder('F1'), folder('F2')], { F1: [fresh] });

      const result = applyFolderOp(
        data,
        { kind: 'moveConversations', ids: ['c'], from: 'F1', target: 'F2', via: 'panel-menu' },
        FOLDER_SITE_POLICIES[site],
        NOW,
      );

      expect(result.outcome).toEqual({ kind: 'saved' });
      expect(result.data.folderContents.F1).toEqual([]);
      const [moved] = result.data.folderContents.F2;
      expect(moved).toMatchObject({
        title: 'Renamed elsewhere',
        customTitle: true,
        starred: true,
        lastOpenedAt: 400,
      });
      expect(moved.addedAt).toBe(site === 'gemini' ? NOW : 10);
    },
  );

  it('T6b: native titles retitle only records the user has not renamed', () => {
    const data = folderData([folder('F')], {
      F: [conversation('a', { title: 'Mine', customTitle: true }), conversation('b')],
    });

    const result = applyFolderOp(
      data,
      {
        kind: 'syncNativeTitles',
        entries: [
          { conversationId: 'a', title: 'Native A' },
          { conversationId: 'b', title: 'Native B' },
        ],
      },
      gemini,
      NOW,
    );

    expect(result.data.folderContents.F).toEqual([
      conversation('a', { title: 'Mine', customTitle: true }),
      conversation('b', { title: 'Native B', updatedAt: NOW }),
    ]);
  });

  it('T6c: clearing instructions removes the stored property', () => {
    const data = folderData([folder('F', 'F', { instructions: 'Be brief' })]);

    const result = applyFolderOp(
      data,
      { kind: 'setFolderInstructions', folderId: 'F', instructions: null },
      gemini,
      NOW,
    );

    expect(result.outcome).toEqual({ kind: 'saved' });
    expect(Object.hasOwn(result.data.folders[0], 'instructions')).toBe(false);
  });

  it('T6d: restoring a native title clears the custom flag and sets only a real title', () => {
    const data = folderData([folder('F')], {
      F: [conversation('c', { title: 'X', customTitle: true })],
    });
    const restore = (nativeTitle: string | null) =>
      applyFolderOp(
        data,
        { kind: 'restoreNativeTitle', conversationId: 'c', nativeTitle },
        gemini,
        NOW,
      ).data.folderContents.F[0];

    expect(restore(null)).toEqual(conversation('c', { title: 'X' }));
    expect(restore('Y')).toEqual(conversation('c', { title: 'Y', updatedAt: NOW }));
  });

  it('T6g: a gem rewrite keeps the account path and query of each matching record', () => {
    const data = folderData([folder('F')], {
      F: [
        conversation('abc', { url: 'https://gemini.google.com/u/1/app/abc?hl=en' }),
        conversation('other'),
      ],
    });

    const result = applyFolderOp(
      data,
      { kind: 'setConversationGem', hexId: 'abc', gemId: 'g1' },
      gemini,
      NOW,
    );

    expect(result.data.folderContents.F).toEqual([
      conversation('abc', {
        url: 'https://gemini.google.com/u/1/gem/g1/abc?hl=en',
        isGem: true,
        gemId: 'g1',
      }),
      conversation('other'),
    ]);
  });

  it('T6h: a move whose source row or target folder is gone writes nothing', () => {
    const data = folderData([folder('F1'), folder('F2')], { F1: [conversation('d')] });
    const move = (from: string, target: string) =>
      applyFolderOp(
        data,
        { kind: 'moveConversations', ids: ['c'], from, target, via: 'tree-drag' },
        gemini,
        NOW,
      );

    const sourceGone = move('F1', 'F2');
    const targetGone = move('F1', 'deleted');

    expect(sourceGone.outcome).toMatchObject({ kind: 'rejected', reason: 'source_missing' });
    expect(targetGone.outcome).toMatchObject({ kind: 'rejected', reason: 'target_missing' });
    expect(sourceGone.data).toBe(data);
    expect(targetGone.data).toBe(data);
  });

  it('files into a root bucket without a folder only on the site that owns it', () => {
    const seed = {
      conversationId: 'p',
      title: 'Prompt',
      url: 'https://aistudio.google.com/prompts/p',
    };
    const add = (site: FolderSite) =>
      applyFolderOp(
        folderData([]),
        {
          kind: 'addConversations',
          target: AISTUDIO_ROOT_BUCKET_ID,
          seeds: [seed],
          via: 'outside-drop',
        },
        FOLDER_SITE_POLICIES[site],
        NOW,
      );

    expect(add('aistudio').data.folderContents[AISTUDIO_ROOT_BUCKET_ID]).toHaveLength(1);
    expect(add('gemini').outcome).toMatchObject({ kind: 'rejected', reason: 'target_missing' });
  });

  it.each<FolderSite>(['gemini', 'chatgpt'])(
    'filing a chat starred in another folder keeps it starred on %s',
    (site) => {
      const policy = FOLDER_SITE_POLICIES[site];
      const starredElsewhere = conversation('c', { starred: true });
      const data = folderData([folder('F1'), folder('F2')], { F1: [starredElsewhere] });
      const seed = { conversationId: 'c', title: 'c', url: starredElsewhere.url };

      const added = applyFolderOp(
        data,
        { kind: 'addConversations', target: 'F2', seeds: [seed], via: 'picker' },
        policy,
        NOW,
      );
      const dropped = applyFolderOp(
        data,
        {
          kind: 'reorderConversations',
          ids: ['c'],
          from: null,
          target: 'F2',
          index: 0,
          sortMode: 'manual',
          ensure: [seed],
        },
        policy,
        NOW,
      );

      expect(added.data.folderContents.F2).toEqual([expect.objectContaining({ starred: true })]);
      expect(dropped.data.folderContents.F2).toEqual([expect.objectContaining({ starred: true })]);
      // Removing the starred copy later must not unstar the chat.
      const removed = applyFolderOp(
        added.data,
        { kind: 'removeConversations', folderId: 'F1', ids: ['c'] },
        policy,
        NOW,
      );
      expect(removed.data.folderContents.F2[0].starred).toBe(true);
    },
  );

  it('filing an unstarred chat adds no star field', () => {
    const data = folderData([folder('F1'), folder('F2')], { F1: [conversation('c')] });

    const result = applyFolderOp(
      data,
      {
        kind: 'addConversations',
        target: 'F2',
        seeds: [{ conversationId: 'c', title: 'c', url: '' }],
        via: 'picker',
      },
      gemini,
      NOW,
    );

    expect(result.data.folderContents.F2[0]).not.toHaveProperty('starred');
  });

  it('T6i: an outside drop at an index files and orders the conversations in one op', () => {
    const data = folderData([folder('F')], {
      F: [conversation('a', { sortIndex: 0 }), conversation('b', { sortIndex: 1 })],
    });
    const seeds = ['x', 'y', 'z'].map((id) => ({
      conversationId: id,
      title: id,
      url: `/app/${id}`,
    }));

    const result = applyFolderOp(
      data,
      {
        kind: 'reorderConversations',
        ids: ['x', 'y', 'z'],
        from: null,
        target: 'F',
        index: 1,
        sortMode: 'manual',
        ensure: seeds,
      },
      gemini,
      NOW,
    );

    const order = [...result.data.folderContents.F]
      .sort((left, right) => (left.sortIndex ?? 0) - (right.sortIndex ?? 0))
      .map((c) => c.conversationId);
    expect(order).toEqual(['a', 'x', 'y', 'z', 'b']);
  });

  it('never mutates the data it is given, so a view can replay ops over its base', () => {
    const data = deepFreeze(
      folderData([folder('F1'), folder('F2', 'F2', { sortIndex: 1 })], {
        F1: [conversation('c', { title: 'T' })],
      }),
    );
    const ops: FolderOpBody[] = [
      { kind: 'createFolder', folderId: 'N', name: 'New', parentId: 'F1' },
      { kind: 'renameFolder', folderId: 'F1', name: 'Renamed' },
      { kind: 'moveFolder', folderId: 'F2', parentId: 'F1' },
      { kind: 'setFolderColor', folderId: 'F1', color: 'red' },
      {
        kind: 'addConversations',
        target: 'F2',
        seeds: [{ conversationId: 'n', title: 'n', url: '' }],
        via: 'native-menu',
      },
      {
        kind: 'moveConversations',
        ids: ['c'],
        from: 'F1',
        target: 'F2',
        via: 'tree-drag',
        index: 0,
      },
      { kind: 'removeConversationEverywhere', conversationId: 'c' },
      { kind: 'setConversationStarred', conversationId: 'c', starred: true, scope: 'everywhere' },
      { kind: 'renameConversation', folderId: 'F1', conversationId: 'c', title: 'U' },
      { kind: 'markConversationOpened', conversationId: 'c', at: NOW },
      { kind: 'setConversationActivity', entries: [{ conversationId: 'c', lastTurnAt: NOW }] },
      { kind: 'removeFolder', folderId: 'F1' },
    ];

    for (const op of ops) {
      expect(applyFolderOp(data, op, gemini, NOW).outcome.kind).toBe('saved');
    }
  });
});
