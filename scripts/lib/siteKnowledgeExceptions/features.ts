import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const FEATURES_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/features/export/services/ConversationExportService.ts',
    kind: 'presentation',
    values: {
      gemini: 1,
    },
    reason: 'historical Gemini slug when an export has no platform label.',
  },
  {
    file: 'src/features/export/services/MarkdownFormatter.ts',
    kind: 'presentation',
    values: {
      gemini: 1,
    },
    reason: 'historical Gemini slug when formatted output has no platform label.',
  },
  {
    file: 'src/features/export/services/exportContentRoots.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'historical Gemini default for message-content resolution.',
  },
  {
    file: 'src/features/folder/owner/authority.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 1,
      aistudio: 1,
      gemini: 1,
      claude: 1,
      deepseek: 1,
    },
    reason: 'release-selected writer authority for the frozen folder sites.',
  },
  {
    file: 'src/features/folder/owner/ownerBulk.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
      chatgpt: 1,
      aistudio: 1,
      claude: 1,
      deepseek: 1,
    },
    reason: 'dispatch existing folder formats to their site importer.',
  },
  {
    file: 'src/features/formulaCopy/FormulaCopyService.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini native formula-arrow observation default.',
  },
  {
    file: 'src/features/formulaCopy/FormulaInteraction.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'Select Gemini native inline and presentation formula profiles.',
  },
  {
    file: 'src/features/formulaCopy/formulaSource.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'Select Gemini native formula-container and display profiles for source extraction.',
  },
  {
    file: 'src/features/researchPack/services/handoff.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 4,
      claude: 4,
    },
    reason: 'existing ChatGPT and Claude handoff destinations and readiness keys.',
  },
  {
    file: 'src/features/researchPack/services/markdown.ts',
    kind: 'presentation',
    values: {
      gemini: 1,
      aistudio: 1,
      chatgpt: 1,
      claude: 1,
    },
    reason: 'existing platform labels in research-pack Markdown.',
  },
  {
    file: 'src/features/savedLibrary/viewModel.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
      chatgpt: 2,
    },
    reason: 'legacy Gemini account hashing and ChatGPT assigned-account grouping.',
  },
  {
    file: 'src/features/timeline/timelineSettings.ts',
    kind: 'serialized-value',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini timeline settings retain their existing namespace.',
  },
  {
    file: 'src/features/timeline/userTextProof.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
      chatgpt: 1,
    },
    reason: 'native Gemini text proof and ChatGPT user-turn proof.',
  },
  {
    file: 'src/features/timeline/userTurnText.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini user text excludes attachment labels.',
  },
];
