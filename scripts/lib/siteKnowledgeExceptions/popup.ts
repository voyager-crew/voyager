import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const POPUP_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/pages/popup/Popup.tsx',
    kind: 'platform-branch',
    values: {
      aistudio: 1,
      gemini: 1,
    },
    reason: 'native popup platform fallback and AI Studio settings branch.',
  },
  {
    file: 'src/pages/popup/components/CloudSyncSettings.tsx',
    kind: 'presentation',
    values: {
      gemini: 1,
      aistudio: 1,
      chatgpt: 1,
      claude: 1,
      deepseek: 1,
    },
    reason: 'existing cloud-sync platform icon table.',
  },
  {
    file: 'src/pages/popup/components/PluginIdentity.tsx',
    kind: 'presentation',
    values: {
      gemini: 1,
      aistudio: 1,
      claude: 1,
      chatgpt: 1,
      deepseek: 1,
      kimi: 1,
    },
    reason: 'existing plugin site icons and brand colors.',
  },
  {
    file: 'src/pages/popup/components/WebsiteLogos.tsx',
    kind: 'presentation',
    values: {
      chatgpt: 1,
      claude: 1,
      deepseek: 1,
      kimi: 1,
      aistudio: 1,
      gemini: 1,
    },
    reason: 'named website icon exports read bundled logos.',
  },
  {
    file: 'src/pages/popup/components/useCloudSyncSettings.ts',
    kind: 'platform-branch',
    values: {
      gemini: 4,
    },
    reason:
      'Gemini initial React state and detectPlatform fallback when no web tab can be resolved.',
  },
  {
    file: 'src/pages/popup/components/useCloudSyncTransfer.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini route-user id participates in cloud sync.',
  },
  {
    file: 'src/pages/popup/hooks/useActivePopupTab.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Initial popup account-platform state is Gemini until the active tab resolves.',
  },
  {
    file: 'src/pages/popup/hooks/useFolderPopupSettings.ts',
    kind: 'platform-branch',
    values: {
      aistudio: 7,
      gemini: 5,
    },
    reason: 'existing native folder settings keys and per-site popup state.',
  },
  {
    file: 'src/pages/popup/utils/nativeSiteCapabilities.ts',
    kind: 'platform-branch',
    values: {
      gemini: 3,
      aistudio: 1,
    },
    reason: 'native popup capability differences for Gemini and AI Studio.',
  },
  {
    file: 'src/pages/welcome/Welcome.tsx',
    kind: 'presentation',
    values: {
      gemini: 1,
    },
    reason: 'Gemini accent from existing synced color preferences.',
  },
];
