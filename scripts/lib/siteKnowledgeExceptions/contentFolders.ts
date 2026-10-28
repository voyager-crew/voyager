import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const CONTENT_FOLDERS_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/pages/content/folder/FolderSidebarView.ts',
    kind: 'owner-read',
    values: {
      gemini: 1,
    },
    reason: 'Gemini conversation identity from the folder policy table.',
  },
  {
    file: 'src/pages/content/folder/FolderStore.ts',
    kind: 'owner-read',
    values: {
      gemini: 1,
    },
    reason: 'Gemini star identity from the folder policy table.',
  },
  {
    file: 'src/pages/content/folder/FolderTransferController.ts',
    kind: 'presentation',
    values: {
      gemini: 2,
    },
    reason: 'existing Gemini cloud-transfer tooltips.',
  },
  {
    file: 'src/pages/content/folder/aistudioAccountScope.ts',
    kind: 'site-owned-module',
    values: {
      aistudio: 1,
    },
    reason: 'AI Studio folder account isolation reads its platform setting.',
  },
  {
    file: 'src/pages/content/folder/aistudioLibraryTable.ts',
    kind: 'site-owned-module',
    values: {
      aistudio: 1,
    },
    reason: 'AI Studio library-row profile read.',
  },
  {
    file: 'src/pages/content/folder/aistudioLocatorReads.ts',
    kind: 'site-owned-module',
    values: {
      aistudio: 9,
    },
    reason: 'AI Studio library locator ownership proof.',
  },
  {
    file: 'src/pages/content/folder/aistudioNavigationReads.ts',
    kind: 'site-owned-module',
    values: {
      aistudio: 9,
    },
    reason: 'AI Studio navigation locator ownership proof.',
  },
  {
    file: 'src/pages/content/folder/floatingFolderUI.ts',
    kind: 'owner-read',
    values: {
      gemini: 1,
    },
    reason: 'Gemini identity from the folder policy table.',
  },
  {
    file: 'src/pages/content/folder/folderCloudSync.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini platform for folder cloud-transfer operations.',
  },
  {
    file: 'src/pages/content/folder/platformFolderConfig.ts',
    kind: 'owner-read',
    values: {
      gemini: 4,
      aistudio: 3,
    },
    reason: 'Native folder platform ids and storage fields read from the frozen definitions.',
  },
  {
    file: 'src/pages/content/folder/pluginSiteFolderConfigs.ts',
    kind: 'owner-read',
    values: {
      claude: 1,
      deepseek: 1,
    },
    reason: 'existing Claude and DeepSeek folder backup namespaces.',
  },
  {
    file: 'src/pages/content/folder/session/aistudioCommands.ts',
    kind: 'owner-read',
    values: {
      aistudio: 2,
    },
    reason: 'AI Studio refused tree operations and folder identity policy.',
  },
  {
    file: 'src/pages/content/folder/session/aistudioFolderSessions.ts',
    kind: 'site-owned-module',
    values: {
      aistudio: 2,
    },
    reason: 'AI Studio folder session lease key.',
  },
  {
    file: 'src/pages/content/folder/session/geminiFolderSessions.ts',
    kind: 'site-owned-module',
    values: {
      gemini: 2,
    },
    reason: 'Gemini folder session lease key.',
  },
  {
    file: 'src/pages/content/folder/sidebarTree.ts',
    kind: 'owner-read',
    values: {
      gemini: 1,
    },
    reason: 'Gemini tree conversation identity from the folder policy table.',
  },
];
