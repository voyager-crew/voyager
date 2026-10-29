import { afterEach, beforeEach, expect, vi } from 'vitest';

import { ConversationExportService } from '@/features/export/services/ConversationExportService';
import { createPDFPrintContainer } from '@/features/export/services/pdfPrintDocument';
import type { ChatTurn, ConversationMetadata, ExportOptions } from '@/features/export/types/export';
import { DEFAULT_EXPORT_SPEAKER_LABELS } from '@/features/export/types/export';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';

let downloads: Blob[] = [];

beforeEach(() => {
  downloads = [];
  vi.spyOn(StarredMessagesService, 'getStarredMessagesForConversation').mockResolvedValue([]);
  URL.createObjectURL = vi.fn((blob: Blob) => {
    downloads.push(blob);
    return `blob:golden-${downloads.length}`;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

export async function exportText(
  turns: ChatTurn[],
  metadata: ConversationMetadata,
  options: ExportOptions,
): Promise<string> {
  const result = await ConversationExportService.export(turns, metadata, options);
  expect(result.success).toBe(true);
  expect(downloads).toHaveLength(1);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(downloads[0]);
  });
}

/**
 * The export date is rendered in the runner's locale and time zone, and the
 * Markdown hard line break (two trailing spaces) is shown as `<br2>`.
 */
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/^(\*\*Date\*\*: |\*Generated on ).*$/gm, '$1<date>')
    .replace(/ {2}$/gm, '<br2>');
}

export function printedTurns(turns: ChatTurn[], metadata: ConversationMetadata): string {
  const container = createPDFPrintContainer(turns, metadata, DEFAULT_EXPORT_SPEAKER_LABELS);
  return container.querySelector('.gv-print-content')?.innerHTML.replace(/\s+\n/g, '\n') ?? '';
}
