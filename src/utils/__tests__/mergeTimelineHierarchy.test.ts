import { describe, expect, it } from 'vitest';

import type {
  TimelineHierarchyConversationData,
  TimelineHierarchyData,
} from '@/features/timeline/hierarchyTypes';

import { mergeTimelineHierarchy } from '../merge';

function createConversation(
  overrides: Partial<TimelineHierarchyConversationData> = {},
): TimelineHierarchyConversationData {
  return {
    conversationUrl: 'https://gemini.google.com/app/conv-1',
    levels: { 'turn-1': 2 },
    collapsed: ['turn-2'],
    updatedAt: 1000,
    ...overrides,
  };
}

function createHierarchy(
  conversations: Record<string, TimelineHierarchyConversationData>,
): TimelineHierarchyData {
  return { conversations };
}

describe('mergeTimelineHierarchy', () => {
  it('returns empty data when both inputs are empty', () => {
    expect(mergeTimelineHierarchy(createHierarchy({}), createHierarchy({}))).toEqual({
      conversations: {},
    });
  });

  it('keeps conversations from both local and cloud when they do not overlap', () => {
    const local = createHierarchy({
      'gemini:conv:local': createConversation({
        conversationUrl: 'https://gemini.google.com/app/local',
      }),
    });
    const cloud = createHierarchy({
      'gemini:conv:cloud': createConversation({
        conversationUrl: 'https://gemini.google.com/app/cloud',
        updatedAt: 2000,
      }),
    });

    const result = mergeTimelineHierarchy(local, cloud);

    expect(Object.keys(result.conversations)).toEqual(['gemini:conv:local', 'gemini:conv:cloud']);
  });

  it('prefers the newer local conversation snapshot', () => {
    const local = createHierarchy({
      'gemini:conv:123': createConversation({
        levels: { 'turn-1': 3 },
        updatedAt: 3000,
      }),
    });
    const cloud = createHierarchy({
      'gemini:conv:123': createConversation({
        levels: { 'turn-1': 2 },
        updatedAt: 2000,
      }),
    });

    const result = mergeTimelineHierarchy(local, cloud);

    expect(result.conversations['gemini:conv:123']?.levels['turn-1']).toBe(3);
  });

  it('prefers the newer cloud conversation snapshot', () => {
    const local = createHierarchy({
      'gemini:conv:123': createConversation({
        collapsed: ['turn-local'],
        updatedAt: 1000,
      }),
    });
    const cloud = createHierarchy({
      'gemini:conv:123': createConversation({
        collapsed: ['turn-cloud'],
        updatedAt: 4000,
      }),
    });

    const result = mergeTimelineHierarchy(local, cloud);

    expect(result.conversations['gemini:conv:123']?.collapsed).toEqual(['turn-cloud']);
  });

  it('prefers local data when timestamps are equal', () => {
    const local = createHierarchy({
      'gemini:conv:123': createConversation({
        levels: { 'turn-1': 2 },
        updatedAt: 1500,
      }),
    });
    const cloud = createHierarchy({
      'gemini:conv:123': createConversation({
        levels: { 'turn-1': 3 },
        updatedAt: 1500,
      }),
    });

    const result = mergeTimelineHierarchy(local, cloud);

    expect(result.conversations['gemini:conv:123']?.levels['turn-1']).toBe(2);
  });

  it('handles nullish inputs gracefully', () => {
    // @ts-expect-error testing null input
    expect(mergeTimelineHierarchy(null, createHierarchy({}))).toEqual({ conversations: {} });
    // @ts-expect-error testing undefined input
    expect(mergeTimelineHierarchy(undefined, createHierarchy({}))).toEqual({ conversations: {} });
    // @ts-expect-error testing both undefined
    expect(mergeTimelineHierarchy(undefined, undefined)).toEqual({ conversations: {} });
  });
});
