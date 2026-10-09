import type { MarkerLevel } from '@/features/timeline/types';

export interface TimelineHierarchyConversationData {
  conversationUrl: string;
  levels: Record<string, MarkerLevel>;
  collapsed: string[];
  updatedAt: number;
}

export interface TimelineHierarchyData {
  conversations: Record<string, TimelineHierarchyConversationData>;
}

export const EMPTY_TIMELINE_HIERARCHY_DATA: TimelineHierarchyData = {
  conversations: {},
};

export function getLegacyTimelineLevelsStorageKey(conversationId: string): string {
  return `geminiTimelineLevels:${conversationId}`;
}

export function getLegacyTimelineCollapsedStorageKey(conversationId: string): string {
  return `geminiTimelineCollapsed:${conversationId}`;
}

function isMarkerLevelValue(value: unknown): value is MarkerLevel {
  return value === 1 || value === 2 || value === 3;
}

function normalizeLevels(value: unknown): Record<string, MarkerLevel> {
  if (typeof value !== 'object' || value === null) return {};

  const levels: Record<string, MarkerLevel> = {};
  for (const [turnId, level] of Object.entries(value)) {
    if (isMarkerLevelValue(level)) {
      levels[turnId] = level;
    }
  }
  return levels;
}

function normalizeCollapsed(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item)).filter(Boolean)));
}

export function normalizeTimelineHierarchyConversationData(
  value: unknown,
): TimelineHierarchyConversationData | null {
  if (typeof value !== 'object' || value === null) return null;

  const raw = value as {
    conversationUrl?: unknown;
    levels?: unknown;
    collapsed?: unknown;
    updatedAt?: unknown;
  };

  const levels = normalizeLevels(raw.levels);
  const collapsed = normalizeCollapsed(raw.collapsed);
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0
      ? raw.updatedAt
      : 0;

  if (Object.keys(levels).length === 0 && collapsed.length === 0) {
    return null;
  }

  return {
    conversationUrl: typeof raw.conversationUrl === 'string' ? raw.conversationUrl : '',
    levels,
    collapsed,
    updatedAt,
  };
}

export function normalizeTimelineHierarchyData(value: unknown): TimelineHierarchyData {
  if (typeof value !== 'object' || value === null) return EMPTY_TIMELINE_HIERARCHY_DATA;

  const raw = value as { conversations?: unknown };
  if (typeof raw.conversations !== 'object' || raw.conversations === null) {
    return EMPTY_TIMELINE_HIERARCHY_DATA;
  }

  const conversations: Record<string, TimelineHierarchyConversationData> = {};
  for (const [conversationId, conversationData] of Object.entries(raw.conversations)) {
    const normalized = normalizeTimelineHierarchyConversationData(conversationData);
    if (normalized) {
      conversations[conversationId] = normalized;
    }
  }

  return { conversations };
}

export function isTimelineHierarchyData(value: unknown): value is TimelineHierarchyData {
  const normalized = normalizeTimelineHierarchyData(value);
  if (typeof value !== 'object' || value === null) return false;

  const raw = value as { conversations?: unknown };
  if (typeof raw.conversations !== 'object' || raw.conversations === null) return false;

  return Object.keys(normalized.conversations).length === Object.keys(raw.conversations).length;
}
