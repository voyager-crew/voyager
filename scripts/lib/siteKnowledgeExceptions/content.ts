import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const CONTENT_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/pages/content/aistudioFolderStartup.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
    },
    reason: 'existing AI Studio folder admission at its native start point.',
  },
  {
    file: 'src/pages/content/aistudioSidebarStartup.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
    },
    reason: 'existing AI Studio sidebar-width admission.',
  },
  {
    file: 'src/pages/content/appearanceStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 7,
    },
    reason: 'existing Gemini appearance-feature admission.',
  },
  {
    file: 'src/pages/content/batchDeleteStartup.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
    },
    reason: 'AI Studio route guard before batch-delete admission.',
  },
  {
    file: 'src/pages/content/canvasExport/canvasTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native Canvas ownership proof.',
  },
  {
    file: 'src/pages/content/canvasExport/documentTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native Canvas document ownership proof.',
  },
  {
    file: 'src/pages/content/canvasExport/menuTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native Canvas menu ownership proof.',
  },
  {
    file: 'src/pages/content/chatInput/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Select native Gemini input resolution instead of the catalog-site finder.',
  },
  {
    file: 'src/pages/content/chatInput/vimGeminiComposer.ts',
    kind: 'site-owned-module',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native Vim composer proof.',
  },
  {
    file: 'src/pages/content/chatInput/vimInputTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini selector view for Vim input targets.',
  },
  {
    file: 'src/pages/content/contextSync/capture.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini selector view for context capture.',
  },
  {
    file: 'src/pages/content/draftSave/geminiDraftSendDetection.ts',
    kind: 'site-owned-module',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native send-key detection for drafts.',
  },
  {
    file: 'src/pages/content/folderProject/inputTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini input ownership proof for folder-project instructions.',
  },
  {
    file: 'src/pages/content/folderSpacing/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 3,
      aistudio: 3,
    },
    reason:
      'Native folder-spacing setting-key table, Gemini default, and AI Studio spacing dispatch.',
  },
  {
    file: 'src/pages/content/fork/chatPairs.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native adapter for fork conversation pairs.',
  },
  {
    file: 'src/pages/content/fork/linkFinisher.ts',
    kind: 'owner-read',
    values: {
      gemini: 3,
    },
    reason: 'native Gemini send-container policy and effective send key.',
  },
  {
    file: 'src/pages/content/geminiBuiltinStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 16,
    },
    reason: 'existing Gemini builtin-feature admission at native start points.',
  },
  {
    file: 'src/pages/content/geminiFolderStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'existing Gemini folder admission.',
  },
  {
    file: 'src/pages/content/geminiPageStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 5,
    },
    reason: 'existing Gemini page-feature admission and folder spacing.',
  },
  {
    file: 'src/pages/content/highlight/manager.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini account scope for native highlight storage operations.',
  },
  {
    file: 'src/pages/content/index.tsx',
    kind: 'platform-branch',
    values: {
      gemini: 3,
      aistudio: 5,
    },
    reason: 'existing native Gemini and AI Studio startup dispatch.',
  },
  {
    file: 'src/pages/content/inputCollapse/targets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'Gemini native collapsed-input ownership proof.',
  },
  {
    file: 'src/pages/content/inputStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 5,
      aistudio: 1,
    },
    reason: 'existing native Gemini and AI Studio input-feature admission.',
  },
  {
    file: 'src/pages/content/prompt/promptAccountMutation.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
    },
    reason: 'AI Studio account-name mutation handling.',
  },
  {
    file: 'src/pages/content/prompt/promptPageScope.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
    },
    reason: 'AI Studio account observer includes character-data changes.',
  },
  {
    file: 'src/pages/content/prompt/resolvePromptSiteAdapter.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'Custom-page and catalog prompt adapters default to the Gemini highlight scope.',
  },
  {
    file: 'src/pages/content/prompt/selectorInput.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native prompt input proof.',
  },
  {
    file: 'src/pages/content/prompt/sentChipTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native sent-chip ownership proof.',
  },
  {
    file: 'src/pages/content/rendererStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 5,
    },
    reason: 'existing Gemini renderer-feature admission.',
  },
  {
    file: 'src/pages/content/researchPack/continueIn.ts',
    kind: 'presentation',
    values: {
      chatgpt: 1,
      claude: 1,
    },
    reason: 'initial readiness keys for existing handoff destination buttons.',
  },
  {
    file: 'src/pages/content/researchPack/turnCapture.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native adapter for research-pack turn capture.',
  },
  {
    file: 'src/pages/content/selectionStartup.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'existing Gemini quote-reply and highlight admission.',
  },
  {
    file: 'src/pages/content/sendBehavior/followSendKey.ts',
    kind: 'site-owned-module',
    values: {
      gemini: 1,
    },
    reason: "Gemini send behavior follows the page coordinator's effective send key.",
  },
  {
    file: 'src/pages/content/sendBehavior/pluginHandler.ts',
    kind: 'site-owned-module',
    values: {
      gemini: 1,
    },
    reason:
      'Gemini Safari Enter-fix plugin registers its fallback on the page send-key coordinator.',
  },
  {
    file: 'src/pages/content/timeline/GeminiTimelineAdapter.ts',
    kind: 'site-owned-module',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini timeline route identity.',
  },
  {
    file: 'src/pages/content/timeline/GeminiTimelineStorage.ts',
    kind: 'serialized-value',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini timeline uses its existing settings prefix.',
  },
  {
    file: 'src/pages/content/watermarkRemover/generatedImageOwner.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native generated-image ownership proof.',
  },
  {
    file: 'src/pages/content/watermarkRemover/generatedImageTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native generated-image target proof.',
  },
];
