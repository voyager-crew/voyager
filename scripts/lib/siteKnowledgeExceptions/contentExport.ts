import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const CONTENT_EXPORT_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/pages/content/export/adapter/chatgptCodeLanguage.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT export code-language selector proof.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptExportData.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT export profile repair detection.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptExportLocators.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT export locator ownership proof.',
  },
  {
    file: 'src/pages/content/export/adapter/chatgptHistoryLocators.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 4,
    },
    reason: 'ChatGPT history-control locator proof.',
  },
  {
    file: 'src/pages/content/export/conversationTurnOperation.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native turn-reader operation.',
  },
  {
    file: 'src/pages/content/export/exportOverlayTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'native Gemini export-overlay selector view and bundled fallback.',
  },
  {
    file: 'src/pages/content/export/exportSearchImages.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini search-image fallback for export.',
  },
  {
    file: 'src/pages/content/export/exportSite.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini export entry-point variant.',
  },
  {
    file: 'src/pages/content/export/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Narrow the entry-point variant handled by the Gemini menu and toolbar mount.',
  },
  {
    file: 'src/pages/content/export/sites/generic.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'generic export adapts the Gemini entry-point variant to its own readiness profiles.',
  },
  {
    file: 'src/pages/content/export/toolbarTargets.ts',
    kind: 'owner-read',
    values: {
      gemini: 1,
      aistudio: 1,
      chatgpt: 1,
      claude: 1,
      deepseek: 1,
      kimi: 1,
    },
    reason: 'Packaged export-layout table keyed by site id.',
  },
];
