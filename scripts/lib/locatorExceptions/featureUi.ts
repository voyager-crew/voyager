import type { LocatorLiteralException } from './types';

export const FEATURE_UI_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/features/timeline/userTurnText.ts',
    kind: 'protocol',
    values: {
      'model-response': 1,
      '[data-message-author-role="assistant"]': 1,
    },
    reason:
      'Full prompt serialization strips action/script/template/assistant content; remote text still requires complete authored-text equality.',
  },
  {
    file: 'src/pages/content/createMode/newChat.ts',
    kind: 'protocol',
    values: {
      'a[href="/"]': 2,
    },
    reason:
      "Create mode's new-chat link on DeepSeek and Kimi, which have no published newChat action; the value only coincides with ChatGPT's contract, and ChatGPT itself goes through chatgptActionSelector.",
  },
];
