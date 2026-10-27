import type { LocatorLiteralException } from './types';

export const SELECTOR_PROOFS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/core/selectors/chatgptSemantics.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role="user"]': 1,
      '[data-message-author-role="assistant"]': 1,
      '[data-message-author-role="model"]': 1,
    },
    reason:
      'provesTurns compares candidate lists with complete native role/identity owners; foreign editable/dialog owners fail. Dynamic role values are packaged user/assistant protocol.',
  },
  {
    file: 'src/core/selectors/contracts/gemini.ts',
    kind: 'protocol',
    values: {
      'generated-image': 1,
    },
    reason: 'generated-image.json is a publication filename, not CSS.',
  },
  {
    file: 'src/core/selectors/placement.ts',
    kind: 'proof',
    values: {
      'gem-menu-item': 1,
    },
    reason:
      'Mount safety rejects composed editable ancestors. This is the fixed acceptance rule, not a page location. menu-row spelling/role comparison defines only the narrow packaged native decoration exception, after independent picker ownership proof.',
  },
];
