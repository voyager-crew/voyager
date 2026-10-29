import type { PromptItem } from '@/core/types/sync';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';

/** Keep import repairs for damaged entries without rewriting a valid template's body or name. */
export function normalizePromptSyncItems(value: unknown): PromptItem[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const items = value.flatMap((raw: unknown) => {
    const normalized = PromptImportExportService.validatePayload([raw]);
    if (!normalized.success || !raw || typeof raw !== 'object' || !('text' in raw)) return [];
    return normalized.data.items.map((item) => ({
      ...item,
      text: typeof raw.text === 'string' ? raw.text : item.text,
      ...('name' in raw && typeof raw.name === 'string' ? { name: raw.name } : {}),
    }));
  });
  return items.length ? items : null;
}
