import { StorageKeys } from '@/core/types/common';
import type { FolderData } from '@/core/types/folder';

export const HISTORY_TEST_TIME = '2026-10-29T12:00:00.000Z';

export interface HistoryPayloadFixture {
  label: string;
  source: string;
  valid: (id: string) => unknown;
  corrupt: (id: string) => unknown;
}

export function historyEnvelope<Data>(format: string, data: Data) {
  return { format, exportedAt: HISTORY_TEST_TIME, version: '2.2.1', data };
}

const folderConversations = {
  gemini: {
    conversationId: 'gemini:conv:123456789abc',
    url: 'https://gemini.google.com/u/0/app/123456789abc',
  },
  chatgpt: {
    conversationId: 'chatgpt:conv:12345678-1234-1234-1234-123456789abc',
    url: 'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc',
  },
  kimi: {
    conversationId: 'kimi:conv:12345678-1234-1234-1234-123456789abc',
    url: 'https://www.kimi.com/chat/12345678-1234-1234-1234-123456789abc',
  },
};

function folderPayload(id: string, platform: keyof typeof folderConversations) {
  const folderId = `folder-${id}`;
  const data: FolderData = {
    folders: [
      {
        id: folderId,
        name: id,
        parentId: null,
        isExpanded: true,
        createdAt: 1,
        updatedAt: 2,
        pinned: true,
        color: '#abcdef',
        sortIndex: 0,
        instructions: 'Keep this folder instruction',
      },
    ],
    folderContents: {
      [folderId]: [
        {
          ...folderConversations[platform],
          title: id,
          addedAt: 1,
          lastOpenedAt: 2,
          lastTurnAt: 3,
          updatedAt: 4,
          starred: true,
          customTitle: true,
          sortIndex: 0,
        },
      ],
    },
  };
  return {
    ...historyEnvelope('gemini-voyager.folders.v1', data),
    ...(platform === 'gemini' ? {} : { platform }),
  };
}

function corruptFolderPayload(id: string, platform: keyof typeof folderConversations) {
  const payload = folderPayload(id, platform);
  const folderId = `folder-${id}`;
  return {
    ...payload,
    data: {
      ...payload.data,
      folderContents: {
        [folderId]: [
          ...payload.data.folderContents[folderId],
          { conversationId: 'silently-dropped-conversation' },
        ],
      },
    },
  };
}

export function strictPromptPayload(id: string) {
  return {
    format: 'gemini-voyager.prompts.v1',
    exportedAt: HISTORY_TEST_TIME,
    version: '2.2.1',
    items: [
      {
        id,
        name: `${id} name`,
        text: `${id} prompt`,
        tags: ['history'],
        createdAt: 1,
        updatedAt: 2,
        pinnedAt: null,
      },
    ],
  };
}

function pluginPayload(id: string) {
  return historyEnvelope('gemini-voyager.plugins.v1', {
    [id]: { enabled: true, installedAt: 1, settings: { density: 'compact', size: 2 } },
  });
}

function forkPayload(id: string, conversationId = `conversation-${id}`, groupId = `group-${id}`) {
  const turnId = `turn-${id}`;
  return historyEnvelope('gemini-voyager.forks.v1', {
    nodes: {
      [conversationId]: [
        {
          turnId,
          conversationId,
          conversationUrl: 'https://gemini.google.com/u/0/app/123456789abc',
          conversationTitle: id,
          forkGroupId: groupId,
          forkIndex: 0,
          createdAt: 1,
        },
      ],
    },
    groups: { [groupId]: [`${conversationId}:${turnId}`] },
  });
}

function hierarchyPayload(id: string) {
  return historyEnvelope('gemini-voyager.timeline-hierarchy.v1', {
    conversations: {
      [id]: {
        conversationUrl: 'https://gemini.google.com/u/0/app/123456789abc',
        levels: { [`turn-${id}`]: 1 },
        collapsed: [`turn-${id}`],
        updatedAt: 1,
      },
    },
  });
}

function settingsPayload(id: string) {
  return historyEnvelope('gemini-voyager.settings.v1', {
    [StorageKeys.GV_TIMELINE_ENABLED]: true,
    [StorageKeys.PROMPT_THEME]: id,
    [StorageKeys.LANGUAGE]: 'en',
  });
}

function coachmarksPayload(id: string) {
  const payload = settingsPayload(id);
  return {
    ...payload,
    data: { ...payload.data, [StorageKeys.COACHMARKS_SEEN]: [`tour-${id}`] },
  };
}

export const strictSharedHistoryFixtures = [
  {
    label: 'Gemini folders with a dropped conversation',
    source: 'gemini-voyager-folders.json',
    valid: (id) => folderPayload(id, 'gemini'),
    corrupt: (id) => corruptFolderPayload(id, 'gemini'),
  },
  {
    label: 'AI Studio folders with a dropped conversation',
    source: 'gemini-voyager-aistudio-folders.json',
    valid: (id) => folderPayload(id, 'gemini'),
    corrupt: (id) => corruptFolderPayload(id, 'gemini'),
  },
  {
    label: 'ChatGPT folders with a dropped conversation',
    source: 'gemini-voyager-chatgpt-folders.json',
    valid: (id) => folderPayload(id, 'chatgpt'),
    corrupt: (id) => corruptFolderPayload(id, 'chatgpt'),
  },
  {
    label: 'catalog Kimi folders with a dropped conversation',
    source: 'gemini-voyager-kimi-folders.json',
    valid: (id) => folderPayload(id, 'kimi'),
    corrupt: (id) => corruptFolderPayload(id, 'kimi'),
  },
  {
    label: 'prompts with a dropped item',
    source: 'gemini-voyager-prompts.json',
    valid: strictPromptPayload,
    corrupt: (id) => ({
      ...strictPromptPayload(id),
      items: [...strictPromptPayload(id).items, { id: 'lost', text: 7 }],
    }),
  },
  {
    label: 'plugins with a dropped entry',
    source: 'gemini-voyager-plugins.json',
    valid: pluginPayload,
    corrupt: (id) => ({
      ...pluginPayload(id),
      data: { ...pluginPayload(id).data, lost: { enabled: 'yes', installedAt: 1 } },
    }),
  },
  {
    label: 'forks with a dangling group reference',
    source: 'gemini-voyager-forks.json',
    valid: forkPayload,
    corrupt: (id) => ({
      ...forkPayload(id),
      data: {
        ...forkPayload(id).data,
        groups: { [`group-${id}`]: ['missing-conversation:missing-turn'] },
      },
    }),
  },
  {
    label: 'forks with an inherited conversation bucket id',
    source: 'gemini-voyager-forks.json',
    valid: forkPayload,
    // Computed keys keep __proto__ as an own JSON property and preserve referential integrity.
    corrupt: (id) => forkPayload(id, '__proto__'),
  },
  {
    label: 'forks with an inherited group bucket id',
    source: 'gemini-voyager-forks.json',
    valid: forkPayload,
    corrupt: (id) => forkPayload(id, `conversation-${id}`, 'constructor'),
  },
  {
    label: 'timeline hierarchy with a coerced collapsed turn',
    source: 'gemini-voyager-timeline-hierarchy.json',
    valid: hierarchyPayload,
    corrupt: (id) => ({
      ...hierarchyPayload(id),
      data: {
        conversations: {
          [id]: {
            ...hierarchyPayload(id).data.conversations[id],
            collapsed: [`turn-${id}`, 7],
          },
        },
      },
    }),
  },
  {
    label: 'settings with a filtered invalid language',
    source: 'gemini-voyager-settings.json',
    valid: settingsPayload,
    corrupt: (id) => ({
      ...settingsPayload(id),
      data: { ...settingsPayload(id).data, [StorageKeys.LANGUAGE]: { corrupt: true } },
    }),
  },
  {
    label: 'settings with filtered nonstring coachmarks',
    source: 'gemini-voyager-settings.json',
    valid: coachmarksPayload,
    corrupt: (id) => ({
      ...coachmarksPayload(id),
      data: {
        ...coachmarksPayload(id).data,
        [StorageKeys.COACHMARKS_SEEN]: [`tour-${id}`, 7],
      },
    }),
  },
  {
    label: 'settings with duplicate coachmarks',
    source: 'gemini-voyager-settings.json',
    valid: coachmarksPayload,
    corrupt: (id) => ({
      ...coachmarksPayload(id),
      data: {
        ...coachmarksPayload(id).data,
        [StorageKeys.COACHMARKS_SEEN]: [`tour-${id}`, `tour-${id}`],
      },
    }),
  },
] satisfies HistoryPayloadFixture[];
