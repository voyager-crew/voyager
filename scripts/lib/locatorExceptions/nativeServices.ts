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
    file: 'src/core/services/KeyboardShortcutService.ts',
    kind: 'protocol',
    values: {
      textarea: 1,
    },
    reason:
      'textarea is a native tag-name comparison in isInputFocused; standard focus/typing safety, not composer discovery.',
  },
  {
    file: 'src/core/services/composer/chatgptRootProof.ts',
    kind: 'proof',
    values: {
      textarea: 1,
      '[role="dialog"]': 1,
      nav: 1,
      aside: 1,
      '[data-message-author-role]': 1,
      '[data-chatgpt-selection-message-id]': 1,
      main: 1,
      button: 1,
      form: 1,
    },
    reason:
      "provesChatgptComposerRoot independently requires exactly one native editable+submit owner and rejects page/transcript/dialog/navigation roots. Additional button[type=submit]/form equality independently establish the native original editor's only submit association.",
  },
  {
    file: 'src/core/services/composer/draft.ts',
    kind: 'protocol',
    values: {
      button: 1,
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
    },
    reason:
      'Fixed native upload evidence rejects inputs/buttons/labels/hidden nodes before attachment-ID/preview protocol checks. This preserves send/draft/upload policy.',
  },
  {
    file: 'src/core/services/composer/find.ts',
    kind: 'protocol',
    values: {
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
    },
    reason:
      'Hidden/inert/ARIA-disabled selectors are immutable native editable-availability refusal conditions, not site input location.',
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
    file: 'src/core/services/composer/sendGuards.ts',
    kind: 'protocol',
    values: {
      progress: 1,
      '[role="progressbar"]': 1,
    },
    reason:
      'progress/progressbar define native pending-upload refusal; immutable Send/upload guard under design §6.',
  },
  {
    file: 'src/core/services/composer/sendKeys/sendKeyCoordinator.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason:
      'An error-message template describing duplicate main send-mode registration; it never enters a DOM query.',
  },
  {
    file: 'src/core/services/composer/sendKeys/sendKeyDom.ts',
    kind: 'protocol',
    values: {
      textarea: 2,
      button: 3,
    },
    reason:
      'EditableKind discriminant and HTMLTextAreaElement tag classification; not a locator or query. Expanded native button descent/enumeration is bounded to the composer and preserves visibility/Send/Stop/disabled click protocol; native kind discriminants themselves are not selectors.',
  },
  {
    file: 'src/core/services/composer/siteComposerOperation.ts',
    kind: 'proof',
    values: {
      '[role="dialog"]': 1,
      textarea: 1,
      form: 1,
      button: 1,
      '[role="button"]': 1,
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
    },
    reason:
      'siteComposerOperation rejects foreign owners and requires a unique native editable in the proposed root, before admitting repaired composer controls. Additional native form equality/button enumeration/hidden checks prove the exact enabled Send target before repaired input can act.',
  },
  {
    file: 'src/core/services/composer/siteInputData.ts',
    kind: 'protocol',
    values: {
      ':not(*)': 1,
    },
    reason: ':not(*) is the internal absent-key/no-match sentinel rather than a page location.',
  },
  {
    file: 'src/core/services/composer/siteInputReads.ts',
    kind: 'proof',
    values: {
      textarea: 1,
      '[role="dialog"]': 1,
      '[data-message-author-role]': 1,
      nav: 1,
      aside: 1,
    },
    reason:
      'Native editable and foreign-owner policies independently establish the one site-owned editor; no remote locator can replace these guards.',
  },
];
