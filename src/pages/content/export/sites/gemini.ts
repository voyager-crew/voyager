import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import { createConversationCollector } from '../conversationCollector';
import type { ExportSite } from '../exportSite';
import { geminiFingerprintSelectors, geminiReadyUserSelectors } from '../geminiTurnReadiness';
import { createGeminiTurnSource } from './geminiTurnSource';

/** Gemini keeps every loaded turn mounted, so the export reads the page in place. */
export function createGeminiExportSite(adapter: ExportPlatformAdapter): ExportSite {
  const page = createConversationCollector(adapter);
  return {
    id: adapter.site.id,
    label: adapter.site.label,
    entryPoints: {
      kind: 'gemini',
      userSelectors: geminiReadyUserSelectors,
      assistantMessageIdFor: page.assistantMessageIdFor,
    },
    title: adapter.extractConversationTitle,
    turns: createGeminiTurnSource(page),
    page,
    history: {
      userSelectors: geminiReadyUserSelectors,
      assistantSelectors: adapter.getAssistantSelectors,
      fingerprintSelectors: geminiFingerprintSelectors,
    },
  };
}
