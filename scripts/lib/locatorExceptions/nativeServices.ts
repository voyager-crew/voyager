import type { LocatorLiteralException } from './types';

export const NATIVE_SERVICES_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/core/services/AccountIsolationService.ts',
    kind: 'protocol',
    values: {
      '#chat-history': 1,
      'infinite-scroller.chat-history': 1,
      'infinite-scroller': 1,
      '.chat-history': 1,
      'chat-window-content': 1,
      'user-query': 1,
      'model-response': 1,
      'message-content': 1,
      '.markdown': 1,
      'deep-research-immersive-panel': 1,
      '[data-message-author-role]': 1,
    },
    reason:
      'All chat-history/turn/message/markdown/research/author-role values belong to GEMINI_CONTENT_SELECTOR, the immutable exclusion preventing conversation text from defining account identity. Design §6 explicitly retains account-content boundaries.',
  },
  {
    file: 'src/core/services/composer/chatgptRootProof.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role]': 1,
      '[data-chatgpt-selection-message-id]': 1,
    },
    reason:
      "provesChatgptComposerRoot independently requires exactly one native editable+submit owner and rejects page/transcript/dialog/navigation roots. Additional button[type=submit]/form equality independently establish the native original editor's only submit association.",
  },
  {
    file: 'src/core/services/composer/index.ts',
    kind: 'protocol',
    values: {
      'rich-textarea': 1,
    },
    reason:
      "rich-textarea classifies the already selected editor's Quill write protocol. Design §6 retains Quill/caret/editing behavior.",
  },
  {
    file: 'src/core/services/composer/siteInputReads.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role]': 1,
    },
    reason:
      'Native editable and foreign-owner policies independently establish the one site-owned editor; no remote locator can replace these guards.',
  },
];
