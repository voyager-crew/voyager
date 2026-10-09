/**
 * One per-turn outline edit as plain data, so the page can overlay it while the background, the
 * single writer of catalog outlines, applies it to whatever storage holds when its turn comes.
 */
import type { TimelineHierarchyConversationData } from './hierarchyTypes';
import type { MarkerLevel } from './types';

type OutlineEntry = TimelineHierarchyConversationData | null;

export type OutlineEdit =
  | { kind: 'level'; turnId: string; aliases: string[]; level: MarkerLevel; url: string }
  | { kind: 'collapse'; turnId: string; aliases: string[]; collapsed: boolean; url: string };

const MAX_ID_LENGTH = 512;
const MAX_ALIASES = 32;
const MAX_URL_LENGTH = 4096;
// oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function outlineEntry(
  levels: Record<string, MarkerLevel>,
  collapsed: string[],
  conversationUrl: string,
  updatedAt: number,
): OutlineEntry {
  if (Object.keys(levels).length === 0 && collapsed.length === 0) return null;
  return { conversationUrl, levels, collapsed, updatedAt };
}

/** The entry after `edit`, dated `updatedAt`; null when no level or collapse is left. */
export function applyOutlineEdit(
  edit: OutlineEdit,
  entry: OutlineEntry,
  updatedAt: number,
): OutlineEntry {
  if (edit.kind === 'level') {
    const levels = { ...entry?.levels };
    edit.aliases.forEach((alias) => delete levels[alias]);
    if (edit.level !== 1) levels[edit.turnId] = edit.level;
    return outlineEntry(levels, entry?.collapsed ?? [], edit.url, updatedAt);
  }
  const ids = (entry?.collapsed ?? []).filter((id) => !edit.aliases.includes(id));
  if (edit.collapsed) ids.push(edit.turnId);
  return outlineEntry({ ...entry?.levels }, ids, edit.url, updatedAt);
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}

/** An edit received in a message, or null when any field is malformed. */
export function parseOutlineEdit(value: unknown): OutlineEdit | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, turnId, aliases, url } = value as Record<string, unknown>;
  if (!isId(turnId) || typeof url !== 'string' || url.length > MAX_URL_LENGTH) return null;
  if (!Array.isArray(aliases) || aliases.length > MAX_ALIASES || !aliases.every(isId)) return null;
  const base = { turnId, aliases: [...aliases], url };
  if (kind === 'level') {
    const { level } = value as { level?: unknown };
    return level === 1 || level === 2 || level === 3 ? { kind, ...base, level } : null;
  }
  if (kind === 'collapse') {
    const { collapsed } = value as { collapsed?: unknown };
    return typeof collapsed === 'boolean' ? { kind, ...base, collapsed } : null;
  }
  return null;
}
