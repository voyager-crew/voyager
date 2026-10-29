import { normalizePromptSyncItems } from '@/core/services/losslessPromptSyncData';
import type { PromptItem } from '@/core/types/sync';

/** Local reads may repair entries, but an unreadable library must not become an empty upload. */
export function normalizeLocalPromptsForSync(value: unknown): PromptItem[] {
  if (value === undefined) return [];
  const items = normalizePromptSyncItems(value);
  if (!items) throw new Error('Local prompt data is invalid');
  return items;
}
