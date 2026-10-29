import type { PromptItem } from '@/core/types/sync';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';

/** Local reads may repair entries, but an unreadable library must not become an empty upload. */
export function normalizeLocalPromptsForSync(value: unknown): PromptItem[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Local prompt data is invalid');
  if (value.length === 0) return [];
  const normalized = PromptImportExportService.validatePayload(value);
  if (!normalized.success) throw new Error('Local prompt data is invalid');
  return normalized.data.items;
}
