/**
 * The tree's item keys. Folder and conversation ids are opaque free text, so
 * every spelling a separator could confuse must still give each row its own key,
 * and laying data out must leave it as it was.
 */
import { describe, expect, it } from 'vitest';

import type { SubfolderPlacement } from '@/features/folder/model/subfolderPlacement';

import type { FolderData } from '../../types';
import { ROOT_ITEM_KEY, buildTreeProjection, conversationKey, folderKey } from '../projection';
import { conv, deepFreeze, folder } from './treeFixtures';

/** Ids that read like parts of another id's key under a naive `parent:id` scheme. */
const TRICKY_IDS = [
  '',
  'a',
  'a:',
  ':a',
  '1:a',
  'f1:a',
  'r',
  'c1:r1:a',
  'a#1',
  '#1',
  '1',
  '11',
  'a1:b',
  'a:1:b',
];

describe('tree item keys', () => {
  it('give every folder, conversation row and repeat its own key, however ids are spelled', () => {
    const keys = new Map<string, string>();
    const record = (key: string, what: string) => {
      expect(keys.get(key), `${what} reuses the key of ${keys.get(key)}`).toBeUndefined();
      keys.set(key, what);
    };
    record(ROOT_ITEM_KEY, 'the root');
    for (const id of TRICKY_IDS) record(folderKey(id), `folder ${JSON.stringify(id)}`);
    const parents = [ROOT_ITEM_KEY, ...TRICKY_IDS.map(folderKey)];
    for (const parent of parents) {
      for (const id of TRICKY_IDS) {
        for (const occurrence of [0, 1, 2]) {
          record(
            conversationKey(parent, id, occurrence),
            `conversation ${JSON.stringify(id)} #${occurrence} under ${parent}`,
          );
        }
      }
    }
  });

  it('lay out a row for every stored entry, the same chat in two folders and twice in one', () => {
    const ids = TRICKY_IDS.filter(Boolean);
    const data: FolderData = {
      folders: ids.map((id, index) => folder(id, `Folder ${index}`, { sortIndex: index })),
      folderContents: Object.fromEntries([
        ...ids.map((id) => [id, ids.map((cid) => conv(cid, `Chat ${cid}`))]),
        ['__root__', [conv('a', 'Loose'), conv('a', 'Loose again')]],
      ]),
    };
    const projection = buildTreeProjection({
      data,
      rootBucketId: '__root__',
      conversationSortMode: 'manual',
    });

    const rows = ids.length + ids.length * ids.length + 2;
    expect(projection.nodes.size).toBe(rows);
    const listed = [...projection.children.values()].flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toHaveLength(rows);
  });

  it('leave the data they lay out unchanged', () => {
    const data = deepFreeze<FolderData>({
      folders: [
        folder('p', 'Pinned', { pinned: true, createdAt: 3 }),
        folder('c', 'Child', { parentId: 'p' }),
        folder('o', 'Older', { createdAt: 1, sortIndex: 5 }),
      ],
      folderContents: {
        p: [conv('x', 'X', { addedAt: 1 }), conv('y', 'Y', { addedAt: 2, starred: true })],
        c: [],
        o: [conv('x', 'X')],
        __root__: [conv('z', 'Z')],
      },
    });
    const before = JSON.stringify(data);
    for (const conversationSortMode of ['manual', 'recent'] as const) {
      for (const site of [
        undefined,
        { folderOrder: 'created' as const, conversationOrder: 'stored' as const },
      ]) {
        buildTreeProjection({ data, rootBucketId: '__root__', conversationSortMode, site });
      }
    }
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('tree order', () => {
  /** Every row in display order, every folder open, as `title` or `name`. */
  const outline = (data: FolderData, subfolderPlacement?: SubfolderPlacement): string[] => {
    const projection = buildTreeProjection({
      data,
      rootBucketId: '__root__',
      conversationSortMode: 'manual',
      subfolderPlacement,
    });
    const walk = (key: string): string[] =>
      (projection.children.get(key) ?? []).flatMap((child) => {
        const node = projection.nodes.get(child)!;
        return node.kind === 'folder'
          ? [node.folder.name, ...walk(child)]
          : [node.conversation.title];
      });
    return walk(ROOT_ITEM_KEY);
  };

  const nested: FolderData = {
    folders: [folder('p', 'Parent'), folder('k', 'Kid', { parentId: 'p' })],
    folderContents: {
      p: [conv('pc', 'Parent chat')],
      k: [conv('kc', 'Kid chat')],
      __root__: [conv('rc', 'Root chat')],
    },
  };

  it("lists a folder's subfolders above its own chats by default", () => {
    expect(outline(nested)).toEqual(['Root chat', 'Parent', 'Kid', 'Kid chat', 'Parent chat']);
  });

  it("lists a folder's own chats first when subfolders are placed last", () => {
    expect(outline(nested, 'last')).toEqual([
      'Root chat',
      'Parent',
      'Parent chat',
      'Kid',
      'Kid chat',
    ]);
  });
});
