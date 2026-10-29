import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const CORE_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/core/selectors/chatgptSemantics.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT turn completeness and native identity proof.',
  },
  {
    file: 'src/core/selectors/chatgptSignals.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT streaming and thinking signal proof.',
  },
  {
    file: 'src/core/selectors/composerSemantics.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT repaired composer-root proof.',
  },
  {
    file: 'src/core/selectors/semanticSnapshot.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
      chatgpt: 1,
    },
    reason: 'native Gemini bypass and ChatGPT semantic proof dispatch.',
  },
  {
    file: 'src/core/selectors/service.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT page-hook fields enter its selector candidates.',
  },
  {
    file: 'src/core/selectors/siteSemantics.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT turn proof and code-block ownership rules.',
  },
  {
    file: 'src/core/services/CloudSyncTransferContext.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini route-user id participates in cloud sync.',
  },
  {
    file: 'src/core/services/AccountIsolationService.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
      gemini: 2,
    },
    reason: 'native account checks and the historical Gemini default.',
  },
  {
    file: 'src/core/services/DiagnosticsExportService.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
      aistudio: 1,
      chatgpt: 1,
      claude: 1,
      deepseek: 1,
      kimi: 1,
    },
    reason: 'Host-to-site fallback table for diagnostic reports when no bundled adapter matches.',
  },
  {
    file: 'src/core/services/GoogleDriveFolderTransfers.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'Upload and download API parameters default to the Gemini sync platform.',
  },
  {
    file: 'src/core/services/HighlightDriveSyncCoordinator.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini scope for local highlight merges and snapshots during Drive sync.',
  },
  {
    file: 'src/core/services/composer/chatgptRootProof.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 3,
    },
    reason: 'ChatGPT native composer-root ownership proof.',
  },
  {
    file: 'src/core/services/composer/sendKeys/aistudioSendRead.ts',
    kind: 'owner-read',
    values: {
      aistudio: 1,
    },
    reason: 'AI Studio send-container selectors from packaged input data.',
  },
  {
    file: 'src/core/services/composer/sendKeys/sendKeyCoordinator.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'native send-button dispatch and Gemini send-key tracking.',
  },
  {
    file: 'src/core/services/composer/siteComposerOperation.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT repaired-root proof before composer operations.',
  },
  {
    file: 'src/core/services/highlightAnnotationData.ts',
    kind: 'serialized-value',
    values: {
      gemini: 2,
      aistudio: 2,
    },
    reason: 'existing highlight index platform tags and clear-marker keys.',
  },
  {
    file: 'src/core/services/highlightAnnotationStore.ts',
    kind: 'serialized-value',
    values: {
      gemini: 4,
      aistudio: 4,
    },
    reason: 'read and clear both existing highlight platform namespaces.',
  },
  {
    file: 'src/core/types/highlight.ts',
    kind: 'serialized-value',
    values: {
      gemini: 1,
      aistudio: 1,
    },
    reason: 'existing highlight platform list owns the derived type and runtime parser.',
  },
  {
    file: 'src/core/types/sync.ts',
    kind: 'serialized-value',
    values: {
      gemini: 1,
      aistudio: 1,
    },
    reason: 'preserve which folder exports carry a platform tag.',
  },
  {
    file: 'src/core/utils/quotedText.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native math extraction in selection clones.',
  },
];
