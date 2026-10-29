import { createChatGptTurnSource } from '../adapter/chatgptTurnSource';
import { chatgptIsConversationPage } from '../adapter/platform/chatgpt';
import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import { createConversationCollector } from '../conversationCollector';
import type { ExportSite } from '../exportSite';
import { siteTurnSelector } from '../toolbarTargets';

/** ChatGPT supplies its crawl policy; entry, selection and files use the shared export core. */
export function createChatGptExportSite(adapter: ExportPlatformAdapter): ExportSite {
  return {
    id: adapter.site.id,
    label: adapter.site.label,
    entryPoints: {
      kind: 'toolbar',
      isConversationPage: chatgptIsConversationPage,
      opensFromPopup: true,
      turnSelector: siteTurnSelector(adapter.site),
    },
    title: adapter.extractConversationTitle,
    turns: createChatGptTurnSource(adapter),
    page: createConversationCollector(adapter),
  };
}
