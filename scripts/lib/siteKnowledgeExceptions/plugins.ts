import type { SiteKnowledgeException } from '../siteKnowledgeTypes';

export const PLUGINS_SITE_KNOWLEDGE_EXCEPTIONS: readonly SiteKnowledgeException[] = [
  {
    file: 'src/features/plugins/builtin/chatgptActionTargets.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT native action-target proof.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptLocalBridge/ops/pageReaders.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT bridge composer and send-control reads.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptModelSelect/pickerDom.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 4,
    },
    reason: 'ChatGPT model-picker and effort-control reads.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptNotificationSelectors.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT notification selector-repair detection.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptProUsage/allowance.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT allowance source tag and precedence.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptReplyContent.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 3,
    },
    reason: 'ChatGPT complete-reply ownership and readiness proof.',
  },
  {
    file: 'src/features/plugins/builtin/chatgptResponseNotification/page.ts',
    kind: 'site-owned-module',
    values: {
      chatgpt: 2,
    },
    reason: 'ChatGPT notification composer-root proof.',
  },
  {
    file: 'src/features/plugins/local/authoring/siteFacts.ts',
    kind: 'presentation',
    values: {
      gemini: 2,
      aistudio: 1,
    },
    reason: 'native-site caveats and Gemini shared-draft explanation.',
  },
  {
    file: 'src/features/plugins/runtime/semanticElements.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'packaged Gemini code blocks use native semantic proof.',
  },
  {
    file: 'src/features/plugins/sends/sendTargets.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT complete user-turn proof before send tracking.',
  },
  {
    file: 'src/features/plugins/sends/trackUserSends.ts',
    kind: 'platform-branch',
    values: {
      chatgpt: 1,
    },
    reason: 'ChatGPT temporary-chat check suppresses user-send reports.',
  },
  {
    file: 'src/features/plugins/sites/registry.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
      aistudio: 1,
    },
    reason: 'existing native-site classification for Gemini and AI Studio.',
  },
  {
    file: 'src/features/plugins/sites/sections/promptData.ts',
    kind: 'serialized-value',
    values: {
      aistudio: 3,
    },
    reason: 'existing AI Studio highlight-scope value in the prompt schema.',
  },
  {
    file: 'src/features/plugins/types.ts',
    kind: 'presentation',
    values: {
      gemini: 1,
      aistudio: 1,
      chatgpt: 1,
      claude: 1,
      deepseek: 1,
      kimi: 1,
    },
    reason: 'Hand-written known-site list for plugin authoring autocomplete.',
  },
  {
    file: 'src/features/plugins/verbs/codeBlockDiagramTargets.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'packaged Gemini code blocks use native diagram-target proof.',
  },
  {
    file: 'src/features/plugins/verbs/codeCollapse/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'select the Gemini native code-collapse lifecycle.',
  },
  {
    file: 'src/features/plugins/verbs/draftSave/draftPolicy.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'native Gemini send-detection policy variant.',
  },
  {
    file: 'src/features/plugins/verbs/draftSave/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'select Gemini native draft persistence policy.',
  },
  {
    file: 'src/features/plugins/verbs/draftSave/session.ts',
    kind: 'platform-branch',
    values: {
      gemini: 3,
    },
    reason: 'native Gemini draft restore and send-detection behavior.',
  },
  {
    file: 'src/features/plugins/verbs/folders/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
      aistudio: 1,
    },
    reason: 'dispatch native Gemini and AI Studio folder extensions.',
  },
  {
    file: 'src/features/plugins/verbs/sendShortcut/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'refuse native send shortcuts on Gemini Enterprise.',
  },
  {
    file: 'src/features/plugins/verbs/turnNavigator/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 2,
    },
    reason: 'keep Gemini native timeline identities in the shared backend.',
  },
  {
    file: 'src/features/plugins/verbs/userLatex/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'packaged Gemini user-line extraction uses native proof.',
  },
  {
    file: 'src/features/plugins/verbs/vimInput/index.ts',
    kind: 'platform-branch',
    values: {
      gemini: 1,
    },
    reason: 'Gemini Vim input keeps configured-composer resolution.',
  },
];
