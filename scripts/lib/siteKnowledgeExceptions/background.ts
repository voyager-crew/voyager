import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const BACKGROUND_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/pages/background/bridge/bridgeOwner.ts',
    kind: 'owner-read',
    values: {
      chatgpt: 2,
    },
    reason: 'bundled ChatGPT adapter and bridge permission gate.',
  },
  {
    file: 'src/pages/background/cloudSyncMessages.ts',
    kind: 'platform-branch',
    values: {
      gemini: 6,
    },
    reason:
      'Gemini highlight-change notices after upload/download and account scope for prompt merge requests.',
  },
  {
    file: 'src/pages/background/highlightMessages.ts',
    kind: 'platform-branch',
    values: {
      gemini: 4,
      aistudio: 1,
    },
    reason:
      'Validate highlight platforms, keep the Gemini scope fallback, and select its tombstone and Drive-sync handling.',
  },
  {
    file: 'src/pages/background/notificationSiteIcon.ts',
    kind: 'presentation',
    values: {
      gemini: 4,
      chatgpt: 3,
    },
    reason: 'native notification icons from bundled platform logos.',
  },
  {
    file: 'src/pages/background/researchPackOwner.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini sender admission for research-pack capture.',
  },
  {
    file: 'src/pages/background/responseNotifications.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
      chatgpt: 3,
    },
    reason: 'Completion labels, sender-site detection, and ChatGPT plugin-switch selection.',
  },
  {
    file: 'src/pages/background/runtimeMessageRouting.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Sync requests without a platform keep the historical Gemini default.',
  },
];
