import type { PromptExportPayload } from '@/core/types/sync';
import { PromptImportExportService } from '@/features/backup/services/PromptImportExportService';

import { normalizePromptSyncItems } from './losslessPromptSyncData';

/** Empty envelopes are recognized; unrelated or corrupt files cannot become an empty library. */
export function decodePromptDrivePayload(value: unknown): PromptExportPayload | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ('format' in value && value.format !== 'gemini-voyager.prompts.v1') return null;
    if ('items' in value && Array.isArray(value.items) && value.items.length === 0) {
      return {
        format: 'gemini-voyager.prompts.v1',
        exportedAt:
          'exportedAt' in value && typeof value.exportedAt === 'string' ? value.exportedAt : '',
        items: [],
      };
    }
  }
  const raw = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && 'items' in value
      ? value.items
      : null;
  const items = normalizePromptSyncItems(raw);
  return items?.length ? PromptImportExportService.exportToPayload(items) : null;
}
